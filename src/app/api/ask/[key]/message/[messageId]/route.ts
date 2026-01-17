import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import { ApiResponse, Message } from '@/types';
import { isValidAskKey, parseErrorMessage } from '@/lib/utils';
import { normaliseMessageMetadata } from '@/lib/messages';
import { createServerSupabaseClient } from '@/lib/supabaseServer';
import { shouldUseSharedThread } from '@/lib/asks';

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

/**
 * PATCH /api/ask/[key]/message/[messageId]
 *
 * Updates a message content and optionally deletes all subsequent messages.
 * Used for editing voice transcription errors.
 *
 * Body:
 * - content: string (required) - New message content
 * - deleteSubsequent: boolean (optional, default: true) - Whether to delete messages after this one
 *
 * Returns:
 * - Updated message
 * - Count of deleted messages (if deleteSubsequent was true)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ key: string; messageId: string }> }
) {
  try {
    const { key, messageId } = await params;

    if (!key || !isValidAskKey(key)) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Invalid ASK key format'
      }, { status: 400 });
    }

    if (!messageId || messageId.length < 10) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Invalid message ID'
      }, { status: 400 });
    }

    const body = await request.json();

    if (!body?.content || typeof body.content !== 'string') {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Message content is required'
      }, { status: 400 });
    }

    const deleteSubsequent = body.deleteSubsequent !== false; // Default to true
    const isDevBypass = process.env.IS_DEV === 'true';

    // Create appropriate client
    let supabase: SupabaseClient;
    if (isDevBypass) {
      const { createServerClient } = await import('@supabase/ssr');
      const { cookies } = await import('next/headers');
      const cookieStore = await cookies();
      supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            get(name: string) {
              return cookieStore.get(name)?.value;
            },
            set() {},
            remove() {},
          },
        }
      ) as unknown as SupabaseClient;
    } else {
      supabase = await createServerSupabaseClient();
    }

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

    // Check for invite token in headers
    const inviteToken = request.headers.get('X-Invite-Token');

    if (inviteToken) {
      const admin = await getAdminClient();
      const { data: participant, error: tokenError } = await admin
        .from('ask_participants')
        .select('id, user_id, ask_session_id')
        .eq('invite_token', inviteToken)
        .maybeSingle();

      if (tokenError) {
        console.error('Error validating invite token:', tokenError);
      } else if (participant?.user_id) {
        profileId = participant.user_id;
        dataClient = admin;
      }
    }

    // If no valid token, try regular auth
    if (!profileId && !isDevBypass) {
      const { data: userResult, error: userError } = await supabase.auth.getUser();

      if (userError) {
        if (isPermissionDenied(userError as unknown as PostgrestError)) {
          return permissionDeniedResponse();
        }
        throw userError;
      }

      const user = userResult?.user;
      if (!user) {
        return NextResponse.json<ApiResponse>({
          success: false,
          error: "Authentification requise"
        }, { status: 403 });
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('auth_id', user.id)
        .single();

      if (profile) {
        profileId = profile.id;
      }
    }

    // In dev bypass mode, use admin client
    if (isDevBypass) {
      dataClient = await getAdminClient();
    }

    // Get the ASK session (include conversation_mode for thread isolation check)
    const { data: askRow, error: askError } = await dataClient
      .from('ask_sessions')
      .select('id, ask_key, conversation_mode')
      .eq('ask_key', key)
      .maybeSingle();

    if (askError) {
      if (isPermissionDenied(askError)) {
        return permissionDeniedResponse();
      }
      throw askError;
    }

    if (!askRow) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'ASK session not found'
      }, { status: 404 });
    }

    // Get the message to edit
    const { data: messageRow, error: messageError } = await dataClient
      .from('messages')
      .select('id, ask_session_id, user_id, sender_type, content, message_type, metadata, created_at, conversation_thread_id')
      .eq('id', messageId)
      .eq('ask_session_id', askRow.id)
      .maybeSingle();

    if (messageError) {
      if (isPermissionDenied(messageError)) {
        return permissionDeniedResponse();
      }
      throw messageError;
    }

    if (!messageRow) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Message not found'
      }, { status: 404 });
    }

    // BUG-028 FIX: Require valid profile for authorization (prevents bypass when profile lookup fails)
    if (!isDevBypass && !profileId) {
      console.error('No profile ID available for authorization - possible profile lookup failure');
      return permissionDeniedResponse();
    }

    // Verify user owns this message (only in non-dev mode)
    if (!isDevBypass && messageRow.user_id !== profileId) {
      console.error('User does not own this message:', {
        messageUserId: messageRow.user_id,
        profileId
      });
      return permissionDeniedResponse();
    }

    // Only allow editing user messages
    if (messageRow.sender_type !== 'user') {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Only user messages can be edited'
      }, { status: 400 });
    }

    // Update the message content
    const updatedMetadata = {
      ...(messageRow.metadata as Record<string, unknown> ?? {}),
      isEdited: true,
      editedAt: new Date().toISOString(),
      originalContent: messageRow.content, // Keep original for reference
    };

    const { data: updatedRow, error: updateError } = await dataClient
      .from('messages')
      .update({
        content: body.content,
        metadata: updatedMetadata,
      })
      .eq('id', messageId)
      .select('id, ask_session_id, user_id, sender_type, content, message_type, metadata, created_at')
      .single();

    if (updateError) {
      console.error('Error updating message:', updateError);
      if (isPermissionDenied(updateError)) {
        return permissionDeniedResponse();
      }
      throw updateError;
    }

    let deletedCount = 0;

    // Delete subsequent messages if requested
    if (deleteSubsequent) {
      // BUG-005 FIX: Check thread isolation mode before deleting
      const askConfig = { conversation_mode: askRow.conversation_mode ?? null };
      const isIndividualMode = !shouldUseSharedThread(askConfig);

      // In individual_parallel mode, REQUIRE thread_id to prevent cross-thread deletion
      if (isIndividualMode && !messageRow.conversation_thread_id) {
        console.warn('BUG-005: Blocking delete in individual_parallel mode without thread_id to prevent cross-thread deletion');
        // Don't delete - this would affect other participants' messages
      } else {
        // Build the delete query based on conversation thread
        let deleteQuery = dataClient
          .from('messages')
          .delete()
          .eq('ask_session_id', askRow.id)
          .gt('created_at', messageRow.created_at);

        // If message has a conversation thread, only delete within that thread
        // In individual mode, this is REQUIRED (checked above)
        if (messageRow.conversation_thread_id) {
          deleteQuery = deleteQuery.eq('conversation_thread_id', messageRow.conversation_thread_id);
        }

        const { data: deletedRows, error: deleteError } = await deleteQuery.select('id');

        if (deleteError) {
          console.error('Error deleting subsequent messages:', deleteError);
          // Don't fail the whole request, just log the error
        } else {
          deletedCount = deletedRows?.length ?? 0;
          console.log(`Deleted ${deletedCount} subsequent messages`);
        }
      }
    }

    // Build response message
    const message: Message = {
      id: updatedRow.id,
      askKey: key,
      askSessionId: updatedRow.ask_session_id,
      content: updatedRow.content,
      type: (updatedRow.message_type as Message['type']) ?? 'text',
      senderType: updatedRow.sender_type as Message['senderType'],
      senderId: updatedRow.user_id ?? null,
      senderName: null,
      timestamp: updatedRow.created_at,
      metadata: normaliseMessageMetadata(updatedRow.metadata),
    };

    return NextResponse.json<ApiResponse<{ message: Message; deletedCount: number }>>({
      success: true,
      data: { message, deletedCount },
      message: `Message updated${deletedCount > 0 ? `, ${deletedCount} subsequent message(s) deleted` : ''}`
    });

  } catch (error) {
    console.error('Error updating message:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      error: parseErrorMessage(error)
    }, { status: 500 });
  }
}
