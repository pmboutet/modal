import { NextRequest, NextResponse } from 'next/server';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { ApiResponse } from '@/types';
import { isValidAskKey, parseErrorMessage } from '@/lib/utils';
import { createServerSupabaseClient } from '@/lib/supabaseServer';
import { getConversationThreadId } from '@/lib/asks';

interface AskSessionRow {
  id: string;
}

interface TimerUpdateRequest {
  elapsedActiveSeconds: number;
  currentStepId?: string;
  stepElapsedSeconds?: number;
  timerResetAt?: string; // Client's local timer_reset_at to detect stale syncs
  reset?: boolean; // User-initiated reset - sets timer_reset_at on server
}

interface TimerResponse {
  elapsedActiveSeconds: number;
  participantId: string;
  stepElapsedSeconds?: number;
  currentStepId?: string;
  timerResetAt?: string | null;
}

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

function permissionDeniedResponse(): NextResponse<ApiResponse> {
  return NextResponse.json<ApiResponse>({
    success: false,
    error: "Accès non autorisé"
  }, { status: 403 });
}

interface StepTimerData {
  stepElapsedSeconds?: number;
  currentStepId?: string;
}

/**
 * Fetch step elapsed time from the conversation plan
 * Reusable helper for both token and connected modes
 * @param profileId - User's profile ID to find their specific thread in individual_parallel mode
 */
async function fetchStepElapsedTime(
  adminClient: SupabaseClient,
  askSessionId: string,
  profileId?: string | null
): Promise<StepTimerData> {
  // Find conversation thread for this ASK session AND user
  // Uses shared helper that handles individual_parallel vs shared mode
  const threadId = await getConversationThreadId(adminClient, askSessionId, profileId ?? null);

  if (!threadId) {
    return {};
  }

  // Find the plan for this thread
  const { data: planData } = await adminClient
    .from('ask_conversation_plans')
    .select('id, current_step_id')
    .eq('conversation_thread_id', threadId)
    .maybeSingle();

  if (!planData?.current_step_id) {
    return {};
  }

  // Get the step elapsed time
  const { data: stepData } = await adminClient
    .from('ask_conversation_plan_steps')
    .select('elapsed_active_seconds')
    .eq('plan_id', planData.id)
    .eq('step_identifier', planData.current_step_id)
    .maybeSingle();

  return {
    currentStepId: planData.current_step_id,
    stepElapsedSeconds: stepData?.elapsed_active_seconds ?? 0,
  };
}

/**
 * GET /api/ask/[key]/timer
 * Get the current elapsed time for the participant
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;

    if (!key || !isValidAskKey(key)) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Invalid ASK key format'
      }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();
    const isDevBypass = process.env.IS_DEV === 'true';

    let adminClient: SupabaseClient | null = null;
    const getAdminClient = async () => {
      if (!adminClient) {
        const { getAdminSupabaseClient } = await import('@/lib/supabaseAdmin');
        adminClient = getAdminSupabaseClient();
      }
      return adminClient;
    };

    let dataClient: SupabaseClient = supabase;
    let profileId: string | null = null;

    // Check for invite token
    const inviteToken = request.headers.get('X-Invite-Token');

    if (inviteToken) {
      // Use RPC functions to bypass RLS securely
      const [participantResult, askResult] = await Promise.all([
        supabase.rpc('get_participant_by_token', { p_token: inviteToken }),
        supabase.rpc('get_ask_session_by_token', { p_token: inviteToken })
          .maybeSingle<{ ask_session_id: string; ask_key: string }>(),
      ]);

      const participant = participantResult.data?.[0] ?? null;
      const askData = askResult.data;

      if (!participantResult.error && participant && !askResult.error && askData && askData.ask_key === key) {
        // Fetch step elapsed time from the conversation plan
        const admin = await getAdminClient();
        const stepTimerData = await fetchStepElapsedTime(admin, askData.ask_session_id, participant.user_id);

        return NextResponse.json<ApiResponse<TimerResponse>>({
          success: true,
          data: {
            elapsedActiveSeconds: participant.elapsed_active_seconds ?? 0,
            participantId: participant.participant_id,
            timerResetAt: participant.timer_reset_at ?? null,
            ...stepTimerData,
          }
        });
      }
    }

    // Regular auth flow
    if (!isDevBypass) {
      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (userError || !userResult?.user) {
        return NextResponse.json<ApiResponse>({
          success: false,
          error: "Authentification requise"
        }, { status: 401 });
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('auth_id', userResult.user.id)
        .single();

      if (!profile) {
        return NextResponse.json<ApiResponse>({
          success: false,
          error: "Profil utilisateur introuvable"
        }, { status: 401 });
      }

      profileId = profile.id;
    } else {
      dataClient = await getAdminClient();
    }

    // Get the ASK session using RPC (bypasses RLS)
    const { data: askRpcData, error: askRpcError } = await supabase
      .rpc('get_ask_session_by_key', { p_key: key })
      .maybeSingle<{ ask_session_id: string }>();

    if (askRpcError) {
      if (isPermissionDenied(askRpcError)) {
        return permissionDeniedResponse();
      }
      throw askRpcError;
    }

    if (!askRpcData) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'ASK introuvable'
      }, { status: 404 });
    }

    const askRow = { id: askRpcData.ask_session_id };

    // Get participant's elapsed time and reset timestamp
    let participantQuery = dataClient
      .from('ask_participants')
      .select('id, elapsed_active_seconds, timer_reset_at')
      .eq('ask_session_id', askRow.id);

    if (profileId) {
      participantQuery = participantQuery.eq('user_id', profileId);
    } else {
      // In dev mode without profileId, just get the first participant
      participantQuery = participantQuery.limit(1);
    }

    const { data: participant, error: participantError } = await participantQuery.maybeSingle();

    if (participantError) {
      if (isPermissionDenied(participantError)) {
        return permissionDeniedResponse();
      }
      throw participantError;
    }

    if (!participant) {
      return NextResponse.json<ApiResponse<TimerResponse>>({
        success: true,
        data: {
          elapsedActiveSeconds: 0,
          participantId: '',
        }
      });
    }

    // Fetch step elapsed time from the conversation plan
    const admin = await getAdminClient();
    const stepTimerData = await fetchStepElapsedTime(admin, askRow.id, profileId);

    return NextResponse.json<ApiResponse<TimerResponse>>({
      success: true,
      data: {
        elapsedActiveSeconds: participant.elapsed_active_seconds ?? 0,
        participantId: participant.id,
        timerResetAt: participant.timer_reset_at ?? null,
        ...stepTimerData,
      }
    });
  } catch (error) {
    console.error('Error getting timer:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      error: parseErrorMessage(error)
    }, { status: 500 });
  }
}

/**
 * PATCH /api/ask/[key]/timer
 * Update the elapsed time for the participant
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;

    if (!key || !isValidAskKey(key)) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Invalid ASK key format'
      }, { status: 400 });
    }

    const body: TimerUpdateRequest = await request.json();

    if (typeof body.elapsedActiveSeconds !== 'number' || body.elapsedActiveSeconds < 0) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'elapsedActiveSeconds must be a non-negative number'
      }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();
    const isDevBypass = process.env.IS_DEV === 'true';

    let adminClient: SupabaseClient | null = null;
    const getAdminClient = async () => {
      if (!adminClient) {
        const { getAdminSupabaseClient } = await import('@/lib/supabaseAdmin');
        adminClient = getAdminSupabaseClient();
      }
      return adminClient;
    };

    let dataClient: SupabaseClient = supabase;
    let profileId: string | null = null;
    let participantId: string | null = null;

    // Check for invite token
    const inviteToken = request.headers.get('X-Invite-Token');

    if (inviteToken) {
      // Use RPC functions to bypass RLS securely
      const [participantResult, askResult] = await Promise.all([
        supabase.rpc('get_participant_by_token', { p_token: inviteToken }),
        supabase.rpc('get_ask_session_by_token', { p_token: inviteToken })
          .maybeSingle<{ ask_session_id: string; ask_key: string }>(),
      ]);

      const participant = participantResult.data?.[0] ?? null;
      const askData = askResult.data;

      if (!participantResult.error && participant && !askResult.error && askData && askData.ask_key === key) {
        profileId = participant.user_id;
        participantId = participant.participant_id;
        dataClient = await getAdminClient(); // Use admin for the update
      }
    }

    // Regular auth flow
    if (!profileId && !isDevBypass) {
      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (userError || !userResult?.user) {
        return NextResponse.json<ApiResponse>({
          success: false,
          error: "Authentification requise"
        }, { status: 401 });
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('auth_id', userResult.user.id)
        .single();

      if (!profile) {
        return NextResponse.json<ApiResponse>({
          success: false,
          error: "Profil utilisateur introuvable"
        }, { status: 401 });
      }

      profileId = profile.id;
    } else if (isDevBypass && !profileId) {
      dataClient = await getAdminClient();
    }

    // Get the ASK session using RPC (bypasses RLS)
    const { data: askRpcData, error: askRpcError } = await supabase
      .rpc('get_ask_session_by_key', { p_key: key })
      .maybeSingle<{ ask_session_id: string }>();

    if (askRpcError) {
      if (isPermissionDenied(askRpcError)) {
        return permissionDeniedResponse();
      }
      throw askRpcError;
    }

    if (!askRpcData) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'ASK introuvable'
      }, { status: 404 });
    }

    const askRow = { id: askRpcData.ask_session_id };

    // Get participant if not already retrieved from invite token
    if (!participantId && profileId) {
      const { data: participant, error: participantError } = await dataClient
        .from('ask_participants')
        .select('id')
        .eq('ask_session_id', askRow.id)
        .eq('user_id', profileId)
        .maybeSingle();

      if (participantError) {
        if (isPermissionDenied(participantError)) {
          return permissionDeniedResponse();
        }
        throw participantError;
      }

      if (participant) {
        participantId = participant.id;
      }
    }

    // In dev mode without a participant, try to find the first participant
    if (isDevBypass && !participantId) {
      const admin = await getAdminClient();
      const { data: anyParticipant } = await admin
        .from('ask_participants')
        .select('id')
        .eq('ask_session_id', askRow.id)
        .limit(1)
        .maybeSingle();

      if (anyParticipant) {
        participantId = anyParticipant.id;
        dataClient = admin;
      }
    }

    if (!participantId) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Participant introuvable pour cette session'
      }, { status: 404 });
    }

    // Check for stale reset: if server has a newer timer_reset_at than client, reject the sync
    // This prevents open sessions from overwriting a timer that was reset by a purge
    if (body.timerResetAt) {
      const admin = await getAdminClient();
      const { data: currentParticipant } = await admin
        .from('ask_participants')
        .select('timer_reset_at, elapsed_active_seconds')
        .eq('id', participantId)
        .single();

      if (currentParticipant?.timer_reset_at) {
        const clientResetAt = new Date(body.timerResetAt).getTime();
        const serverResetAt = new Date(currentParticipant.timer_reset_at).getTime();

        if (serverResetAt > clientResetAt) {
          // Server has a newer reset - reject the sync and tell client to refresh
          console.log('[timer] Rejecting stale sync:', {
            participantId,
            clientResetAt: body.timerResetAt,
            serverResetAt: currentParticipant.timer_reset_at,
            clientElapsed: body.elapsedActiveSeconds,
            serverElapsed: currentParticipant.elapsed_active_seconds,
          });

          return NextResponse.json<ApiResponse<{
            serverResetAt: string;
            serverElapsedSeconds: number;
          }>>({
            success: false,
            error: 'Timer was reset on server. Please refresh.',
            data: {
              serverResetAt: currentParticipant.timer_reset_at,
              serverElapsedSeconds: currentParticipant.elapsed_active_seconds ?? 0,
            }
          }, { status: 409 });
        }
      }
    }

    // Build update payload
    const updatePayload: { elapsed_active_seconds: number; timer_reset_at?: string } = {
      elapsed_active_seconds: Math.floor(body.elapsedActiveSeconds),
    };

    // If user-initiated reset, also set timer_reset_at to propagate reset to other sessions
    let newTimerResetAt: string | undefined;
    if (body.reset) {
      newTimerResetAt = new Date().toISOString();
      updatePayload.timer_reset_at = newTimerResetAt;
      console.log('[timer] User-initiated reset:', { participantId, newTimerResetAt });
    }

    // Update the participant elapsed time
    const { error: updateError } = await dataClient
      .from('ask_participants')
      .update(updatePayload)
      .eq('id', participantId);

    if (updateError) {
      if (isPermissionDenied(updateError)) {
        return permissionDeniedResponse();
      }
      throw updateError;
    }

    // Update step elapsed time if provided
    // Note: currentStepId is a step_identifier (e.g. "step_1"), not an UUID
    let stepElapsedSeconds: number | undefined;
    if (body.currentStepId && typeof body.stepElapsedSeconds === 'number') {
      // IMPORTANT: Clear cache and get fresh admin client to ensure service_role bypasses RLS
      // The cached client sometimes doesn't have the correct permissions for step updates
      const { clearAdminClientCache, getAdminSupabaseClient } = await import('@/lib/supabaseAdmin');
      clearAdminClientCache();
      const admin = getAdminSupabaseClient();

      // Step 1: Find conversation thread for this ASK session AND user
      // Uses shared helper that handles individual_parallel vs shared mode
      const threadId = await getConversationThreadId(admin, askRow.id, profileId);

      if (threadId) {
        // Step 2: Find the plan for this thread using RPC (bypasses RLS)
        const { data: planResult } = await admin
          .rpc('get_conversation_plan_with_steps', { p_conversation_thread_id: threadId });

        const planData = planResult?.plan as { id: string } | null;

        if (planData) {
          // Step 3: Update the step by step_identifier within this plan
          console.log('[timer] Updating step:', {
            planId: planData.id,
            stepIdentifier: body.currentStepId,
            stepElapsedSeconds: Math.floor(body.stepElapsedSeconds),
          });

          const { data: updateResult, error: stepUpdateError } = await admin
            .from('ask_conversation_plan_steps')
            .update({ elapsed_active_seconds: Math.floor(body.stepElapsedSeconds) })
            .eq('plan_id', planData.id)
            .eq('step_identifier', body.currentStepId)
            .select();

          if (stepUpdateError) {
            console.error('[timer] Failed to update step elapsed time:', stepUpdateError.message, stepUpdateError.details, stepUpdateError.hint);
          } else if (updateResult && updateResult.length > 0) {
            console.log('[timer] Step updated successfully:', updateResult[0]);
            stepElapsedSeconds = Math.floor(body.stepElapsedSeconds);
          } else {
            console.warn('[timer] Step update returned 0 rows - step_identifier might not match:', {
              planId: planData.id,
              stepIdentifier: body.currentStepId,
              updateResult,
            });
          }
        } else {
          console.warn('[timer] No plan found for thread:', threadId);
        }
      }
    }

    return NextResponse.json<ApiResponse<TimerResponse>>({
      success: true,
      data: {
        elapsedActiveSeconds: Math.floor(body.elapsedActiveSeconds),
        participantId,
        stepElapsedSeconds,
        currentStepId: body.currentStepId,
        timerResetAt: newTimerResetAt ?? null,
      }
    });
  } catch (error) {
    console.error('Error updating timer:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      error: parseErrorMessage(error)
    }, { status: 500 });
  }
}

/**
 * POST /api/ask/[key]/timer
 * Same as PATCH - needed for sendBeacon which only supports POST
 */
export const POST = PATCH;
