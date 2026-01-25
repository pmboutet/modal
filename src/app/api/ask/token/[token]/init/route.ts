import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabaseClient } from "@/lib/supabaseAdmin";
import { type ApiResponse } from "@/types";
import { getOrCreateConversationThread, shouldUseSharedThread } from "@/lib/asks";
import {
  getConversationPlanWithSteps,
  generateConversationPlan,
  createConversationPlan,
} from "@/lib/ai/conversation-plan";
import { executeAgent } from "@/lib/ai/service";
import { buildConversationAgentVariables } from "@/lib/ai/conversation-agent";
import { fetchElapsedTime } from "@/lib/conversation-context";
import * as Sentry from "@sentry/nextjs";

// Extend timeout for LLM calls (plan generation + initial message)
// Default Vercel timeout is 10s (Hobby) / 60s (Pro) which may not be enough
export const maxDuration = 60;

/**
 * POST /api/ask/token/[token]/init
 *
 * Async initialization endpoint for plan and initial message generation.
 * Called fire-and-forget from the main token route to avoid blocking.
 *
 * This endpoint:
 * 1. Generates the conversation plan if it doesn't exist
 * 2. Generates the initial AI message if no messages exist
 * 3. Returns immediately - caller should poll for completion
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const startTime = Date.now();

  try {
    const { token } = await params;
    const body = await request.json().catch(() => ({}));
    const { askSessionId, conversationThreadId, conversationMode } = body;

    if (!token || !askSessionId || !conversationThreadId) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Missing required parameters'
      }, { status: 400 });
    }

    console.log(`🚀 [init route] Starting async initialization`, {
      token,
      askSessionId,
      conversationThreadId,
      conversationMode,
    });

    const adminClient = getAdminSupabaseClient();

    // Try to acquire the initialization lock atomically
    // UPDATE ... WHERE is_initializing = false will only succeed if no other process has the lock
    const { data: lockAcquired, error: lockError } = await adminClient
      .from('conversation_threads')
      .update({ is_initializing: true })
      .eq('id', conversationThreadId)
      .eq('is_initializing', false)
      .select('id')
      .maybeSingle();

    if (lockError) {
      console.error('❌ [init route] Failed to acquire lock:', lockError.message);
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Failed to acquire initialization lock'
      }, { status: 500 });
    }

    if (!lockAcquired) {
      // Another process already has the lock or is_initializing was already true
      console.log(`⏳ [init route] Initialization already in progress for thread ${conversationThreadId}, skipping`);
      return NextResponse.json<ApiResponse>({
        success: true,
        data: {
          skipped: true,
          reason: 'initialization_already_in_progress',
        }
      });
    }

    console.log(`🔒 [init route] Lock acquired for thread ${conversationThreadId}`);

    // Wrap in try-finally to ensure we always release the lock
    try {
    // Fetch ask session data
    const { data: askRow, error: askError } = await adminClient
      .from('ask_sessions')
      .select('id, ask_key, question, description, project_id, challenge_id, conversation_mode')
      .eq('id', askSessionId)
      .single();

    if (askError || !askRow) {
      console.error('❌ [init route] Failed to fetch ask session:', askError?.message);
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Ask session not found'
      }, { status: 404 });
    }

    // Fetch participants for context
    const { data: participantRows } = await adminClient
      .from('ask_participants')
      .select('id, user_id, participant_name, participant_email, role, is_spokesperson')
      .eq('ask_session_id', askSessionId);

    const participants = (participantRows ?? []).map((p, index) => ({
      name: p.participant_name || p.participant_email || `Participant ${index + 1}`,
      role: p.role ?? null,
      description: null,
    }));

    // Check if plan already exists (might have been created by another request)
    let conversationPlan = await getConversationPlanWithSteps(adminClient, conversationThreadId);

    // Generate plan if it doesn't exist
    if (!conversationPlan) {
      console.log(`📋 [init route] Generating conversation plan...`);
      try {
        // BUG FIX: Pass currentParticipantName to ensure participant_name/participant_details are populated
        // even when messages array is empty (initial greeting)
        const firstParticipantName = participants.length > 0 ? participants[0].name : null;
        const planGenerationVariables = buildConversationAgentVariables({
          ask: {
            ask_key: askRow.ask_key,
            question: askRow.question,
            description: askRow.description,
            system_prompt: null,
          },
          project: null,
          challenge: null,
          messages: [],
          participants,
          currentParticipantName: firstParticipantName,
          conversationPlan: null,
        });

        const planData = await generateConversationPlan(
          adminClient,
          askSessionId,
          planGenerationVariables
        );
        console.log(`📋 [init route] Plan data generated`, {
          stepsCount: planData.steps?.length,
          firstStepId: planData.steps?.[0]?.id,
        });

        // Double-check for plan before creating to prevent race condition
        const existingPlan = await getConversationPlanWithSteps(adminClient, conversationThreadId);
        if (existingPlan) {
          console.log(`⚠️ [init route] Plan already exists (race condition prevented), skipping creation`);
          conversationPlan = existingPlan;
        } else {
          console.log(`📋 [init route] Creating plan in database...`);
          conversationPlan = await createConversationPlan(
            adminClient,
            conversationThreadId,
            planData
          );
          console.log(`✅ [init route] Plan created`, {
            planId: conversationPlan.id,
            stepsCount: conversationPlan.steps?.length,
          });
        }
      } catch (planError) {
        // Enhanced error logging to capture full error details
        let errorMsg: string;
        let errorDetails: Record<string, unknown> | undefined;
        if (planError instanceof Error) {
          errorMsg = planError.message;
          errorDetails = { stack: planError.stack };
        } else if (planError && typeof planError === 'object') {
          const errObj = planError as Record<string, unknown>;
          errorMsg = String(errObj.message || 'Unknown error');
          errorDetails = {
            code: errObj.code,
            details: errObj.details,
            hint: errObj.hint,
            status: errObj.status,
            statusCode: errObj.statusCode,
            fullError: JSON.stringify(errObj),
          };
        } else {
          errorMsg = String(planError);
        }
        console.error('❌ [init route] Plan generation failed:', errorMsg, errorDetails);
        Sentry.captureException(planError, {
          tags: {
            route: 'init',
            phase: 'plan_generation',
          },
          extra: {
            askSessionId,
            conversationThreadId,
            errorDetails,
          },
        });
        // IMPORTANT: Plan is REQUIRED - fail if generation fails
        return NextResponse.json<ApiResponse>({
          success: false,
          error: 'Failed to generate conversation plan. Please try again.'
        }, { status: 500 });
      }
    } else {
      console.log(`📋 [init route] Plan already exists`);
    }

    // Check if messages exist
    const { data: existingMessages } = await adminClient
      .from('messages')
      .select('id')
      .eq('conversation_thread_id', conversationThreadId)
      .limit(1);

    const hasMessages = existingMessages && existingMessages.length > 0;

    // Generate initial message if no messages exist and not consultant mode
    if (!hasMessages && conversationMode !== 'consultant') {
      console.log(`💬 [init route] Generating initial message...`);
      try {
        // Fetch elapsed times
        const { elapsedActiveSeconds, stepElapsedActiveSeconds } = await fetchElapsedTime({
          supabase: adminClient,
          askSessionId,
          profileId: null,
          conversationPlan,
          participantRows: participantRows ?? [],
        });

        // BUG FIX: Pass currentParticipantName to ensure participant_name/participant_details are populated
        // even when messages array is empty (initial greeting)
        const firstParticipant = participants.length > 0 ? participants[0].name : null;
        const agentVariables = buildConversationAgentVariables({
          ask: {
            ask_key: askRow.ask_key,
            question: askRow.question,
            description: askRow.description,
            system_prompt: null,
          },
          project: null,
          challenge: null,
          messages: [],
          participants,
          currentParticipantName: firstParticipant,
          conversationPlan,
          elapsedActiveSeconds,
          stepElapsedActiveSeconds,
        });

        const agentResult = await executeAgent({
          supabase: adminClient,
          agentSlug: 'ask-conversation-response',
          askSessionId,
          interactionType: 'ask.chat.response',
          variables: agentVariables,
          toolContext: {
            projectId: askRow.project_id,
            challengeId: askRow.challenge_id,
          },
        });

        if (typeof agentResult.content === 'string' && agentResult.content.trim().length > 0) {
          const aiResponse = agentResult.content.trim();
          const activeStepId = conversationPlan?.steps?.find(s => s.status === 'active')?.id ?? null;
          console.log(`💬 [init route] AI response generated`, {
            responseLength: aiResponse.length,
            activeStepId,
            hasConversationPlan: !!conversationPlan,
            stepsCount: conversationPlan?.steps?.length,
          });

          // Double-check for messages before insert to prevent race condition
          // Another init request might have already created the message while we were generating
          const { data: messagesBeforeInsert } = await adminClient
            .from('messages')
            .select('id')
            .eq('conversation_thread_id', conversationThreadId)
            .limit(1);

          if (messagesBeforeInsert && messagesBeforeInsert.length > 0) {
            console.log(`⚠️ [init route] Message already exists (race condition prevented), skipping insert`);
          } else {
            console.log(`💬 [init route] Inserting AI message via RPC...`);
            const { data: insertedMessage, error: insertError } = await adminClient.rpc('insert_ai_message', {
              p_ask_session_id: askSessionId,
              p_conversation_thread_id: conversationThreadId,
              p_content: aiResponse,
              p_sender_name: 'Agent',
              p_plan_step_id: activeStepId,
            });

            if (insertError) {
              console.error('❌ [init route] Failed to insert initial message:', {
                message: insertError.message,
                details: insertError.details,
                hint: insertError.hint,
                code: insertError.code,
              });
            } else {
              console.log(`✅ [init route] Initial message created`, {
                messageId: insertedMessage?.id,
              });
            }
          }
        } else {
          console.warn(`⚠️ [init route] Agent returned empty content`, {
            contentType: typeof agentResult.content,
            contentLength: typeof agentResult.content === 'string' ? agentResult.content.length : 'N/A',
          });
        }
      } catch (msgError) {
        const errorMsg = msgError instanceof Error ? msgError.message : String(msgError);
        console.error('❌ [init route] Initial message generation failed:', errorMsg);
        // Report to Sentry for visibility - this was silently failing before
        Sentry.captureException(msgError, {
          tags: {
            route: 'init',
            phase: 'initial_message_generation',
          },
          extra: {
            askSessionId,
            conversationThreadId,
            conversationMode,
          },
        });
      }
    } else if (hasMessages) {
      console.log(`💬 [init route] Messages already exist`);
    }

    const duration = Date.now() - startTime;
    console.log(`✅ [init route] Initialization complete in ${duration}ms`);

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        planCreated: !!conversationPlan,
        messageCreated: !hasMessages && conversationMode !== 'consultant',
        durationMs: duration,
      }
    });
    } finally {
      // Always release the lock when done (success or error within the lock block)
      const { error: unlockError } = await adminClient
        .from('conversation_threads')
        .update({ is_initializing: false })
        .eq('id', conversationThreadId);

      if (unlockError) {
        console.error('❌ [init route] Failed to release lock:', unlockError.message);
      } else {
        console.log(`🔓 [init route] Lock released for thread ${conversationThreadId}`);
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('❌ [init route] Unexpected error:', errorMsg);
    Sentry.captureException(error, {
      tags: {
        route: 'init',
        phase: 'unexpected_error',
      },
    });
    return NextResponse.json<ApiResponse>({
      success: false,
      error: errorMsg
    }, { status: 500 });
  }
}
