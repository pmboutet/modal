/**
 * SpeechmaticsConnection - Gestion de la connexion et deconnexion WebSocket
 *
 * Ce module extrait la logique de connexion/deconnexion de SpeechmaticsVoiceAgent :
 * - connect: etablit la connexion WebSocket et initialise les modules
 * - disconnect: ferme proprement la connexion et nettoie l'etat
 *
 * Pattern: Uses dependency injection via ConnectionDeps interface
 */

import * as Sentry from '@sentry/nextjs';
import { devLog, devError } from '@/lib/utils';
import { ElevenLabsTTS, type ElevenLabsConfig } from './elevenlabs';
import { SpeechmaticsAuth } from './speechmatics-auth';
import { AudioChunkDedupe } from './speechmatics-audio-dedupe';
import { TranscriptionManager } from './speechmatics-transcription';
import { SpeechmaticsWebSocket } from './speechmatics-websocket';
import { SpeechmaticsAudio } from './speechmatics-audio';
import {
  createSemanticTurnDetector,
  type SemanticTurnDetector,
  type SemanticTurnTelemetryEvent,
} from './turn-detection';
import { resolveSemanticTurnDetectorConfig, type SemanticTurnDetectorConfig } from './turn-detection-config';
import type { SpeechmaticsStateMachine } from './speechmatics-state-machine';
import type { EchoDetails } from './speechmatics-response-handler';
import {
  DEFAULT_MICROPHONE_SENSITIVITY,
  MICROPHONE_STOP_WAIT_MS,
  DISCONNECT_CLEANUP_DELAY_MS,
} from './speechmatics-constants';
import type {
  SpeechmaticsConfig,
  SpeechmaticsMessageCallback,
  SpeechmaticsErrorCallback,
  SpeechmaticsConnectionCallback,
} from './speechmatics-types';

/**
 * Dependencies required by SpeechmaticsConnection
 */
export interface ConnectionDeps {
  // Auth module
  auth: SpeechmaticsAuth;
  audioDedupe: AudioChunkDedupe;
  stateMachine: SpeechmaticsStateMachine;

  // Callbacks
  onMessageCallback: SpeechmaticsMessageCallback | null;
  onErrorCallback: SpeechmaticsErrorCallback | null;
  onConnectionCallback: SpeechmaticsConnectionCallback | null;
  onSemanticTurnCallback: ((event: SemanticTurnTelemetryEvent) => void) | null;

  // Parent callbacks for actions
  handleWebSocketMessage: (data: unknown) => void;
  processUserMessage: (transcript: string) => Promise<void>;
  abortResponse: () => void;
  handleAudioPlaybackEnd: () => void;
  handleEchoDetected: (details?: EchoDetails) => void;
}

/**
 * Result of connection containing initialized modules
 */
export interface ConnectionResult {
  websocket: SpeechmaticsWebSocket;
  audio: SpeechmaticsAudio;
  transcriptionManager: TranscriptionManager;
  elevenLabsTTS: ElevenLabsTTS | null;
  semanticTurnConfig: SemanticTurnDetectorConfig;
  semanticTurnDetector: SemanticTurnDetector | null;
}

/**
 * Global connection token counter shared across ALL instances
 * Used to track connection attempts and invalidate stale connections
 */
let globalConnectionToken = 0;

/**
 * Increment and get the global connection token
 * Called at the start of each connect() to invalidate any stale connections
 */
export function incrementGlobalConnectionToken(): number {
  globalConnectionToken++;
  return globalConnectionToken;
}

/**
 * Check if a connection token is still valid
 * A token is valid if it matches the current global counter
 */
export function isConnectionTokenValid(token: number): boolean {
  return token === globalConnectionToken;
}

/**
 * Establish connection to Speechmatics and initialize all modules
 *
 * This function:
 * 1. Initializes ElevenLabs TTS (if enabled)
 * 2. Resets the dedupe cache
 * 3. Creates the TranscriptionManager
 * 4. Creates and connects the WebSocket
 * 5. Initializes the audio manager
 * 6. Configures microphone sensitivity
 *
 * @param config - Configuration for the voice agent
 * @param deps - Dependencies (auth, callbacks, etc.)
 * @param disconnectPromise - Current disconnect promise if any
 * @returns ConnectionResult with initialized modules, or null if connection was invalidated
 */
export async function establishConnection(
  config: SpeechmaticsConfig,
  deps: ConnectionDeps,
  disconnectPromise: Promise<void> | null,
  myConnectionToken: number
): Promise<ConnectionResult | null> {
  // Initialize conversation history from existing messages if provided
  if (config.initialConversationHistory && config.initialConversationHistory.length > 0) {
    deps.stateMachine.initializeHistory(config.initialConversationHistory.map(msg => ({
      role: msg.role,
      content: msg.content,
    })));
    devLog('[Speechmatics] Initialized conversation history with', config.initialConversationHistory.length, 'messages');
  }

  // Refresh semantic detector on each connection to pick up env changes
  const semanticTurnConfig = resolveSemanticTurnDetectorConfig();
  const semanticTurnDetector = createSemanticTurnDetector(semanticTurnConfig);

  // ===== INITIALIZE ELEVENLABS TTS =====
  let elevenLabsTTS: ElevenLabsTTS | null = null;
  if (!config.disableElevenLabsTTS) {
    // Validate required ElevenLabs configuration
    if (!config.elevenLabsVoiceId) {
      throw new Error('ElevenLabs voice ID is required for Speechmatics voice agent (or set disableElevenLabsTTS to true)');
    }

    // Get ElevenLabs API key if not provided
    let elevenLabsApiKey = config.elevenLabsApiKey;
    if (!elevenLabsApiKey) {
      elevenLabsApiKey = await deps.auth.getElevenLabsApiKey();
    }

    // Initialize ElevenLabs TTS
    const elevenLabsConfig: ElevenLabsConfig = {
      apiKey: elevenLabsApiKey,
      voiceId: config.elevenLabsVoiceId,
      modelId: config.elevenLabsModelId,
    };
    elevenLabsTTS = new ElevenLabsTTS(elevenLabsConfig);
  }

  // Reset dedupe cache
  deps.audioDedupe.reset();

  // Initialize transcription manager
  const transcriptionManager = new TranscriptionManager(
    deps.onMessageCallback,
    (transcript: string) => deps.processUserMessage(transcript),
    deps.stateMachine.getContext().conversationHistory,
    config.sttEnablePartials !== false,
    semanticTurnDetector && semanticTurnConfig.enabled
      ? {
          detector: semanticTurnDetector,
          threshold: semanticTurnConfig.probabilityThreshold,
          gracePeriodMs: semanticTurnConfig.gracePeriodMs,
          maxHoldMs: semanticTurnConfig.maxHoldMs,
          fallbackMode: semanticTurnConfig.fallbackMode,
          maxContextMessages: semanticTurnConfig.contextMessages,
          telemetry: (event) => deps.onSemanticTurnCallback?.(event),
        }
      : undefined,
    // Speaker filtering config (individual mode)
    config.enableSpeakerFiltering
      ? {
          enabled: true,
          onSpeakerEstablished: config.onSpeakerEstablished,
          onSpeakerFiltered: (speaker: string, transcript: string) => {
            // BUG FIX: Reset VAD state when a speaker is filtered
            // This prevents filtered speakers from causing "isUserSpeaking" = true
            // which would incorrectly drop LLM responses
            // Note: audio module is not available here, so we use a callback pattern
            config.onSpeakerFiltered?.(speaker, transcript);
          },
        }
      : undefined
  );

  // Initialize WebSocket manager
  const websocket = new SpeechmaticsWebSocket(
    deps.auth,
    deps.onConnectionCallback,
    deps.onErrorCallback,
    (data: unknown) => deps.handleWebSocketMessage(data)
  );

  // Connect WebSocket
  await websocket.connect(config, disconnectPromise);

  // CRITICAL: Check if this connection attempt is still valid
  if (!isConnectionTokenValid(myConnectionToken)) {
    return null;
  }

  // Also check isDisconnected flag as a secondary safety check
  if (deps.stateMachine.isDisconnected()) {
    return null;
  }

  // Emit CONNECT event to state machine
  deps.stateMachine.transition({ type: 'CONNECT' });

  // Initialize audio manager
  const audio = new SpeechmaticsAudio(
    deps.audioDedupe,
    () => {}, // onAudioChunk not needed, handled internally
    websocket.getWebSocket(),
    () => deps.abortResponse(), // Barge-in callback
    () => deps.handleAudioPlaybackEnd(), // Audio playback end callback
    (details) => deps.handleEchoDetected(details) // Echo detection callback
  );

  // Update audio with WebSocket reference
  audio.updateWebSocket(websocket.getWebSocket());

  // Set microphone sensitivity if configured
  const sensitivity = config.microphoneSensitivity ?? DEFAULT_MICROPHONE_SENSITIVITY;
  audio.setMicrophoneSensitivity(sensitivity);

  // Configure adaptive audio processing features
  audio.setAdaptiveFeatures({
    enableAdaptiveSensitivity: config.enableAdaptiveSensitivity !== false,
    enableAdaptiveNoiseGate: config.enableAdaptiveNoiseGate !== false,
    enableWorkletAGC: config.enableWorkletAGC !== false,
  });

  return {
    websocket,
    audio,
    transcriptionManager,
    elevenLabsTTS,
    semanticTurnConfig,
    semanticTurnDetector,
  };
}

/**
 * Disconnect from Speechmatics and cleanup all resources
 *
 * This function:
 * 1. Increments global token to invalidate in-flight connections
 * 2. Emits DISCONNECT event to state machine
 * 3. Aborts any pending LLM request
 * 4. Stops microphone and waits for audio to flush
 * 5. Disconnects WebSocket (sends EndOfStream)
 * 6. Cleans up transcription manager
 * 7. Resets audio dedupe cache
 * 8. Forces browser to release microphone permissions
 *
 * @param deps - Dependencies and module references
 * @param audio - Audio manager instance
 * @param websocket - WebSocket manager instance
 * @param transcriptionManager - Transcription manager instance
 * @param audioDedupe - Audio deduplication instance
 * @param abortLlmRequest - Callback to abort LLM request
 */
export async function performDisconnect(deps: {
  stateMachine: SpeechmaticsStateMachine;
  onConnectionCallback: SpeechmaticsConnectionCallback | null;
  audio: SpeechmaticsAudio | null;
  websocket: SpeechmaticsWebSocket | null;
  transcriptionManager: TranscriptionManager | null;
  audioDedupe: AudioChunkDedupe;
  abortLlmRequest: () => void;
}): Promise<void> {
  // CRITICAL: Increment global token to invalidate any in-flight connect() attempts
  incrementGlobalConnectionToken();

  // Emit DISCONNECT event to state machine
  deps.stateMachine.transition({ type: 'DISCONNECT' });

  // Always abort any pending LLM request on disconnect
  deps.abortLlmRequest();

  // CRITICAL: According to Speechmatics API docs:
  // 1. Stop sending audio FIRST (no AddAudio after EndOfStream)
  // 2. Send EndOfStream message
  // 3. Wait for server to process
  // 4. Close WebSocket

  if (deps.audio) {
    // Stop microphone input completely - this stops all AddAudio messages
    deps.audio.setMicrophoneMuted(true);
    try {
      await deps.audio.stopMicrophone();
    } catch (error) {
      Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
        tags: {
          module: 'speechmatics',
          operation: 'stop_microphone_on_disconnect',
        },
        level: 'warning',
      });
      devError('[Speechmatics] Error stopping microphone:', error);
    }

    // CRITICAL: Wait to ensure NO audio chunks are in flight
    await new Promise(resolve => setTimeout(resolve, MICROPHONE_STOP_WAIT_MS));
  }

  // Now disconnect WebSocket (this will send EndOfStream and close properly)
  if (deps.websocket) {
    await deps.websocket.disconnect(deps.stateMachine.isDisconnected());
  }

  // Cleanup transcription manager
  deps.transcriptionManager?.cleanup();

  // Reset audio dedupe cache
  deps.audioDedupe.reset();

  deps.onConnectionCallback?.(false);

  // CRITICAL: Force browser to release any ghost microphone permissions
  await new Promise(resolve => setTimeout(resolve, DISCONNECT_CLEANUP_DELAY_MS));

  if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    try {
      await navigator.mediaDevices.enumerateDevices();
    } catch {
      // Ignore errors - this is just a cleanup trick
    }
  }
}
