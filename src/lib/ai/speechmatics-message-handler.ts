/**
 * SpeechmaticsMessageHandler - Gestion des messages WebSocket entrants
 *
 * Ce module extrait la logique de traitement des messages WebSocket de SpeechmaticsVoiceAgent :
 * - handleWebSocketMessage: dispatche les messages selon leur type
 * - handlePartialTranscript: traite les transcriptions partielles
 * - handleFinalTranscript: traite les transcriptions finales
 * - handleEndOfUtterance: gere la fin de parole detectee
 * - handleError: gere les erreurs Speechmatics
 *
 * Pattern: Uses dependency injection via MessageHandlerDeps interface
 */

import * as Sentry from '@sentry/nextjs';
import { devLog, devError } from '@/lib/utils';
import { SpeechmaticsWebSocket } from './speechmatics-websocket';
import type { SpeechmaticsStateMachine } from './speechmatics-state-machine';
import type { SpeechmaticsAudio } from './speechmatics-audio';
import type { TranscriptionManager } from './speechmatics-transcription';
import type { SpeechmaticsErrorCallback } from './speechmatics-types';
import {
  extractDominantSpeaker,
  hasSignificantNewContent,
  getRecentConversationContext,
} from './speechmatics-speaker-utils';

/**
 * Dependencies required by SpeechmaticsMessageHandler
 */
export interface MessageHandlerDeps {
  // Module getters
  getWebSocket: () => SpeechmaticsWebSocket | null;
  getAudio: () => SpeechmaticsAudio | null;
  getTranscriptionManager: () => TranscriptionManager | null;

  // State machine
  stateMachine: SpeechmaticsStateMachine;

  // Callbacks
  onErrorCallback: SpeechmaticsErrorCallback | null;

  // Parent callbacks for actions
  abortResponse: () => void;
  disconnect: () => Promise<void>;
}

/**
 * Handle incoming WebSocket message from Speechmatics
 *
 * Dispatches messages to appropriate handlers based on message type:
 * - RecognitionStarted: Connection established
 * - Info: Informational message
 * - AudioAdded: Audio chunk acknowledged
 * - AddPartialTranscript: Partial transcription (interim)
 * - AddTranscript: Final transcription
 * - EndOfUtterance: User stopped speaking
 * - EndOfStream: Server closing connection
 * - Error: Speechmatics error
 *
 * @param data - Raw WebSocket message data
 * @param deps - Dependencies (modules, callbacks)
 */
export function handleWebSocketMessage(
  data: { message?: string; metadata?: { transcript?: string; start_time?: number; end_time?: number }; results?: unknown[]; reason?: string },
  deps: MessageHandlerDeps
): void {
  // CRITICAL FIX: Only skip if we're disconnected AND websocket is not connected
  if (deps.stateMachine.isDisconnected() && !deps.getWebSocket()?.isConnected()) {
    return;
  }

  // If websocket is connected but state machine shows disconnected, emit CONNECT to reset state
  if (deps.stateMachine.isDisconnected() && deps.getWebSocket()?.isConnected()) {
    deps.stateMachine.transition({ type: 'CONNECT' });
  }

  // Handle RecognitionStarted
  if (data.message === "RecognitionStarted") {
    return;
  }

  // Handle Info messages
  if (data.message === "Info") {
    return;
  }

  // Handle AudioAdded
  if (data.message === "AudioAdded") {
    return;
  }

  // Handle partial transcription
  if (data.message === "AddPartialTranscript") {
    handlePartialTranscript(data, deps);
    return;
  }

  // Handle final transcription
  if (data.message === "AddTranscript") {
    handleFinalTranscript(data, deps);
    return;
  }

  // Handle EndOfUtterance
  if (data.message === "EndOfUtterance") {
    handleEndOfUtterance(deps);
    return;
  }

  // Handle EndOfStream
  if (data.message === "EndOfStream") {
    deps.getTranscriptionManager()?.processPendingTranscript(true);
    return;
  }

  // Handle Error messages
  if (data.message === "Error") {
    handleErrorMessage(data, deps);
    return;
  }
}

/**
 * Handle partial transcription message
 *
 * Partial transcripts are interim results that may change as more audio arrives.
 * They are used for:
 * - Showing live transcription to the user
 * - Detecting user continuation during LLM generation (abort-on-continue)
 * - Validating barge-in attempts
 *
 * @param data - WebSocket message with transcript data
 * @param deps - Dependencies
 */
function handlePartialTranscript(
  data: { metadata?: { transcript?: string; start_time?: number; end_time?: number }; results?: unknown[] },
  deps: MessageHandlerDeps
): void {
  const transcript = data.metadata?.transcript || "";
  const startTime = data.metadata?.start_time ?? 0;
  const endTime = data.metadata?.end_time ?? 0;
  const speaker = extractDominantSpeaker(data.results as Array<{ alternatives?: Array<{ speaker?: string }> }>);

  const audio = deps.getAudio();
  if (!audio || !transcript || !transcript.trim()) {
    return;
  }

  const trimmedTranscript = transcript.trim();

  // Track ANY partial received during LLM generation
  // This flag is used to drop the LLM response if user was speaking
  if (deps.stateMachine.isGenerating()) {
    deps.stateMachine.transition({
      type: 'PARTIAL_TRANSCRIPT',
      text: trimmedTranscript,
      timestamp: Date.now()
    });
  }

  // ABORT-ON-CONTINUE: If response is being generated OR audio is playing and user continues speaking,
  // abort the current response and let them finish
  const isAgentResponding = deps.stateMachine.isGenerating() || audio.isPlaying();
  const lastSentMsg = deps.stateMachine.getContext().lastSentUserMessage;
  if (isAgentResponding && lastSentMsg) {
    const hasNewContent = hasSignificantNewContent(trimmedTranscript, lastSentMsg);
    if (hasNewContent) {
      // Mark that we're aborting due to user continuation
      deps.stateMachine.markAbortedDueToUserContinuation();
      // Emit BARGE_IN event to state machine (clears queue)
      deps.stateMachine.transition({ type: 'BARGE_IN' });
      deps.abortResponse();
      // Remove the incomplete user message from conversation history
      deps.stateMachine.removeLastMessage('user');
    }
  }

  // Process transcript with speaker filtering
  processTranscriptWithSpeakerFiltering(trimmedTranscript, startTime, endTime, speaker, true, deps);
}

/**
 * Handle final transcription message
 *
 * Final transcripts are committed results that won't change.
 * They represent a complete segment of recognized speech.
 *
 * @param data - WebSocket message with transcript data
 * @param deps - Dependencies
 */
function handleFinalTranscript(
  data: { metadata?: { transcript?: string; start_time?: number; end_time?: number }; results?: unknown[] },
  deps: MessageHandlerDeps
): void {
  const transcript = data.metadata?.transcript || "";
  const startTime = data.metadata?.start_time ?? 0;
  const endTime = data.metadata?.end_time ?? 0;
  const speaker = extractDominantSpeaker(data.results as Array<{ alternatives?: Array<{ speaker?: string }> }>);

  if (!transcript || !transcript.trim()) {
    return;
  }

  const trimmedFinalTranscript = transcript.trim();

  // Process transcript with speaker filtering
  processTranscriptWithSpeakerFiltering(trimmedFinalTranscript, startTime, endTime, speaker, false, deps);
}

/**
 * Handle EndOfUtterance message
 *
 * EndOfUtterance is signaled by Speechmatics when the user stops speaking.
 * We don't process immediately - we mark it and let the silence timeout handle processing.
 * This gives the user more time to continue speaking if they want.
 */
function handleEndOfUtterance(deps: MessageHandlerDeps): void {
  const transcriptionManager = deps.getTranscriptionManager();
  const audio = deps.getAudio();

  // Mark that we received it, but don't process yet
  transcriptionManager?.markEndOfUtterance();

  // BUG-FIX: Reset the "received partial during generation" flag when user finishes speaking
  // We only reset if VAD also confirms user is not speaking
  if (deps.stateMachine.getContext().receivedPartialDuringGeneration && !audio?.isUserSpeaking()) {
    devLog('[Speechmatics] EndOfUtterance received - resetting receivedPartialDuringGeneration flag');
    deps.stateMachine.clearPartialFlag();
  }
}

/**
 * Handle Speechmatics error message
 *
 * Handles various error types:
 * - Quota errors: User-friendly message, prevents reconnection for 10 seconds
 * - Other errors: Logged and forwarded to error callback
 *
 * @param data - WebSocket message with error data
 * @param deps - Dependencies
 */
function handleErrorMessage(
  data: { reason?: string; message?: string },
  deps: MessageHandlerDeps
): void {
  const errorMessage = data.reason || data.message || 'Unknown error';

  // Handle quota errors with a more user-friendly message
  if (errorMessage.includes('Quota') || errorMessage.includes('quota') || errorMessage.includes('Concurrent')) {
    // Record quota error timestamp in WebSocket class to enforce longer delay on reconnect
    SpeechmaticsWebSocket.lastQuotaErrorTimestamp = Date.now();

    const friendlyError = new Error('Speechmatics quota exceeded. Please wait 10 seconds before trying again, or check your account limits. If you have multiple tabs open, close them to free up concurrent sessions.');
    devError('[Speechmatics] Quota error:', errorMessage);
    devError('[Speechmatics] Will prevent reconnection for 10 seconds to allow quota to reset');

    // Capture quota errors to Sentry for tracking usage issues
    Sentry.captureException(friendlyError, {
      tags: {
        component: 'speechmatics',
        error_type: 'quota_exceeded',
      },
      extra: {
        originalMessage: errorMessage,
        timestamp: new Date().toISOString(),
      },
      level: 'warning',
    });

    deps.onErrorCallback?.(friendlyError);
    // Disconnect on quota error to prevent further attempts
    deps.disconnect().catch(() => {});
    return;
  }

  devError('[Speechmatics] Error message:', errorMessage);
  const error = new Error(`Speechmatics error: ${errorMessage}`);

  // Capture Speechmatics API errors to Sentry
  Sentry.captureException(error, {
    tags: {
      component: 'speechmatics',
      error_type: 'api_error',
    },
    extra: {
      originalMessage: errorMessage,
      reason: data.reason,
    },
    level: 'error',
  });

  deps.onErrorCallback?.(error);
}

/**
 * Process a transcript with speaker filtering logic
 *
 * Handles both partial and final transcripts with the same filtering behavior:
 * - If speaker should be filtered: reset VAD state and process transcript (for logging/callbacks)
 * - If speaker is allowed: validate barge-in and process transcript
 *
 * @param transcript - The trimmed transcript text
 * @param startTime - Start time in seconds from audio start
 * @param endTime - End time in seconds from audio start
 * @param speaker - Optional speaker identifier from diarization
 * @param isPartial - True for partial transcripts, false for final transcripts
 * @param deps - Dependencies
 */
function processTranscriptWithSpeakerFiltering(
  transcript: string,
  startTime: number,
  endTime: number,
  speaker: string | undefined,
  isPartial: boolean,
  deps: MessageHandlerDeps
): void {
  const transcriptionManager = deps.getTranscriptionManager();
  const audio = deps.getAudio();

  const shouldFilterThisSpeaker = transcriptionManager?.shouldFilterSpeaker(speaker) ?? false;

  if (shouldFilterThisSpeaker) {
    // Cancel any pending barge-in validation and reset VAD state
    audio?.resetVADStateForFilteredSpeaker();
  } else {
    // Get recent conversation context for echo detection
    const recentContext = getRecentConversationContext(deps.stateMachine.getContext().conversationHistory);

    // Validate barge-in with transcript content, context, and speaker
    audio?.validateBargeInWithTranscript(transcript, recentContext, speaker);
  }

  // Process transcript with timestamps for deduplication
  if (isPartial) {
    transcriptionManager?.handlePartialTranscript(transcript, startTime, endTime, speaker);
  } else {
    transcriptionManager?.handleFinalTranscript(transcript, startTime, endTime, speaker);
  }
}
