import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabaseClient } from '@/lib/supabaseAdmin';
import { createServerSupabaseClient, getCurrentUser } from '@/lib/supabaseServer';
import { isValidAskKey, parseErrorMessage } from '@/lib/utils';
import { getAskSessionByKey } from '@/lib/asks';
import type { ApiResponse } from '@/types';

// Validation schema for speaker assignment update
const SpeakerAssignmentSchema = z.object({
  speaker: z.string().min(1, 'Speaker identifier is required'),
  participantId: z.string().nullable(),
  participantName: z.string().min(1, 'Participant name is required'),
  shouldTranscribe: z.boolean(),
});

export interface SpeakerAssignmentUpdateResponse {
  updatedCount: number;
}

// Type for the ASK session row we need
interface AskSessionRow {
  id: string;
  conversation_mode: string | null;
}

/**
 * POST /api/ask/[key]/messages/speaker-assignment
 *
 * Updates existing messages with the correct user_id based on speaker assignment.
 * This is called after a speaker is assigned in consultant mode to retroactively
 * update messages that were stored before the assignment was made.
 *
 * The update:
 * - Finds all messages with the specified speaker in metadata
 * - Updates their user_id to the assigned participant
 * - Updates metadata.senderName to the participant's name
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;

    // Validate ask key format
    if (!key || !isValidAskKey(key)) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Invalid ASK key format'
      }, { status: 400 });
    }

    // Parse and validate request body
    const body = await request.json();
    const validatedBody = SpeakerAssignmentSchema.parse(body);

    const adminClient = getAdminSupabaseClient();

    // Get the ASK session
    const { row: askSession, error: askError } = await getAskSessionByKey<AskSessionRow>(
      adminClient,
      key,
      'id, conversation_mode'
    );

    if (askError) {
      console.error('[SPEAKER-ASSIGNMENT] Error fetching ASK session:', askError);
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Failed to fetch ASK session'
      }, { status: 500 });
    }

    if (!askSession) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'ASK session not found'
      }, { status: 404 });
    }

    // Verify this is a consultant mode session
    if (askSession.conversation_mode !== 'consultant') {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Speaker assignment updates are only available in consultant mode'
      }, { status: 400 });
    }

    // If not transcribing, we don't need to update anything
    if (!validatedBody.shouldTranscribe) {
      console.log('[SPEAKER-ASSIGNMENT] Speaker set to ignore, skipping update');
      return NextResponse.json<ApiResponse<SpeakerAssignmentUpdateResponse>>({
        success: true,
        data: { updatedCount: 0 }
      });
    }

    // Find all messages with this speaker in metadata
    // We need to use raw SQL because Supabase doesn't support JSONB containment queries directly
    const { data: messagesToUpdate, error: fetchError } = await adminClient
      .from('messages')
      .select('id, metadata')
      .eq('ask_session_id', askSession.id)
      .eq('sender_type', 'user');

    if (fetchError) {
      console.error('[SPEAKER-ASSIGNMENT] Error fetching messages:', fetchError);
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Failed to fetch messages'
      }, { status: 500 });
    }

    // Filter messages that have this speaker in metadata
    const matchingMessages = (messagesToUpdate ?? []).filter(msg => {
      const metadata = msg.metadata as Record<string, unknown> | null;
      return metadata?.speaker === validatedBody.speaker;
    });

    if (matchingMessages.length === 0) {
      console.log('[SPEAKER-ASSIGNMENT] No messages found for speaker:', validatedBody.speaker);
      return NextResponse.json<ApiResponse<SpeakerAssignmentUpdateResponse>>({
        success: true,
        data: { updatedCount: 0 }
      });
    }

    // Get the participant's user_id if we have a participantId
    // BUG-013 FIX: Validate that participant belongs to THIS ask_session
    let userId: string | null = null;
    if (validatedBody.participantId) {
      const { data: participant, error: participantError } = await adminClient
        .from('ask_participants')
        .select('user_id')
        .eq('id', validatedBody.participantId)
        .eq('ask_session_id', askSession.id) // BUG-013 FIX: Ensure participant belongs to this session
        .maybeSingle();

      if (participantError) {
        console.error('[SPEAKER-ASSIGNMENT] Error fetching participant:', participantError);
      } else if (participant) {
        userId = participant.user_id;
      } else {
        // Participant not found or doesn't belong to this session
        console.warn('[SPEAKER-ASSIGNMENT] Participant not found or does not belong to this session:', validatedBody.participantId);
      }
    }

    // Update each message
    let updatedCount = 0;
    for (const msg of matchingMessages) {
      const existingMetadata = (msg.metadata as Record<string, unknown>) ?? {};
      const updatedMetadata = {
        ...existingMetadata,
        senderName: validatedBody.participantName,
        speakerAssigned: true,
        speakerAssignedAt: new Date().toISOString(),
      };

      const { error: updateError } = await adminClient
        .from('messages')
        .update({
          user_id: userId,
          metadata: updatedMetadata,
        })
        .eq('id', msg.id);

      if (updateError) {
        console.error('[SPEAKER-ASSIGNMENT] Error updating message:', msg.id, updateError);
      } else {
        updatedCount++;
      }
    }

    console.log('[SPEAKER-ASSIGNMENT] Updated messages:', {
      speaker: validatedBody.speaker,
      participantId: validatedBody.participantId,
      participantName: validatedBody.participantName,
      userId,
      updatedCount,
      totalFound: matchingMessages.length,
    });

    return NextResponse.json<ApiResponse<SpeakerAssignmentUpdateResponse>>({
      success: true,
      data: { updatedCount }
    });

  } catch (error) {
    console.error('[SPEAKER-ASSIGNMENT] Error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: error.errors.map(e => e.message).join(', ')
      }, { status: 400 });
    }

    return NextResponse.json<ApiResponse>({
      success: false,
      error: parseErrorMessage(error)
    }, { status: 500 });
  }
}
