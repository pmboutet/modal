import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

export interface ConversationThread {
  id: string;
  ask_session_id: string;
  user_id: string | null;
  is_shared: boolean;
  created_at: string;
}

export interface AskSessionConfig {
  conversation_mode?: string | null;
}

export interface Participant {
  id: string;
  user_id: string | null;
  [key: string]: unknown;
}

/**
 * Get the conversation thread ID from the last user message.
 *
 * BUG FIX: For AI response routes (respond, stream) in individual_parallel mode,
 * the AI must respond in the SAME thread where the user sent their message.
 * Using resolveThreadUserId() picks the first participant, which may be different
 * from the user who sent the message.
 *
 * This function finds the last user message's conversation_thread_id to ensure
 * AI responses go to the correct thread.
 *
 * @param supabase - Supabase client
 * @param askSessionId - The ASK session ID
 * @returns The thread ID from the last user message, or null if not found
 */
export async function getLastUserMessageThread(
  supabase: SupabaseClient,
  askSessionId: string
): Promise<{ threadId: string | null; userId: string | null; error: PostgrestError | null }> {
  const { data: lastUserMessage, error } = await supabase
    .from('messages')
    .select('conversation_thread_id, user_id')
    .eq('ask_session_id', askSessionId)
    .eq('sender_type', 'user')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { threadId: null, userId: null, error };
  }

  if (lastUserMessage) {
    console.log('[getLastUserMessageThread] Found last user message thread:', {
      threadId: lastUserMessage.conversation_thread_id,
      userId: lastUserMessage.user_id,
    });
    return {
      threadId: lastUserMessage.conversation_thread_id,
      userId: lastUserMessage.user_id,
      error: null,
    };
  }

  return { threadId: null, userId: null, error: null };
}

/**
 * Determine the correct user ID for thread operations in dev mode.
 *
 * NOTE: This function is primarily for routes that CREATE threads (GET, POST).
 * For AI RESPONSE routes (respond, stream), use getLastUserMessageThread() instead
 * to ensure the AI responds in the same thread as the user message.
 *
 * BUG PREVENTION: In individual_parallel mode, AI messages must go to the same
 * thread as user messages. In dev mode (IS_DEV=true), profileId is often null
 * because auth is bypassed. Without this fix, AI messages would be saved to a
 * shared thread instead of the user's individual thread, causing messages to
 * appear in the wrong conversation or disappear from the UI.
 *
 * @param profileId - The current user's profile ID (often null in dev mode)
 * @param conversationMode - The ASK session's conversation mode
 * @param participants - List of participants in the session
 * @param isDevMode - Whether we're in dev mode (bypassing auth)
 * @returns The user ID to use for thread operations
 */
export function resolveThreadUserId(
  profileId: string | null,
  conversationMode: string | null | undefined,
  participants: Participant[],
  isDevMode: boolean
): string | null {
  // If we have a profileId, use it
  if (profileId) {
    return profileId;
  }

  // In dev mode with individual_parallel, use first participant's user_id
  // to ensure AI messages go to the correct individual thread
  if (isDevMode && conversationMode === 'individual_parallel') {
    const firstParticipantWithUserId = participants.find(p => p.user_id);
    if (firstParticipantWithUserId?.user_id) {
      console.log('[resolveThreadUserId] Dev mode: Using first participant user_id for individual thread:', firstParticipantWithUserId.user_id);
      return firstParticipantWithUserId.user_id;
    }
  }

  // Default: return null (will use shared thread fallback)
  return null;
}

/**
 * Determine if an ASK session should use a shared thread
 *
 * Based on conversation_mode:
 *
 * - individual_parallel: Individual threads (is_shared = false)
 *   → Plusieurs personnes répondent individuellement, pas de visibilité croisée
 *   → Chaque utilisateur a son propre thread isolé
 *
 * - collaborative: Shared thread (is_shared = true)
 *   → Conversation multi-voix, tout le monde voit tout
 *   → Tous les participants partagent le même thread
 *
 * - group_reporter: Shared thread (is_shared = true)
 *   → Un groupe contribue avec un rapporteur
 *   → Tous les participants partagent le même thread
 *   → Un participant est désigné comme rapporteur (is_spokesperson)
 *
 * - consultant: Shared thread (is_shared = true)
 *   → L'IA écoute et propose des questions au facilitator
 *   → Tous les participants partagent le même thread
 *   → Multi-voix: identification par diarization (voice) ou token (text)
 *   → Seul le facilitator voit les questions suggérées
 *   → Pas de TTS, l'IA ne parle pas
 */
export function shouldUseSharedThread(askSession: AskSessionConfig): boolean {
  // Only individual_parallel uses individual threads
  // Default to shared thread if conversation_mode is not set
  const individualModes = ['individual_parallel'];
  return !individualModes.includes(askSession.conversation_mode ?? '');
}

/**
 * Get or create a conversation thread for an ASK session
 *
 * Thread Logic based on conversation_mode:
 *
 * - individual_parallel: Individual threads (is_shared = false, user_id = specific user)
 *   → Chaque utilisateur a son propre thread isolé
 *   → Pas de visibilité croisée des messages et insights
 *
 * - collaborative: Shared thread (is_shared = true, user_id = NULL)
 *   → Tous les participants partagent le même thread
 *   → Tout le monde voit tous les messages et insights
 *
 * - group_reporter: Shared thread (is_shared = true, user_id = NULL)
 *   → Tous les participants partagent le même thread
 *   → Tout le monde voit tous les messages et insights
 *   → Un participant est désigné comme rapporteur (via is_spokesperson)
 *
 * - consultant: Shared thread (is_shared = true, user_id = NULL)
 *   → Tous les participants partagent le même thread
 *   → Seul le facilitator voit les questions suggérées
 *   → L'IA n'envoie pas de réponses automatiques
 *
 * Important: Si userId est fourni en mode individuel, le thread sera créé/recherché pour cet utilisateur spécifique.
 * Si userId est NULL en mode individuel, on bascule vers un thread partagé (fallback).
 */
export async function getOrCreateConversationThread(
  supabase: SupabaseClient,
  askSessionId: string,
  userId: string | null,
  askConfig: AskSessionConfig
): Promise<{ thread: ConversationThread | null; error: PostgrestError | null }> {
  const useShared = shouldUseSharedThread(askConfig);
  const threadUserId = useShared ? null : userId;

  console.log('[getOrCreateConversationThread] Starting...', {
    askSessionId,
    userId,
    conversationMode: askConfig.conversation_mode,
    useShared,
    threadUserId,
  });

  // Try to find existing thread
  // NOTE: For shared threads (user_id = NULL), PostgreSQL unique indexes don't prevent duplicates
  // because NULL values are considered distinct. We use .limit(1) to handle potential duplicates.
  let query = supabase
    .from('conversation_threads')
    .select('id, ask_session_id, user_id, is_shared, created_at')
    .eq('ask_session_id', askSessionId);

  if (useShared) {
    query = query.is('user_id', null).eq('is_shared', true);
  } else {
    // In individual mode, we need a userId. If not provided, fallback to shared thread
    if (!threadUserId) {
      console.warn('Individual thread mode requires userId, but none provided. Falling back to shared thread behavior.');
      // Try to get or create shared thread as fallback
      // Use .limit(1) to handle potential duplicates due to NULL uniqueness
      const { data: sharedThreads, error: sharedError } = await supabase
        .from('conversation_threads')
        .select('id, ask_session_id, user_id, is_shared, created_at')
        .eq('ask_session_id', askSessionId)
        .is('user_id', null)
        .eq('is_shared', true)
        .order('created_at', { ascending: true })
        .limit(1);

      if (!sharedError && sharedThreads && sharedThreads.length > 0) {
        return { thread: sharedThreads[0] as ConversationThread, error: null };
      }

      // If no shared thread exists, CREATE one as fallback
      console.log('No shared thread exists, creating one as fallback for plan generation...');
      const { data: newSharedThread, error: createSharedError } = await supabase
        .from('conversation_threads')
        .insert({
          ask_session_id: askSessionId,
          user_id: null,
          is_shared: true,
        })
        .select('id, ask_session_id, user_id, is_shared, created_at')
        .single<ConversationThread>();

      if (createSharedError) {
        console.error('Failed to create shared thread fallback:', createSharedError);
        return { thread: null, error: createSharedError };
      }

      console.log('Created shared thread fallback:', newSharedThread?.id);
      return { thread: newSharedThread, error: null };
    }
    query = query.eq('user_id', threadUserId).eq('is_shared', false);
  }

  // Use order + limit(1) instead of maybeSingle to handle potential duplicates
  const { data: existingThreads, error: findError } = await query
    .order('created_at', { ascending: true })
    .limit(1);

  const existingThread = existingThreads?.[0] as ConversationThread | undefined;

  console.log('[getOrCreateConversationThread] Find existing thread result:', {
    found: !!existingThread,
    threadId: existingThread?.id,
    isShared: existingThread?.is_shared,
    resultCount: existingThreads?.length,
    errorCode: findError?.code,
    errorMessage: findError?.message,
  });

  if (findError) {
    console.error('[getOrCreateConversationThread] Find error:', findError);
    return { thread: null, error: findError };
  }

  if (existingThread) {
    console.log('[getOrCreateConversationThread] Returning existing thread:', existingThread.id);
    return { thread: existingThread, error: null };
  }

  // Create new thread
  console.log('[getOrCreateConversationThread] Creating new thread...', {
    askSessionId,
    userId: threadUserId,
    isShared: useShared,
  });

  const { data: newThread, error: createError } = await supabase
    .from('conversation_threads')
    .insert({
      ask_session_id: askSessionId,
      user_id: threadUserId,
      is_shared: useShared,
    })
    .select('id, ask_session_id, user_id, is_shared, created_at')
    .single<ConversationThread>();

  if (createError) {
    // BUG-003 FIX: Handle race condition - if duplicate key error (23505),
    // another concurrent request created the thread. Retry the fetch.
    const isDuplicateKeyError = createError.code === '23505' ||
      (createError.message?.toLowerCase().includes('duplicate') ||
       createError.message?.toLowerCase().includes('unique'));

    if (isDuplicateKeyError) {
      console.log('[getOrCreateConversationThread] Duplicate key error detected - fetching existing thread created by concurrent request');

      // Rebuild query based on thread type
      let retryQuery = supabase
        .from('conversation_threads')
        .select('id, ask_session_id, user_id, is_shared, created_at')
        .eq('ask_session_id', askSessionId);

      if (useShared) {
        retryQuery = retryQuery.is('user_id', null).eq('is_shared', true);
      } else {
        retryQuery = retryQuery.eq('user_id', threadUserId).eq('is_shared', false);
      }

      const { data: existingThreadsRetry, error: retryError } = await retryQuery
        .order('created_at', { ascending: true })
        .limit(1);

      const existingThreadRetry = existingThreadsRetry?.[0] as ConversationThread | undefined;

      if (retryError) {
        console.error('[getOrCreateConversationThread] Retry fetch error:', retryError);
        return { thread: null, error: retryError };
      }

      if (existingThreadRetry) {
        console.log('[getOrCreateConversationThread] Successfully fetched thread after race condition:', existingThreadRetry.id);
        return { thread: existingThreadRetry, error: null };
      }

      // If still no thread found after retry, return the original error
      console.error('[getOrCreateConversationThread] Thread not found after retry');
    }

    console.error('[getOrCreateConversationThread] Create error:', {
      code: createError.code,
      message: createError.message,
      details: createError.details,
      hint: createError.hint,
    });
    return { thread: null, error: createError };
  }

  console.log('[getOrCreateConversationThread] Created new thread:', newThread?.id);
  return { thread: newThread, error: null };
}

/**
 * Get the conversation thread ID for an ASK session
 *
 * In individual_parallel mode, each user has their own thread (user_id = specific user).
 * In other modes (collaborative, group_reporter, consultant), a shared thread is used (is_shared = true).
 *
 * @param client - Supabase client (session or admin)
 * @param askSessionId - The ASK session ID
 * @param profileId - The user's profile ID (null for shared thread lookup)
 * @returns The thread ID or null if not found
 */
export async function getConversationThreadId(
  client: SupabaseClient,
  askSessionId: string,
  profileId: string | null
): Promise<string | null> {
  const threadQuery = client
    .from('conversation_threads')
    .select('id')
    .eq('ask_session_id', askSessionId);

  if (profileId) {
    threadQuery.eq('user_id', profileId);
  } else {
    threadQuery.eq('is_shared', true);
  }

  const { data: threadData } = await threadQuery.maybeSingle();
  return threadData?.id ?? null;
}

/**
 * Get messages for a specific conversation thread
 */
export async function getMessagesForThread(
  supabase: SupabaseClient,
  threadId: string
): Promise<{ messages: any[]; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_thread_id', threadId)
    .order('created_at', { ascending: true });

  if (error) {
    return { messages: [], error };
  }

  return { messages: data ?? [], error: null };
}

/**
 * Get insights for a specific conversation thread
 * Used for isolation in individual_parallel mode
 */
export async function getInsightsForThread(
  supabase: SupabaseClient,
  threadId: string
): Promise<{ insights: any[]; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .from('insights')
    .select('*')
    .eq('conversation_thread_id', threadId)
    .order('created_at', { ascending: true });

  if (error) {
    return { insights: [], error };
  }

  return { insights: data ?? [], error: null };
}

export async function getAskSessionByKey<Row>(
  supabase: SupabaseClient,
  rawKey: string,
  columns: string
): Promise<{ row: Row | null; error: PostgrestError | null }> {
  const key = rawKey.trim();

  console.log('[getAskSessionByKey] Looking up ASK session:', {
    rawKey,
    trimmedKey: key,
    columns: columns.substring(0, 50) + '...',
  });

  if (!key) {
    console.warn('[getAskSessionByKey] Empty key provided');
    return { row: null, error: null };
  }

  // Use RPC function to bypass RLS
  const { data: rpcData, error: rpcError } = await supabase
    .rpc('get_ask_session_by_key', { p_key: key })
    .maybeSingle<{
      ask_session_id: string;
      ask_key: string;
      question: string;
      description: string | null;
      status: string;
      project_id: string | null;
      challenge_id: string | null;
      conversation_mode: string | null;
      expected_duration_minutes: number | null;
      system_prompt: string | null;
      allow_auto_registration: boolean | null;
      name: string | null;
      delivery_mode: string | null;
      start_date: string | null;
      end_date: string | null;
      created_at: string | null;
      updated_at: string | null;
    }>();

  console.log('[getAskSessionByKey] RPC result:', {
    found: !!rpcData,
    error: rpcError?.message,
    errorCode: rpcError?.code,
  });

  if (rpcError) {
    // If RPC fails (function doesn't exist), fall back to direct query
    if (rpcError.code === 'PGRST202') {
      console.log('[getAskSessionByKey] RPC not found, falling back to direct query');
      const { data, error } = await supabase
        .from('ask_sessions')
        .select(columns)
        .eq('ask_key', key)
        .maybeSingle<Row>();

      if (error) {
        return { row: null, error };
      }
      return { row: data ?? null, error: null };
    }
    return { row: null, error: rpcError };
  }

  if (!rpcData) {
    return { row: null, error: null };
  }

  // Map RPC result to expected format
  const mappedData = {
    id: rpcData.ask_session_id,
    ask_key: rpcData.ask_key,
    question: rpcData.question,
    description: rpcData.description,
    status: rpcData.status,
    project_id: rpcData.project_id,
    challenge_id: rpcData.challenge_id,
    conversation_mode: rpcData.conversation_mode,
    expected_duration_minutes: rpcData.expected_duration_minutes,
    system_prompt: rpcData.system_prompt,
    allow_auto_registration: rpcData.allow_auto_registration,
    name: rpcData.name,
    delivery_mode: rpcData.delivery_mode,
    start_date: rpcData.start_date,
    end_date: rpcData.end_date,
    created_at: rpcData.created_at,
    updated_at: rpcData.updated_at,
  } as unknown as Row;

  return { row: mappedData, error: null };
}

/**
 * Get ASK session by participant invite token
 * This allows each participant to have a unique link
 */
export async function getAskSessionByToken<Row>(
  supabase: SupabaseClient,
  token: string,
  columns: string
): Promise<{ row: Row | null; participantId: string | null; error: PostgrestError | null }> {
  const trimmedToken = token.trim();

  if (!trimmedToken) {
    return { row: null, participantId: null, error: null };
  }

  // First, find the participant by token
  const { data: participant, error: participantError } = await supabase
    .from('ask_participants')
    .select('ask_session_id, id')
    .eq('invite_token', trimmedToken)
    .maybeSingle<{ ask_session_id: string; id: string }>();

  if (participantError) {
    return { row: null, participantId: null, error: participantError };
  }

  if (!participant) {
    return { row: null, participantId: null, error: null };
  }

  // Then, get the ask session
  const { data: askSession, error: askError } = await supabase
    .from('ask_sessions')
    .select(columns)
    .eq('id', participant.ask_session_id)
    .maybeSingle<Row>();

  if (askError) {
    return { row: null, participantId: null, error: askError };
  }

  return { row: askSession ?? null, participantId: participant.id, error: null };
}
