import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient, requireAdmin } from "@/lib/supabaseServer";
import { sanitizeOptional, sanitizeText } from "@/lib/sanitize";
import { parseErrorMessage } from "@/lib/utils";
import { type ApiResponse, type AskSessionRecord } from "@/types";
import { ensureProfileExists } from "@/lib/profiles";
import { sendMagicLink } from "@/lib/auth/magicLink";
import { buildParticipantDisplayName, type ParticipantRow, type UserRow } from "@/lib/conversation-context";

/**
 * Generate a random suffix for ask_key uniqueness
 */
function generateRandomSuffix(length: number = 4): string {
  return Math.random().toString(36).slice(2, 2 + length);
}

/**
 * Insert an ASK session with retry logic for duplicate key conflicts.
 * If the ask_key already exists, appends a random suffix and retries.
 */
async function insertAskSessionWithRetry(
  supabase: SupabaseClient,
  insertData: Record<string, unknown>,
  selectQuery: string,
  maxRetries: number = 3
): Promise<{ data: any; error: any }> {
  let attempt = 0;
  let currentAskKey = insertData.ask_key as string;

  while (attempt < maxRetries) {
    const dataToInsert = { ...insertData, ask_key: currentAskKey };
    const { data, error } = await supabase
      .from("ask_sessions")
      .insert(dataToInsert)
      .select(selectQuery)
      .single();

    if (!error) {
      return { data, error: null };
    }

    // Check if it's a duplicate key error (PostgreSQL error code 23505)
    const isDuplicateKey = error.code === "23505" &&
      error.message?.includes("ask_sessions_ask_key_key");

    if (!isDuplicateKey) {
      return { data: null, error };
    }

    // Generate a new key with random suffix and retry
    attempt++;
    currentAskKey = `${insertData.ask_key}-${generateRandomSuffix()}`;
    console.log(`🔄 Duplicate key detected, retrying with: ${currentAskKey} (attempt ${attempt}/${maxRetries})`);
  }

  return {
    data: null,
    error: {
      message: `Failed to create unique ask_key after ${maxRetries} attempts`,
      code: "DUPLICATE_KEY_EXHAUSTED"
    }
  };
}

const statusValues = ["active", "inactive", "draft", "closed"] as const;
const deliveryModes = ["physical", "digital"] as const;
const conversationModes = ["individual_parallel", "collaborative", "group_reporter", "consultant"] as const;
const askSelect = "*, projects(name), ask_participants(id, user_id, role, participant_name, participant_email, is_spokesperson, invite_token), system_prompt";
const dateSchema = z.string().trim().min(1).refine(value => !Number.isNaN(new Date(value).getTime()), {
  message: "Invalid date"
});

const askSchema = z.object({
  askKey: z.string().trim().min(3).max(255).regex(/^[a-zA-Z0-9._-]+$/),
  name: z.string().trim().min(1).max(255),
  question: z.string().trim().min(5).max(2000),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  status: z.enum(statusValues).default("active"),
  projectId: z.string().uuid(),
  challengeId: z.string().uuid().optional().or(z.literal("")),
  startDate: dateSchema,
  endDate: dateSchema,
  allowAutoRegistration: z.boolean().default(false),
  maxParticipants: z.number().int().positive().max(10000).optional(),
  deliveryMode: z.enum(deliveryModes),
  conversationMode: z.enum(conversationModes).default("collaborative"),
  expectedDurationMinutes: z.number().int().min(1).max(30).default(8),
  participantIds: z.array(z.string().uuid()).default([]),
  participantEmails: z.array(z.string().email()).default([]),
  spokespersonId: z.string().uuid().optional().or(z.literal("")),
  spokespersonEmail: z.string().email().optional().or(z.literal("")),
  systemPrompt: z.union([z.string().trim(), z.literal(""), z.null()]).optional()
});

function mapAsk(row: any): AskSessionRecord {
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

  return {
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
}

export async function GET(request: NextRequest) {
  try {
    // Verify user is admin and get authenticated client
    const { profile } = await requireAdmin();
    const supabase = await createServerSupabaseClient();

    const role = profile.role?.toLowerCase() ?? "";
    const isFullAdmin = role === "full_admin";

    const url = new URL(request.url);
    const challengeId = url.searchParams.get("challengeId");

    // For non full_admin, include client_id in projects join for filtering
    const selectQuery = isFullAdmin
      ? askSelect
      : "*, projects!inner(name, client_id), ask_participants(id, user_id, role, participant_name, participant_email, is_spokesperson, invite_token), system_prompt";

    let query = supabase
      .from("ask_sessions")
      .select(selectQuery)
      .order("created_at", { ascending: false });

    // Non full_admin users can only see asks for their clients' projects
    if (!isFullAdmin && profile.client_ids.length > 0) {
      query = query.in("projects.client_id", profile.client_ids);
    }

    if (challengeId) {
      if (!z.string().uuid().safeParse(challengeId).success) {
        return NextResponse.json<ApiResponse>({
          success: false,
          error: "Invalid challenge identifier"
        }, { status: 400 });
      }
      query = query.eq("challenge_id", challengeId);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return NextResponse.json<ApiResponse<AskSessionRecord[]>>({
      success: true,
      data: (data ?? []).map(mapAsk)
    });
  } catch (error) {
    const status = error instanceof Error && error.message.includes('required') ? 403 : 500;
    return NextResponse.json<ApiResponse>({
      success: false,
      error: parseErrorMessage(error)
    }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify user is admin and get authenticated client
    await requireAdmin();
    const supabase = await createServerSupabaseClient();
    
    const body = await request.json();
    console.log('🔧 ASK creation request:', body);
    
    const payload = askSchema.parse(body);
    console.log('✅ Parsed ASK payload:', payload);
    const startDate = new Date(payload.startDate).toISOString();
    const endDate = new Date(payload.endDate).toISOString();

    const insertData = {
      ask_key: sanitizeText(payload.askKey),
      name: sanitizeText(payload.name),
      question: sanitizeText(payload.question),
      description: sanitizeOptional(payload.description || null),
      status: payload.status,
      project_id: payload.projectId,
      challenge_id: payload.challengeId && payload.challengeId !== "" ? payload.challengeId : null,
      start_date: startDate,
      end_date: endDate,
      allow_auto_registration: payload.allowAutoRegistration,
      max_participants: payload.maxParticipants ?? null,
      delivery_mode: payload.deliveryMode,
      conversation_mode: payload.conversationMode,
      expected_duration_minutes: payload.expectedDurationMinutes,
      system_prompt: sanitizeOptional(payload.systemPrompt || null)
    };

    console.log('📝 ASK insert data to be sent to DB:', insertData);

    // Use retry logic to handle duplicate key conflicts
    const { data, error } = await insertAskSessionWithRetry(
      supabase,
      insertData,
      askSelect
    );

    if (error) {
      console.error('❌ ASK creation database error:', error);
      throw error;
    }

    console.log('✅ ASK created successfully:', data);

    // Process participants from user IDs
    const participantRecords: Array<{
      ask_session_id: string;
      user_id?: string;
      participant_email?: string;
      role: string;
    }> = [];

    // Determine spokesperson ID/email
    const spokespersonId = payload.spokespersonId && payload.spokespersonId !== "" ? payload.spokespersonId : null;
    const spokespersonEmail = payload.spokespersonEmail && payload.spokespersonEmail !== "" ? payload.spokespersonEmail.toLowerCase().trim() : null;

    // Add participants from user IDs
    if (payload.participantIds.length > 0) {
      for (const userId of payload.participantIds) {
        participantRecords.push({
          ask_session_id: data.id,
          user_id: userId,
          role: spokespersonId && userId === spokespersonId ? "spokesperson" : "participant",
        });
      }
    }

    // Process participants from email addresses
    const emailParticipants: Array<{ email: string; profileId?: string }> = [];
    const failedEmails: string[] = [];

    if (payload.participantEmails.length > 0) {
      for (const email of payload.participantEmails) {
        const normalizedEmail = email.toLowerCase().trim();

        try {
          // Ensure profile exists and is added to project
          // This is REQUIRED - we must have a user_id for each participant with an invite_token
          const profileId = await ensureProfileExists(normalizedEmail, payload.projectId);

          // Check if profile already added (from participantIds)
          const alreadyAdded = participantRecords.some(p => p.user_id === profileId);

          if (!alreadyAdded) {
            participantRecords.push({
              ask_session_id: data.id,
              user_id: profileId, // REQUIRED: Every participant must have a user_id
              participant_email: normalizedEmail,
              role: spokespersonEmail && normalizedEmail === spokespersonEmail ? "spokesperson" : "participant",
            });

            emailParticipants.push({ email: normalizedEmail, profileId });
          }
        } catch (error) {
          console.error(`❌ Failed to create profile for ${normalizedEmail}:`, error);
          // CRITICAL: Do NOT create participants without user_id
          // Invite tokens require a linked user profile for authentication
          failedEmails.push(normalizedEmail);
          // Log the error but DO NOT add a participant without user_id
          // This prevents 403 errors when using invite tokens
        }
      }
    }

    // If any emails failed, log a warning
    if (failedEmails.length > 0) {
      console.warn(`⚠️  Failed to create participants for emails (no user_id assigned): ${failedEmails.join(', ')}`);
      console.warn('⚠️  These participants will NOT be created. All participants must have a linked user profile.');
    }

    // Insert all participants
    if (participantRecords.length > 0) {
      const { error: participantError } = await supabase
        .from("ask_participants")
        .insert(participantRecords);

      if (participantError) {
        throw participantError;
      }
    }

    const { data: hydrated, error: fetchError } = await supabase
      .from("ask_sessions")
      .select(askSelect)
      .eq("id", data.id)
      .single();

    const record = fetchError ? data : hydrated;

    return NextResponse.json<ApiResponse<AskSessionRecord>>({
      success: true,
      data: mapAsk(record)
    }, { status: 201 });
  } catch (error) {
    let status = 500;
    let errorMessage = "An unexpected error occurred";
    
    if (error instanceof z.ZodError) {
      status = 400;
      // Provide detailed validation error messages
      const errors = error.errors.map(err => {
        const path = err.path.join('.');
        return path ? `${path}: ${err.message}` : err.message;
      });
      errorMessage = errors.length > 0 
        ? `Validation error: ${errors.join('; ')}`
        : "Invalid input";
      console.error('❌ ASK creation validation error:', error.errors);
    } else if (error instanceof Error && error.message.includes('required')) {
      status = 403;
      errorMessage = parseErrorMessage(error);
    } else {
      errorMessage = parseErrorMessage(error);
      console.error('❌ ASK creation error:', error);
    }
    
    return NextResponse.json<ApiResponse>({
      success: false,
      error: errorMessage
    }, { status });
  }
}
