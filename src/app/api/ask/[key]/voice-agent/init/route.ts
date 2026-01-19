import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabaseServer';
import { executeAgent } from '@/lib/ai/service';
import { DEFAULT_CHAT_AGENT_SLUG } from '@/lib/ai/agent-config';
import { getAskSessionByKey, getOrCreateConversationThread, getMessagesForThread, resolveThreadUserId } from '@/lib/asks';
import { getConversationPlanWithSteps, getActiveStep, ensureConversationPlanExists } from '@/lib/ai/conversation-plan';
import { getAdminSupabaseClient } from '@/lib/supabaseAdmin';
import { parseErrorMessage } from '@/lib/utils';
import type { ApiResponse } from '@/types';
import { buildConversationAgentVariables } from '@/lib/ai/conversation-agent';
import {
  buildMessageSummary,
  fetchElapsedTime,
  fetchParticipantsWithUsers,
  fetchProfileByAuthId,
  fetchProjectById,
  fetchChallengeById,
  fetchMessagesWithoutThread,
  fetchUsersByIds,
  insertAiMessage,
  type AskSessionRow,
  type UserRow,
  type MessageRow,
} from '@/lib/conversation-context';

const CHAT_AGENT_SLUG = DEFAULT_CHAT_AGENT_SLUG;
const CHAT_INTERACTION_TYPE = 'ask.chat.response.voice';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    const supabase = await createServerSupabaseClient();

    // Get ASK session
    const { row: askRow, error: askError } = await getAskSessionByKey<AskSessionRow>(
      supabase,
      key,
      'id, ask_key, question, description, status, system_prompt, project_id, challenge_id, conversation_mode, expected_duration_minutes'
    );

    if (askError || !askRow) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'ASK session not found'
      }, { status: 404 });
    }

    // Fetch participants and users via centralized helper (DRY)
    const adminClient = getAdminSupabaseClient();
    const {
      participantRows,
      usersById: fetchedUsersById,
      projectMembersById,
      participants: participantSummaries,
    } = await fetchParticipantsWithUsers(adminClient, askRow.id, askRow.project_id);

    let usersById = fetchedUsersById;

    // Try to get current user for thread determination via RPC wrapper
    const isDevBypass = process.env.IS_DEV === 'true';
    let profileId: string | null = null;
    try {
      const { data: userResult } = await supabase.auth.getUser();
      if (userResult?.user) {
        const profile = await fetchProfileByAuthId(adminClient, userResult.user.id);
        if (profile) {
          profileId = profile.id;
        }
      }
    } catch (error) {
      // Ignore auth errors - will use resolveThreadUserId fallback
    }

    // Get or create conversation thread using resolveThreadUserId for proper thread assignment
    const askConfig = {
      conversation_mode: askRow.conversation_mode ?? null,
    };

    // Use resolveThreadUserId for consistent thread assignment across all routes
    // Map participantRows to ensure they conform to Participant interface
    const participantsForThread = participantRows.map(p => ({
      ...p,
      user_id: p.user_id ?? null,
    }));
    const threadProfileId = resolveThreadUserId(
      profileId,
      askRow.conversation_mode,
      participantsForThread,
      isDevBypass
    );

    const { thread: conversationThread } = await getOrCreateConversationThread(
      supabase,
      askRow.id,
      threadProfileId,
      askConfig
    );

    // Fetch project and challenge data via RPC wrappers
    const projectData = askRow.project_id
      ? await fetchProjectById(adminClient, askRow.project_id)
      : null;
    const challengeData = askRow.challenge_id
      ? await fetchChallengeById(adminClient, askRow.challenge_id)
      : null;

    // Ensure a conversation plan exists (centralized function handles generation if needed)
    let conversationPlan = null;
    if (conversationThread) {
      try {
        const adminClient = getAdminSupabaseClient();
        conversationPlan = await ensureConversationPlanExists(
          adminClient,
          conversationThread.id,
          {
            askRow,
            projectData,
            challengeData,
            participantSummaries,
          }
        );
      } catch (planError) {
        // IMPORTANT: Plan generation is REQUIRED - fail if it doesn't work
        console.error('❌ Voice agent init: Failed to generate conversation plan:', planError);
        return NextResponse.json<ApiResponse>({
          success: false,
          error: 'Failed to generate conversation plan. Please try again.'
        }, { status: 500 });
      }
    }

    // Check if there are any messages in the thread
    // BUG FIX: Use adminClient instead of supabase to bypass RLS
    // In voice mode, there's often no authenticated user context, so RLS blocks the query
    let hasMessages = false;
    let messageRows: MessageRow[] = [];
    if (conversationThread) {
      const { messages: threadMessages } = await getMessagesForThread(
        adminClient,
        conversationThread.id
      );
      messageRows = (threadMessages ?? []) as MessageRow[];
      hasMessages = messageRows.length > 0;
    } else {
      // Check for messages without thread via RPC wrapper
      const messagesWithoutThread = await fetchMessagesWithoutThread(adminClient, askRow.id);
      hasMessages = messagesWithoutThread.length > 0;
    }

    // Fetch additional user data for message senders not already in usersById
    const messageUserIds = messageRows
      .map(row => row.user_id)
      .filter((value): value is string => Boolean(value))
      .filter(id => !usersById[id]);

    if (messageUserIds.length > 0) {
      const additionalUsers = await fetchUsersByIds(supabase, messageUserIds);
      Object.assign(usersById, additionalUsers);
    }

    // Build message summaries using unified function for consistent mapping
    // This ensures senderName logic and planStepId are consistent across all modes
    const messages = messageRows.map((row, index) => {
      const user = row.user_id ? usersById[row.user_id] ?? null : null;
      return buildMessageSummary(row, user, index);
    });

    // Fetch elapsed times using centralized helper (DRY)
    const { elapsedActiveSeconds, stepElapsedActiveSeconds } = await fetchElapsedTime({
      supabase,
      askSessionId: askRow.id,
      profileId,
      conversationPlan,
      participantRows: participantRows ?? [],
      adminClient: getAdminSupabaseClient(),
    });

    // Find the current participant name from profileId
    const currentParticipant = profileId
      ? participantSummaries.find((p, index) => {
          const participantRow = (participantRows ?? [])[index];
          return participantRow?.user_id === profileId;
        })
      : null;

    // Build agent variables using THE SAME function as text/stream mode
    // This ensures 100% consistency between voice and text modes
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

    // If no messages exist, initiate conversation with agent
    // Note: Consultant mode does NOT get an initialization message (spec requirement)
    if (!hasMessages && askRow.conversation_mode !== 'consultant') {
      try {
        // Execute agent to get initial response
        // Use 'ask.chat.response' for initial message (same as text mode)
        const agentResult = await executeAgent({
          supabase,
          agentSlug: CHAT_AGENT_SLUG,
          askSessionId: askRow.id,
          interactionType: 'ask.chat.response',
          variables: agentVariables,
          toolContext: {
            projectId: askRow.project_id,
            challengeId: askRow.challenge_id,
          },
        });

        if (typeof agentResult.content === 'string' && agentResult.content.trim().length > 0) {
          const aiResponse = agentResult.content.trim();

          // Get the currently active plan step to link this message
          let initialPlanStepId: string | null = null;
          if (conversationPlan) {
            try {
              const adminClient = getAdminSupabaseClient();
              const activeStep = await getActiveStep(adminClient, conversationPlan.id);
              if (activeStep) {
                initialPlanStepId = activeStep.id;
              }
            } catch (stepError) {
              console.warn('⚠️ Voice agent init: Failed to get active step for message linking:', stepError);
            }
          }

          // Insert the initial AI message via RPC wrapper
          // Pass initialPlanStepId to link message to current step
          const insertedMessage = await insertAiMessage(
            adminClient,
            askRow.id,
            conversationThread?.id ?? null,
            aiResponse,
            'Agent',
            initialPlanStepId
          );

          if (!insertedMessage) {
            console.error('Voice agent init: Failed to insert initial message');
          }
        }
      } catch (error) {
        // Don't fail the request - voice agent can still initialize
        console.error('Voice agent init: Failed to generate initial message:', error);
      }
    }

    // Execute agent to get voice agent response
    // Uses the same agentVariables as the initial message for consistency
    const result = await executeAgent({
      supabase,
      agentSlug: CHAT_AGENT_SLUG,
      askSessionId: askRow.id,
      interactionType: CHAT_INTERACTION_TYPE,
      variables: agentVariables,
      toolContext: {
        projectId: askRow.project_id,
        challengeId: askRow.challenge_id,
      },
    });

    // Check if result is a voice agent response
    if ('voiceAgent' in result) {
      return NextResponse.json<ApiResponse<{ logId: string }>>({
        success: true,
        data: {
          logId: result.logId,
        },
      });
    }

    return NextResponse.json<ApiResponse>({
      success: false,
      error: 'Voice agent initialization failed'
    }, { status: 500 });

  } catch (error) {
    console.error('Error initializing voice agent:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      error: parseErrorMessage(error)
    }, { status: 500 });
  }
}
