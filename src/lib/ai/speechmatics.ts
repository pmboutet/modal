/**
 * SpeechmaticsVoiceAgent - Agent vocal utilisant Speechmatics STT + LLM + ElevenLabs TTS
 *
 * Architecture modulaire :
 * - SpeechmaticsAuth : Gestion de l'authentification Speechmatics et ElevenLabs
 * - SpeechmaticsWebSocket : Gestion de la connexion WebSocket et des messages
 * - SpeechmaticsAudio : Capture et envoi de l'audio du microphone
 * - AudioChunkDedupe : Deduplication des chunks audio pour eviter les doublons
 * - TranscriptionManager : Gestion des transcriptions partielles et finales
 * - SpeechmaticsLLM : Appels au LLM (Anthropic/OpenAI) pour generer les reponses
 * - ElevenLabsTTS : Synthese vocale pour les reponses de l'agent
 * - SpeechmaticsConnection : Logique de connexion/deconnexion (extraction)
 * - SpeechmaticsMessageHandler : Traitement des messages WebSocket (extraction)
 * - SpeechmaticsMessageProcessor : Traitement des messages utilisateur (extraction)
 *
 * Flux de traitement :
 * 1. Audio du microphone -> Speechmatics STT (transcription en temps reel)
 * 2. Transcription finale -> LLM (generation de reponse)
 * 3. Reponse LLM -> ElevenLabs TTS (synthese vocale)
 * 4. Audio TTS -> Lecture dans le navigateur
 *
 * Ce fichier a ete refactorise pour utiliser des composants modulaires
 * afin d'ameliorer la maintenabilite et la testabilite.
 */

import { ElevenLabsTTS } from './elevenlabs';
import { SpeechmaticsAuth } from './speechmatics-auth';
import { AudioChunkDedupe } from './speechmatics-audio-dedupe';
import { TranscriptionManager } from './speechmatics-transcription';
import { SpeechmaticsWebSocket } from './speechmatics-websocket';
import { SpeechmaticsAudio } from './speechmatics-audio';
import { SpeechmaticsLLM } from './speechmatics-llm';
import type {
  SemanticTurnDetector,
  SemanticTurnTelemetryEvent,
} from './turn-detection';
import type { SemanticTurnDetectorConfig } from './turn-detection-config';
import { SpeechmaticsStateMachine } from './speechmatics-state-machine';
import { SpeechmaticsResponseHandler, type EchoDetails } from './speechmatics-response-handler';
import {
  establishConnection,
  performDisconnect,
  incrementGlobalConnectionToken,
} from './speechmatics-connection';
import {
  handleWebSocketMessage as handleWebSocketMessageFn,
  type MessageHandlerDeps,
} from './speechmatics-message-handler';
import {
  processUserMessage as processUserMessageFn,
  type MessageProcessorDeps,
} from './speechmatics-message-processor';

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
 * Coordonne tous les modules pour fournir une experience vocale complete :
 * - Connexion WebSocket a Speechmatics
 * - Capture audio du microphone
 * - Transcription en temps reel
 * - Generation de reponses via LLM
 * - Synthese vocale avec ElevenLabs
 */
export class SpeechmaticsVoiceAgent {
  // ===== MODULES CORE =====
  private auth: SpeechmaticsAuth;
  private audioDedupe: AudioChunkDedupe;
  private transcriptionManager: TranscriptionManager | null = null;
  private websocket: SpeechmaticsWebSocket | null = null;
  private audio: SpeechmaticsAudio | null = null;
  private llm: SpeechmaticsLLM;
  private elevenLabsTTS: ElevenLabsTTS | null = null;

  // ===== CONFIGURATION ET ETAT =====
  private config: SpeechmaticsConfig | null = null;
  private disconnectPromise: Promise<void> | null = null;
  private myConnectionToken: number = 0;
  private semanticTurnConfig: SemanticTurnDetectorConfig | null = null;
  private semanticTurnDetector: SemanticTurnDetector | null = null;
  private llmAbortController: AbortController | null = null;
  private stateMachine: SpeechmaticsStateMachine;
  private responseHandler: SpeechmaticsResponseHandler;

  // ===== CALLBACKS =====
  private onMessageCallback: SpeechmaticsMessageCallback | null = null;
  private onErrorCallback: SpeechmaticsErrorCallback | null = null;
  private onConnectionCallback: SpeechmaticsConnectionCallback | null = null;
  private onAudioCallback: SpeechmaticsAudioCallback | null = null;
  private onSemanticTurnCallback: ((event: SemanticTurnTelemetryEvent) => void) | null = null;
  private onAudioPlaybackEndCallback: (() => void) | null = null;

  /**
   * Constructeur - Initialise les modules core
   */
  constructor() {
    this.auth = new SpeechmaticsAuth();
    this.audioDedupe = new AudioChunkDedupe();
    this.llm = new SpeechmaticsLLM();
    this.stateMachine = new SpeechmaticsStateMachine();

    // Initialize response handler with dependencies
    const self = this;
    this.responseHandler = new SpeechmaticsResponseHandler({
      getAudio: () => self.audio,
      getTTS: () => self.elevenLabsTTS,
      getConfig: () => self.config,
      getTranscriptionManager: () => self.transcriptionManager,
      get onMessageCallback() { return self.onMessageCallback; },
      get onAudioCallback() { return self.onAudioCallback; },
      get onErrorCallback() { return self.onErrorCallback; },
      get onAudioPlaybackEndCallback() { return self.onAudioPlaybackEndCallback; },
      stateMachine: self.stateMachine,
      processUserMessage: (msg: string) => self.processUserMessage(msg),
      addAgentMessageToHistory: (content: string) => {
        self.stateMachine.addAgentMessage(content);
      },
    });
  }

  /**
   * Configure les callbacks pour recevoir les evenements
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
   * Etablit la connexion a Speechmatics et initialise tous les modules
   */
  async connect(config: SpeechmaticsConfig): Promise<void> {
    this.myConnectionToken = incrementGlobalConnectionToken();
    this.config = config;

    const result = await establishConnection(
      config,
      {
        auth: this.auth,
        audioDedupe: this.audioDedupe,
        stateMachine: this.stateMachine,
        onMessageCallback: this.onMessageCallback,
        onErrorCallback: this.onErrorCallback,
        onConnectionCallback: this.onConnectionCallback,
        onSemanticTurnCallback: this.onSemanticTurnCallback,
        handleWebSocketMessage: (data: unknown) => this.handleWebSocketMessage(data),
        processUserMessage: (transcript: string) => this.processUserMessage(transcript),
        abortResponse: () => this.abortResponse(),
        handleAudioPlaybackEnd: () => this.handleAudioPlaybackEnd(),
        handleEchoDetected: (details?: EchoDetails) => this.handleEchoDetected(details),
      },
      this.disconnectPromise,
      this.myConnectionToken
    );

    // Connection was invalidated or disconnected during setup
    if (!result) {
      return;
    }

    // Store the initialized modules
    this.websocket = result.websocket;
    this.audio = result.audio;
    this.transcriptionManager = result.transcriptionManager;
    this.elevenLabsTTS = result.elevenLabsTTS;
    this.semanticTurnConfig = result.semanticTurnConfig;
    this.semanticTurnDetector = result.semanticTurnDetector;
  }

  private handleWebSocketMessage(data: unknown): void {
    const deps: MessageHandlerDeps = {
      getWebSocket: () => this.websocket,
      getAudio: () => this.audio,
      getTranscriptionManager: () => this.transcriptionManager,
      stateMachine: this.stateMachine,
      onErrorCallback: this.onErrorCallback,
      abortResponse: () => this.abortResponse(),
      disconnect: () => this.disconnect(),
    };
    handleWebSocketMessageFn(data as Parameters<typeof handleWebSocketMessageFn>[0], deps);
  }

  private async processUserMessage(transcript: string): Promise<void> {
    const deps: MessageProcessorDeps = {
      getConfig: () => this.config,
      getAudio: () => this.audio,
      getTTS: () => this.elevenLabsTTS,
      stateMachine: this.stateMachine,
      llm: this.llm,
      getLlmAbortController: () => this.llmAbortController,
      setLlmAbortController: (controller) => { this.llmAbortController = controller; },
      onMessageCallback: this.onMessageCallback,
      onErrorCallback: this.onErrorCallback,
      onAudioCallback: this.onAudioCallback,
    };
    await processUserMessageFn(transcript, deps);
  }

  async startMicrophone(deviceId?: string, voiceIsolation: boolean = true): Promise<void> {
    if (!this.websocket?.isConnected()) {
      throw new Error('Not connected to Speechmatics');
    }

    if (!this.audio) {
      throw new Error('Audio manager not initialized');
    }

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
      await performDisconnect({
        stateMachine: this.stateMachine,
        onConnectionCallback: this.onConnectionCallback,
        audio: this.audio,
        websocket: this.websocket,
        transcriptionManager: this.transcriptionManager,
        audioDedupe: this.audioDedupe,
        abortLlmRequest: () => {
          if (this.llmAbortController) {
            this.llmAbortController.abort();
            this.llmAbortController = null;
          }
        },
      });

      // Clear module references
      this.transcriptionManager = null;
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
   * Check if TTS audio is currently playing
   */
  isAudioPlaying(): boolean {
    return this.audio?.isPlaying() || false;
  }

  /**
   * Set text-only mode (disables TTS audio responses)
   */
  setTextOnlyMode(enabled: boolean): void {
    if (this.config) {
      this.config.disableElevenLabsTTS = enabled;
    }
  }

  /**
   * Get current text-only mode state
   */
  getTextOnlyMode(): boolean {
    return this.config?.disableElevenLabsTTS ?? false;
  }

  // ===== SPEAKER FILTERING METHODS =====

  addAllowedSpeaker(speaker: string): void {
    this.transcriptionManager?.addAllowedSpeaker(speaker);
  }

  setPrimarySpeaker(speaker: string): void {
    this.transcriptionManager?.setPrimarySpeaker(speaker);
  }

  resetSpeakerFiltering(): void {
    this.transcriptionManager?.resetSpeakerFiltering();
  }

  getPrimarySpeaker(): string | undefined {
    return this.transcriptionManager?.getPrimarySpeaker();
  }

  isAwaitingSpeakerConfirmation(): boolean {
    return this.transcriptionManager?.isAwaitingSpeakerConfirmation() || false;
  }

  confirmCandidateSpeaker(): void {
    this.transcriptionManager?.confirmCandidateSpeaker();
  }

  rejectCandidateSpeaker(): void {
    this.transcriptionManager?.rejectCandidateSpeaker();
  }

  /**
   * Handle echo detection - delegates to response handler
   */
  private handleEchoDetected(details?: EchoDetails): void {
    this.responseHandler.handleEchoDetected(details);
  }

  /**
   * Handle audio playback end - delegates to response handler
   */
  private handleAudioPlaybackEnd(): void {
    this.responseHandler.handleAudioPlaybackEnd();
  }

  /**
   * Abort current assistant response (called when user interrupts)
   */
  abortResponse(): void {
    this.stateMachine.transition({ type: 'ABORT' });

    if (this.audio) {
      this.audio.stopAgentSpeech();
    }

    if (this.llmAbortController) {
      this.llmAbortController.abort();
      this.llmAbortController = null;
    }

    this.onMessageCallback?.({
      role: 'agent',
      content: '',
      timestamp: new Date().toISOString(),
      isInterim: true,
      messageId: `abort-${Date.now()}`,
    });
  }

  /**
   * Update prompts dynamically without reconnecting
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
   */
  getCurrentStepId(): string | null {
    return this.config?.promptVariables?.current_step_id as string | null ?? null;
  }

  /**
   * Speak an initial/welcome message via TTS
   */
  async speakInitialMessage(text: string): Promise<void> {
    return this.responseHandler.speakInitialMessage(text);
  }

  /**
   * Inject a text message and trigger AI response
   */
  async injectUserMessageAndRespond(text: string): Promise<void> {
    return this.responseHandler.injectUserMessageAndRespond(text);
  }
}
