import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient, requireAdmin } from "@/lib/supabaseServer";
import { sanitizeOptional, sanitizeText } from "@/lib/sanitize";
import { parseErrorMessage } from "@/lib/utils";
import { type ApiResponse, type AskSessionRecord, type AskProgressData, type ParticipantProgressInfo, type AskConversationMode } from "@/types";
import { randomBytes } from "crypto";
import { buildParticipantDisplayName, type ParticipantRow, type UserRow } from "@/lib/conversation-context";

const statusValues = ["active", "inactive", "draft", "closed"] as const;
const deliveryModes = ["physical", "digital"] as const;
const conversationModes = ["individual_parallel", "collaborative", "group_reporter", "consultant"] as const;
const askSelect = "*, projects(name), ask_participants(id, user_id, role, participant_name, participant_email, is_spokesperson, invite_token)";

// Extended select that includes conversation threads and plans for progress tracking
const askSelectWithProgress = `
  *,
  projects(name),
  ask_participants(id, user_id, role, participant_name, participant_email, is_spokesperson, invite_token),
  conversation_threads(
    id,
    user_id,
    is_shared,
    ask_conversation_plans(
      id,
      completed_steps,
      total_steps,
      status,
      current_step_id,
      ask_conversation_plan_steps(id, title, status, step_order)
    )
  )
`;

const updateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  question: z.string().trim().min(5).max(2000).optional(),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  status: z.enum(statusValues).optional(),
  challengeId: z.string().uuid().optional().or(z.literal("")),
  startDate: z.string().trim().min(1).optional(),
  endDate: z.string().trim().min(1).optional(),
  allowAutoRegistration: z.boolean().optional(),
  maxParticipants: z.number().int().positive().max(10000).optional(),
  deliveryMode: z.enum(deliveryModes).optional(),
  conversationMode: z.enum(conversationModes).optional(),
  expectedDurationMinutes: z.number().int().min(1).max(30).optional(),
  participantIds: z.array(z.string().uuid()).optional(),
  spokespersonId: z.string().uuid().optional().or(z.literal("")),
  systemPrompt: z.union([z.string().trim(), z.literal(""), z.null()]).optional()
});

/**
 * Ensures all participants for an ask session have invite tokens.
 * Generates tokens for any participants that are missing them.
 */
async function ensureParticipantTokens(supabase: any, askId: string): Promise<void> {
  console.log(`🔑 Ensuring tokens for ASK ${askId}...`);

  // Get all participants without tokens
  const { data: participantsWithoutTokens, error: fetchError } = await supabase
    .from("ask_participants")
    .select("id, user_id, participant_name, invite_token")
    .eq("ask_session_id", askId)
    .is("invite_token", null);

  if (fetchError) {
    console.error("❌ Error fetching participants without tokens:", fetchError);
    return; // Don't throw, just log - we'll continue without updating tokens
  }

  console.log(`📊 Found ${participantsWithoutTokens?.length || 0} participants without tokens`);

  if (participantsWithoutTokens && participantsWithoutTokens.length > 0) {
    // Generate tokens for participants missing them
    const participantIds = participantsWithoutTokens.map((p: any) => p.id);
    console.log(`🔧 Generating tokens for participants:`, participantIds);

    for (const participantId of participantIds) {
      // Generate a random token (32 hex characters = 16 bytes)
      const token = randomBytes(16).toString('hex');

      console.log(`  ➡️  Participant ${participantId}: generating token ${token.substring(0, 8)}...`);

      const { error: updateError } = await supabase
        .from("ask_participants")
        .update({ invite_token: token })
        .eq("id", participantId);

      if (updateError) {
        console.error(`❌ Error updating token for participant ${participantId}:`, updateError);
      } else {
        console.log(`  ✅ Token generated for participant ${participantId}`);
      }
    }
  } else {
    console.log(`✅ All participants already have tokens`);
  }
}

/**
 * Normalize Supabase nested data to always be an array (Supabase can return object or array)
 */
function normalizeToArray(data: any): any[] {
  if (!data) return [];
  return Array.isArray(data) ? data : [data];
}

/**
 * Build progress data from conversation threads and plans
 */
function buildProgressData(row: any): AskProgressData | null {
  const rawThreads = row.conversation_threads ?? [];
  const conversationMode = (row.conversation_mode ?? "collaborative") as AskConversationMode;

  // Normalize threads to ensure ask_conversation_plans is always an array
  const threads = rawThreads.map((t: any) => ({
    ...t,
    ask_conversation_plans: normalizeToArray(t.ask_conversation_plans),
  }));

  if (threads.length === 0) {
    return null;
  }

  const isSharedMode = conversationMode !== "individual_parallel";

  if (isSharedMode) {
    // Find the shared thread
    const sharedThread = threads.find((t: any) => t.is_shared);
    if (!sharedThread) {
      return { byParticipant: {}, shared: null, mode: conversationMode };
    }

    const plans = sharedThread.ask_conversation_plans ?? [];
    const plan = plans[0]; // There should be only one plan per thread

    if (!plan) {
      return { byParticipant: {}, shared: null, mode: conversationMode };
    }

    const steps = normalizeToArray(plan.ask_conversation_plan_steps);
    const currentStep = steps.find((s: any) => s.id === plan.current_step_id);

    const shared: ParticipantProgressInfo = {
      completedSteps: plan.completed_steps ?? 0,
      totalSteps: plan.total_steps ?? steps.length,
      currentStepTitle: currentStep?.title ?? null,
      planStatus: plan.status ?? null,
      isCompleted: plan.status === "completed",
      isActive: plan.status === "active",
      threadId: sharedThread.id,
    };

    return { byParticipant: {}, shared, mode: conversationMode };
  }

  // Individual parallel mode - each participant has their own thread
  const byParticipant: Record<string, ParticipantProgressInfo> = {};

  for (const thread of threads) {
    if (!thread.user_id) continue;

    const plans = thread.ask_conversation_plans ?? [];
    const plan = plans[0];

    if (!plan) {
      byParticipant[thread.user_id] = {
        completedSteps: 0,
        totalSteps: 0,
        currentStepTitle: null,
        planStatus: null,
        isCompleted: false,
        isActive: false,
        threadId: thread.id,
      };
      continue;
    }

    const steps = normalizeToArray(plan.ask_conversation_plan_steps);
    const currentStep = steps.find((s: any) => s.id === plan.current_step_id);

    byParticipant[thread.user_id] = {
      completedSteps: plan.completed_steps ?? 0,
      totalSteps: plan.total_steps ?? steps.length,
      currentStepTitle: currentStep?.title ?? null,
      planStatus: plan.status ?? null,
      isCompleted: plan.status === "completed",
      isActive: plan.status === "active",
      threadId: thread.id,
    };
  }

  return { byParticipant, shared: null, mode: conversationMode };
}

function mapAsk(row: any, includeProgress = false): AskSessionRecord {
  const participants = (row.ask_participants ?? []).map((participant: any, index: number) => {
    const user = participant.users ?? {};

    // Use centralized function for display name
    const displayName = buildParticipantDisplayName(
      participant as ParticipantRow,
      user.id ? user as UserRow : null,
      index
    );

    return {
      id: String(participant.user_id ?? participant.id),
      name: displayName,
      email: participant.participant_email || user.email || null,
      role: user.role || participant.role || null,
      isSpokesperson: participant.role === "spokesperson" || participant.is_spokesperson === true,
      isActive: true,
      inviteToken: participant.invite_token || null,
    };
  });

  const result: AskSessionRecord = {
    id: row.id,
    askKey: row.ask_key,
    name: row.name,
    question: row.question,
    description: row.description,
    status: row.status,
    projectId: row.project_id,
    projectName: row.projects?.name ?? null,
    challengeId: row.challenge_id,
    startDate: row.start_date,
    endDate: row.end_date,
    allowAutoRegistration: row.allow_auto_registration,
    maxParticipants: row.max_participants,
    deliveryMode: row.delivery_mode ?? "digital",
    conversationMode: row.conversation_mode ?? "collaborative",
    expectedDurationMinutes: row.expected_duration_minutes ?? 8,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    participants,
    systemPrompt: row.system_prompt ?? null,
  };

  // Include progress data if requested
  if (includeProgress) {
    result.progressData = buildProgressData(row);
  }

  return result;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const supabase = await createServerSupabaseClient();
    const resolvedParams = await params;
    const askId = z.string().uuid().parse(resolvedParams.id);

    // Check if progress data is requested via query param
    const includeProgress = request.nextUrl.searchParams.get("includeProgress") === "true";

    // Ensure all participants have tokens before fetching
    await ensureParticipantTokens(supabase, askId);

    // Use extended select if progress is requested
    const selectQuery = includeProgress ? askSelectWithProgress : askSelect;

    const { data, error, status } = await supabase
      .from("ask_sessions")
      .select(selectQuery)
      .eq("id", askId)
      .single();

    if (error) {
      if (error.code === "PGRST116" || status === 406) {
        return NextResponse.json<ApiResponse>({
          success: false,
          error: "ASK session not found",
        }, { status: 404 });
      }
      throw error;
    }

    if (!data) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: "ASK session not found",
      }, { status: 404 });
    }

    return NextResponse.json<ApiResponse<AskSessionRecord>>({
      success: true,
      data: mapAsk(data, includeProgress),
    });
  } catch (error) {
    let status = 500;
    if (error instanceof z.ZodError) status = 400;
    else if (error instanceof Error && error.message.includes('required')) status = 403;
    
    const message = error instanceof z.ZodError
      ? error.errors[0]?.message || "Invalid ASK id"
      : parseErrorMessage(error);

    return NextResponse.json<ApiResponse>({
      success: false,
      error: message,
    }, { status });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const supabase = await createServerSupabaseClient();
    const resolvedParams = await params;
    const askId = z.string().uuid().parse(resolvedParams.id);
    const body = await request.json();
    const payload = updateSchema.parse(body);

  const updateData: Record<string, any> = {};
  if (payload.name) updateData.name = sanitizeText(payload.name);
  if (payload.question) updateData.question = sanitizeText(payload.question);
  if (payload.description !== undefined) updateData.description = sanitizeOptional(payload.description);
  if (payload.status) updateData.status = payload.status;
  if (payload.challengeId !== undefined) {
      updateData.challenge_id = payload.challengeId && payload.challengeId !== "" ? payload.challengeId : null;
    }
    if (payload.startDate) {
      const startDate = new Date(payload.startDate);
      if (Number.isNaN(startDate.getTime())) {
        throw new z.ZodError([{ message: "Invalid start date", path: ["startDate"], code: "custom" }]);
      }
      updateData.start_date = startDate.toISOString();
    }
  if (payload.endDate) {
    const endDate = new Date(payload.endDate);
    if (Number.isNaN(endDate.getTime())) {
      throw new z.ZodError([{ message: "Invalid end date", path: ["endDate"], code: "custom" }]);
    }
    updateData.end_date = endDate.toISOString();
  }
  if (payload.allowAutoRegistration !== undefined) updateData.allow_auto_registration = payload.allowAutoRegistration;
  if (payload.maxParticipants !== undefined) updateData.max_participants = payload.maxParticipants;
  if (payload.deliveryMode) updateData.delivery_mode = payload.deliveryMode;

  // Handle conversation mode
  if (payload.conversationMode) {
    updateData.conversation_mode = payload.conversationMode;
  }

  // Handle expected duration
  if (payload.expectedDurationMinutes !== undefined) {
    updateData.expected_duration_minutes = payload.expectedDurationMinutes;
  }

  if (payload.systemPrompt !== undefined) updateData.system_prompt = sanitizeOptional(payload.systemPrompt || null);

  const hasParticipantUpdate = payload.participantIds !== undefined;
  const hasSpokespersonUpdate = payload.spokespersonId !== undefined;

  if (Object.keys(updateData).length === 0 && !hasParticipantUpdate && !hasSpokespersonUpdate) {
    return NextResponse.json<ApiResponse>({
      success: false,
      error: "No valid fields provided"
    }, { status: 400 });
  }

  if (Object.keys(updateData).length > 0) {
    const { error } = await supabase
      .from("ask_sessions")
      .update(updateData)
      .eq("id", askId);

    if (error) {
      throw error;
    }
  }

  if (hasParticipantUpdate) {
    const participantIds = payload.participantIds ?? [];
    const { data: currentParticipants, error: currentError } = await supabase
      .from("ask_participants")
      .select("id, user_id")
      .eq("ask_session_id", askId);

    if (currentError) {
      throw currentError;
    }

    const currentIds = (currentParticipants ?? [])
      .map(entry => entry.user_id)
      .filter((value): value is string => Boolean(value));

    const toDeleteIds = (currentParticipants ?? [])
      .filter(entry => !participantIds.includes(entry.user_id))
      .map(entry => entry.id);

    if (toDeleteIds.length > 0) {
      const { error: deleteError } = await supabase
        .from("ask_participants")
        .delete()
        .in("id", toDeleteIds);

      if (deleteError) {
        throw deleteError;
      }
    }

    const toInsertIds = participantIds.filter(id => !currentIds.includes(id));
    const spokespersonId = payload.spokespersonId && payload.spokespersonId !== "" ? payload.spokespersonId : null;

    if (toInsertIds.length > 0) {
      const insertPayload = toInsertIds.map(userId => ({
        ask_session_id: askId,
        user_id: userId,
        role: spokespersonId && userId === spokespersonId ? "spokesperson" : "participant",
      }));

      const { error: insertError } = await supabase
        .from("ask_participants")
        .insert(insertPayload);

      if (insertError) {
        throw insertError;
      }
    }

    // Ensure role alignment for existing participants
    const { error: resetError } = await supabase
      .from("ask_participants")
      .update({ role: "participant" })
      .eq("ask_session_id", askId);

    if (resetError) {
      throw resetError;
    }

    if (spokespersonId) {
      const { error: setSpokesError } = await supabase
        .from("ask_participants")
        .update({ role: "spokesperson" })
        .eq("ask_session_id", askId)
        .eq("user_id", spokespersonId);

      if (setSpokesError) {
        throw setSpokesError;
      }
    }
  } else if (hasSpokespersonUpdate) {
    const spokespersonId = payload.spokespersonId && payload.spokespersonId !== "" ? payload.spokespersonId : null;

    const { error: resetError } = await supabase
      .from("ask_participants")
      .update({ role: "participant" })
      .eq("ask_session_id", askId);

    if (resetError) {
      throw resetError;
    }

    if (spokespersonId) {
      const { error: setSpokesError } = await supabase
        .from("ask_participants")
        .update({ role: "spokesperson" })
        .eq("ask_session_id", askId)
        .eq("user_id", spokespersonId);

      if (setSpokesError) {
        throw setSpokesError;
      }
    }
  }

  // Ensure all participants have tokens before fetching
  await ensureParticipantTokens(supabase, askId);

  console.log(`📡 Fetching ASK with select: ${askSelect}`);
  const { data, error } = await supabase
    .from("ask_sessions")
    .select(askSelect)
    .eq("id", askId)
    .single();

  if (error) {
    throw error;
  }

  console.log(`📦 Raw data from DB:`, {
    askId: data.id,
    participantCount: data.ask_participants?.length || 0,
    participants: data.ask_participants?.map((p: any) => ({
      id: p.id,
      user_id: p.user_id,
      hasToken: !!p.invite_token,
      tokenPreview: p.invite_token?.substring(0, 8)
    }))
  });

  const mapped = mapAsk(data);
  console.log(`📤 Mapped data to return:`, {
    askId: mapped.id,
    participantCount: mapped.participants?.length || 0,
  });

  return NextResponse.json<ApiResponse<AskSessionRecord>>({
    success: true,
    data: mapped
  });
  } catch (error) {
    let status = 500;
    if (error instanceof z.ZodError) status = 400;
    else if (error instanceof Error && error.message.includes('required')) status = 403;
    
    return NextResponse.json<ApiResponse>({
      success: false,
      error: error instanceof z.ZodError ? error.errors[0]?.message || "Invalid payload" : parseErrorMessage(error)
    }, { status });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const supabase = await createServerSupabaseClient();
    const resolvedParams = await params;
    const askId = z.string().uuid().parse(resolvedParams.id);
    const { error } = await supabase.from("ask_sessions").delete().eq("id", askId);

    if (error) {
      throw error;
    }

    return NextResponse.json<ApiResponse>({ success: true });
  } catch (error) {
    let status = 500;
    if (error instanceof z.ZodError) status = 400;
    else if (error instanceof Error && error.message.includes('required')) status = 403;
    
    return NextResponse.json<ApiResponse>({
      success: false,
      error: error instanceof z.ZodError ? error.errors[0]?.message || "Invalid ASK id" : parseErrorMessage(error)
    }, { status });
  }
}
