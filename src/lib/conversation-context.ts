/**
 * Unified Conversation Context Module
 *
 * This module provides a single source of truth for fetching and building
 * conversation context used by AI agents across all modes:
 * - Text mode (stream/route.ts)
 * - Voice mode (voice-agent/init/route.ts)
 * - Test mode (admin/ai/agents/[id]/test/route.ts)
 *
 * IMPORTANT: Any changes to data fetching or message mapping should be made HERE
 * to ensure consistency across all modes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import { normaliseMessageMetadata } from './messages';
import { getOrCreateConversationThread, getMessagesForThread, getLastUserMessageThread, type AskSessionConfig } from './asks';
import { getConversationPlanWithSteps, type ConversationPlan, type ConversationPlanWithSteps } from './ai/conversation-plan';
import type { ConversationMessageSummary, ConversationParticipantSummary } from './ai/conversation-agent';

// ============================================================================
// DEBUG MODE - Toggle to throw errors for production visibility
// Set to false to revert to silent failures
// ============================================================================
const DEBUG_RPC_ERRORS = true;

/**
 * Custom error class for RPC failures with detailed debug info.
 * Includes the RPC name, parameters, and original error for debugging.
 */
export class RpcDebugError extends Error {
  public readonly rpcName: string;
  public readonly params: Record<string, unknown>;
  public readonly originalError: unknown;
  public readonly timestamp: string;

  constructor(rpcName: string, params: Record<string, unknown>, originalError: unknown) {
    // Handle different error types properly
    let errorMessage: string;
    if (originalError instanceof Error) {
      errorMessage = originalError.message;
    } else if (originalError && typeof originalError === 'object') {
      // Supabase PostgrestError has message, details, hint properties
      const errObj = originalError as { message?: string; details?: string; hint?: string };
      const parts = [errObj.message, errObj.details, errObj.hint].filter(Boolean);
      errorMessage = parts.length > 0 ? parts.join(' | ') : JSON.stringify(originalError);
    } else {
      errorMessage = String(originalError);
    }
    const errorCode = (originalError as { code?: string })?.code ?? 'UNKNOWN';

    super(`[RPC_ERROR] ${rpcName} failed (${errorCode}): ${errorMessage} | params: ${JSON.stringify(params)}`);

    this.name = 'RpcDebugError';
    this.rpcName = rpcName;
    this.params = params;
    this.originalError = originalError;
    this.timestamp = new Date().toISOString();

    // Log detailed debug info
    console.error(`🔴 [RPC_DEBUG] ${this.timestamp}`);
    console.error(`   RPC: ${rpcName}`);
    console.error(`   Code: ${errorCode}`);
    console.error(`   Message: ${errorMessage}`);
    console.error(`   Params:`, params);
    console.error(`   Full error:`, originalError);

    // Send to Sentry for monitoring
    Sentry.captureException(this, {
      tags: {
        rpcName,
        errorCode,
      },
      extra: {
        params,
        originalError,
        timestamp: this.timestamp,
      },
    });
  }
}

/**
 * Helper to handle RPC errors - throws in debug mode, warns otherwise.
 */
function handleRpcError<T>(
  rpcName: string,
  params: Record<string, unknown>,
  error: unknown,
  fallbackValue: T
): T {
  if (DEBUG_RPC_ERRORS) {
    throw new RpcDebugError(rpcName, params, error);
  }
  console.warn(`Failed to call ${rpcName}:`, error);
  return fallbackValue;
}

/**
 * Helper to handle direct table query errors - throws in debug mode, warns otherwise.
 */
function handleDbQueryError<T>(
  tableName: string,
  queryDescription: string,
  error: unknown,
  fallbackValue: T
): T {
  if (DEBUG_RPC_ERRORS) {
    throw new RpcDebugError(`DB:${tableName}`, { query: queryDescription }, error);
  }
  console.warn(`Failed DB query on ${tableName}:`, error);
  return fallbackValue;
}

// ============================================================================
// Types
// ============================================================================

export interface ParticipantRow {
  id: string;
  participant_name?: string | null;
  participant_email?: string | null;
  role?: string | null;
  is_spokesperson?: boolean | null;
  user_id?: string | null;
  last_active?: string | null;
  elapsed_active_seconds?: number | null;
}

export interface UserRow {
  id: string;
  email?: string | null;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  description?: string | null;
  job_title?: string | null;
}

export interface ProjectMemberRow {
  user_id: string;
  description?: string | null;
  job_title?: string | null;
  role?: string | null;
}

export interface MessageRow {
  id: string;
  ask_session_id: string;
  user_id?: string | null;
  sender_type?: string | null;
  content: string;
  message_type?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  conversation_thread_id?: string | null;
  plan_step_id?: string | null;
}

export interface AskSessionRow {
  id: string;
  ask_key: string;
  question: string;
  description?: string | null;
  status?: string | null;
  system_prompt?: string | null;
  project_id?: string | null;
  challenge_id?: string | null;
  allow_auto_registration?: boolean | null;
  conversation_mode?: string | null;
  expected_duration_minutes?: number | null;
}

export interface ProjectRow {
  id: string;
  name?: string | null;
  description?: string | null;
  system_prompt?: string | null;
}

export interface ChallengeRow {
  id: string;
  name?: string | null;
  description?: string | null;
  system_prompt?: string | null;
}

/**
 * Extended message type used by streaming routes that need full message details.
 * This includes all fields from ConversationMessageSummary plus additional metadata.
 */
export interface DetailedMessage {
  id: string;
  askKey?: string;
  askSessionId: string;
  content: string;
  type: string;
  senderType: string;
  senderId: string | null;
  senderName: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
  planStepId: string | null;
}

export interface ConversationContextResult {
  askSession: AskSessionRow;
  participants: ConversationParticipantSummary[];
  messages: ConversationMessageSummary[];
  project: ProjectRow | null;
  challenge: ChallengeRow | null;
  conversationPlan: ConversationPlan | null;
  conversationThread: { id: string; is_shared: boolean } | null;
  usersById: Record<string, UserRow>;
  /** Real elapsed active time in seconds (from participant timer) */
  elapsedActiveSeconds: number;
  /** Real elapsed active time for current step in seconds */
  stepElapsedActiveSeconds: number;
}

export interface FetchConversationContextOptions {
  profileId?: string | null;
  adminClient?: SupabaseClient; // For bypassing RLS when needed
  /** Invite token for voice mode (uses token-based RPCs to bypass RLS) */
  token?: string;
  /** If true, find the thread from the last user message (important for individual_parallel mode) */
  useLastUserMessageThread?: boolean;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Build participant display name from participant row and user data.
 *
 * Priority:
 * 1. participant_name (explicit name set for this participation)
 * 2. User's full_name
 * 3. User's first_name + last_name
 * 4. User's email
 * 5. Fallback: "Participant {index + 1}"
 *
 * IMPORTANT: This is the SINGLE source of truth for participant display names.
 * Do NOT duplicate this logic elsewhere.
 */
export function buildParticipantDisplayName(
  participant: ParticipantRow,
  user: UserRow | null,
  index: number
): string {
  // Priority 1: Explicit participant name
  if (participant.participant_name && participant.participant_name.trim().length > 0) {
    return participant.participant_name.trim();
  }

  // Priority 2-4: User data
  if (user) {
    // Full name
    if (user.full_name && user.full_name.trim().length > 0) {
      return user.full_name.trim();
    }

    // First + last name
    const nameParts = [user.first_name, user.last_name]
      .filter(Boolean)
      .map(part => part!.trim())
      .filter(part => part.length > 0);
    if (nameParts.length > 0) {
      return nameParts.join(' ');
    }

    // Email as fallback
    if (user.email && user.email.trim().length > 0) {
      return user.email.trim();
    }
  }

  // Priority 5: Generic fallback
  return `Participant ${index + 1}`;
}

/**
 * Build message sender name from message metadata and user data.
 *
 * Priority:
 * 1. metadata.senderName (stored sender name)
 * 2. "Agent" for AI messages
 * 3. User's full_name
 * 4. User's first_name + last_name
 * 5. User's email
 * 6. Fallback: "Participant {index + 1}"
 *
 * IMPORTANT: This is the SINGLE source of truth for message sender names.
 * Do NOT duplicate this logic elsewhere.
 */
export function buildMessageSenderName(
  messageRow: MessageRow,
  user: UserRow | null,
  index: number
): string {
  // Parse metadata
  const metadata = normaliseMessageMetadata(messageRow.metadata);

  // Priority 1: Explicit sender name in metadata
  if (metadata && typeof metadata.senderName === 'string' && metadata.senderName.trim().length > 0) {
    return metadata.senderName.trim();
  }

  // Priority 2: AI messages always return "Agent"
  if (messageRow.sender_type === 'ai') {
    return 'Agent';
  }

  // Priority 3-5: User data
  if (user) {
    if (user.full_name && user.full_name.trim().length > 0) {
      return user.full_name.trim();
    }

    const nameParts = [user.first_name, user.last_name]
      .filter(Boolean)
      .map(part => part!.trim())
      .filter(part => part.length > 0);
    if (nameParts.length > 0) {
      return nameParts.join(' ');
    }

    if (user.email && user.email.trim().length > 0) {
      return user.email.trim();
    }
  }

  // Priority 6: Generic fallback
  return `Participant ${index + 1}`;
}

/**
 * Build a ConversationMessageSummary from a database message row.
 *
 * IMPORTANT: This function ensures consistent message mapping across ALL modes.
 * Always use this function when converting DB rows to ConversationMessageSummary.
 *
 * @param messageRow - Raw message row from database
 * @param user - User row for the message sender (if available)
 * @param index - Message index (for fallback naming)
 * @returns ConversationMessageSummary with all required fields including planStepId
 */
export function buildMessageSummary(
  messageRow: MessageRow,
  user: UserRow | null,
  index: number
): ConversationMessageSummary {
  return {
    id: messageRow.id,
    senderType: messageRow.sender_type ?? 'user',
    senderName: buildMessageSenderName(messageRow, user, index),
    content: messageRow.content,
    timestamp: messageRow.created_at ?? new Date().toISOString(),
    // CRITICAL: Always include planStepId for step variable support
    planStepId: messageRow.plan_step_id ?? null,
  };
}

/**
 * Build a DetailedMessage from a database message row.
 *
 * Used by streaming routes that need the full message object including metadata.
 * Uses the same sender name logic as buildMessageSummary for consistency.
 *
 * @param messageRow - Raw message row from database
 * @param user - User row for the message sender (if available)
 * @param index - Message index (for fallback naming)
 * @param askKey - Optional ASK key to include in the message
 * @returns DetailedMessage with all fields including metadata
 */
export function buildDetailedMessage(
  messageRow: MessageRow,
  user: UserRow | null,
  index: number,
  askKey?: string
): DetailedMessage {
  const metadata = normaliseMessageMetadata(messageRow.metadata);
  return {
    id: messageRow.id,
    askKey,
    askSessionId: messageRow.ask_session_id,
    content: messageRow.content,
    type: messageRow.message_type ?? 'text',
    senderType: messageRow.sender_type ?? 'user',
    senderId: messageRow.user_id ?? null,
    // Use the same sender name logic as buildMessageSummary
    senderName: buildMessageSenderName(messageRow, user, index),
    timestamp: messageRow.created_at ?? new Date().toISOString(),
    metadata,
    // CRITICAL: Always include planStepId for step variable support
    planStepId: messageRow.plan_step_id ?? null,
  };
}

/**
 * Build participant summary from participant row and user data.
 *
 * @param participantRow - Raw participant row from database
 * @param user - User row (if available)
 * @param projectMember - Project member row (if available, for project-specific description)
 * @param index - Participant index (for fallback naming)
 * @returns ConversationParticipantSummary with name, role, and description
 *
 * Priority for description: project_members.description > profiles.description
 * Priority for jobTitle: project_members.job_title > profiles.job_title
 */
export function buildParticipantSummary(
  participantRow: ParticipantRow,
  user: UserRow | null,
  projectMember: ProjectMemberRow | null,
  index: number
): ConversationParticipantSummary {
  return {
    name: buildParticipantDisplayName(participantRow, user, index),
    role: participantRow.role ?? null,
    // Priority: project-specific > global profile
    description: projectMember?.description ?? user?.description ?? null,
    jobTitle: projectMember?.job_title ?? user?.job_title ?? null,
  };
}

// ============================================================================
// Data Fetching Functions
// ============================================================================

/**
 * Fetch users by their IDs and return a lookup map.
 * Uses RPC to bypass RLS in production.
 */
export async function fetchUsersByIds(
  supabase: SupabaseClient,
  userIds: string[]
): Promise<Record<string, UserRow>> {
  if (userIds.length === 0) {
    return {};
  }

  // Use RPC to bypass RLS in production
  const params = { p_user_ids: userIds };
  const { data: userRowsJson, error } = await supabase.rpc('get_profiles_by_ids', params);

  if (error) {
    return handleRpcError('get_profiles_by_ids', { p_user_ids: `[${userIds.length} ids]` }, error, {});
  }

  const userRows = (userRowsJson as UserRow[] | null) ?? [];
  return userRows.reduce<Record<string, UserRow>>((acc, user) => {
    acc[user.id] = user;
    return acc;
  }, {});
}

/**
 * Fetch project members for a project and return a lookup map by user_id.
 * Used to get project-specific descriptions/job titles that override profile defaults.
 */
export async function fetchProjectMembersByProject(
  supabase: SupabaseClient,
  projectId: string
): Promise<Record<string, ProjectMemberRow>> {
  const { data: memberRows, error } = await supabase
    .from('project_members')
    .select('user_id, description, job_title, role')
    .eq('project_id', projectId);

  if (error) {
    console.warn(`Failed to fetch project_members for project ${projectId}:`, error);
    return {};
  }

  return (memberRows ?? []).reduce<Record<string, ProjectMemberRow>>((acc, row) => {
    acc[row.user_id] = row as ProjectMemberRow;
    return acc;
  }, {});
}

/**
 * Result type for fetchParticipantsWithUsers.
 * Includes all data needed by routes to build various participant structures.
 */
export interface FetchParticipantsResult {
  /** Built participant summaries (ConversationParticipantSummary) */
  participants: ConversationParticipantSummary[];
  /** User data by user ID */
  usersById: Record<string, UserRow>;
  /** Raw participant rows from database */
  participantRows: ParticipantRow[];
  /** Project member data by user ID (for project-specific descriptions) */
  projectMembersById: Record<string, ProjectMemberRow>;
}

/**
 * Fetch participants for an ASK session with their user data.
 * Returns raw participantRows for use with fetchElapsedTime.
 *
 * @param supabase - Supabase client
 * @param askSessionId - ASK session ID
 * @param projectId - Optional project ID for fetching project-specific descriptions
 */
export async function fetchParticipantsWithUsers(
  supabase: SupabaseClient,
  askSessionId: string,
  projectId?: string | null
): Promise<FetchParticipantsResult> {
  // Fetch participants (include elapsed_active_seconds for timer)
  const { data: participantRows, error: participantError } = await supabase
    .from('ask_participants')
    .select('id, participant_name, participant_email, role, is_spokesperson, user_id, last_active, elapsed_active_seconds')
    .eq('ask_session_id', askSessionId)
    .order('joined_at', { ascending: true });

  if (participantError) {
    return handleDbQueryError('ask_participants', `askSessionId=${askSessionId}`, participantError, {
      participants: [],
      usersById: {},
      participantRows: [],
      projectMembersById: {},
    });
  }

  const typedParticipantRows = (participantRows ?? []) as ParticipantRow[];

  // Collect user IDs
  const participantUserIds = typedParticipantRows
    .map(row => row.user_id)
    .filter((value): value is string => Boolean(value));

  // Fetch user data and project member data in parallel
  const [usersById, projectMembersById] = await Promise.all([
    fetchUsersByIds(supabase, participantUserIds),
    projectId ? fetchProjectMembersByProject(supabase, projectId) : Promise.resolve({} as Record<string, ProjectMemberRow>),
  ]);

  // Build participant summaries with project-specific data priority
  const participants = typedParticipantRows.map((row, index) => {
    const user = row.user_id ? usersById[row.user_id] ?? null : null;
    const projectMember = row.user_id ? projectMembersById[row.user_id] ?? null : null;
    return buildParticipantSummary(row, user, projectMember, index);
  });

  return { participants, usersById, participantRows: typedParticipantRows, projectMembersById };
}

/**
 * Fetch messages for a conversation thread (or all messages if no thread).
 * Returns messages as ConversationMessageSummary with consistent mapping.
 */
export async function fetchMessagesWithUsers(
  supabase: SupabaseClient,
  askSessionId: string,
  conversationThreadId: string | null,
  existingUsersById: Record<string, UserRow> = {}
): Promise<{ messages: ConversationMessageSummary[]; usersById: Record<string, UserRow> }> {
  let messageRows: MessageRow[] = [];

  if (conversationThreadId) {
    // Fetch messages for the specific thread
    const { messages: threadMessages, error: threadError } = await getMessagesForThread(
      supabase,
      conversationThreadId
    );

    if (threadError) {
      handleDbQueryError('messages', `thread=${conversationThreadId}`, threadError, []);
    }

    // Also fetch messages without thread for backward compatibility
    const { data: messagesWithoutThread, error: noThreadError } = await supabase
      .from('messages')
      .select('id, ask_session_id, user_id, sender_type, content, message_type, metadata, created_at, conversation_thread_id, plan_step_id')
      .eq('ask_session_id', askSessionId)
      .is('conversation_thread_id', null)
      .order('created_at', { ascending: true });

    if (noThreadError) {
      handleDbQueryError('messages', `noThread askSessionId=${askSessionId}`, noThreadError, []);
    }

    // Combine and sort by timestamp
    const threadMessagesList = (threadMessages ?? []) as MessageRow[];
    const noThreadMessagesList = (messagesWithoutThread ?? []) as MessageRow[];
    messageRows = [...threadMessagesList, ...noThreadMessagesList].sort((a, b) => {
      const timeA = new Date(a.created_at ?? new Date().toISOString()).getTime();
      const timeB = new Date(b.created_at ?? new Date().toISOString()).getTime();
      return timeA - timeB;
    });
  } else {
    // Fallback: fetch all messages for the session
    const { data, error } = await supabase
      .from('messages')
      .select('id, ask_session_id, user_id, sender_type, content, message_type, metadata, created_at, conversation_thread_id, plan_step_id')
      .eq('ask_session_id', askSessionId)
      .order('created_at', { ascending: true });

    if (error) {
      handleDbQueryError('messages', `all askSessionId=${askSessionId}`, error, []);
    }

    messageRows = (data ?? []) as MessageRow[];
  }

  // Collect additional user IDs not in existing lookup
  const messageUserIds = messageRows
    .map(row => row.user_id)
    .filter((value): value is string => Boolean(value));

  const additionalUserIds = messageUserIds.filter(id => !existingUsersById[id]);

  // Fetch additional user data
  let usersById = { ...existingUsersById };
  if (additionalUserIds.length > 0) {
    const additionalUsers = await fetchUsersByIds(supabase, additionalUserIds);
    usersById = { ...usersById, ...additionalUsers };
  }

  // Build message summaries with consistent mapping
  const messages = messageRows.map((row, index) => {
    const user = row.user_id ? usersById[row.user_id] ?? null : null;
    return buildMessageSummary(row, user, index);
  });

  return { messages, usersById };
}

/**
 * Fetch project data by ID.
 */
export async function fetchProject(
  supabase: SupabaseClient,
  projectId: string | null
): Promise<ProjectRow | null> {
  if (!projectId) {
    return null;
  }

  const { data, error } = await supabase
    .from('projects')
    .select('id, name, description, system_prompt')
    .eq('id', projectId)
    .maybeSingle<ProjectRow>();

  if (error) {
    return handleDbQueryError('projects', `projectId=${projectId}`, error, null);
  }

  return data ?? null;
}

/**
 * Fetch challenge data by ID.
 */
export async function fetchChallenge(
  supabase: SupabaseClient,
  challengeId: string | null
): Promise<ChallengeRow | null> {
  if (!challengeId) {
    return null;
  }

  const { data, error } = await supabase
    .from('challenges')
    .select('id, name, description, system_prompt')
    .eq('id', challengeId)
    .maybeSingle<ChallengeRow>();

  if (error) {
    return handleDbQueryError('challenges', `challengeId=${challengeId}`, error, null);
  }

  return data ?? null;
}

// ============================================================================
// Token-Based Fetch Functions (Voice Mode)
// ============================================================================

/**
 * RPC participant row type from get_ask_participants_by_token.
 * Includes both participant data and profile data (from LEFT JOIN).
 */
interface RpcParticipantByToken {
  participant_id: string;
  user_id: string | null;
  participant_name: string | null;
  participant_email: string | null;
  role: string | null;
  is_spokesperson: boolean | null;
  joined_at: string | null;
  elapsed_active_seconds: number | null;
  timer_reset_at: string | null;
  profile_full_name: string | null;
  profile_first_name: string | null;
  profile_last_name: string | null;
  profile_email: string | null;
  profile_description: string | null;
}

/**
 * RPC message row type from get_ask_messages_by_token.
 */
interface RpcMessageByToken {
  message_id: string;
  content: string;
  type: string | null;
  sender_type: string | null;
  sender_id: string | null;
  sender_name: string | null;
  created_at: string | null;
  metadata: Record<string, unknown> | null;
  plan_step_id: string | null;
}

/**
 * Fetch participants and their profile data via token RPC.
 * This bypasses RLS and returns all participants for the session associated with the token.
 *
 * @param supabase - Supabase client (admin client recommended for RPC)
 * @param token - Invite token
 * @param projectId - Optional project ID for fetching project-specific descriptions
 * @returns Participants, users lookup, and raw participant rows
 */
export async function fetchParticipantsByToken(
  supabase: SupabaseClient,
  token: string,
  projectId?: string | null
): Promise<FetchParticipantsResult> {
  const params = { p_token: token };
  const { data: rpcRows, error } = await supabase.rpc('get_ask_participants_by_token', params);

  if (error) {
    return handleRpcError('get_ask_participants_by_token', { p_token: token.substring(0, 8) + '...' }, error, {
      participants: [],
      usersById: {},
      participantRows: [],
      projectMembersById: {},
    });
  }

  const rpcParticipants = (rpcRows ?? []) as RpcParticipantByToken[];

  // Build participantRows from RPC data
  const participantRows: ParticipantRow[] = rpcParticipants.map(row => ({
    id: row.participant_id,
    participant_name: row.participant_name,
    participant_email: row.participant_email,
    role: row.role,
    is_spokesperson: row.is_spokesperson,
    user_id: row.user_id,
    elapsed_active_seconds: row.elapsed_active_seconds,
  }));

  // Build usersById from RPC profile data (no separate profile fetch needed!)
  const usersById: Record<string, UserRow> = rpcParticipants.reduce((acc, row) => {
    if (row.user_id) {
      acc[row.user_id] = {
        id: row.user_id,
        email: row.profile_email,
        full_name: row.profile_full_name,
        first_name: row.profile_first_name,
        last_name: row.profile_last_name,
        description: row.profile_description,
      };
    }
    return acc;
  }, {} as Record<string, UserRow>);

  // Fetch project members if project ID provided (for project-specific descriptions)
  const projectMembersById = projectId
    ? await fetchProjectMembersByProject(supabase, projectId)
    : {};

  // Build participant summaries with project-specific data priority
  const participants = participantRows.map((row, index) => {
    const user = row.user_id ? usersById[row.user_id] ?? null : null;
    const projectMember = row.user_id ? projectMembersById[row.user_id] ?? null : null;
    return buildParticipantSummary(row, user, projectMember, index);
  });

  return { participants, usersById, participantRows, projectMembersById };
}

/**
 * Fetch messages via token RPC.
 * This bypasses RLS and returns all messages for the session associated with the token.
 *
 * @param supabase - Supabase client (admin client recommended for RPC)
 * @param token - Invite token
 * @param existingUsersById - Existing users lookup (to avoid re-fetching)
 * @returns Messages and updated users lookup
 */
export async function fetchMessagesByToken(
  supabase: SupabaseClient,
  token: string,
  existingUsersById: Record<string, UserRow> = {}
): Promise<{ messages: ConversationMessageSummary[]; usersById: Record<string, UserRow> }> {
  const params = { p_token: token };
  const { data: rpcRows, error } = await supabase.rpc('get_ask_messages_by_token', params);

  if (error) {
    return handleRpcError('get_ask_messages_by_token', { p_token: token.substring(0, 8) + '...' }, error, {
      messages: [],
      usersById: existingUsersById,
    });
  }

  const rpcMessages = (rpcRows ?? []) as RpcMessageByToken[];

  // RPC already returns sender_name, so we can build messages directly
  // No need to fetch additional users - the RPC does the JOIN
  const messages: ConversationMessageSummary[] = rpcMessages.map((row, index) => ({
    id: row.message_id,
    senderType: row.sender_type ?? 'user',
    // Use RPC-provided sender_name, fallback to "Participant N" if empty
    senderName: row.sender_name && row.sender_name.trim().length > 0
      ? row.sender_name
      : row.sender_type === 'ai'
        ? 'Agent'
        : `Participant ${index + 1}`,
    content: row.content,
    timestamp: row.created_at ?? new Date().toISOString(),
    // CRITICAL: Include planStepId for step_messages_json filtering
    planStepId: row.plan_step_id ?? null,
  }));

  // Build usersById from message sender info (for consistency with non-token path)
  // Note: This is less detailed than profile data, but sufficient for message display
  const usersById = { ...existingUsersById };
  rpcMessages.forEach(row => {
    if (row.sender_id && !usersById[row.sender_id]) {
      usersById[row.sender_id] = {
        id: row.sender_id,
        full_name: row.sender_name,
      };
    }
  });

  return { messages, usersById };
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Fetch complete conversation context for AI agent use.
 *
 * This is the SINGLE entry point for fetching all data needed by AI agents.
 * It ensures consistent data fetching and mapping across all modes:
 * - Text mode (stream/route.ts)
 * - Voice mode (voice-agent/init/route.ts)
 * - Test mode (admin/ai/agents/[id]/test/route.ts)
 *
 * @param supabase - Supabase client (regular or admin)
 * @param askSession - The ASK session row
 * @param options - Optional configuration
 * @returns Complete conversation context ready for buildConversationAgentVariables()
 */
export async function fetchConversationContext(
  supabase: SupabaseClient,
  askSession: AskSessionRow,
  options: FetchConversationContextOptions = {}
): Promise<ConversationContextResult> {
  const { profileId, adminClient, token, useLastUserMessageThread } = options;

  // Use admin client for plan fetching and token-based RPCs (to bypass RLS)
  const planClient = adminClient ?? supabase;
  const dataClient = token ? (adminClient ?? supabase) : supabase;

  // 1. Fetch participants with user data (includes participantRows for elapsed time)
  // Use token-based RPC when token is provided (voice mode)
  let participantsResult: FetchParticipantsResult;
  if (token) {
    participantsResult = await fetchParticipantsByToken(
      dataClient,
      token,
      askSession.project_id
    );
  } else {
    // Pass project_id to fetch project-specific descriptions (priority over profile descriptions)
    participantsResult = await fetchParticipantsWithUsers(
      supabase,
      askSession.id,
      askSession.project_id
    );
  }
  const { participants, usersById: participantUsersById, participantRows } = participantsResult;

  // 2. Get or create conversation thread
  // Use last user message thread resolution when specified (important for individual_parallel mode)
  const askConfig: AskSessionConfig = {
    conversation_mode: askSession.conversation_mode ?? null,
  };

  let conversationThread: { id: string; is_shared: boolean } | null = null;

  if (useLastUserMessageThread) {
    // First, try to find the thread from the last user message (for voice mode / individual_parallel)
    const { threadId: lastUserThreadId } = await getLastUserMessageThread(
      dataClient,
      askSession.id
    );

    if (lastUserThreadId) {
      // Fetch the thread details
      const { data: existingThread } = await dataClient
        .from('conversation_threads')
        .select('id, is_shared')
        .eq('id', lastUserThreadId)
        .single();

      if (existingThread) {
        conversationThread = existingThread;
      }
    }

    // BUG FIX: If no user message found, try to find the thread from ANY message (including AI messages)
    // This handles the case where AI sent an initial greeting but user hasn't responded yet
    // Without this, voice mode would get a different (shared) thread and lose the conversation context
    if (!conversationThread) {
      const { data: lastAnyMessage } = await dataClient
        .from('messages')
        .select('conversation_thread_id')
        .eq('ask_session_id', askSession.id)
        .not('conversation_thread_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastAnyMessage?.conversation_thread_id) {
        console.log('[fetchConversationContext] No user message found, using thread from last AI message:', lastAnyMessage.conversation_thread_id);
        const { data: existingThread } = await dataClient
          .from('conversation_threads')
          .select('id, is_shared')
          .eq('id', lastAnyMessage.conversation_thread_id)
          .single();

        if (existingThread) {
          conversationThread = existingThread;
        }
      }
    }
  }

  // Fallback: create/get thread based on conversation mode
  if (!conversationThread) {
    const { thread } = await getOrCreateConversationThread(
      dataClient,
      askSession.id,
      profileId ?? null,
      askConfig
    );
    conversationThread = thread;
  }

  // 3. Fetch messages with user data
  // Use token-based RPC when token is provided (voice mode)
  let messagesResult: { messages: ConversationMessageSummary[]; usersById: Record<string, UserRow> };
  if (token) {
    messagesResult = await fetchMessagesByToken(
      dataClient,
      token,
      participantUsersById
    );
  } else {
    messagesResult = await fetchMessagesWithUsers(
      supabase,
      askSession.id,
      conversationThread?.id ?? null,
      participantUsersById
    );
  }
  const { messages, usersById } = messagesResult;

  // 4. Fetch project and challenge data in parallel
  // Use dataClient to bypass RLS when token is provided
  const [project, challenge] = await Promise.all([
    fetchProject(dataClient, askSession.project_id ?? null),
    fetchChallenge(dataClient, askSession.challenge_id ?? null),
  ]);

  // 5. Fetch conversation plan (using admin client if available for RLS bypass)
  let conversationPlan: ConversationPlan | null = null;
  if (conversationThread) {
    conversationPlan = await getConversationPlanWithSteps(planClient, conversationThread.id);
  }

  // 6. Fetch elapsed times using centralized helper
  // IMPORTANT: Pass participantRows to use fallback when profileId doesn't match
  const { elapsedActiveSeconds, stepElapsedActiveSeconds } = await fetchElapsedTime({
    supabase: dataClient,
    askSessionId: askSession.id,
    profileId,
    conversationPlan,
    participantRows,
    adminClient: adminClient ?? (token ? dataClient : undefined),
  });

  return {
    askSession,
    participants,
    messages,
    project,
    challenge,
    conversationPlan,
    conversationThread: conversationThread
      ? { id: conversationThread.id, is_shared: conversationThread.is_shared }
      : null,
    usersById,
    elapsedActiveSeconds,
    stepElapsedActiveSeconds,
  };
}

// ============================================================================
// Elapsed Time Helper
// ============================================================================

export interface ElapsedTimeResult {
  elapsedActiveSeconds: number;
  stepElapsedActiveSeconds: number;
}

export interface FetchElapsedTimeOptions {
  supabase: SupabaseClient;
  askSessionId: string;
  profileId?: string | null;
  conversationPlan?: ConversationPlan | null;
  /** Participant rows if already fetched (avoids extra query) */
  participantRows?: Array<{ user_id?: string | null; elapsed_active_seconds?: number | null }>;
  adminClient?: SupabaseClient;
}

/**
 * Fetch elapsed time from participant and step timers.
 *
 * This is the SINGLE source of truth for elapsed time fetching.
 * Use this function instead of duplicating the logic in routes.
 */
export async function fetchElapsedTime(options: FetchElapsedTimeOptions): Promise<ElapsedTimeResult> {
  const { supabase, askSessionId, profileId, conversationPlan, participantRows, adminClient } = options;

  // 1. Fetch participant's elapsed time
  let elapsedActiveSeconds = 0;

  if (participantRows && participantRows.length > 0) {
    // Use pre-fetched participant rows
    const participant = participantRows.find(p => p.user_id === profileId);
    if (participant) {
      elapsedActiveSeconds = participant.elapsed_active_seconds ?? 0;
    } else if (participantRows.length > 0) {
      // Fallback: use first participant if current user not found
      elapsedActiveSeconds = participantRows[0].elapsed_active_seconds ?? 0;
    }
  } else if (profileId) {
    // Fetch from DB
    const { data: participantTimer } = await supabase
      .from('ask_participants')
      .select('elapsed_active_seconds')
      .eq('ask_session_id', askSessionId)
      .eq('user_id', profileId)
      .maybeSingle();

    elapsedActiveSeconds = participantTimer?.elapsed_active_seconds ?? 0;
  }

  // 2. Fetch step elapsed time
  let stepElapsedActiveSeconds = 0;

  if (conversationPlan?.current_step_id) {
    // Handle normalized format (steps array with step_identifier)
    const hasStepsArray = 'steps' in conversationPlan && Array.isArray(conversationPlan.steps);
    console.log('[fetchElapsedTime] current_step_id:', conversationPlan.current_step_id, '| hasStepsArray:', hasStepsArray, '| stepsCount:', hasStepsArray ? (conversationPlan as ConversationPlanWithSteps).steps.length : 0);

    if (hasStepsArray) {
      const planWithSteps = conversationPlan as ConversationPlanWithSteps;
      const currentStep = planWithSteps.steps.find(
        (s) => s.step_identifier === conversationPlan.current_step_id
      );
      console.log('[fetchElapsedTime] Found step:', !!currentStep, '| step.id:', currentStep?.id ?? 'N/A');
      if (currentStep?.id) {
        const dataClient = adminClient ?? supabase;
        const { data: stepTimer, error: stepError } = await dataClient
          .from('ask_conversation_plan_steps')
          .select('elapsed_active_seconds')
          .eq('id', currentStep.id)
          .maybeSingle();

        console.log('[fetchElapsedTime] DB result:', stepTimer, '| error:', stepError?.message);
        stepElapsedActiveSeconds = stepTimer?.elapsed_active_seconds ?? 0;
      }
    } else {
      // Fallback: current_step_id is already the DB record ID
      const dataClient = adminClient ?? supabase;
      const { data: stepTimer } = await dataClient
        .from('ask_conversation_plan_steps')
        .select('elapsed_active_seconds')
        .eq('id', conversationPlan.current_step_id)
        .maybeSingle();

      stepElapsedActiveSeconds = stepTimer?.elapsed_active_seconds ?? 0;
    }
  }

  return { elapsedActiveSeconds, stepElapsedActiveSeconds };
}

// ============================================================================
// RPC Wrapper Functions (DRY - centralized RPC calls)
// ============================================================================

/**
 * Fetch participants by ASK session ID via RPC.
 */
export async function fetchParticipantsBySession(
  supabase: SupabaseClient,
  askSessionId: string
): Promise<ParticipantRow[]> {
  const params = { p_ask_session_id: askSessionId };
  const { data, error } = await supabase.rpc('get_participants_by_ask_session', params);

  if (error) {
    return handleRpcError('get_participants_by_ask_session', params, error, []);
  }

  return (data as ParticipantRow[] | null) ?? [];
}

/**
 * Fetch a project by ID via RPC.
 */
export async function fetchProjectById(
  supabase: SupabaseClient,
  projectId: string
): Promise<ProjectRow | null> {
  const params = { p_project_id: projectId };
  const { data, error } = await supabase.rpc('get_project_by_id', params);

  if (error) {
    return handleRpcError('get_project_by_id', params, error, null);
  }

  return (data as ProjectRow | null) ?? null;
}

/**
 * Fetch a challenge by ID via RPC.
 */
export async function fetchChallengeById(
  supabase: SupabaseClient,
  challengeId: string
): Promise<ChallengeRow | null> {
  const params = { p_challenge_id: challengeId };
  const { data, error } = await supabase.rpc('get_challenge_by_id', params);

  if (error) {
    return handleRpcError('get_challenge_by_id', params, error, null);
  }

  return (data as ChallengeRow | null) ?? null;
}

/**
 * Fetch a participant by invite token via RPC.
 */
export async function fetchParticipantByToken(
  supabase: SupabaseClient,
  token: string
): Promise<ParticipantRow | null> {
  const params = { p_token: token };
  const { data, error } = await supabase.rpc('get_participant_by_invite_token', params);

  if (error) {
    return handleRpcError('get_participant_by_invite_token', { p_token: token.substring(0, 8) + '...' }, error, null);
  }

  return (data as ParticipantRow | null) ?? null;
}

/**
 * Check if a user is a participant of a session via RPC.
 * Returns the participant record or null if not found.
 */
export async function fetchUserParticipation(
  supabase: SupabaseClient,
  askSessionId: string,
  userId: string
): Promise<ParticipantRow | null> {
  const params = { p_ask_session_id: askSessionId, p_user_id: userId };
  const { data, error } = await supabase.rpc('check_user_is_participant', params);

  if (error) {
    return handleRpcError('check_user_is_participant', params, error, null);
  }

  return (data as ParticipantRow | null) ?? null;
}

/**
 * Add an anonymous participant to a session via RPC.
 */
export async function addAnonymousParticipant(
  supabase: SupabaseClient,
  askSessionId: string,
  userId: string,
  participantName?: string | null
): Promise<ParticipantRow | null> {
  const params = {
    p_ask_session_id: askSessionId,
    p_user_id: userId,
    p_participant_name: participantName ?? null,
    p_role: 'participant',
  };
  const { data, error } = await supabase.rpc('add_anonymous_participant', params);

  if (error) {
    return handleRpcError('add_anonymous_participant', params, error, null);
  }

  return (data as ParticipantRow | null) ?? null;
}

/**
 * Fetch a profile by auth ID via RPC.
 */
export async function fetchProfileByAuthId(
  supabase: SupabaseClient,
  authId: string
): Promise<{ id: string } | null> {
  const params = { p_auth_id: authId };
  const { data, error } = await supabase.rpc('get_profile_by_auth_id', params);

  if (error) {
    return handleRpcError('get_profile_by_auth_id', params, error, null);
  }

  return (data as { id: string } | null) ?? null;
}

/**
 * Fetch a conversation thread by ID via RPC.
 */
export async function fetchThreadById(
  supabase: SupabaseClient,
  threadId: string
): Promise<{ id: string; is_shared: boolean } | null> {
  const params = { p_thread_id: threadId };
  const { data, error } = await supabase.rpc('get_conversation_thread_by_id', params);

  if (error) {
    return handleRpcError('get_conversation_thread_by_id', params, error, null);
  }

  return (data as { id: string; is_shared: boolean } | null) ?? null;
}

/**
 * Fetch messages without a conversation thread (backward compatibility) via RPC.
 */
export async function fetchMessagesWithoutThread(
  supabase: SupabaseClient,
  askSessionId: string
): Promise<MessageRow[]> {
  const params = { p_ask_session_id: askSessionId };
  const { data, error } = await supabase.rpc('get_messages_without_thread', params);

  if (error) {
    return handleRpcError('get_messages_without_thread', params, error, []);
  }

  return (data as MessageRow[] | null) ?? [];
}

/**
 * Fetch all messages for a session via RPC.
 */
export async function fetchMessagesBySession(
  supabase: SupabaseClient,
  askSessionId: string
): Promise<MessageRow[]> {
  const params = { p_ask_session_id: askSessionId };
  const { data, error } = await supabase.rpc('get_messages_by_session', params);

  if (error) {
    return handleRpcError('get_messages_by_session', params, error, []);
  }

  return (data as MessageRow[] | null) ?? [];
}

/**
 * Insert an AI message via RPC.
 *
 * IMPORTANT: Always pass planStepId to ensure AI messages are properly linked
 * to conversation plan steps. Without this, step_messages_json will only contain
 * user messages, causing the AI to lose context of its own questions.
 */
export async function insertAiMessage(
  supabase: SupabaseClient,
  askSessionId: string,
  conversationThreadId: string | null,
  content: string,
  senderName: string = 'Agent',
  planStepId: string | null = null
): Promise<MessageRow | null> {
  const params = {
    p_ask_session_id: askSessionId,
    p_conversation_thread_id: conversationThreadId,
    p_content: content.substring(0, 100) + (content.length > 100 ? '...' : ''), // Truncate for debug
    p_sender_name: senderName,
    p_plan_step_id: planStepId,
  };
  const { data, error } = await supabase.rpc('insert_ai_message', {
    p_ask_session_id: askSessionId,
    p_conversation_thread_id: conversationThreadId,
    p_content: content,
    p_sender_name: senderName,
    p_plan_step_id: planStepId,
  });

  if (error) {
    return handleRpcError('insert_ai_message', params, error, null);
  }

  return (data as MessageRow | null) ?? null;
}

/**
 * Fetch recent messages for parent linking via RPC.
 */
export async function fetchRecentMessages(
  supabase: SupabaseClient,
  askSessionId: string,
  limit: number = 10
): Promise<{ id: string; sender_type: string }[]> {
  const params = { p_ask_session_id: askSessionId, p_limit: limit };
  const { data, error } = await supabase.rpc('get_recent_messages', params);

  if (error) {
    return handleRpcError('get_recent_messages', params, error, []);
  }

  return (data as { id: string; sender_type: string }[] | null) ?? [];
}

