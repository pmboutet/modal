import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabaseServer';
import { getAdminSupabaseClient } from '@/lib/supabaseAdmin';
import { getAskSessionByKey, getOrCreateConversationThread, resolveThreadUserId } from '@/lib/asks';
import { completeStep, getConversationPlanWithSteps } from '@/lib/ai/conversation-plan';
import { loadFullAuthContext } from '@/lib/ask-session-loader';
import type { ApiResponse } from '@/types';
import type { ConversationPlan as LibConversationPlan } from '@/lib/ai/conversation-plan';

interface StepCompleteRequest {
  stepId: string; // The step_identifier to complete (e.g., "step_1")
}

interface StepCompleteResponse {
  conversationPlan: LibConversationPlan;
  completedStepId: string;
  nextStepId: string | null;
}

/**
 * POST /api/ask/[key]/step-complete
 *
 * Completes a conversation step. Called from voice mode when STEP_COMPLETE is detected
 * in AI responses. This endpoint:
 * 1. Validates the request and authentication
 * 2. Finds the conversation thread
 * 3. Calls completeStep to mark the step as completed and advance to next
 * 4. Returns the updated conversation plan
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const adminClient = getAdminSupabaseClient();

  try {
    const { key } = await params;
    const body = (await request.json()) as StepCompleteRequest;

    // Validate request
    if (!body.stepId) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'stepId is required',
      }, { status: 400 });
    }

    console.log('[step-complete] Starting step completion:', { key, stepId: body.stepId });

    // Create Supabase client
    const supabase = await createServerSupabaseClient();

    // Get ASK session
    const { row: askRow, error: askError } = await getAskSessionByKey<{
      id: string;
      conversation_mode: string | null;
      project_id: string | null;
    }>(supabase, key, 'id, conversation_mode, project_id');

    if (askError || !askRow) {
      console.error('[step-complete] ASK session not found:', key);
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'ASK session not found',
      }, { status: 404 });
    }

    // Get auth context (handles invite token and session auth)
    const token = request.headers.get('x-invite-token') || null;
    const isDevBypass = process.env.IS_DEV === 'true';
    const { authContext } = await loadFullAuthContext({
      sessionClient: supabase,
      askSessionId: askRow.id,
      inviteToken: token,
      isDevBypass,
    });

    console.log('[step-complete] Auth context:', {
      authMethod: authContext.authMethod,
      profileId: authContext.profileId,
      participantId: authContext.participantId,
    });

    // Get participants for thread resolution
    const { data: participants } = await adminClient
      .from('ask_participants')
      .select('id, user_id')
      .eq('ask_session_id', askRow.id);

    // Resolve thread user ID (reuse isDevBypass from auth context load)
    const threadUserId = resolveThreadUserId(
      authContext.profileId,
      askRow.conversation_mode,
      (participants ?? []).map(p => ({ ...p, user_id: p.user_id ?? null })),
      isDevBypass
    );

    // Get or create conversation thread
    const { thread, error: threadError } = await getOrCreateConversationThread(
      authContext.useAdminClient ? adminClient : supabase,
      askRow.id,
      threadUserId,
      { conversation_mode: askRow.conversation_mode }
    );

    if (threadError || !thread) {
      console.error('[step-complete] Thread not found:', threadError);
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Conversation thread not found',
      }, { status: 404 });
    }

    console.log('[step-complete] Thread found:', thread.id);

    // Complete the step
    const updatedPlan = await completeStep(
      adminClient,
      thread.id,
      body.stepId,
      undefined, // No pre-generated summary - let async agent generate it
      askRow.id // Pass askSessionId to trigger async summary generation
    );

    if (!updatedPlan) {
      console.error('[step-complete] Failed to complete step:', body.stepId);
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Failed to complete step',
      }, { status: 500 });
    }

    console.log('[step-complete] Step completed successfully:', {
      completedStepId: body.stepId,
      nextStepId: updatedPlan.current_step_id,
    });

    // Fetch the full plan with steps to return
    const planWithSteps = await getConversationPlanWithSteps(adminClient, thread.id);

    return NextResponse.json<ApiResponse<StepCompleteResponse>>({
      success: true,
      data: {
        conversationPlan: planWithSteps || updatedPlan,
        completedStepId: body.stepId,
        nextStepId: updatedPlan.current_step_id,
      },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Failed to complete step';
    console.error('[step-complete] Error:', errorMsg);
    return NextResponse.json<ApiResponse>({
      success: false,
      error: errorMsg,
    }, { status: 500 });
  }
}
