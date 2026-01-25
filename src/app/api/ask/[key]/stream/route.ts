import { NextRequest } from 'next/server';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { isValidAskKey, parseErrorMessage } from '@/lib/utils';

// Extend timeout for streaming LLM responses
export const maxDuration = 60;
import { getAskSessionByKey, getOrCreateConversationThread, getMessagesForThread, getLastUserMessageThread, shouldUseSharedThread } from '@/lib/asks';
import { normaliseMessageMetadata } from '@/lib/messages';
import { callModelProviderStream } from '@/lib/ai/providers';
import { createAgentLog, markAgentLogProcessing, completeAgentLog, failAgentLog, createStreamingDebugLogger, buildStreamingResponsePayload } from '@/lib/ai/logs';
import { DEFAULT_MAX_OUTPUT_TOKENS } from '@/lib/ai/constants';
import { getAgentConfigForAsk, DEFAULT_CHAT_AGENT_SLUG, type AgentConfigResult } from '@/lib/ai/agent-config';
import type { AiAgentLog, Insight } from '@/types';
import { createServerSupabaseClient } from '@/lib/supabaseServer';
import { buildConversationAgentVariables } from '@/lib/ai/conversation-agent';
import { detectStepCompletion, completeStep, getConversationPlanWithSteps, getActiveStep, getCurrentStep } from '@/lib/ai/conversation-plan';
import { handleSubtopicSignals, cleanAllSignalMarkers } from '@/lib/ai/conversation-signals';
import {
  buildParticipantDisplayName,
  buildDetailedMessage,
  fetchElapsedTime,
  fetchParticipantsWithUsers,
  fetchParticipantByToken,
  fetchProfileByAuthId,
  fetchUserParticipation,
  fetchUsersByIds,
  addAnonymousParticipant,
  fetchThreadById,
  fetchMessagesWithoutThread,
  fetchMessagesBySession,
  fetchProjectById,
  fetchChallengeById,
  fetchRecentMessages,
  insertAiMessage,
  type AskSessionRow,
  type UserRow,
  type MessageRow,
  type ProjectRow,
  type ChallengeRow,
  type ParticipantRow,
} from '@/lib/conversation-context';

interface InsightDetectionResponse {
  success: boolean;
  data?: { insights?: Insight[] };
  error?: string;
}

const CHAT_AGENT_SLUG = DEFAULT_CHAT_AGENT_SLUG;

// Types imported from @/lib/conversation-context:
// - AskSessionRow
// - UserRow
// - MessageRow
// - buildParticipantDisplayName (unified function)
// - buildMessageSummary (unified function)

function isPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = ((error as PostgrestError).code ?? '').toString().toUpperCase();
  if (code === '42501' || code === 'PGRST301' || code === 'PGRST302') {
    return true;
  }

  const message = ((error as { message?: string }).message ?? '').toString().toLowerCase();
  return message.includes('permission denied') || message.includes('unauthorized');
}

function permissionDeniedResponse(): Response {
  return new Response('Accès non autorisé à cette ASK', { status: 403 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;

    if (!key || !isValidAskKey(key)) {
      return new Response('Invalid ASK key format', { status: 400 });
    }

    const supabase = await createServerSupabaseClient();
    const isDevBypass = process.env.IS_DEV === 'true';

    let dataClient: SupabaseClient = supabase;
    let adminClient: SupabaseClient | null = null;
    const getAdminClient = async () => {
      if (!adminClient) {
        const { getAdminSupabaseClient } = await import('@/lib/supabaseAdmin');
        adminClient = getAdminSupabaseClient();
      }
      return adminClient;
    };

    const inviteToken = request.headers.get('X-Invite-Token');
    let profileId: string | null = null;
    let tokenAskSessionId: string | null = null;
    let authenticatedViaToken = false;
    let currentParticipantId: string | null = null; // For graph generation trigger

    if (!isDevBypass && inviteToken) {
      const admin = await getAdminClient();
      // Use RPC wrapper to bypass RLS in production
      const participant = await fetchParticipantByToken(admin, inviteToken);

      if (!participant || !participant.user_id) {
        console.error('❌ Invite token invalid or missing linked user profile for streaming');
        return new Response("Ce lien d'invitation n'est associé à aucun profil utilisateur. Contactez votre administrateur.", { status: 403 });
      }

      profileId = participant.user_id;
      currentParticipantId = participant.id; // Store participant ID for graph generation
      tokenAskSessionId = (participant as ParticipantRow & { ask_session_id?: string }).ask_session_id ?? null;
      dataClient = admin;
      authenticatedViaToken = true;
    }

    if (!isDevBypass && !profileId) {
      const { data: userResult, error: userError } = await supabase.auth.getUser();

      if (userError) {
        if (isPermissionDenied(userError)) {
          return permissionDeniedResponse();
        }
        throw userError;
      }

      const user = userResult?.user;

      if (!user) {
        return new Response('Authentification requise', { status: 401 });
      }

      // Use RPC wrapper to bypass RLS in production
      const admin = await getAdminClient();
      const profile = await fetchProfileByAuthId(admin, user.id);

      if (!profile) {
        return new Response('Profil utilisateur introuvable', { status: 401 });
      }

      profileId = profile.id;
      // BUG FIX: Use admin client for all authenticated users (not just invite token)
      // This ensures ai_agent_logs INSERT has proper permissions (service_role bypasses RLS)
      dataClient = admin;
    }

    const { row: askRow, error: askError } = await getAskSessionByKey<AskSessionRow & { conversation_mode?: string | null }>(
      dataClient,
      key,
      'id, ask_key, question, description, status, system_prompt, project_id, challenge_id, allow_auto_registration, conversation_mode, expected_duration_minutes'
    );

    if (askError) {
      if (isPermissionDenied(askError)) {
        return permissionDeniedResponse();
      }
      throw askError;
    }

    if (!askRow) {
      return new Response('ASK introuvable pour la clé fournie', { status: 404 });
    }

    if (authenticatedViaToken && tokenAskSessionId && tokenAskSessionId !== askRow.id) {
      console.error('Invite token does not belong to this ASK session', { tokenAskSessionId, requestedId: askRow.id });
      return permissionDeniedResponse();
    }

    if (!isDevBypass && profileId && !authenticatedViaToken) {
      const allowAutoReg = askRow.allow_auto_registration === true;

      // Check if user is a participant via RPC wrapper
      const adminCheck = await getAdminClient();
      const membership = await fetchUserParticipation(adminCheck, askRow.id, profileId);

      // If session allows auto-registration, allow access even if not in participants list
      // Otherwise, require explicit participation
      if (!membership && !allowAutoReg) {
        return permissionDeniedResponse();
      }

      // If auto-registration enabled and user is not yet a participant, create one automatically via RPC wrapper
      if (allowAutoReg && !membership) {
        await addAnonymousParticipant(adminCheck, askRow.id, profileId, null);
      }
    }

    // Fetch participants and users via centralized helper (DRY)
    const adminParticipants = await getAdminClient();
    const {
      participantRows,
      usersById: fetchedUsersById,
      projectMembersById,
      participants: participantSummaries,
    } = await fetchParticipantsWithUsers(adminParticipants, askRow.id, askRow.project_id);

    let usersById = fetchedUsersById;

    // BUG-GRAPH-001 FIX: Lookup participant ID for non-token auth
    // currentParticipantId is only set when authenticating via invite token (line 113).
    // For users authenticated via Supabase session, dev bypass, or auto-registration,
    // we need to find their participant ID from participantRows using profileId.
    if (!currentParticipantId && profileId) {
      const matchingParticipant = participantRows?.find(p => p.user_id === profileId);
      if (matchingParticipant) {
        currentParticipantId = matchingParticipant.id;
        console.log('[Stream] BUG-GRAPH-001 FIX: Found participant ID from profile:', currentParticipantId);
      }
    }

    // Build participants with extra fields needed by this route
    const participants = (participantRows ?? []).map((row, index) => {
      const user = row.user_id ? usersById[row.user_id] ?? null : null;
      const projectMember = row.user_id ? projectMembersById[row.user_id] ?? null : null;
      return {
        id: row.id,
        name: buildParticipantDisplayName(row, user, index),
        email: row.participant_email ?? user?.email ?? null,
        role: row.role ?? null,
        // Priority: project-specific description > profile description
        description: projectMember?.description ?? user?.description ?? null,
        isSpokesperson: Boolean(row.is_spokesperson),
        isActive: true,
      };
    });

    // Get conversation thread for AI response
    // BUG FIX: For individual_parallel mode, AI must respond in the SAME thread as the user message.
    // We find the last user message's thread instead of using resolveThreadUserId() which
    // picks the first participant (may be different from the user who sent the message).
    const askConfig = {
      conversation_mode: askRow.conversation_mode ?? null,
    };

    // In dev bypass mode, use admin client to bypass RLS for thread operations
    const threadClient = isDevBypass ? await getAdminClient() : dataClient;

    let conversationThread: { id: string; is_shared: boolean } | null = null;

    // First, try to find the thread from the last user message
    const { threadId: lastUserThreadId, userId: lastUserUserId } = await getLastUserMessageThread(
      threadClient,
      askRow.id
    );

    if (lastUserThreadId) {
      // Use the same thread as the last user message via RPC wrapper
      console.log('[stream] Using thread from last user message:', lastUserThreadId);
      const threadAdmin = await getAdminClient();
      const existingThread = await fetchThreadById(threadAdmin, lastUserThreadId);

      if (existingThread) {
        conversationThread = existingThread;
      }
    }

    // Fallback: create/get thread based on profileId or last user's userId
    if (!conversationThread) {
      const threadUserId = profileId ?? lastUserUserId ?? null;
      const { thread, error: threadError } = await getOrCreateConversationThread(
        threadClient,
        askRow.id,
        threadUserId,
        askConfig
      );

      if (threadError) {
        if (isPermissionDenied(threadError)) {
          return permissionDeniedResponse();
        }
        throw threadError;
      }
      conversationThread = thread;
    }

    // Get messages for the thread (or all messages if no thread for backward compatibility)
    // BUG-005 FIX: In individual_parallel mode, ONLY show messages from the user's thread
    // Do NOT include legacy messages without thread_id as they may belong to other participants
    let messageRows: MessageRow[] = [];
    if (conversationThread) {
      const { messages: threadMessages, error: threadMessagesError } = await getMessagesForThread(
        dataClient,
        conversationThread.id
      );

      if (threadMessagesError) {
        if (isPermissionDenied(threadMessagesError)) {
          return permissionDeniedResponse();
        }
        throw threadMessagesError;
      }

      const threadMessagesList = (threadMessages ?? []) as MessageRow[];

      // BUG-005 FIX: Only include messages without thread_id in shared modes
      // In individual_parallel mode, strict isolation means no legacy messages
      if (shouldUseSharedThread(askConfig)) {
        // Shared mode: also include messages without thread_id for backward compatibility
        const msgAdmin = await getAdminClient();
        const messagesWithoutThread = await fetchMessagesWithoutThread(msgAdmin, askRow.id);

        messageRows = [...threadMessagesList, ...messagesWithoutThread].sort((a, b) => {
          const timeA = new Date(a.created_at ?? new Date().toISOString()).getTime();
          const timeB = new Date(b.created_at ?? new Date().toISOString()).getTime();
          return timeA - timeB;
        });
      } else {
        // Individual_parallel mode: strict isolation - only messages from this thread
        messageRows = threadMessagesList;
        console.log(`🔒 [stream] Individual thread mode - showing ${messageRows.length} messages from thread ${conversationThread.id}`);
      }
    } else {
      // Fallback: get all messages for backward compatibility via RPC wrapper
      const fallbackMsgAdmin = await getAdminClient();
      messageRows = await fetchMessagesBySession(fallbackMsgAdmin, askRow.id);
    }

    const messageUserIds = messageRows
      .map(row => row.user_id)
      .filter((value): value is string => Boolean(value));

    const additionalUserIds = messageUserIds.filter(id => !usersById[id]);

    if (additionalUserIds.length > 0) {
      // Use RPC wrapper to fetch additional profiles
      const extraProfilesAdmin = await getAdminClient();
      const additionalUsers = await fetchUsersByIds(extraProfilesAdmin, additionalUserIds);
      usersById = { ...usersById, ...additionalUsers };
    }

    // Use unified buildDetailedMessage function for consistent message mapping
    // This ensures senderName logic and planStepId are consistent across all modes
    const messages = (messageRows ?? []).map((row, index) => {
      const user = row.user_id ? usersById[row.user_id] ?? null : null;
      return buildDetailedMessage(row, user, index, askRow.ask_key);
    });

    // Fetch project and challenge data via RPC wrappers
    const contextAdmin = await getAdminClient();
    const projectData = askRow.project_id
      ? await fetchProjectById(contextAdmin, askRow.project_id)
      : null;
    const challengeData = askRow.challenge_id
      ? await fetchChallengeById(contextAdmin, askRow.challenge_id)
      : null;

    // Load conversation plan if thread exists
    // Use admin client to bypass RLS and ensure we always get the plan data
    let conversationPlan = null;
    if (conversationThread) {
      const planClient = await getAdminClient();
      conversationPlan = await getConversationPlanWithSteps(planClient, conversationThread.id);
    }

    // Fetch elapsed times using centralized helper (DRY)
    // IMPORTANT: Pass participantRows to use fallback (first participant) when profileId is null
    const { elapsedActiveSeconds, stepElapsedActiveSeconds } = await fetchElapsedTime({
      supabase: dataClient,
      askSessionId: askRow.id,
      profileId,
      conversationPlan,
      participantRows: participantRows ?? [],
      adminClient: await getAdminClient(),
    });

    // Parse the request body to get the new user message
    let newUserMessage = '';
    try {
      const body = await request.json();
      newUserMessage = body.message || body.content || '';
    } catch (error) {
      // Ignore parsing errors - may not have a body
    }

    // Find the current participant name from the last user message sender
    // or from the profileId (user who made this request)
    const currentUserId = profileId ?? lastUserUserId;
    const currentParticipant = currentUserId
      ? participants.find(p => {
          const participantRow = (participantRows ?? []).find(r => r.id === p.id);
          return participantRow?.user_id === currentUserId;
        })
      : null;

    const agentVariables = buildConversationAgentVariables({
      ask: {
        ...askRow,
        conversation_mode: askRow.conversation_mode ?? null,
      },
      project: projectData,
      challenge: challengeData,
      messages,
      participants: participantSummaries,
      currentParticipantName: currentParticipant?.name ?? null,
      conversationPlan,
      elapsedActiveSeconds,
      stepElapsedActiveSeconds,
    });

    // Override latest_user_message with the new message from the request
    if (newUserMessage) {
      agentVariables.latest_user_message = newUserMessage;
    }

    let agentConfig: AgentConfigResult;
    try {
      // Utiliser getAgentConfigForAsk qui gère correctement les system_prompt depuis la base
      agentConfig = await getAgentConfigForAsk(dataClient, askRow.id, agentVariables);
    } catch (error) {
      if (isPermissionDenied(error)) {
        return permissionDeniedResponse();
      }
      console.error('Error getting chat agent config:', error);

      return new Response(JSON.stringify({
        type: 'error',
        error: `Configuration de l'agent introuvable: ${error instanceof Error ? error.message : String(error)}. Vérifiez la table ai_agents.`,
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    const resolvedUserPrompt = agentConfig.userPrompt;

    if (!resolvedUserPrompt || resolvedUserPrompt.trim().length === 0) {
      return new Response(JSON.stringify({
        type: 'error',
        error: 'Le prompt utilisateur de l’agent est vide. Vérifiez la configuration AI.',
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    const prompts = {
      system: agentConfig.systemPrompt,
      user: resolvedUserPrompt,
    };

    /// Vibe Coding: Les variables sont déjà compilées dans les prompts via Handlebars
    // Le payload ne contient que les prompts finaux (system et user)
    // Also store step_messages_json for debugging context issues
    const agentRequestPayload = {
      agentSlug: CHAT_AGENT_SLUG,
      modelConfigId: agentConfig.modelConfig.id,
      systemPrompt: prompts.system,
      userPrompt: prompts.user,
      // Debug: store step messages to verify context is properly populated
      stepMessagesJson: agentVariables.step_messages_json ?? null,
      currentStepId: agentVariables.current_step_id ?? null,
    } satisfies Record<string, unknown>;

    // Create a log entry for tracking
    let log: AiAgentLog | null = null;
    try {
      log = await createAgentLog(dataClient, {
        agentId: agentConfig.agent?.id || null,
        askSessionId: askRow.id,
        messageId: null,
        interactionType: 'ask.chat.response',
        requestPayload: agentRequestPayload,
      });
    } catch (error) {
      console.error('Unable to create agent log for streaming response:', error);
    }

    // Create streaming response
    const encoder = new TextEncoder();
    const streamingDebugLogger = log ? createStreamingDebugLogger(log.id) : null;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          let fullContent = '';
          const startTime = Date.now();

          // Mark log as processing
          if (log) {
            try {
              await markAgentLogProcessing(dataClient, log.id, { modelConfigId: agentConfig.modelConfig.id });
            } catch (error) {
              console.error('Unable to mark agent log processing:', error);
            }
          }

          try {
            for await (const chunk of callModelProviderStream(
              agentConfig.modelConfig,
              {
                systemPrompt: prompts.system,
                userPrompt: prompts.user,
                maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
              }
            )) {
            if (chunk.content) {
              fullContent += chunk.content;

              // Log chunk for debugging
              if (streamingDebugLogger) {
                streamingDebugLogger.logChunk(chunk.content, chunk.raw);
              }

              // Send chunk to client
              const data = JSON.stringify({
                type: 'chunk',
                content: chunk.content,
                done: chunk.done
              });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }

            if (chunk.done) {
              // Store the complete message in database
              if (fullContent.trim()) {
                // Use admin client for AI message insertion to bypass RLS
                // This ensures AI responses are always saved, regardless of user permissions
                const insertClient = await getAdminClient();

                // Trouver le dernier message utilisateur pour le lier comme parent via RPC wrapper
                const recentMessages = await fetchRecentMessages(insertClient, askRow.id, 10);
                const lastUserMessage = recentMessages.find(msg => msg.sender_type === 'user');
                const parentMessageId = lastUserMessage?.id ?? null;

                // Get the currently active plan step to link this message
                let planStepId: string | null = null;
                if (conversationThread) {
                  try {
                    const plan = await getConversationPlanWithSteps(insertClient, conversationThread.id);
                    if (plan) {
                      const activeStep = await getActiveStep(insertClient, plan.id);
                      if (activeStep) {
                        planStepId = activeStep.id;
                      }
                    }
                  } catch (error) {
                    console.warn('⚠️ Failed to get active step for message linking in stream:', error);
                    // Continue without linking to step
                  }
                }

                // BUG-022 FIX: Validate thread exists before inserting in individual_parallel mode
                // In individual_parallel mode, messages MUST have a thread_id to maintain isolation
                const isIndividualParallelMode = !shouldUseSharedThread({
                  conversation_mode: askRow.conversation_mode ?? null,
                });

                if (isIndividualParallelMode && !conversationThread) {
                  console.error('❌ [stream] BUG-022: Cannot insert message without thread in individual_parallel mode');
                  const errorData = JSON.stringify({
                    type: 'error',
                    error: 'Thread required for individual_parallel mode but not available'
                  });
                  controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
                  controller.close();
                  return;
                }

                // Clean signal markers from content before storing
                // Signals are processed separately but should not appear in stored messages
                const cleanedContent = cleanAllSignalMarkers(fullContent.trim());

                // Insert AI message via RPC wrapper to bypass RLS
                // Pass planStepId to link message to current step (fixes context loss bug)
                const inserted = await insertAiMessage(
                  insertClient,
                  askRow.id,
                  conversationThread?.id ?? null,
                  cleanedContent,
                  'Agent',
                  planStepId
                );

                if (!inserted) {
                  console.error('Error storing AI response');
                  // Send error event to client so they know the message wasn't saved
                  const errorData = JSON.stringify({
                    type: 'error',
                    error: 'Failed to save AI response to database'
                  });
                  controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
                } else {
                  const message = {
                    id: inserted.id,
                    askKey: askRow.ask_key,
                    askSessionId: inserted.ask_session_id,
                    content: inserted.content,
                    type: (inserted.message_type as any) ?? 'text',
                    senderType: 'ai' as const,
                    senderId: inserted.user_id ?? null,
                    senderName: 'Agent',
                    timestamp: inserted.created_at ?? new Date().toISOString(),
                    metadata: normaliseMessageMetadata(inserted.metadata),
                  };

                  // Send final message
                  const finalData = JSON.stringify({
                    type: 'message',
                    message: message
                  });
                  controller.enqueue(encoder.encode(`data: ${finalData}\n\n`));

                  // Check for step completion markers
                  if (conversationThread) {
                    const detectedStepId = detectStepCompletion(fullContent.trim());
                    if (detectedStepId) {
                      try {
                        // Use admin client to ensure we can read the plan regardless of RLS
                        const adminForPlan = await getAdminClient();
                        const plan = await getConversationPlanWithSteps(adminForPlan, conversationThread.id);
                        if (plan) {
                          const currentStep = getCurrentStep(plan);

                          // Support both normalized and legacy step structures
                          const currentStepIdentifier = currentStep && 'step_identifier' in currentStep
                            ? currentStep.step_identifier
                            : currentStep?.id;

                          // If 'CURRENT' was returned, use the current step identifier
                          // Otherwise validate that detected ID matches current step
                          const stepIdToComplete = detectedStepId === 'CURRENT'
                            ? currentStepIdentifier
                            : detectedStepId;

                          if (currentStep && (detectedStepId === 'CURRENT' || currentStepIdentifier === detectedStepId)) {
                            // BUG-024 FIX: Only send step_completed event if completeStep() succeeds
                            // Use admin client for RLS bypass
                            const adminForStepUpdate = await getAdminClient();

                            try {
                              // Complete the step (summary will be generated asynchronously)
                              await completeStep(
                                adminForStepUpdate,
                                conversationThread.id,
                                stepIdToComplete!,
                                undefined, // No pre-generated summary - let the async agent generate it
                                askRow.id // Pass askSessionId to trigger async summary generation
                              );

                              // Fetch the updated plan and send step_completed event to client
                              // Only reached if completeStep() succeeded
                              const updatedPlan = await getConversationPlanWithSteps(adminForStepUpdate, conversationThread.id);
                              if (updatedPlan) {
                                const stepCompletedEvent = JSON.stringify({
                                  type: 'step_completed',
                                  conversationPlan: updatedPlan,
                                  completedStepId: stepIdToComplete,
                                });
                                controller.enqueue(encoder.encode(`data: ${stepCompletedEvent}\n\n`));

                                // Check if all steps are completed to trigger graph generation
                                const steps = updatedPlan.plan_data?.steps || [];
                                const allStepsCompleted = steps.length > 0 && steps.every(
                                  (s: { status?: string }) => s.status === 'completed' || s.status === 'skipped'
                                );

                                if (allStepsCompleted && currentParticipantId) {
                                  // Trigger graph generation in background (don't block the stream)
                                  console.log(`[Stream] All steps completed for participant ${currentParticipantId}, triggering graph generation`);
                                  import('@/lib/graphRAG/generateParticipantGraph').then(({ generateParticipantGraph }) => {
                                    generateParticipantGraph(currentParticipantId!, askRow.id, adminForStepUpdate)
                                      .then(result => {
                                        if (result.success) {
                                          console.log(`[Stream] Graph generation complete: ${result.claimsCreated} claims, ${result.edgesCreated} edges`);
                                        } else {
                                          console.error(`[Stream] Graph generation failed: ${result.error}`);
                                        }
                                      })
                                      .catch(err => console.error('[Stream] Graph generation error:', err));
                                  });
                                }
                              }
                            } catch (stepError) {
                              // BUG-024 FIX: Log the error but do NOT send step_completed event
                              // This prevents UI/database state disconnect
                              console.error('❌ [stream] BUG-024: completeStep() failed, not sending step_completed event:', stepError);
                            }
                          }
                        }
                      } catch (planError) {
                        console.error('Failed to update conversation plan in stream:', planError);
                        // Don't fail the stream if plan update fails
                      }
                    }

                    // Handle subtopic signals (TOPICS_DISCOVERED, TOPIC_EXPLORED, TOPIC_SKIPPED)
                    try {
                      const adminForSubtopics = await getAdminClient();
                      const subtopicResult = await handleSubtopicSignals(
                        adminForSubtopics,
                        conversationThread.id,
                        fullContent.trim()
                      );
                      if (subtopicResult) {
                        console.log('[stream] 🔄 Subtopic signals handled:', subtopicResult);
                      }
                    } catch (subtopicError) {
                      console.error('[stream] ⚠️ Failed to handle subtopic signals:', subtopicError);
                      // Don't fail the stream if subtopic handling fails
                    }
                  }
                }
              }

              // Trigger insight detection to capture KPI insights
              try {
                const respondUrl = new URL(request.url);
                respondUrl.pathname = `/api/ask/${encodeURIComponent(key)}/respond`;
                respondUrl.search = '';

                const detectionHeaders: Record<string, string> = {
                  'Content-Type': 'application/json',
                  ...(request.headers.get('cookie') ? { Cookie: request.headers.get('cookie')! } : {}),
                };

                if (inviteToken) {
                  detectionHeaders['X-Invite-Token'] = inviteToken;
                }

                const detectionResponse = await fetch(respondUrl.toString(), {
                  method: 'POST',
                  headers: detectionHeaders,
                  body: JSON.stringify({
                    detectInsights: true,
                    askSessionId: askRow.id,
                  }),
                  cache: 'no-store',
                });

                if (detectionResponse.ok) {
                  const detectionJson = (await detectionResponse.json()) as InsightDetectionResponse;

                  if (detectionJson.success) {
                    const insights = detectionJson.data?.insights ?? [];

                    const insightsEvent = JSON.stringify({
                      type: 'insights',
                      insights,
                    });
                    controller.enqueue(encoder.encode(`data: ${insightsEvent}\n\n`));
                  } else if (detectionJson.error) {
                    console.warn('Insight detection responded with error:', detectionJson.error);
                  }
                } else {
                  console.error('Insight detection request failed:', detectionResponse.status, detectionResponse.statusText);
                }
              } catch (insightError) {
                console.error('Unable to detect insights:', insightError);
              }

              // Send completion signal
              controller.enqueue(encoder.encode(`data: {"type": "done"}\n\n`));
              
              // Complete the log with streaming debug info
              if (log) {
                try {
                  const debugLog = streamingDebugLogger?.finalize();
                  const responsePayload = debugLog
                    ? buildStreamingResponsePayload(fullContent, debugLog)
                    : { content: fullContent, streaming: true };

                  await completeAgentLog(dataClient, log.id, {
                    responsePayload,
                    latencyMs: Date.now() - startTime,
                  });
                } catch (error) {
                  console.error('Unable to complete agent log:', error);
                }
              }
              
              controller.close();
            }
          }
          } catch (streamError) {
            console.error('Error in model provider stream:', streamError);

            // Log the error in debug logger
            if (streamingDebugLogger) {
              streamingDebugLogger.logError(parseErrorMessage(streamError));
            }

            // Fail the log
            if (log) {
              try {
                await failAgentLog(dataClient, log.id, parseErrorMessage(streamError));
              } catch (failError) {
                console.error('Unable to mark agent log as failed:', failError);
              }
            }
            
            const errorData = JSON.stringify({
              type: 'error',
              error: parseErrorMessage(streamError)
            });
            controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
            controller.close();
            return;
          }
        } catch (error) {
          console.error('Streaming error:', error);

          // Log the error in debug logger
          if (streamingDebugLogger) {
            streamingDebugLogger.logError(parseErrorMessage(error));
          }

          // Fail the log
          if (log) {
            try {
              await failAgentLog(dataClient, log.id, parseErrorMessage(error));
            } catch (failError) {
              console.error('Unable to mark agent log as failed:', failError);
            }
          }
          
          const errorData = JSON.stringify({
            type: 'error',
            error: parseErrorMessage(error)
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('Error in streaming endpoint:', error);
    return new Response(parseErrorMessage(error), { status: 500 });
  }
}
