/**
 * SpeechmaticsResponseHandler - Gestion des reponses TTS et des interruptions
 *
 * Ce module extrait la logique de gestion des reponses vocales de SpeechmaticsVoiceAgent :
 * - handleEchoDetected: gere la detection d'echo (quand le micro capte le TTS)
 * - handleAudioPlaybackEnd: nettoie l'etat quand le TTS finit de jouer
 * - speakInitialMessage: joue un message de bienvenue initial
 * - injectUserMessageAndRespond: injecte un message utilisateur et declenche une reponse
 */

import * as Sentry from '@sentry/nextjs';
import { devLog, devWarn, devError } from '@/lib/utils';
import { cleanTextForTTS } from '@/lib/sanitize';
import type { SpeechmaticsAudio } from './speechmatics-audio';
import type { ElevenLabsTTS } from './elevenlabs';
import type { TranscriptionManager } from './speechmatics-transcription';
import type { SpeechmaticsStateMachine } from './speechmatics-state-machine';
import type {
  SpeechmaticsConfig,
  SpeechmaticsMessageCallback,
  SpeechmaticsAudioCallback,
  SpeechmaticsErrorCallback,
} from './speechmatics-types';

// Import and re-export EchoDetails from barge-in module for consistency
import type { EchoDetails } from './speechmatics-barge-in';
export type { EchoDetails };

/**
 * Dependencies required by SpeechmaticsResponseHandler
 */
export interface ResponseHandlerDeps {
  // Getters for external modules
  getAudio: () => SpeechmaticsAudio | null;
  getTTS: () => ElevenLabsTTS | null;
  getConfig: () => SpeechmaticsConfig | null;
  getTranscriptionManager: () => TranscriptionManager | null;

  // Callbacks
  onMessageCallback: SpeechmaticsMessageCallback | null;
  onAudioCallback: SpeechmaticsAudioCallback | null;
  onErrorCallback: SpeechmaticsErrorCallback | null;
  onAudioPlaybackEndCallback: (() => void) | null;

  // State machine reference
  stateMachine: SpeechmaticsStateMachine;

  // Callbacks for parent actions
  processUserMessage: (message: string) => Promise<void>;
  addAgentMessageToHistory: (content: string) => void;
}

/**
 * Handler for TTS responses and abort logic
 *
 * Manages:
 * - Echo detection and handling
 * - Audio playback lifecycle
 * - Initial message playback
 * - Programmatic message injection
 */
export class SpeechmaticsResponseHandler {
  constructor(private deps: ResponseHandlerDeps) {}

  /**
   * Handle echo detection - discard pending transcript and notify UI
   * Called when the audio module detects that the transcribed audio is actually
   * TTS playback being picked up by the microphone (not real user speech)
   *
   * BUG-008 FIX: Now accepts echo details and notifies the UI via message callback
   */
  handleEchoDetected(details?: EchoDetails): void {
    const transcriptionManager = this.deps.getTranscriptionManager();

    // Discard any pending transcript in the transcription manager
    // This prevents sending echo as user input to the LLM
    transcriptionManager?.discardPendingTranscript();

    // BUG-008 FIX: Notify UI about echo detection so it can provide feedback
    // Send a special interim message to clear any displayed user input
    if (details) {
      devLog('[Speechmatics] Echo detected:', {
        speaker: details.speaker,
        transcriptPreview: details.transcript.substring(0, 50) + (details.transcript.length > 50 ? '...' : ''),
      });

      // Clear any interim user message that was showing the echo
      this.deps.onMessageCallback?.({
        role: 'user',
        content: '',
        timestamp: new Date().toISOString(),
        isInterim: true,
        messageId: `echo-cleared-${Date.now()}`,
      });
    }
  }

  /**
   * Handle audio playback end - called when TTS finishes playing
   * Emits TTS_END event and notifies external callback for inactivity timer
   */
  handleAudioPlaybackEnd(): void {
    // Emit TTS_END event to state machine (shadow mode)
    this.deps.stateMachine.transition({ type: 'TTS_END' });
    // Notify external callback (for inactivity timer)
    this.deps.onAudioPlaybackEndCallback?.();
  }

  /**
   * Speak an initial/welcome message via TTS
   * Used to greet the user when starting a voice session with no existing messages
   *
   * @param text - The message text to speak
   */
  async speakInitialMessage(text: string): Promise<void> {
    if (!text?.trim()) {
      devWarn('[Speechmatics] speakInitialMessage: empty text, skipping');
      return;
    }

    const config = this.deps.getConfig();
    const tts = this.deps.getTTS();
    const audio = this.deps.getAudio();

    // Skip if TTS is disabled
    if (config?.disableElevenLabsTTS || !tts || !audio) {
      devLog('[Speechmatics] speakInitialMessage: TTS disabled, skipping audio playback');
      // Still emit the message for display
      this.deps.onMessageCallback?.({
        role: 'agent',
        content: text,
        timestamp: new Date().toISOString(),
        isInterim: false,
        messageId: `initial-${Date.now()}`,
      });
      return;
    }

    devLog('[Speechmatics] Speaking initial message:', text.substring(0, 50) + '...');

    try {
      // Add to conversation history
      this.deps.addAgentMessageToHistory(text);

      // NOTE: Do NOT emit onMessageCallback here!
      // The initial message is already managed by the caller (either created via /respond endpoint
      // and returned in the API response, or already exists in the messages prop).
      // Emitting the callback would cause handleVoiceMessage to add a duplicate and persist again.
      // This method only handles: 1) adding to conversation history for LLM context, 2) playing TTS

      // Clean all signal markers before TTS (STEP_COMPLETE, TOPICS_DISCOVERED, etc.)
      const ttsText = cleanTextForTTS(text);

      // Set current assistant speech for echo detection
      audio.setCurrentAssistantSpeech(ttsText);

      // Generate and play TTS audio
      const audioStream = await tts.streamTextToSpeech(ttsText);
      const audioData = await audio.streamToUint8Array(audioStream);
      if (audioData) {
        this.deps.onAudioCallback?.(audioData);
        await audio.playAudio(audioData).catch(err => {
          devError('[Speechmatics] Error playing initial message audio:', err);
        });
      }

      devLog('[Speechmatics] Initial message spoken successfully');
    } catch (error) {
      Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
        tags: {
          module: 'speechmatics',
          operation: 'speak_initial_message',
        },
        extra: {
          textLength: text.length,
          hasTTS: Boolean(tts),
        },
        level: 'warning',
      });
      devError('[Speechmatics] Error speaking initial message:', error);
      // Don't throw - initial message failure shouldn't break the session
    }
  }

  /**
   * Inject a text message and trigger AI response
   * Used when user edits a transcription in voice mode
   *
   * @param text - The edited/corrected message text
   */
  async injectUserMessageAndRespond(text: string): Promise<void> {
    if (!text?.trim()) {
      devWarn('[Speechmatics] injectUserMessageAndRespond: empty text, skipping');
      return;
    }

    devLog('[Speechmatics] Injecting edited message and triggering response:', text.substring(0, 50) + '...');

    try {
      await this.deps.processUserMessage(text);
    } catch (error) {
      Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
        tags: {
          module: 'speechmatics',
          operation: 'inject_user_message_and_respond',
        },
        extra: {
          textLength: text.length,
        },
        level: 'error',
      });
      devError('[Speechmatics] Error processing injected message:', error);
      this.deps.onErrorCallback?.(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
