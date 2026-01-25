/**
 * SpeechmaticsVoiceAgent - Agent vocal utilisant Speechmatics STT + LLM + ElevenLabs TTS
 * 
 * Architecture modulaire :
 * - SpeechmaticsAuth : Gestion de l'authentification Speechmatics et ElevenLabs
 * - SpeechmaticsWebSocket : Gestion de la connexion WebSocket et des messages
 * - SpeechmaticsAudio : Capture et envoi de l'audio du microphone
 * - AudioChunkDedupe : Déduplication des chunks audio pour éviter les doublons
 * - TranscriptionManager : Gestion des transcriptions partielles et finales
 * - SpeechmaticsLLM : Appels au LLM (Anthropic/OpenAI) pour générer les réponses
 * - ElevenLabsTTS : Synthèse vocale pour les réponses de l'agent
 * 
 * Flux de traitement :
 * 1. Audio du microphone → Speechmatics STT (transcription en temps réel)
 * 2. Transcription finale → LLM (génération de réponse)
 * 3. Réponse LLM → ElevenLabs TTS (synthèse vocale)
 * 4. Audio TTS → Lecture dans le navigateur
 * 
 * Ce fichier a été refactoré pour utiliser des composants modulaires
 * afin d'améliorer la maintenabilité et la testabilité.
 */

/**
 * Helper function to get timestamp for logging
 */
function getTimestamp(): string {
  const now = new Date();
  return now.toISOString().split('T')[1].replace('Z', '');
}

import { ElevenLabsTTS, type ElevenLabsConfig } from './elevenlabs';
import { SpeechmaticsAuth } from './speechmatics-auth';
import { AudioChunkDedupe } from './speechmatics-audio-dedupe';
import { TranscriptionManager } from './speechmatics-transcription';
import { SpeechmaticsWebSocket } from './speechmatics-websocket';
import { SpeechmaticsAudio } from './speechmatics-audio';
import { SpeechmaticsLLM } from './speechmatics-llm';
import {
  createSemanticTurnDetector,
  type SemanticTurnDetector,
  type SemanticTurnTelemetryEvent,
} from './turn-detection';
import { resolveSemanticTurnDetectorConfig } from './turn-detection-config';
import { cleanAllSignalMarkers } from '@/lib/sanitize';

// Import and re-export types for backward compatibility
import type {
  SpeechmaticsConfig,
  SpeechmaticsMessageEvent,
  SpeechmaticsMessageCallback,
  SpeechmaticsErrorCallback,
  SpeechmaticsConnectionCallback,
  SpeechmaticsAudioCallback,
} from './speechmatics-types';

export type {
  SpeechmaticsConfig,
  SpeechmaticsMessageEvent,
  SpeechmaticsMessageCallback,
  SpeechmaticsErrorCallback,
  SpeechmaticsConnectionCallback,
  SpeechmaticsAudioCallback,
};

/**
 * Classe principale SpeechmaticsVoiceAgent
 * 
 * Coordonne tous les modules pour fournir une expérience vocale complète :
 * - Connexion WebSocket à Speechmatics
 * - Capture audio du microphone
 * - Transcription en temps réel
 * - Génération de réponses via LLM
 * - Synthèse vocale avec ElevenLabs
 */
export class SpeechmaticsVoiceAgent {
  // ===== STATIC CLASS VARIABLES =====
  // Global connection token counter shared across ALL instances to track connection attempts
  private static globalConnectionToken: number = 0;

  // ===== MODULES CORE =====
  // Gestion de l'authentification (Speechmatics et ElevenLabs)
  private auth: SpeechmaticsAuth;
  // Déduplication des chunks audio (évite les doublons)
  private audioDedupe: AudioChunkDedupe;
  // Gestionnaire de transcription (traite les partials et finals)
  private transcriptionManager: TranscriptionManager | null = null;
  // Gestionnaire WebSocket (connexion et messages)
  private websocket: SpeechmaticsWebSocket | null = null;
  // Gestionnaire audio (capture et envoi du microphone)
  private audio: SpeechmaticsAudio | null = null;
  // Gestionnaire LLM (appels à Anthropic/OpenAI)
  private llm: SpeechmaticsLLM;
  // Gestionnaire TTS ElevenLabs (synthèse vocale)
  private elevenLabsTTS: ElevenLabsTTS | null = null;

  // ===== CONFIGURATION ET ÉTAT =====
  // Configuration actuelle de l'agent
  private config: SpeechmaticsConfig | null = null;
  // Historique de conversation (pour le contexte LLM)
  private conversationHistory: Array<{ role: 'user' | 'agent'; content: string }> = [];
  // Flag indiquant si une réponse est en cours de génération (pour la queue)
  private isGeneratingResponse: boolean = false;
  // Timestamp when generation started (for stuck flag recovery)
  private generationStartedAt: number = 0;
  // Maximum time allowed for response generation before auto-reset (60 seconds)
  private readonly GENERATION_TIMEOUT_MS = 60000;
  // Queue des messages utilisateur en attente (si plusieurs messages arrivent pendant la génération)
  private userMessageQueue: Array<{ content: string; timestamp: string }> = [];
  // Track if user continues speaking during response generation (abort-on-continue)
  private responseAbortedDueToUserContinuation: boolean = false;
  // Track if ANY partial transcript was received during LLM generation
  // This flag is only reset when generation completes, not when processing starts
  private receivedPartialDuringGeneration: boolean = false;
  // Timestamp of when we last received a partial during generation (for staleness check)
  private lastPartialDuringGenerationTimestamp: number = 0;
  // Maximum age of receivedPartialDuringGeneration flag before it's considered stale (3 seconds)
  private readonly PARTIAL_FLAG_STALENESS_MS = 3000;
  // Last processed user message (to detect new content during response)
  private lastSentUserMessage: string = '';
  // Deduplication: Track last successfully processed message to avoid duplicate processing
  private lastProcessedMessage: { content: string; timestamp: number } | null = null;
  // Flag indiquant si l'agent est déconnecté (pour ignorer les messages tardifs)
  private isDisconnected: boolean = false;
  // Promise de déconnexion en cours (pour éviter les déconnexions multiples)
  private disconnectPromise: Promise<void> | null = null;
  // Connection token for THIS instance's connection attempt (captured from global counter)
  private myConnectionToken: number = 0;
  // Semantic turn detection configuration
  private semanticTurnConfig = resolveSemanticTurnDetectorConfig();
  private semanticTurnDetector: SemanticTurnDetector | null =
    createSemanticTurnDetector(this.semanticTurnConfig);
  // AbortController for canceling in-flight LLM requests
  private llmAbortController: AbortController | null = null;

  // ===== CALLBACKS =====
  // Callback appelé lorsqu'un message est reçu (user ou agent, interim ou final)
  private onMessageCallback: SpeechmaticsMessageCallback | null = null;
  // Callback appelé en cas d'erreur
  private onErrorCallback: SpeechmaticsErrorCallback | null = null;
  // Callback appelé lors des changements d'état de connexion
  private onConnectionCallback: SpeechmaticsConnectionCallback | null = null;
  // Callback appelé lorsqu'un chunk audio TTS est reçu (pour l'analyse si nécessaire)
  private onAudioCallback: SpeechmaticsAudioCallback | null = null;
  // Callback pour les événements de détection sémantique
  private onSemanticTurnCallback: ((event: SemanticTurnTelemetryEvent) => void) | null = null;
  // Callback appelé quand le TTS audio a fini de jouer (pour le timer d'inactivité)
  private onAudioPlaybackEndCallback: (() => void) | null = null;

  /**
   * Constructeur - Initialise les modules core
   */
  constructor() {
    this.auth = new SpeechmaticsAuth();
    this.audioDedupe = new AudioChunkDedupe();
    this.llm = new SpeechmaticsLLM();
  }

  /**
   * Configure les callbacks pour recevoir les événements
   * 
   * @param callbacks - Objet contenant les callbacks optionnels
   */
  setCallbacks(callbacks: {
    onMessage?: SpeechmaticsMessageCallback;
    onError?: SpeechmaticsErrorCallback;
    onConnection?: SpeechmaticsConnectionCallback;
    onAudio?: SpeechmaticsAudioCallback;
    onSemanticTurn?: (event: SemanticTurnTelemetryEvent) => void;
    onAudioPlaybackEnd?: () => void;
  }) {
    this.onMessageCallback = callbacks.onMessage || null;
    this.onErrorCallback = callbacks.onError || null;
    this.onConnectionCallback = callbacks.onConnection || null;
    this.onAudioCallback = callbacks.onAudio || null;
    this.onSemanticTurnCallback = callbacks.onSemanticTurn || null;
    this.onAudioPlaybackEndCallback = callbacks.onAudioPlaybackEnd || null;
  }

  /**
   * Établit la connexion à Speechmatics et initialise tous les modules
   * 
   * Cette fonction :
   * 1. Initialise ElevenLabs TTS (si activé)
   * 2. Réinitialise le cache de déduplication audio
   * 3. Crée le TranscriptionManager
   * 4. Crée et connecte le WebSocket
   * 5. Initialise le gestionnaire audio
   * 6. Configure la sensibilité du microphone
   * 
   * @param config - Configuration de l'agent (STT, LLM, TTS, etc.)
   */
  async connect(config: SpeechmaticsConfig): Promise<void> {
    // Increment GLOBAL connection token to track THIS specific connection attempt
    // Using static counter ensures tokens are unique across ALL agent instances
    SpeechmaticsVoiceAgent.globalConnectionToken++;
    this.myConnectionToken = SpeechmaticsVoiceAgent.globalConnectionToken;

    // Réinitialiser le flag de déconnexion
    this.isDisconnected = false;
    this.config = config;

    // Initialize conversation history from existing messages if provided
    if (config.initialConversationHistory && config.initialConversationHistory.length > 0) {
      this.conversationHistory = [...config.initialConversationHistory];
      console.log('[Speechmatics] Initialized conversation history with', this.conversationHistory.length, 'messages');
    } else {
      this.conversationHistory = [];
    }

    // Refresh semantic detector on each connection to pick up env changes
    this.semanticTurnConfig = resolveSemanticTurnDetectorConfig();
    this.semanticTurnDetector = createSemanticTurnDetector(this.semanticTurnConfig);


    // ===== INITIALISATION D'ELEVENLABS TTS =====
    // Initialiser ElevenLabs seulement si TTS n'est pas désactivé
    if (!config.disableElevenLabsTTS) {
      // Validate required ElevenLabs configuration
      if (!config.elevenLabsVoiceId) {
        throw new Error('ElevenLabs voice ID is required for Speechmatics voice agent (or set disableElevenLabsTTS to true)');
      }

      // Get ElevenLabs API key if not provided
      let elevenLabsApiKey = config.elevenLabsApiKey;
      if (!elevenLabsApiKey) {
        elevenLabsApiKey = await this.auth.getElevenLabsApiKey();
      }

      // Initialize ElevenLabs TTS
      const elevenLabsConfig: ElevenLabsConfig = {
        apiKey: elevenLabsApiKey,
        voiceId: config.elevenLabsVoiceId,
        modelId: config.elevenLabsModelId,
      };
      this.elevenLabsTTS = new ElevenLabsTTS(elevenLabsConfig);
    }

    // Reset dedupe cache
    this.audioDedupe.reset();

    // Initialize transcription manager
    this.transcriptionManager = new TranscriptionManager(
      this.onMessageCallback,
      (transcript: string) => this.processUserMessage(transcript),
      this.conversationHistory,
      config.sttEnablePartials !== false,
      this.semanticTurnDetector && this.semanticTurnConfig.enabled
        ? {
            detector: this.semanticTurnDetector,
            threshold: this.semanticTurnConfig.probabilityThreshold,
            gracePeriodMs: this.semanticTurnConfig.gracePeriodMs,
            maxHoldMs: this.semanticTurnConfig.maxHoldMs,
            fallbackMode: this.semanticTurnConfig.fallbackMode,
            maxContextMessages: this.semanticTurnConfig.contextMessages,
            telemetry: (event) => this.onSemanticTurnCallback?.(event),
          }
        : undefined,
      // Speaker filtering config (individual mode)
      config.enableSpeakerFiltering
        ? {
            enabled: true,
            onSpeakerEstablished: config.onSpeakerEstablished,
            onSpeakerFiltered: (speaker: string, transcript: string) => {
              // BUG FIX: Reset VAD state when a speaker is filtered
              // This prevents filtered speakers (e.g., S2) from causing "isUserSpeaking" = true
              // which would incorrectly drop LLM responses
              this.audio?.resetVADStateForFilteredSpeaker();
              // Call the original callback
              config.onSpeakerFiltered?.(speaker, transcript);
            },
          }
        : undefined
    );

    // Initialize WebSocket manager
    this.websocket = new SpeechmaticsWebSocket(
      this.auth,
      this.onConnectionCallback,
      this.onErrorCallback,
      (data: any) => this.handleWebSocketMessage(data)
    );

    // Connect WebSocket
    await this.websocket.connect(config, this.disconnectPromise);

    // CRITICAL: Check if this connection attempt is still valid
    // If a newer connect() call has incremented the global counter beyond our token,
    // it means this connection is orphaned and should be aborted
    if (this.myConnectionToken !== SpeechmaticsVoiceAgent.globalConnectionToken) {
      return;
    }

    // Also check isDisconnected flag as a secondary safety check
    if (this.isDisconnected) {
      return;
    }


    // Initialize audio manager (will be updated with WebSocket reference after connection)
    this.audio = new SpeechmaticsAudio(
      this.audioDedupe,
      () => {}, // onAudioChunk not needed, handled internally
      this.websocket.getWebSocket(),
      () => this.abortResponse(), // Barge-in callback
      () => this.handleAudioPlaybackEnd(), // Audio playback end callback - clears lastSentUserMessage and notifies inactivity timer
      // BUG-008 FIX: Pass echo details to handler for UI feedback
      (details) => this.handleEchoDetected(details)
    );
    
    // Update audio with WebSocket reference
    if (this.audio && this.websocket) {
      this.audio.updateWebSocket(this.websocket.getWebSocket());
    }

    // Set microphone sensitivity if configured
    // Higher values = less sensitive = ignores distant/quieter sounds
    // Default: 1.5 (less sensitive to filter out background conversations)
    const sensitivity = config.microphoneSensitivity ?? 1.5;
    this.audio.setMicrophoneSensitivity(sensitivity);
    
    // Configure adaptive audio processing features
    this.audio.setAdaptiveFeatures({
      enableAdaptiveSensitivity: config.enableAdaptiveSensitivity !== false, // Default: true
      enableAdaptiveNoiseGate: config.enableAdaptiveNoiseGate !== false, // Default: true
      enableWorkletAGC: config.enableWorkletAGC !== false, // Default: true
    });
  }

  private handleWebSocketMessage(data: any): void {
    // CRITICAL FIX: Only skip if we're disconnected AND websocket is not connected
    // If websocket is connected, we should process messages even if isDisconnected flag is set
    // (This can happen if disconnect() was called but connection is still active)
    if (this.isDisconnected && !this.websocket?.isConnected()) {
      return;
    }
    
    // If websocket is connected but isDisconnected flag is true, reset the flag
    // This handles the case where disconnect() was called but connection is still active
    if (this.isDisconnected && this.websocket?.isConnected()) {
      this.isDisconnected = false;
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
      // Speechmatics API structure:
      // - transcript is in metadata.transcript (full text)
      // - start_time/end_time are in metadata (segment timing)
      // - Speaker info is in results[].alternatives[0].speaker (S1, S2, UU)
      const transcript = data.metadata?.transcript || "";
      const startTime = data.metadata?.start_time ?? 0;
      const endTime = data.metadata?.end_time ?? 0;
      const speaker = this.extractDominantSpeaker(data.results);

      if (this.audio && transcript && transcript.trim()) {
        const trimmedTranscript = transcript.trim();

        // Track ANY partial received during LLM generation
        // This flag is used to drop the LLM response if user was speaking
        if (this.isGeneratingResponse) {
          this.receivedPartialDuringGeneration = true;
          this.lastPartialDuringGenerationTimestamp = Date.now();
        }

        // ABORT-ON-CONTINUE: If response is being generated OR audio is playing and user continues speaking,
        // abort the current response and let them finish
        // BUG FIX: Also check isPlayingAudio - user should be able to abort during TTS, not just LLM generation
        const isAgentResponding = this.isGeneratingResponse || this.audio?.isPlaying();
        if (isAgentResponding && this.lastSentUserMessage) {
          const hasSignificantNewContent = this.hasSignificantNewContent(trimmedTranscript, this.lastSentUserMessage);
          if (hasSignificantNewContent) {
            this.responseAbortedDueToUserContinuation = true;
            this.abortResponse();
            // Remove the incomplete user message from conversation history
            // (it will be replaced by the complete one when user finishes)
            if (this.conversationHistory.length > 0 &&
                this.conversationHistory[this.conversationHistory.length - 1]?.role === 'user') {
              this.conversationHistory.pop();
            }
            // CRITICAL: Clear the message queue since those are now stale fragments
            // The transcription manager will send the complete message when user finishes
            if (this.userMessageQueue.length > 0) {
              this.userMessageQueue = [];
            }
          }
        }

        // BUG FIX: Check speaker filtering BEFORE barge-in validation
        // This prevents parasitic voices from stopping TTS - previously, barge-in was validated
        // before speaker filtering, so TTS would stop and not resume when we discovered it was a filtered speaker
        const shouldFilterThisSpeaker = this.transcriptionManager?.shouldFilterSpeaker(speaker) ?? false;

        if (shouldFilterThisSpeaker) {
          // Cancel any pending barge-in validation and reset VAD state
          // This prevents the filtered speaker from interrupting TTS
          this.audio?.resetVADStateForFilteredSpeaker();
          // Still process the transcript for logging/callbacks (handlePartialTranscript will filter it)
          this.transcriptionManager?.handlePartialTranscript(trimmedTranscript, startTime, endTime, speaker);
        } else {
          // Get recent conversation context for echo detection (last agent message + last user message)
          const recentContext = this.conversationHistory
            .slice(-2)
            .map(msg => msg.content)
            .join(' ')
            .slice(-200); // Last 200 chars of recent context

          // Validate barge-in with transcript content, context, and speaker (for diarization-based echo detection)
          this.audio?.validateBargeInWithTranscript(trimmedTranscript, recentContext, speaker);

          // Process partial transcript with timestamps for deduplication
          this.transcriptionManager?.handlePartialTranscript(trimmedTranscript, startTime, endTime, speaker);
        }
      }
      return;
    }

    // Handle final transcription
    if (data.message === "AddTranscript") {
      // Speechmatics API structure:
      // - transcript is in metadata.transcript (full text)
      // - start_time/end_time are in metadata (segment timing)
      // - Speaker info is in results[].alternatives[0].speaker (S1, S2, UU)
      const transcript = data.metadata?.transcript || "";
      const startTime = data.metadata?.start_time ?? 0;
      const endTime = data.metadata?.end_time ?? 0;
      const speaker = this.extractDominantSpeaker(data.results);

      if (transcript && transcript.trim()) {
        const trimmedFinalTranscript = transcript.trim();

        // BUG FIX: Check speaker filtering BEFORE barge-in validation (same as partial transcripts)
        // This prevents parasitic voices from stopping TTS
        const shouldFilterThisSpeaker = this.transcriptionManager?.shouldFilterSpeaker(speaker) ?? false;

        if (shouldFilterThisSpeaker) {
          // Cancel any pending barge-in validation and reset VAD state
          this.audio?.resetVADStateForFilteredSpeaker();
          // Still process the transcript for logging/callbacks (handleFinalTranscript will filter it)
          this.transcriptionManager?.handleFinalTranscript(trimmedFinalTranscript, startTime, endTime, speaker);
        } else {
          // Get recent conversation context for echo detection (last agent message + last user message)
          const recentContext = this.conversationHistory
            .slice(-2)
            .map(msg => msg.content)
            .join(' ')
            .slice(-200); // Last 200 chars of recent context

          // Validate barge-in with transcript content, context, and speaker (for diarization-based echo detection)
          this.audio?.validateBargeInWithTranscript(trimmedFinalTranscript, recentContext, speaker);

          // Process final transcript with timestamps for deduplication
          this.transcriptionManager?.handleFinalTranscript(trimmedFinalTranscript, startTime, endTime, speaker);
        }
      }
      return;
    }

    // Handle EndOfUtterance
    // This is the signal from Speechmatics that the user has finished speaking
    // IMPORTANT: We DON'T process immediately on EndOfUtterance because it can arrive too early
    // Instead, we just mark it and let the silence timeout handle the processing
    // This gives the user more time to continue speaking if they want
    if (data.message === "EndOfUtterance") {
      // Just mark that we received it, but don't process yet
      // The silence timeout will handle processing after the configured delay
      this.transcriptionManager?.markEndOfUtterance();

      // BUG-FIX: Reset the "received partial during generation" flag when user finishes speaking
      // This prevents the LLM response from being dropped when the user has already stopped talking
      // We only reset if VAD also confirms user is not speaking (belt and suspenders)
      if (this.receivedPartialDuringGeneration && !this.audio?.isUserSpeaking()) {
        console.log('[Speechmatics] ✅ EndOfUtterance received - resetting receivedPartialDuringGeneration flag');
        this.receivedPartialDuringGeneration = false;
      }
      return;
    }

    // Handle EndOfStream (server response to our EndOfStream message)
    // According to Speechmatics API, the server may send EndOfStream back
    // This indicates the server has processed our EndOfStream and is ready to close
    if (data.message === "EndOfStream") {
      this.transcriptionManager?.processPendingTranscript(true);
      return;
    }

    // Handle Error messages
    if (data.message === "Error") {
      const errorMessage = data.reason || data.message || 'Unknown error';
      
      // Handle quota errors with a more user-friendly message
      if (errorMessage.includes('Quota') || errorMessage.includes('quota') || errorMessage.includes('Concurrent')) {
        // Record quota error timestamp in WebSocket class to enforce longer delay on reconnect
        SpeechmaticsWebSocket.lastQuotaErrorTimestamp = Date.now();
        
        const friendlyError = new Error('Speechmatics quota exceeded. Please wait 10 seconds before trying again, or check your account limits. If you have multiple tabs open, close them to free up concurrent sessions.');
        console.error('[Speechmatics] ❌ Quota error:', errorMessage);
        console.error('[Speechmatics] ⏳ Will prevent reconnection for 10 seconds to allow quota to reset');
        this.onErrorCallback?.(friendlyError);
        // Disconnect on quota error to prevent further attempts
        // Use a longer delay to ensure quota is released
        this.disconnect().catch(() => {});
        return;
      }
      
      console.error('[Speechmatics] ❌ Error message:', errorMessage);
      const error = new Error(`Speechmatics error: ${errorMessage}`);
      this.onErrorCallback?.(error);
      return;
    }
  }

  private async processUserMessage(transcript: string): Promise<void> {
    const processStartedAt = Date.now();
    const normalizedTranscript = transcript.trim().toLowerCase();

    // DEDUPLICATION: Skip if this is identical to what we just processed (within 5 seconds)
    if (this.lastProcessedMessage &&
        this.lastProcessedMessage.content === normalizedTranscript &&
        processStartedAt - this.lastProcessedMessage.timestamp < 5000) {
      return;
    }

    // If we were aborted due to user continuation, clear the flag and proceed
    // The new transcript should contain the complete user input
    if (this.responseAbortedDueToUserContinuation) {
      this.responseAbortedDueToUserContinuation = false;
    }

    if (this.isGeneratingResponse) {
      // SAFETY CHECK: Auto-reset if generation has been stuck for too long
      // This prevents the agent from becoming unresponsive if something goes wrong
      if (this.generationStartedAt > 0 &&
          processStartedAt - this.generationStartedAt > this.GENERATION_TIMEOUT_MS) {
        console.warn('[Speechmatics] ⚠️ Generation stuck for', Math.round((processStartedAt - this.generationStartedAt) / 1000), 'seconds - auto-resetting flag');
        this.isGeneratingResponse = false;
        this.generationStartedAt = 0;
        this.lastSentUserMessage = '';
        this.userMessageQueue = [];
        // Abort any in-flight LLM request
        if (this.llmAbortController) {
          this.llmAbortController.abort();
          this.llmAbortController = null;
        }
      } else {
        // DEDUPLICATION: Check if this message is already in queue or identical to what's being processed
        const isInQueue = this.userMessageQueue.some(q => q.content.trim().toLowerCase() === normalizedTranscript);
        const isCurrentlyProcessing = this.lastSentUserMessage.trim().toLowerCase() === normalizedTranscript;

        if (isInQueue || isCurrentlyProcessing) {
          return;
        }

        this.userMessageQueue.push({ content: transcript, timestamp: new Date().toISOString() });
        return;
      }
    }

    this.isGeneratingResponse = true;
    this.generationStartedAt = processStartedAt;
    this.receivedPartialDuringGeneration = false; // Reset flag at start of generation

    // Track the message we're about to process (for abort-on-continue detection)
    this.lastSentUserMessage = transcript;

    // Add user message to conversation history
    this.conversationHistory.push({ role: 'user', content: transcript });

    // Update audio manager with conversation history for start-of-turn detection
    if (this.audio) {
      const historyForDetection = this.conversationHistory.slice(-4).map(msg => ({
        role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
        content: msg.content,
      }));
      this.audio.updateConversationHistory(historyForDetection);
    }

    // In consultant mode (disableLLM), skip LLM response generation entirely
    // The transcription is already captured and sent via callback, so just exit
    if (this.config?.disableLLM) {
      this.isGeneratingResponse = false;
      // BUG-002 FIX: Process any queued messages with await to ensure proper error handling
      // and prevent isGeneratingResponse from getting stuck
      if (this.userMessageQueue.length > 0) {
        const next = this.userMessageQueue.shift()!;
        try {
          await this.processUserMessage(next.content);
        } catch (error) {
          console.error('[Speechmatics] Error processing queued message in consultant mode:', error);
        }
      }
      return;
    }

    // Create abort controller for this LLM request
    this.llmAbortController = new AbortController();
    const signal = this.llmAbortController.signal;

    try {
      const llmProvider = this.config?.llmProvider || "anthropic";
      const llmApiKey = this.config?.llmApiKey || await this.llm.getLLMApiKey(llmProvider);
      const llmModel = this.config?.llmModel || (llmProvider === "openai" ? "gpt-4o" : "claude-3-5-haiku-latest");

      // Build messages for LLM (same format as text mode)
      const recentHistory = this.conversationHistory.slice(-4);
      
      // Use user prompt if available (same as text mode), otherwise use transcript directly
      // Import renderTemplate to properly replace ALL variables, not just latest_user_message
      const { renderTemplate } = await import('./templates');
      const userPrompt = this.config?.userPrompt;
      let userMessageContent: string;
      if (userPrompt && userPrompt.trim()) {
        // Build variables for template rendering (same as text mode)
        // Use promptVariables from config if available, otherwise build minimal set
        const baseVariables = this.config?.promptVariables || {};
        const variables: Record<string, string | null | undefined> = {
          ...baseVariables, // Include all variables from config (ask_question, ask_description, etc.)
          latest_user_message: transcript, // Override with current transcript
        };
        // Render template with all variables (same as text mode)
        userMessageContent = renderTemplate(userPrompt, variables);
      } else {
        // Fallback: use transcript directly
        userMessageContent = transcript;
      }
      
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: this.config?.systemPrompt || '' },
        ...recentHistory.map(msg => ({
          role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
          content: msg.content,
        })),
        { role: 'user', content: userMessageContent },
      ];

      // Call LLM with abort signal
      const llmResponse = await this.llm.callLLM(
        llmProvider,
        llmApiKey,
        llmModel,
        messages,
        {
          enableThinking: this.config?.enableThinking,
          thinkingBudgetTokens: this.config?.thinkingBudgetTokens,
          signal,
        }
      );

      // USER-SPEAKING CHECK: If user started speaking while LLM was generating,
      // drop the response entirely and wait for user to finish
      // This prevents the AI from talking over the user
      // BUG-FIX: Only use receivedPartialDuringGeneration flag, NOT isUserSpeaking() VAD check
      // The VAD sliding window can have stale state from BEFORE generation started, causing
      // responses to be incorrectly dropped even when the user has stopped speaking
      // The partial flag is the accurate signal - it's only set when we receive actual
      // transcription partials during generation
      const now = Date.now();
      const partialFlagIsFresh = this.receivedPartialDuringGeneration &&
        (now - this.lastPartialDuringGenerationTimestamp < this.PARTIAL_FLAG_STALENESS_MS);
      if (partialFlagIsFresh) {
        console.log('[Speechmatics] 🚫 LLM response dropped - user spoke during generation (partial age ms:', now - this.lastPartialDuringGenerationTimestamp, ')');
        // Remove the incomplete user message from conversation history
        // (it will be replaced by the complete one when user finishes)
        if (this.conversationHistory.length > 0 &&
            this.conversationHistory[this.conversationHistory.length - 1]?.role === 'user') {
          this.conversationHistory.pop();
        }
        // Reset generation state
        this.isGeneratingResponse = false;
        this.generationStartedAt = 0;
        this.receivedPartialDuringGeneration = false; // Reset flag
        // Clear queue - stale fragments will be replaced by new user message
        this.userMessageQueue = [];
        return;
      }

      // Log that response was NOT dropped (helps debugging)
      if (this.receivedPartialDuringGeneration) {
        console.log('[Speechmatics] ✅ LLM response NOT dropped - partial was stale (age ms:', now - this.lastPartialDuringGenerationTimestamp, ', threshold:', this.PARTIAL_FLAG_STALENESS_MS, ')');
      }

      // Add to conversation history
      this.conversationHistory.push({ role: 'agent', content: llmResponse });

      // Update audio manager with conversation history for start-of-turn detection
      if (this.audio) {
        const historyForDetection = this.conversationHistory.slice(-4).map(msg => ({
          role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
          content: msg.content,
        }));
        this.audio.updateConversationHistory(historyForDetection);
      }

      // Notify callback with FINAL agent response
      this.onMessageCallback?.({
        role: 'agent',
        content: llmResponse,
        timestamp: new Date().toISOString(),
        isInterim: false,
      });

      // Generate TTS audio only if ElevenLabs is enabled (not in text-only mode)
      // BUG-001 FIX: Extra guard - never play TTS in consultant mode (disableLLM) even if other code paths
      // accidentally generate a response. This is a belt-and-suspenders check.
      if (!this.config?.disableLLM && !this.config?.disableElevenLabsTTS && this.elevenLabsTTS && this.audio) {
        try {
          // Clean all signal markers before TTS (STEP_COMPLETE, TOPICS_DISCOVERED, etc.)
          const ttsText = cleanAllSignalMarkers(llmResponse);

          // Set current assistant speech for echo detection (use cleaned text)
          this.audio.setCurrentAssistantSpeech(ttsText);

          const audioStream = await this.elevenLabsTTS.streamTextToSpeech(ttsText);
          const audioData = await this.audio.streamToUint8Array(audioStream);
          if (audioData) {
            this.onAudioCallback?.(audioData);
            await this.audio.playAudio(audioData).catch(err => {
              console.error('[Speechmatics] Error playing audio:', err);
            });
          }
        } catch (error) {
          console.error('[Speechmatics] Error generating TTS audio:', error);
          // Don't fail the whole message processing if TTS fails
        }
      }

      // DEDUPLICATION: Track the successfully processed message to prevent re-processing
      this.lastProcessedMessage = {
        content: this.lastSentUserMessage.trim().toLowerCase(),
        timestamp: Date.now(),
      };

      // BUG FIX: Don't clear lastSentUserMessage here if audio is still playing
      // The abort-on-continue logic needs it to detect if user adds new content during TTS
      // It will be cleared by handleAudioPlaybackEnd() when TTS finishes
      if (!this.audio?.isPlaying()) {
        this.lastSentUserMessage = '';
      }

      // Process queued messages
      if (this.userMessageQueue.length > 0) {
        const nextMessage = this.userMessageQueue.shift();
        if (nextMessage) {
          // Process next message (will reset isGeneratingResponse when done)
          await this.processUserMessage(nextMessage.content);
        } else {
          this.isGeneratingResponse = false;
          this.generationStartedAt = 0;
        }
      } else {
        this.isGeneratingResponse = false;
        this.generationStartedAt = 0;
      }
    } catch (error) {
      // Check if error was caused by user aborting (barge-in or continuation)
      if (error instanceof Error && error.name === 'AbortError') {
        // Don't treat abort as error - it's expected behavior
        this.isGeneratingResponse = false;
        this.generationStartedAt = 0;
        // Keep lastSentUserMessage if aborted due to continuation
        // (will be compared against new partials)
        if (!this.responseAbortedDueToUserContinuation) {
          this.lastSentUserMessage = '';
        }
        // NOTE: Don't process queue on abort - user is still speaking or interrupted
        // The new/complete message will arrive through normal flow
        return;
      }

      console.error('[Speechmatics] Error processing user message:', error);
      this.lastSentUserMessage = '';
      this.onErrorCallback?.(error instanceof Error ? error : new Error(String(error)));

      // CRITICAL: Even on error, try to process queued messages so we don't get stuck
      if (this.userMessageQueue.length > 0) {
        const nextMessage = this.userMessageQueue.shift();
        if (nextMessage) {
          // Reset flag before recursive call (it will be set to true again in processUserMessage)
          this.isGeneratingResponse = false;
          this.generationStartedAt = 0;
          // BUG-019 FIX: Use setTimeout with async/await and try-catch at callback level
          // This ensures both synchronous and asynchronous errors are caught
          setTimeout(async () => {
            try {
              await this.processUserMessage(nextMessage.content);
            } catch (err) {
              // BUG-019 FIX: Catch handles both sync and async errors
              console.error('[Speechmatics] Error processing queued message:', err);
            }
          }, 100);
        } else {
          this.isGeneratingResponse = false;
          this.generationStartedAt = 0;
        }
      } else {
        this.isGeneratingResponse = false;
        this.generationStartedAt = 0;
      }
    } finally {
      // Clear abort controller
      this.llmAbortController = null;
    }
  }

  async startMicrophone(deviceId?: string, voiceIsolation: boolean = true): Promise<void> {
    if (!this.websocket?.isConnected()) {
      throw new Error('Not connected to Speechmatics');
    }

    if (!this.audio) {
      throw new Error('Audio manager not initialized');
    }

    // Update audio with current WebSocket
    this.audio.updateWebSocket(this.websocket.getWebSocket());
    await this.audio.startMicrophone(deviceId, voiceIsolation);
  }

  setMicrophoneSensitivity(sensitivity: number): void {
    this.audio?.setMicrophoneSensitivity(sensitivity);
  }

  async stopMicrophone(): Promise<void> {
    await this.audio?.stopMicrophone();
  }

  async disconnect(): Promise<void> {
    if (this.disconnectPromise) {
      return this.disconnectPromise;
    }

    this.disconnectPromise = (async () => {
      // CRITICAL: Increment global token to invalidate any in-flight connect() attempts
      // This ensures orphaned connections will be aborted when they finish
      SpeechmaticsVoiceAgent.globalConnectionToken++;
      this.isDisconnected = true;

      // BUG-020 FIX: Always abort any pending LLM request on disconnect
      // This prevents stuck requests from holding resources or continuing after disconnect
      if (this.llmAbortController) {
        this.llmAbortController.abort();
        this.llmAbortController = null;
      }
      // Reset generation state to ensure clean slate
      this.isGeneratingResponse = false;
      this.generationStartedAt = 0;

      // CRITICAL: According to Speechmatics API docs:
      // 1. Stop sending audio FIRST (no AddAudio after EndOfStream)
      // 2. Send EndOfStream message
      // 3. Wait for server to process
      // 4. Close WebSocket

      if (this.audio) {
        // Stop microphone input completely - this stops all AddAudio messages
        this.audio.setMicrophoneMuted(true);
        try {
          await this.audio.stopMicrophone();
        } catch (error) {
          console.error('[Speechmatics] Error stopping microphone:', error);
        }

        // CRITICAL: Wait to ensure NO audio chunks are in flight
        // According to docs: "Protocol specification doesn't allow adding audio after EndOfStream"
        // We must ensure all audio has been sent before sending EndOfStream
        await new Promise(resolve => setTimeout(resolve, 800)); // Increased to ensure all chunks are processed
      }

      // Now disconnect WebSocket (this will send EndOfStream and close properly)
      // The WebSocket disconnect will:
      // 1. Send EndOfStream message (if connection is open)
      // 2. Wait for server to process
      // 3. Close WebSocket with code 1000
      // 4. Wait additional time for server to release session
      if (this.websocket) {
        await this.websocket.disconnect(this.isDisconnected);
      }

      // Cleanup transcription manager
      this.transcriptionManager?.cleanup();

      // Clear state
      this.conversationHistory = [];
      this.userMessageQueue = [];
      this.audioDedupe.reset();
      this.lastSentUserMessage = '';
      this.responseAbortedDueToUserContinuation = false;

      this.onConnectionCallback?.(false);

      // CRITICAL: Force browser to release any ghost microphone permissions
      // This must be called AFTER everything is disconnected (WebSocket + audio)
      // Wait a bit to ensure all resources are fully released before forcing cleanup
      await new Promise(resolve => setTimeout(resolve, 500)); // Small delay to ensure cleanup is complete

      if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        try {
          await navigator.mediaDevices.enumerateDevices();
        } catch (error) {
          // Ignore errors - this is just a cleanup trick
        }
      }
    })();

    try {
      await this.disconnectPromise;
    } finally {
      this.disconnectPromise = null;
    }
  }

  isConnected(): boolean {
    return this.websocket?.isConnected() || false;
  }

  setMicrophoneMuted(muted: boolean): void {
    this.audio?.setMicrophoneMuted(muted);
  }

  /**
   * Set text-only mode (disables TTS audio responses)
   * When enabled, the agent will only respond with text, no audio playback
   *
   * @param enabled - true to disable TTS (text-only mode), false to enable TTS (voice mode)
   */
  setTextOnlyMode(enabled: boolean): void {
    if (this.config) {
      this.config.disableElevenLabsTTS = enabled;
    }
  }

  /**
   * Get current text-only mode state
   *
   * @returns true if TTS is disabled (text-only mode), false if TTS is enabled
   */
  getTextOnlyMode(): boolean {
    return this.config?.disableElevenLabsTTS ?? false;
  }

  // ===== SPEAKER FILTERING METHODS =====

  /**
   * Add a speaker to the whitelist (allows multiple speakers)
   * @param speaker Speaker ID to allow (e.g., "S2")
   */
  addAllowedSpeaker(speaker: string): void {
    this.transcriptionManager?.addAllowedSpeaker(speaker);
  }

  /**
   * Set a new primary speaker (resets filtering and establishes new speaker)
   * @param speaker New primary speaker ID (e.g., "S2")
   */
  setPrimarySpeaker(speaker: string): void {
    this.transcriptionManager?.setPrimarySpeaker(speaker);
  }

  /**
   * Reset speaker filtering state (clears primary and whitelist)
   */
  resetSpeakerFiltering(): void {
    this.transcriptionManager?.resetSpeakerFiltering();
  }

  /**
   * Get the current primary speaker
   */
  getPrimarySpeaker(): string | undefined {
    return this.transcriptionManager?.getPrimarySpeaker();
  }

  /**
   * Extract the dominant speaker from Speechmatics results array
   * According to Speechmatics API docs, speaker is in alternatives[0].speaker (S1, S2, S3, UU for unknown)
   * Returns the most frequently occurring speaker in the transcript
   */
  private extractDominantSpeaker(results?: Array<{ alternatives?: Array<{ speaker?: string }> }>): string | undefined {
    if (!results || !Array.isArray(results) || results.length === 0) {
      return undefined;
    }

    // Count speaker occurrences
    const speakerCounts: Record<string, number> = {};
    for (const result of results) {
      // Speaker is in alternatives[0].speaker according to Speechmatics API docs
      const speaker = result.alternatives?.[0]?.speaker;
      if (speaker && speaker !== 'UU') { // Skip unknown speakers for counting
        speakerCounts[speaker] = (speakerCounts[speaker] || 0) + 1;
      }
    }

    // Find the most frequent speaker
    let dominantSpeaker: string | undefined;
    let maxCount = 0;
    for (const [speaker, count] of Object.entries(speakerCounts)) {
      if (count > maxCount) {
        maxCount = count;
        dominantSpeaker = speaker;
      }
    }

    // If no dominant speaker found but we have results with UU, return UU
    if (!dominantSpeaker && results.some(r => r.alternatives?.[0]?.speaker === 'UU')) {
      return 'UU';
    }

    return dominantSpeaker;
  }

  /**
   * Check if new transcript contains significant new content beyond what was already sent
   * Used to detect when user continues speaking after we started generating a response
   */
  private hasSignificantNewContent(newTranscript: string, sentMessage: string): boolean {
    // Normalize both for comparison
    const normalizeText = (text: string) => text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/[.,!?;:'"«»\-–—…()[\]{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const normalizedNew = normalizeText(newTranscript);
    const normalizedSent = normalizeText(sentMessage);

    // If new is shorter or same length, likely just a variation/repetition
    if (normalizedNew.length <= normalizedSent.length) {
      return false;
    }

    // Check if new content starts with sent content (continuation)
    if (normalizedNew.startsWith(normalizedSent)) {
      // Calculate new words added
      const newPortion = normalizedNew.substring(normalizedSent.length).trim();
      const newWords = newPortion.split(/\s+/).filter(w => w.length > 1);
      // Require at least 3 new words to consider it significant continuation
      if (newWords.length >= 3) {
        return true;
      }
    }

    // Check word-based: count new words not in sent message
    const sentWords = new Set(normalizedSent.split(/\s+/).filter(w => w.length > 1));
    const newWords = normalizedNew.split(/\s+/).filter(w => w.length > 1);
    const genuinelyNewWords = newWords.filter(w => !sentWords.has(w));

    // If 3+ genuinely new words, user is continuing
    if (genuinelyNewWords.length >= 3) {
      return true;
    }

    return false;
  }

  /**
   * Handle echo detection - discard pending transcript and notify UI
   * Called when the audio module detects that the transcribed audio is actually
   * TTS playback being picked up by the microphone (not real user speech)
   *
   * BUG-008 FIX: Now accepts echo details and notifies the UI via message callback
   */
  private handleEchoDetected(details?: { transcript: string; matchType: string; similarity: number }): void {
    // Discard any pending transcript in the transcription manager
    // This prevents sending echo as user input to the LLM
    this.transcriptionManager?.discardPendingTranscript();

    // BUG-008 FIX: Notify UI about echo detection so it can provide feedback
    // Send a special interim message to clear any displayed user input
    if (details) {
      console.log('[Speechmatics] 🔇 Echo detected:', {
        matchType: details.matchType,
        similarity: details.similarity.toFixed(2),
        transcriptPreview: details.transcript.substring(0, 50) + (details.transcript.length > 50 ? '...' : ''),
      });

      // Clear any interim user message that was showing the echo
      this.onMessageCallback?.({
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
   * Clears lastSentUserMessage since agent is no longer responding
   */
  private handleAudioPlaybackEnd(): void {
    // Clear lastSentUserMessage since agent is done responding
    // This allows abort-on-continue to work only while agent is actively responding
    this.lastSentUserMessage = '';
    // Notify external callback (for inactivity timer)
    this.onAudioPlaybackEndCallback?.();
  }

  /**
   * Abort current assistant response (called when user interrupts)
   * Stops ElevenLabs playback, clears assistant interim message, and cancels in-flight LLM request
   */
  abortResponse(): void {

    // Stop ElevenLabs TTS playback
    if (this.audio) {
      this.audio.stopAgentSpeech();
    }

    // Cancel in-flight LLM request
    if (this.llmAbortController) {
      this.llmAbortController.abort();
      this.llmAbortController = null;
    }

    // Clear assistant interim message via callback
    this.onMessageCallback?.({
      role: 'agent',
      content: '',
      timestamp: new Date().toISOString(),
      isInterim: true,
      messageId: `abort-${Date.now()}`,
    });

    // Reset generation state
    this.isGeneratingResponse = false;
    this.receivedPartialDuringGeneration = false;
  }

  /**
   * Update prompts dynamically without reconnecting
   * Call this when the conversation step changes to update system prompt with new variables
   *
   * @param prompts - New prompts and variables to use for subsequent LLM calls
   */
  updatePrompts(prompts: {
    systemPrompt?: string;
    userPrompt?: string;
    promptVariables?: Record<string, string | null | undefined>;
  }): void {
    if (!this.config) {
      return;
    }

    if (prompts.systemPrompt !== undefined) {
      this.config.systemPrompt = prompts.systemPrompt;
    }

    if (prompts.userPrompt !== undefined) {
      this.config.userPrompt = prompts.userPrompt;
    }

    if (prompts.promptVariables !== undefined) {
      this.config.promptVariables = prompts.promptVariables;
    }
  }

  /**
   * Get the current step ID from prompt variables
   * Useful for detecting step changes
   */
  getCurrentStepId(): string | null {
    return this.config?.promptVariables?.current_step_id as string | null ?? null;
  }

  /**
   * Speak an initial/welcome message via TTS
   * Used to greet the user when starting a voice session with no existing messages
   *
   * @param text - The message text to speak
   */
  async speakInitialMessage(text: string): Promise<void> {
    if (!text?.trim()) {
      console.warn('[Speechmatics] speakInitialMessage: empty text, skipping');
      return;
    }

    // Skip if TTS is disabled
    if (this.config?.disableElevenLabsTTS || !this.elevenLabsTTS || !this.audio) {
      console.log('[Speechmatics] speakInitialMessage: TTS disabled, skipping audio playback');
      // Still emit the message for display
      this.onMessageCallback?.({
        role: 'agent',
        content: text,
        timestamp: new Date().toISOString(),
        isInterim: false,
        messageId: `initial-${Date.now()}`,
      });
      return;
    }

    console.log('[Speechmatics] 🎤 Speaking initial message:', text.substring(0, 50) + '...');

    try {
      // Add to conversation history
      this.conversationHistory.push({
        role: 'agent',
        content: text,
      });

      // NOTE: Do NOT emit onMessageCallback here!
      // The initial message is already managed by the caller (either created via /respond endpoint
      // and returned in the API response, or already exists in the messages prop).
      // Emitting the callback would cause handleVoiceMessage to add a duplicate and persist again.
      // This method only handles: 1) adding to conversation history for LLM context, 2) playing TTS

      // Clean all signal markers before TTS (STEP_COMPLETE, TOPICS_DISCOVERED, etc.)
      const ttsText = cleanAllSignalMarkers(text);

      // Set current assistant speech for echo detection
      this.audio.setCurrentAssistantSpeech(ttsText);

      // Generate and play TTS audio
      const audioStream = await this.elevenLabsTTS.streamTextToSpeech(ttsText);
      const audioData = await this.audio.streamToUint8Array(audioStream);
      if (audioData) {
        this.onAudioCallback?.(audioData);
        await this.audio.playAudio(audioData).catch(err => {
          console.error('[Speechmatics] Error playing initial message audio:', err);
        });
      }

      console.log('[Speechmatics] ✅ Initial message spoken successfully');
    } catch (error) {
      console.error('[Speechmatics] Error speaking initial message:', error);
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
      console.warn('[Speechmatics] injectUserMessageAndRespond: empty text, skipping');
      return;
    }

    console.log('[Speechmatics] 📝 Injecting edited message and triggering response:', text.substring(0, 50) + '...');

    try {
      await this.processUserMessage(text);
    } catch (error) {
      console.error('[Speechmatics] Error processing injected message:', error);
      this.onErrorCallback?.(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
