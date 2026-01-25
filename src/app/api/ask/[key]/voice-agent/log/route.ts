import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabaseServer';
import { createAgentLog, completeAgentLog } from '@/lib/ai/logs';
import { getAgentConfigForAsk } from '@/lib/ai/agent-config';
import { getAskSessionByKey } from '@/lib/asks';
import { getAdminSupabaseClient } from '@/lib/supabaseAdmin';
import { parseErrorMessage } from '@/lib/utils';
import type { ApiResponse, Insight } from '@/types';
import { buildConversationAgentVariables } from '@/lib/ai/conversation-agent';
import {
  fetchConversationContext,
  fetchParticipantByToken,
  fetchUsersByIds,
  buildParticipantDisplayName,
  type AskSessionRow,
} from '@/lib/conversation-context';
import { handleSubtopicSignals } from '@/lib/ai/conversation-signals';

interface InsightDetectionResponse {
  success: boolean;
  data?: { insights?: Insight[] };
  error?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    const body = await request.json().catch(() => ({}));
    const typedBody = body as {
      role: 'user' | 'agent';
      content: string;
      messageId?: string | null;
      logId?: string;
    };

    const { role, content, messageId, logId } = typedBody;

    if (!role || !content) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Missing role or content'
      }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();
    const adminClient = getAdminSupabaseClient();

    // Get ASK session with all needed fields
    const { row: askRow, error: askError } = await getAskSessionByKey<AskSessionRow>(
      supabase,
      key,
      'id, ask_key, question, description, project_id, challenge_id, system_prompt, conversation_mode, expected_duration_minutes'
    );

    if (askError || !askRow) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'ASK session not found'
      }, { status: 404 });
    }

    // BUG-042 FIX: Get participant info from token BEFORE fetching context
    // This allows us to use the participant's user_id to find the correct thread
    const inviteToken = request.headers.get('X-Invite-Token');
    let currentParticipantName: string | null = null;
    let participantUserId: string | null = null;

    if (inviteToken) {
      const participantRow = await fetchParticipantByToken(adminClient, inviteToken);
      if (participantRow) {
        participantUserId = participantRow.user_id ?? null;
        const usersById = participantRow.user_id
          ? await fetchUsersByIds(adminClient, [participantRow.user_id])
          : {};
        const user = participantRow.user_id ? usersById[participantRow.user_id] ?? null : null;
        currentParticipantName = buildParticipantDisplayName(participantRow, user, 0);
        console.log(`[voice-agent/log] Current participant from token: ${currentParticipantName} (user_id: ${participantUserId})`);
      }
    }

    // Fetch complete conversation context using centralized function (DRY!)
    // BUG-042 FIX: Use profileId to find the correct thread for THIS participant
    const context = await fetchConversationContext(adminClient, askRow, {
      adminClient,
      profileId: participantUserId,
    });

    if (context.conversationPlan?.plan_data) {
      console.log('📋 Voice agent log: Loaded conversation plan with', context.conversationPlan.plan_data.steps.length, 'steps');
    }

    // Use centralized function for ALL prompt variables - no manual overrides
    const promptVariables = buildConversationAgentVariables({
      ask: askRow,
      project: context.project,
      challenge: context.challenge,
      messages: context.messages, // Already in ConversationMessageSummary format with planStepId
      participants: context.participants,
      currentParticipantName, // BUG-037 FIX: Pass current participant for filtering in individual_parallel mode
      conversationPlan: context.conversationPlan,
      elapsedActiveSeconds: context.elapsedActiveSeconds,
      stepElapsedActiveSeconds: context.stepElapsedActiveSeconds,
    });

    // Pass the complete promptVariables directly - no manual subset
    // Use admin client because session client may not have RLS access (guest/anonymous users)
    // Access is already validated via getAskSessionByKey RPC
    const agentConfig = await getAgentConfigForAsk(adminClient, askRow.id, promptVariables);

    if (!agentConfig.modelConfig) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Failed to load agent configuration'
      }, { status: 500 });
    }

    if (role === 'user') {
      // Create a new log for user message with resolved system prompt
      // Use admin client because ai_agent_logs only allows INSERT via service_role
      const log = await createAgentLog(adminClient, {
        agentId: agentConfig.agent?.id || null,
        askSessionId: askRow.id,
        messageId: messageId || null,
        interactionType: 'ask.chat.response.voice',
        requestPayload: {
          agentSlug: 'ask-conversation-response',
          modelConfigId: agentConfig.modelConfig.id,
          systemPrompt: agentConfig.systemPrompt,
          userPrompt: agentConfig.userPrompt,
          userMessage: content,
          role: 'user',
          // Variables are already compiled into systemPrompt and userPrompt
          // No need to store them separately (reduces payload size)
        },
      });

      return NextResponse.json<ApiResponse<{ logId: string }>>({
        success: true,
        data: {
          logId: log.id,
        },
      });
    } else {
      // Complete the log for agent response
      if (!logId) {
        return NextResponse.json<ApiResponse>({
          success: false,
          error: 'Missing logId for agent response'
        }, { status: 400 });
      }

      // Use admin client because ai_agent_logs only allows UPDATE via service_role
      await completeAgentLog(adminClient, logId, {
        responsePayload: {
          agentMessage: content,
          role: 'agent',
        },
      });

      // Handle subtopic signals (TOPICS_DISCOVERED, TOPIC_EXPLORED, TOPIC_SKIPPED)
      // This must be done BEFORE insight detection to ensure subtopics are tracked
      if (context.conversationThread?.id) {
        try {
          const subtopicResult = await handleSubtopicSignals(
            adminClient,
            context.conversationThread.id,
            content
          );
          if (subtopicResult) {
            console.log('[voice-agent/log] 🎤 Subtopic signals handled:', subtopicResult);
          }
        } catch (subtopicError) {
          console.error('[voice-agent/log] ⚠️ Failed to handle subtopic signals:', subtopicError);
          // Don't fail the request if subtopic handling fails
        }
      }

      // Trigger insight detection after agent response (same as stream route)
      // This ensures voice mode captures insights like text mode does
      try {
        const respondUrl = new URL(request.url);
        respondUrl.pathname = `/api/ask/${encodeURIComponent(key)}/respond`;
        respondUrl.search = '';

        const detectionHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(request.headers.get('cookie') ? { Cookie: request.headers.get('cookie')! } : {}),
        };

        // Forward invite token if present (for authentication)
        const inviteToken = request.headers.get('X-Invite-Token');
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
            console.log(`[voice-agent/log] Insight detection completed: ${insights.length} insights found`);
          } else if (detectionJson.error) {
            console.warn('[voice-agent/log] Insight detection responded with error:', detectionJson.error);
          }
        } else {
          console.error('[voice-agent/log] Insight detection request failed:', detectionResponse.status, detectionResponse.statusText);
        }
      } catch (insightError) {
        // Don't fail the request if insight detection fails - log and continue
        console.error('[voice-agent/log] Unable to detect insights:', insightError);
      }

      return NextResponse.json<ApiResponse>({
        success: true,
        data: { logId },
      });
    }

  } catch (error) {
    const errorMsg = parseErrorMessage(error);
    console.error('Error handling voice agent log:', errorMsg);
    return NextResponse.json<ApiResponse>({
      success: false,
      error: errorMsg
    }, { status: 500 });
  }
}

