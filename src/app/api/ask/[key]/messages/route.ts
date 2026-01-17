import { NextRequest, NextResponse } from 'next/server';
import { type ApiResponse, type Message } from '@/types';
import { getAdminSupabaseClient } from '@/lib/supabaseAdmin';
import { createServerSupabaseClient } from '@/lib/supabaseServer';
import { isValidAskKey } from '@/lib/utils';
import { getAskSessionByKey } from '@/lib/asks';
import { normaliseMessageMetadata } from '@/lib/messages';

interface MessageRow {
  id: string;
  ask_session_id: string;
  conversation_thread_id: string | null;
  user_id: string | null;
  sender_type: string;
  content: string;
  message_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/**
 * GET /api/ask/[key]/messages
 *
 * Fetch messages for a specific conversation thread.
 * Used for polling fallback when Realtime doesn't work (dev mode without auth).
 *
 * Query params:
 * - threadId: The conversation thread ID (required)
 * - since: ISO timestamp to get messages after (optional, for incremental updates)
 * - token: Invite token for authentication (optional)
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

    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');
    const since = searchParams.get('since');
    const inviteToken = searchParams.get('token');

    if (!threadId) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'threadId is required'
      }, { status: 400 });
    }

    const isDevBypass = process.env.IS_DEV === 'true';

    // Use admin client in dev mode or when token is provided
    let dataClient;
    if (isDevBypass || inviteToken) {
      dataClient = getAdminSupabaseClient();
    } else {
      dataClient = await createServerSupabaseClient();
    }

    // Validate the ASK exists
    const { row: askRow, error: askError } = await getAskSessionByKey<{ id: string }>(
      dataClient,
      key,
      'id'
    );

    if (askError) {
      throw askError;
    }

    if (!askRow) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'ASK not found'
      }, { status: 404 });
    }

    // Validate invite token if provided (and not in dev mode)
    if (inviteToken && !isDevBypass) {
      const { data: participant } = await dataClient
        .from('ask_participants')
        .select('id, ask_session_id')
        .eq('invite_token', inviteToken)
        .maybeSingle();

      if (!participant || participant.ask_session_id !== askRow.id) {
        return NextResponse.json<ApiResponse>({
          success: false,
          error: 'Invalid invite token'
        }, { status: 403 });
      }
    }

    // BUG-026 FIX: Validate that the requested thread belongs to this ask_session
    // This prevents users from fetching messages from other sessions by guessing thread IDs
    const { data: thread, error: threadError } = await dataClient
      .from('conversation_threads')
      .select('id, ask_session_id')
      .eq('id', threadId)
      .maybeSingle();

    if (threadError) {
      console.error('[messages/route] Error validating thread:', threadError);
      throw threadError;
    }

    if (!thread || thread.ask_session_id !== askRow.id) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Thread not found or does not belong to this session'
      }, { status: 403 });
    }

    // Build query for messages
    let query = dataClient
      .from('messages')
      .select('id, ask_session_id, conversation_thread_id, user_id, sender_type, content, message_type, metadata, created_at')
      .eq('conversation_thread_id', threadId)
      .order('created_at', { ascending: true });

    // Filter by timestamp if provided
    if (since) {
      query = query.gt('created_at', since);
    }

    const { data: messageRows, error: messagesError } = await query;

    if (messagesError) {
      console.error('[messages/route] Error fetching messages:', messagesError);
      throw messagesError;
    }

    // Transform to Message format
    const messages: Message[] = (messageRows ?? []).map((row: MessageRow) => {
      const metadata = normaliseMessageMetadata(row.metadata);

      return {
        id: row.id,
        clientId: row.id,
        askKey: key,
        askSessionId: row.ask_session_id,
        conversationThreadId: row.conversation_thread_id,
        content: row.content,
        type: (row.message_type as Message['type']) ?? 'text',
        senderType: (row.sender_type as Message['senderType']) ?? 'user',
        senderId: row.user_id,
        senderName: (metadata?.senderName as string) ?? (row.sender_type === 'ai' ? 'Agent' : null),
        timestamp: row.created_at ?? new Date().toISOString(),
        metadata,
      };
    });

    return NextResponse.json<ApiResponse<{ messages: Message[] }>>({
      success: true,
      data: { messages }
    });

  } catch (error) {
    console.error('[messages/route] Error:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
