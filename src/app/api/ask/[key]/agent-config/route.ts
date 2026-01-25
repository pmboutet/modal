import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabaseServer';
import { getAgentConfigForAsk } from '@/lib/ai/agent-config';
import { isValidAskKey } from '@/lib/utils';
import { buildConversationAgentVariables } from '@/lib/ai/conversation-agent';
import { getAskSessionByKey } from '@/lib/asks';
import { getAdminSupabaseClient } from '@/lib/supabaseAdmin';
import {
  fetchConversationContext,
  fetchParticipantByToken,
  fetchUsersByIds,
  buildParticipantDisplayName,
  type AskSessionRow,
} from '@/lib/conversation-context';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;

  if (!isValidAskKey(key)) {
    return NextResponse.json(
      { success: false, error: 'Invalid ask key format' },
      { status: 400 }
    );
  }

  try {
    const supabase = await createServerSupabaseClient();
    const adminClient = getAdminSupabaseClient();

    // Check if user is accessing via invite token
    const token = request.nextUrl.searchParams.get('token');
    console.log(`[agent-config] Token from URL: ${token ? token.substring(0, 8) + '...' : 'null'}`);

    // Get ASK session - use token-based RPC or admin client
    let askSession: AskSessionRow | null = null;

    if (token) {
      console.log(`[agent-config] Using token-based RPC access`);
      const { data, error: tokenError } = await supabase
        .rpc('get_ask_session_by_token', { p_token: token })
        .maybeSingle<{
          ask_session_id: string;
          ask_key: string;
          question: string;
          description: string | null;
          project_id: string | null;
          challenge_id: string | null;
          conversation_mode: string | null;
          expected_duration_minutes: number | null;
        }>();

      if (tokenError) {
        console.error(`[agent-config] RPC error:`, tokenError);
        throw new Error(`Failed to fetch ASK session by token: ${tokenError.message}`);
      }

      if (data) {
        askSession = {
          id: data.ask_session_id,
          ask_key: data.ask_key,
          question: data.question,
          description: data.description,
          project_id: data.project_id,
          challenge_id: data.challenge_id,
          conversation_mode: data.conversation_mode,
          expected_duration_minutes: data.expected_duration_minutes,
          system_prompt: null,
        };
      }
    } else {
      console.log(`[agent-config] No token, using admin client (bypasses RLS)`);
      const { row, error: askError } = await getAskSessionByKey<AskSessionRow>(
        adminClient,
        key,
        'id, ask_key, question, description, project_id, challenge_id, system_prompt, conversation_mode, expected_duration_minutes'
      );

      if (askError) {
        throw new Error(`Failed to fetch ASK session: ${askError.message}`);
      }

      askSession = row;
    }

    if (!askSession) {
      return NextResponse.json(
        { success: false, error: 'ASK session not found' },
        { status: 404 }
      );
    }

    // BUG-042 FIX: Get participant info from token BEFORE fetching context
    // This allows us to use the participant's user_id to find the correct thread
    // Without this, useLastUserMessageThread would return another participant's thread
    let currentParticipantName: string | null = null;
    let participantUserId: string | null = null;
    if (token) {
      const participantRow = await fetchParticipantByToken(adminClient, token);
      if (participantRow) {
        participantUserId = participantRow.user_id ?? null;
        // Get user data for the participant to build display name
        const usersById = participantRow.user_id
          ? await fetchUsersByIds(adminClient, [participantRow.user_id])
          : {};
        const user = participantRow.user_id ? usersById[participantRow.user_id] ?? null : null;
        currentParticipantName = buildParticipantDisplayName(participantRow, user, 0);
        console.log(`[agent-config] Current participant from token: ${currentParticipantName} (user_id: ${participantUserId})`);
      }
    }

    // Fetch complete conversation context using centralized function (DRY!)
    // BUG-042 FIX: When token is provided, use profileId to find the correct thread for THIS participant
    // Don't use useLastUserMessageThread when we have a specific user - it would return another user's thread
    const context = await fetchConversationContext(adminClient, askSession, {
      adminClient,
      token: token || undefined,
      profileId: participantUserId, // Use participant's user_id to find their thread
      useLastUserMessageThread: !participantUserId, // Only use last message thread if no specific user
    });

    // Debug logging for STEP_COMPLETE troubleshooting
    console.log('[agent-config] 📋 Conversation context loaded:', {
      hasConversationPlan: !!context.conversationPlan,
      planId: context.conversationPlan?.id,
      currentStepId: context.conversationPlan?.current_step_id,
      threadId: context.conversationThread?.id,
      participantCount: context.participants.length,
      messageCount: context.messages.length,
      usingToken: !!token,
      currentParticipantName,
    });

    // Use centralized function for ALL prompt variables - no manual overrides
    // BUG FIX: Pass currentParticipantName for proper filtering in individual_parallel mode
    const promptVariables = buildConversationAgentVariables({
      ask: askSession,
      project: context.project,
      challenge: context.challenge,
      messages: context.messages, // Already in ConversationMessageSummary format with planStepId
      participants: context.participants,
      currentParticipantName, // Critical for individual_parallel mode
      conversationPlan: context.conversationPlan,
      elapsedActiveSeconds: context.elapsedActiveSeconds,
      stepElapsedActiveSeconds: context.stepElapsedActiveSeconds,
    });

    console.log('[agent-config] 📋 Prompt variables built:', {
      variableCurrentStepId: promptVariables.current_step_id,
      variableCurrentStep: promptVariables.current_step?.substring(0, 100),
    });

    // Pass the complete promptVariables directly - no manual subset
    // Use adminClient to bypass RLS - we've already verified access above
    const agentConfig = await getAgentConfigForAsk(adminClient, askSession.id, promptVariables, token);

    return NextResponse.json({
      success: true,
      data: {
        systemPrompt: agentConfig.systemPrompt,
        userPrompt: agentConfig.userPrompt,
        promptVariables: promptVariables, // Pass prompt variables for template rendering
        modelConfig: agentConfig.modelConfig ? {
          id: agentConfig.modelConfig.id,
          provider: agentConfig.modelConfig.provider,
          voiceAgentProvider: (agentConfig.modelConfig as any).voiceAgentProvider,
          model: agentConfig.modelConfig.model,
          deepgramSttModel: (agentConfig.modelConfig as any).deepgramSttModel,
          deepgramTtsModel: (agentConfig.modelConfig as any).deepgramTtsModel,
          deepgramLlmProvider: (agentConfig.modelConfig as any).deepgramLlmProvider,
          deepgramLlmModel: (agentConfig.modelConfig as any).deepgramLlmModel,
          speechmaticsSttLanguage: (agentConfig.modelConfig as any).speechmaticsSttLanguage,
          speechmaticsSttOperatingPoint: (agentConfig.modelConfig as any).speechmaticsSttOperatingPoint,
          speechmaticsSttMaxDelay: (agentConfig.modelConfig as any).speechmaticsSttMaxDelay,
          speechmaticsSttEnablePartials: (agentConfig.modelConfig as any).speechmaticsSttEnablePartials,
          speechmaticsLlmProvider: (agentConfig.modelConfig as any).speechmaticsLlmProvider,
          speechmaticsLlmModel: (agentConfig.modelConfig as any).speechmaticsLlmModel,
          speechmaticsApiKeyEnvVar: (agentConfig.modelConfig as any).speechmaticsApiKeyEnvVar,
          elevenLabsVoiceId: (agentConfig.modelConfig as any).elevenLabsVoiceId,
          elevenLabsModelId: (agentConfig.modelConfig as any).elevenLabsModelId,
          elevenLabsApiKeyEnvVar: (agentConfig.modelConfig as any).elevenLabsApiKeyEnvVar,
        } : null,
      },
    });
  } catch (error) {
    console.error('Error fetching agent config:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch agent configuration',
      },
      { status: 500 }
    );
  }
}

