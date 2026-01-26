/**
 * TranscriptionManager - Gestionnaire de transcription pour Speechmatics Voice Agent
 *
 * Ce module gère la logique de traitement des transcriptions avec déduplication
 * basée sur les timestamps (start_time/end_time) fournis par Speechmatics.
 *
 * Architecture simplifiée :
 * - SegmentStore : stockage des segments par intervalle temporel
 * - Déduplication temporelle : un final remplace tous les partials qui chevauchent
 * - Détection de silence : finalise le message après X ms sans nouvelles transcriptions
 * - Détection sémantique optionnelle : utilise Mistral pour détecter la fin de tour
 *
 * Cette version remplace ~235 lignes d'heuristiques textuelles par ~50 lignes
 * de logique temporelle déterministe.
 */

import { devLog, devError } from '@/lib/utils';
import type { SpeechmaticsMessageCallback } from './speechmatics-types';
import { SegmentStore } from './speechmatics-segment-store';
import type {
  SemanticTurnDecision,
  SemanticTurnDecisionOptions,
  SemanticTurnMessage,
  SemanticTurnTelemetryEvent,
  SemanticTurnTrigger,
} from './turn-detection';

type SemanticSupportOptions = SemanticTurnDecisionOptions & {
  telemetry?: (event: SemanticTurnTelemetryEvent) => void;
};

/**
 * Classe principale pour la gestion des transcriptions
 *
 * Utilise le SegmentStore pour stocker les segments par timestamps.
 * La déduplication est gérée par la logique temporelle :
 * - Les partials remplacent les partials avec le même intervalle
 * - Les finals suppriment tous les partials qui chevauchent leur intervalle
 */
export class TranscriptionManager {
  // ===== SEGMENT STORE =====
  private segmentStore: SegmentStore = new SegmentStore();

  // ===== ÉTATS DE SUIVI =====
  private pendingFinalTranscript: string | null = null;
  private currentStreamingMessageId: string | null = null;
  private lastProcessedContent: string | null = null;
  private contentBeingProcessed: string | null = null; // BUG FIX: Track content currently being processed to prevent duplicates
  private processingLock: boolean = false; // Mutex to prevent concurrent processPendingTranscript calls
  private silenceTimeout: NodeJS.Timeout | null = null;
  private receivedEndOfUtterance: boolean = false;
  private utteranceDebounceTimeout: NodeJS.Timeout | null = null;
  private lastPreviewContent: string | null = null;
  private lastPartialUpdateTimestamp: number = 0;
  private currentSpeaker: string | undefined = undefined;

  // ===== SPEAKER FILTERING (individual mode) =====
  private speakerFilteringEnabled: boolean = false;
  private requireSpeakerConfirmation: boolean = false; // If true, require user confirmation before establishing speaker
  private candidateSpeaker: string | undefined = undefined; // Speaker awaiting confirmation
  private candidateConfirmationCount: number = 0; // Track how many transcripts from candidate speaker
  private awaitingSpeakerConfirmation: boolean = false; // True when waiting for user to confirm speaker
  private rejectedSpeakers: Set<string> = new Set(); // Speakers the user said "not me"
  private primarySpeaker: string | undefined = undefined; // Confirmed primary speaker (2 consecutive)
  private allowedSpeakers: Set<string> = new Set(); // Whitelist of allowed speakers
  private lastAllowedSpeakerPartialAt: number = 0; // Timestamp of last partial from allowed speaker (for safety net)
  private onSpeakerEstablished?: (speaker: string) => void;
  private onSpeakerFiltered?: (speaker: string, transcript: string) => void;
  private onSpeakerPendingConfirmation?: (speaker: string, recentTranscript: string) => void;

  // Gestion de la détection sémantique des fins de tour
  private semanticHoldTimeout: NodeJS.Timeout | null = null;
  private semanticHoldStartedAt: number | null = null;
  private semanticEvaluationInFlight: boolean = false;
  private pendingSemanticTrigger: SemanticTurnTrigger | null = null;

  // ===== CONSTANTES DE CONFIGURATION =====
  // Silence timeout is now just a fallback - primary trigger is EndOfUtterance from Speechmatics VAD
  private readonly SILENCE_DETECTION_TIMEOUT = 2000; // 2s fallback (reduced from 3s)
  private readonly SILENCE_DETECTION_TIMEOUT_NO_PARTIALS = 2000; // 2s fallback (reduced from 5s)
  private readonly UTTERANCE_FINALIZATION_DELAY = 300; // 300ms debounce after EndOfUtterance (reduced from 800ms)
  private readonly MIN_PARTIAL_UPDATE_INTERVAL_MS = 100; // 100ms rate limit
  private readonly MIN_UTTERANCE_CHAR_LENGTH = 20;
  private readonly MIN_UTTERANCE_WORDS = 3;

  // Mots français qui indiquent qu'un fragment n'est pas complet
  private readonly FRAGMENT_ENDINGS = new Set([
    'et', 'de', 'des', 'du', 'd\'', 'si', 'que', 'qu', 'le', 'la', 'les',
    'nous', 'vous', 'je', 'tu', 'il', 'elle', 'on', 'mais', 'ou', 'donc',
    'or', 'ni', 'car', 'à', 'en', 'pour', 'sur', 'avec'
  ]);

  constructor(
    private onMessageCallback: SpeechmaticsMessageCallback | null,
    private processUserMessage: (transcript: string) => Promise<void>,
    private conversationHistory: Array<{ role: 'user' | 'agent'; content: string }>,
    private enablePartials: boolean = true,
    private semanticOptions?: SemanticSupportOptions,
    filteringConfig?: {
      enabled: boolean;
      requireConfirmation?: boolean; // If true, show confirmation overlay before establishing speaker
      onSpeakerEstablished?: (speaker: string) => void;
      onSpeakerFiltered?: (speaker: string, transcript: string) => void;
      onSpeakerPendingConfirmation?: (speaker: string, recentTranscript: string) => void;
    }
  ) {
    if (filteringConfig) {
      this.speakerFilteringEnabled = filteringConfig.enabled;
      this.requireSpeakerConfirmation = filteringConfig.requireConfirmation || false;
      this.onSpeakerEstablished = filteringConfig.onSpeakerEstablished;
      this.onSpeakerFiltered = filteringConfig.onSpeakerFiltered;
      this.onSpeakerPendingConfirmation = filteringConfig.onSpeakerPendingConfirmation;
    }
  }

  // ===== PUBLIC METHODS =====

  /**
   * Handle partial transcript from Speechmatics
   * @param transcript - The partial transcript text
   * @param startTime - Start time in seconds from audio start
   * @param endTime - End time in seconds from audio start
   * @param speaker - Optional speaker identifier from diarization
   */
  handlePartialTranscript(
    transcript: string,
    startTime: number,
    endTime: number,
    speaker?: string
  ): void {
    if (!transcript || !transcript.trim()) return;

    const trimmedTranscript = transcript.trim();

    // Cancel any pending finalization when user continues speaking
    this.cancelUtteranceDebounce();
    this.clearSemanticHold();

    // Speaker change detection: finalize previous speaker's message
    if (speaker && this.currentSpeaker && speaker !== this.currentSpeaker && this.segmentStore.hasSegments()) {
      void this.processPendingTranscript(true, false);
    }

    // Update current speaker
    if (speaker) {
      this.currentSpeaker = speaker;
    }

    // Speaker filtering for individual mode (2 consecutive transcripts from same speaker)
    if (this.speakerFilteringEnabled && speaker) {
      // Skip unknown speakers entirely
      if (speaker === 'UU') {
        return;
      }

      // Filter previously rejected speakers (user said "not me")
      if (this.rejectedSpeakers.has(speaker)) {
        console.log(`[Transcription] Filtering rejected speaker ${speaker}`);
        this.onSpeakerFiltered?.(speaker, trimmedTranscript);
        return;
      }

      // If waiting for speaker confirmation, buffer transcripts but don't process yet
      if (this.awaitingSpeakerConfirmation) {
        // Only buffer if it's from the candidate speaker
        if (speaker === this.candidateSpeaker) {
          // Continue to buffer - segments will be processed when confirmed
          devLog(`[Transcription] Buffering transcript while awaiting confirmation: ${trimmedTranscript}`);
        } else {
          // Different speaker while waiting - ignore
          devLog(`[Transcription] Ignoring speaker ${speaker} while awaiting confirmation for ${this.candidateSpeaker}`);
          return;
        }
      }

      // Establishment phase: need 2 consecutive transcripts from same speaker
      if (!this.primarySpeaker && !this.awaitingSpeakerConfirmation) {
        if (speaker === this.candidateSpeaker) {
          // Same speaker twice in a row
          this.candidateConfirmationCount++;

          if (this.requireSpeakerConfirmation) {
            // Require user confirmation before establishing
            if (this.candidateConfirmationCount >= 2 && !this.awaitingSpeakerConfirmation) {
              this.awaitingSpeakerConfirmation = true;
              console.log(`[Transcription] Speaker ${speaker} needs confirmation`);
              this.onSpeakerPendingConfirmation?.(speaker, trimmedTranscript);
              // Continue processing - transcripts will be buffered
            }
          } else {
            // Auto-establish after 2 consecutive (original behavior)
            if (this.candidateConfirmationCount >= 2) {
              this.primarySpeaker = speaker;
              console.log(`[Transcription] Primary speaker established: ${this.primarySpeaker}`);
              this.onSpeakerEstablished?.(this.primarySpeaker);
            }
          }
        } else {
          // Different speaker → reset candidate
          this.candidateSpeaker = speaker;
          this.candidateConfirmationCount = 1;
        }
        // Don't filter during establishment - process normally
      } else if (this.primarySpeaker && speaker !== this.primarySpeaker && !this.allowedSpeakers.has(speaker)) {
        // Filter non-primary speakers (unless in whitelist) after establishment
        console.log(`[Transcription] Filtering speaker ${speaker} (primary: ${this.primarySpeaker})`);
        this.onSpeakerFiltered?.(speaker, trimmedTranscript);

        // SAFETY NET: In noisy environments, filtered speakers may keep sending partials
        // while the allowed speaker has stopped. Force process if silence timeout exceeded.
        if (this.shouldTriggerFilteredSpeakerSafetyNet()) {
          devLog('[Transcription] Filtered speaker safety net triggered - forcing pending transcript');
          void this.processPendingTranscript(true, true);
        }

        return;
      }
    }

    // Track timestamp for allowed speaker (used by filtered speaker safety net)
    this.lastAllowedSpeakerPartialAt = Date.now();

    // Store segment in the segment store (handles deduplication by timestamp)
    this.segmentStore.upsert({
      startTime,
      endTime,
      transcript: trimmedTranscript,
      isFinal: false,
      speaker,
      receivedAt: Date.now(),
    });

    // Update pending transcript from segment store
    this.pendingFinalTranscript = this.segmentStore.getFullTranscript();

    // Ensure we have a streaming message id for optimistic updates
    if (!this.currentStreamingMessageId) {
      this.currentStreamingMessageId = `stream-${Date.now()}`;
    }

    // Reset silence timeout
    this.resetSilenceTimeout();

    // Send interim message if partials are enabled (with rate limiting)
    if (this.enablePartials) {
      this.emitInterimMessage(this.pendingFinalTranscript);
    }
  }

  /**
   * Handle final transcript from Speechmatics
   * @param transcript - The final transcript text
   * @param startTime - Start time in seconds from audio start
   * @param endTime - End time in seconds from audio start
   * @param speaker - Optional speaker identifier from diarization
   */
  handleFinalTranscript(
    transcript: string,
    startTime: number,
    endTime: number,
    speaker?: string
  ): void {
    if (!transcript || !transcript.trim()) return;

    const trimmedTranscript = transcript.trim();
    this.clearSemanticHold();

    // Skip if this is the same as what we just processed
    if (trimmedTranscript === this.lastProcessedContent) {
      return;
    }

    // Speaker change detection: finalize previous speaker's message
    if (speaker && this.currentSpeaker && speaker !== this.currentSpeaker && this.segmentStore.hasSegments()) {
      void this.processPendingTranscript(true, false);
    }

    // Update current speaker
    if (speaker) {
      this.currentSpeaker = speaker;
    }

    // Speaker filtering for individual mode (2 consecutive transcripts from same speaker)
    if (this.speakerFilteringEnabled && speaker) {
      // Skip unknown speakers entirely
      if (speaker === 'UU') {
        return;
      }

      // Filter previously rejected speakers (user said "not me")
      if (this.rejectedSpeakers.has(speaker)) {
        console.log(`[Transcription] Filtering rejected speaker ${speaker}`);
        this.onSpeakerFiltered?.(speaker, trimmedTranscript);
        return;
      }

      // If waiting for speaker confirmation, buffer transcripts but don't process yet
      if (this.awaitingSpeakerConfirmation) {
        // Only buffer if it's from the candidate speaker
        if (speaker === this.candidateSpeaker) {
          // Continue to buffer - segments will be processed when confirmed
          devLog(`[Transcription] Buffering final transcript while awaiting confirmation: ${trimmedTranscript}`);
        } else {
          // Different speaker while waiting - ignore
          devLog(`[Transcription] Ignoring speaker ${speaker} while awaiting confirmation for ${this.candidateSpeaker}`);
          return;
        }
      }

      // Establishment phase: need 2 consecutive transcripts from same speaker
      if (!this.primarySpeaker && !this.awaitingSpeakerConfirmation) {
        if (speaker === this.candidateSpeaker) {
          // Same speaker twice in a row
          this.candidateConfirmationCount++;

          if (this.requireSpeakerConfirmation) {
            // Require user confirmation before establishing
            if (this.candidateConfirmationCount >= 2 && !this.awaitingSpeakerConfirmation) {
              this.awaitingSpeakerConfirmation = true;
              console.log(`[Transcription] Speaker ${speaker} needs confirmation`);
              this.onSpeakerPendingConfirmation?.(speaker, trimmedTranscript);
              // Continue processing - transcripts will be buffered
            }
          } else {
            // Auto-establish after 2 consecutive (original behavior)
            if (this.candidateConfirmationCount >= 2) {
              this.primarySpeaker = speaker;
              console.log(`[Transcription] Primary speaker established: ${this.primarySpeaker}`);
              this.onSpeakerEstablished?.(this.primarySpeaker);
            }
          }
        } else {
          // Different speaker → reset candidate
          this.candidateSpeaker = speaker;
          this.candidateConfirmationCount = 1;
        }
        // Don't filter during establishment - process normally
      } else if (this.primarySpeaker && speaker !== this.primarySpeaker && !this.allowedSpeakers.has(speaker)) {
        // Filter non-primary speakers (unless in whitelist) after establishment
        console.log(`[Transcription] Filtering speaker ${speaker} (primary: ${this.primarySpeaker})`);
        this.onSpeakerFiltered?.(speaker, trimmedTranscript);

        // SAFETY NET: In noisy environments, filtered speakers may keep sending partials
        // while the allowed speaker has stopped. Force process if silence timeout exceeded.
        if (this.shouldTriggerFilteredSpeakerSafetyNet()) {
          devLog('[Transcription] Filtered speaker safety net triggered - forcing pending transcript');
          void this.processPendingTranscript(true, true);
        }

        return;
      }
    }

    // Track timestamp for allowed speaker (used by filtered speaker safety net)
    this.lastAllowedSpeakerPartialAt = Date.now();

    // Store as final (automatically removes overlapping partials)
    this.segmentStore.upsert({
      startTime,
      endTime,
      transcript: trimmedTranscript,
      isFinal: true,
      speaker,
      receivedAt: Date.now(),
    });

    // Update pending transcript from segment store
    this.pendingFinalTranscript = this.segmentStore.getFullTranscript();

    // Ensure we have a streaming message id
    if (!this.currentStreamingMessageId) {
      this.currentStreamingMessageId = `stream-${Date.now()}`;
    }

    this.resetSilenceTimeout();
    this.scheduleUtteranceFinalization();
  }

  /**
   * Mark that EndOfUtterance was received from Speechmatics
   * This is the PRIMARY trigger for processing - Speechmatics VAD already detected ~700ms of silence
   * We add a short debounce (300ms) to catch any final words, then process immediately
   */
  markEndOfUtterance(): void {
    this.receivedEndOfUtterance = true;
    // Trigger processing with a short debounce (instead of waiting for long silence timeout)
    // This makes the conversation much more responsive
    this.scheduleUtteranceFinalization();
  }

  /**
   * Reset silence timeout - called when new transcript is received
   */
  resetSilenceTimeout(): void {
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }

    if (this.pendingFinalTranscript && this.pendingFinalTranscript.trim()) {
      const timeoutDuration = this.enablePartials
        ? this.SILENCE_DETECTION_TIMEOUT
        : this.SILENCE_DETECTION_TIMEOUT_NO_PARTIALS;

      this.silenceTimeout = setTimeout(() => {
        this.handleSilenceTimeout();
      }, timeoutDuration);
    }
  }

  /**
   * Process pending transcript when silence is detected
   */
  async processPendingTranscript(force: boolean = false, absoluteFailsafe: boolean = false): Promise<void> {
    // Mutex lock to prevent concurrent processing
    // This prevents duplicate LLM calls when processPendingTranscript is triggered by
    // multiple events in quick succession (e.g., speaker change + EndOfUtterance)
    if (this.processingLock) {
      devLog('[Transcription] Skipping processPendingTranscript - already processing');
      return;
    }
    this.processingLock = true;

    try {
      // BUG-039 FIX: Skip processing if awaiting speaker confirmation
      // This prevents the AI from responding to its own echo while the user
      // is confirming their identity in individual voice mode
      if (this.awaitingSpeakerConfirmation) {
        devLog('[Transcription] Skipping processPendingTranscript - awaiting speaker confirmation');
        return;
      }

      // Clear timeouts
      if (this.silenceTimeout) {
        clearTimeout(this.silenceTimeout);
        this.silenceTimeout = null;
      }
      if (this.utteranceDebounceTimeout) {
        clearTimeout(this.utteranceDebounceTimeout);
        this.utteranceDebounceTimeout = null;
      }
      this.clearSemanticHold();
      this.receivedEndOfUtterance = false;

      // Process pending transcript
      if (this.pendingFinalTranscript && this.pendingFinalTranscript.trim()) {
        const finalMessage = this.cleanTranscript(this.pendingFinalTranscript.trim());

        if (!this.isUtteranceComplete(finalMessage, force, absoluteFailsafe)) {
          // Not enough content yet
          this.pendingFinalTranscript = finalMessage;
          if (!force && !absoluteFailsafe) {
            this.resetSilenceTimeout();
            return;
          } else if (!absoluteFailsafe) {
            this.resetSilenceTimeout();
            return;
          }
          // absoluteFailsafe = true: send anyway
        }

        // Skip if same as last processed message
        if (finalMessage === this.lastProcessedContent) {
          this.clearState();
          return;
        }

        // BUG FIX: Skip if this content is currently being processed (race condition prevention)
        // This prevents duplicate messages when processPendingTranscript is called multiple times
        // in quick succession (e.g., speaker change + EndOfUtterance arriving close together)
        if (finalMessage === this.contentBeingProcessed) {
          this.clearState();
          return;
        }

        // Skip if too short
        if (finalMessage.length < 2) {
          this.clearState();
          return;
        }

        // Store values before processing (keep state until processing completes)
        const messageId = this.currentStreamingMessageId;
        const fullContent = finalMessage;
        const speakerSnapshot = this.currentSpeaker;

        // BUG FIX: Mark content as being processed to prevent duplicate processing
        this.contentBeingProcessed = fullContent;

        // Add to conversation history
        this.conversationHistory.push({ role: 'user', content: fullContent });

        // Notify callback with final message
        this.onMessageCallback?.({
          role: 'user',
          content: fullContent,
          timestamp: new Date().toISOString(),
          isInterim: false,
          messageId: messageId || undefined,
          speaker: speakerSnapshot,
        });

        try {
          // Process user message (triggers LLM + TTS)
          await this.processUserMessage(fullContent);

          // BUG-007 FIX: Only clear state AFTER successful processing
          this.clearState();
          this.lastProcessedContent = fullContent;
          this.contentBeingProcessed = null;
        } catch (error) {
          // BUG-007 FIX: On error, remove from conversation history and keep state for retry
          // Simplified: directly check and remove the last element if it matches
          const lastMsg = this.conversationHistory[this.conversationHistory.length - 1];
          if (lastMsg && lastMsg.role === 'user' && lastMsg.content === fullContent) {
            this.conversationHistory.pop();
          }
          // Clear the "being processed" flag so it can be retried
          this.contentBeingProcessed = null;

          devError('[Transcription] Error processing user message, transcript preserved for retry:', error);
          // Re-throw so the caller knows it failed
          throw error;
        }
      }
    } finally {
      // Always release the processing lock
      this.processingLock = false;
    }
  }

  /**
   * Discard pending transcript - called when echo is detected
   */
  discardPendingTranscript(): void {
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }
    if (this.utteranceDebounceTimeout) {
      clearTimeout(this.utteranceDebounceTimeout);
      this.utteranceDebounceTimeout = null;
    }
    this.clearSemanticHold();
    this.clearState();
  }

  /**
   * Get the current speaker identifier from diarization
   */
  getCurrentSpeaker(): string | undefined {
    return this.currentSpeaker;
  }

  /**
   * Check if there's pending transcript (user started speaking again)
   * Used to discard LLM response if user started a new turn
   */
  hasPendingTranscript(): boolean {
    return !!(this.pendingFinalTranscript && this.pendingFinalTranscript.trim());
  }

  /**
   * Cleanup on disconnect
   */
  cleanup(): void {
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }
    if (this.utteranceDebounceTimeout) {
      clearTimeout(this.utteranceDebounceTimeout);
      this.utteranceDebounceTimeout = null;
    }
    this.clearSemanticHold();
    this.clearState();
    this.lastProcessedContent = null;
    this.contentBeingProcessed = null;
    this.lastPartialUpdateTimestamp = 0;
    this.currentSpeaker = undefined;
    this.resetSpeakerFiltering();
  }

  /**
   * Reset speaker filtering state (for new session)
   */
  resetSpeakerFiltering(): void {
    this.candidateSpeaker = undefined;
    this.candidateConfirmationCount = 0;
    this.awaitingSpeakerConfirmation = false;
    this.rejectedSpeakers.clear();
    this.primarySpeaker = undefined;
    this.allowedSpeakers.clear();
    this.lastAllowedSpeakerPartialAt = 0;
  }

  /**
   * Get the current primary speaker (for debugging/UI)
   */
  getPrimarySpeaker(): string | undefined {
    return this.primarySpeaker;
  }

  /**
   * Check if we're waiting for speaker confirmation
   */
  isAwaitingSpeakerConfirmation(): boolean {
    return this.awaitingSpeakerConfirmation;
  }

  /**
   * Get the candidate speaker awaiting confirmation
   */
  getCandidateSpeaker(): string | undefined {
    return this.candidateSpeaker;
  }

  /**
   * Confirm the candidate speaker as the primary speaker
   * Called when user clicks "C'est moi" / "Yes, it's me" in the overlay
   */
  confirmCandidateSpeaker(): void {
    if (!this.candidateSpeaker) {
      console.warn('[Transcription] confirmCandidateSpeaker called but no candidate speaker');
      return;
    }

    this.primarySpeaker = this.candidateSpeaker;
    this.awaitingSpeakerConfirmation = false;
    console.log(`[Transcription] User confirmed primary speaker: ${this.primarySpeaker}`);
    this.onSpeakerEstablished?.(this.primarySpeaker);
  }

  /**
   * Reject the candidate speaker (user said "not me")
   * Called when user clicks "Ce n'est pas moi" / "Not me" in the overlay
   * The candidate is added to rejected list and we wait for the next speaker
   */
  rejectCandidateSpeaker(): void {
    if (!this.candidateSpeaker) {
      console.warn('[Transcription] rejectCandidateSpeaker called but no candidate speaker');
      return;
    }

    const rejectedSpeaker = this.candidateSpeaker;
    this.rejectedSpeakers.add(rejectedSpeaker);
    console.log(`[Transcription] User rejected speaker: ${rejectedSpeaker}`);

    // Clear buffered segments from the rejected speaker
    this.clearState();

    // Reset candidate tracking to wait for next speaker
    this.candidateSpeaker = undefined;
    this.candidateConfirmationCount = 0;
    this.awaitingSpeakerConfirmation = false;
  }

  /**
   * Check if a speaker would be filtered (for barge-in prevention)
   * Returns true if the speaker is NOT the primary speaker and NOT in whitelist
   * Used to prevent barge-in from parasitic voices before TTS is stopped
   *
   * @param speaker Speaker ID to check (e.g., "S2")
   * @returns true if this speaker should be filtered (ignored)
   */
  shouldFilterSpeaker(speaker: string | undefined): boolean {
    // If speaker filtering is disabled, never filter
    if (!this.speakerFilteringEnabled) {
      return false;
    }

    // If no speaker info, don't filter (can't make a decision)
    if (!speaker) {
      return false;
    }

    // Unknown speakers are always filtered when filtering is enabled
    if (speaker === 'UU') {
      return true;
    }

    // During establishment phase (no primary speaker yet), don't filter
    // This allows the first speakers to be processed normally
    if (!this.primarySpeaker) {
      return false;
    }

    // If this is the primary speaker or in the whitelist, don't filter
    if (speaker === this.primarySpeaker || this.allowedSpeakers.has(speaker)) {
      return false;
    }

    // Non-primary speaker not in whitelist → should be filtered
    return true;
  }

  /**
   * Check if filtered speaker safety net should trigger.
   * In noisy environments, filtered speakers (background noise) may keep sending partials
   * while the allowed speaker has stopped talking. This safety net forces processing
   * if the allowed speaker hasn't sent a partial for SILENCE_DETECTION_TIMEOUT.
   * @returns true if we should force-process pending transcript
   */
  private shouldTriggerFilteredSpeakerSafetyNet(): boolean {
    if (!this.pendingFinalTranscript?.trim()) return false;
    if (this.lastAllowedSpeakerPartialAt <= 0) return false;
    return Date.now() - this.lastAllowedSpeakerPartialAt >= this.SILENCE_DETECTION_TIMEOUT;
  }

  /**
   * Add a speaker to the whitelist (allows multiple speakers)
   * @param speaker Speaker ID to allow (e.g., "S2")
   */
  addAllowedSpeaker(speaker: string): void {
    this.allowedSpeakers.add(speaker);
    console.log(`[Transcription] Added speaker ${speaker} to whitelist. Allowed: ${Array.from(this.allowedSpeakers).join(', ')}`);
  }

  /**
   * Set a new primary speaker (resets filtering and establishes new speaker)
   * @param speaker New primary speaker ID (e.g., "S2")
   */
  setPrimarySpeaker(speaker: string): void {
    this.candidateSpeaker = undefined;
    this.primarySpeaker = speaker;
    this.allowedSpeakers.clear();
    console.log(`[Transcription] Changed primary speaker to: ${speaker}`);
    this.onSpeakerEstablished?.(speaker);
  }

  // ===== PRIVATE METHODS =====

  private clearState(): void {
    this.pendingFinalTranscript = null;
    this.currentStreamingMessageId = null;
    this.lastPreviewContent = null;
    this.segmentStore.clear();
  }

  private handleSilenceTimeout(): void {
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }
    void this.processPendingTranscript(true);
  }

  private scheduleUtteranceFinalization(force: boolean = false, absoluteFailsafe: boolean = false): void {
    if (this.utteranceDebounceTimeout) {
      clearTimeout(this.utteranceDebounceTimeout);
      this.utteranceDebounceTimeout = null;
    }

    const defaultDelay = this.enablePartials
      ? this.UTTERANCE_FINALIZATION_DELAY
      : this.SILENCE_DETECTION_TIMEOUT_NO_PARTIALS;

    const delay = force && this.enablePartials
      ? Math.min(200, defaultDelay)
      : defaultDelay;

    this.utteranceDebounceTimeout = setTimeout(() => {
      if (this.semanticOptions?.detector && !force && !absoluteFailsafe) {
        this.triggerSemanticEvaluation('utterance_debounce');
      } else {
        this.processPendingTranscript(force, absoluteFailsafe);
      }
    }, delay);
  }

  private cancelUtteranceDebounce(): void {
    if (this.utteranceDebounceTimeout) {
      clearTimeout(this.utteranceDebounceTimeout);
      this.utteranceDebounceTimeout = null;
    }
  }

  private emitInterimMessage(content: string): void {
    if (!content) return;

    const cleanedContent = this.cleanTranscript(content);
    if (!cleanedContent) return;

    // Skip if same as last preview
    if (cleanedContent === this.lastPreviewContent) return;

    // Rate limiting
    const now = Date.now();
    if (now - this.lastPartialUpdateTimestamp < this.MIN_PARTIAL_UPDATE_INTERVAL_MS) {
      return;
    }

    this.lastPreviewContent = cleanedContent;
    this.lastPartialUpdateTimestamp = now;

    this.onMessageCallback?.({
      role: 'user',
      content: cleanedContent,
      timestamp: new Date().toISOString(),
      isInterim: true,
      messageId: this.currentStreamingMessageId || undefined,
      speaker: this.currentSpeaker,
    });
  }

  // ===== UTTERANCE COMPLETENESS CHECK =====

  private isUtteranceComplete(text: string, force: boolean, absoluteFailsafe: boolean = false): boolean {
    if (!text) return false;
    const cleaned = text.trim();
    if (!cleaned) return false;

    // Absolute failsafe bypasses all checks
    if (absoluteFailsafe) {
      return true;
    }

    const words = cleaned.split(/\s+/).filter(Boolean);
    const lastWord = words[words.length - 1]?.toLowerCase().replace(/[.,!?;:…\-—–'"]+$/g, '');

    // Always check fragment endings (even with force)
    if (this.FRAGMENT_ENDINGS.has(lastWord)) {
      return false;
    }

    if (force) {
      return true;
    }

    const relaxedMode = !this.enablePartials;
    const minChars = relaxedMode
      ? Math.max(6, Math.floor(this.MIN_UTTERANCE_CHAR_LENGTH / 2))
      : this.MIN_UTTERANCE_CHAR_LENGTH;
    const minWords = relaxedMode
      ? Math.max(1, this.MIN_UTTERANCE_WORDS - 1)
      : this.MIN_UTTERANCE_WORDS;

    if (cleaned.length < minChars) return false;
    if (words.length < minWords) return false;

    return true;
  }

  // ===== TRANSCRIPT CLEANING =====

  private cleanTranscript(text: string): string {
    if (!text) return '';
    let cleaned = text.replace(/\s+/g, ' ').trim();
    cleaned = cleaned.replace(/\s+([,.!?;:])/g, '$1');
    cleaned = cleaned.replace(/([,.!?;:])([^\s])/g, '$1 $2');
    cleaned = cleaned.replace(/([.!?]){2,}/g, '$1');
    cleaned = this.removeConsecutiveWordDuplicates(cleaned);
    return cleaned.trim();
  }

  private removeConsecutiveWordDuplicates(text: string): string {
    const tokens = text.split(/\s+/);
    const deduped: string[] = [];
    const normalizedHistory: string[] = [];

    for (const token of tokens) {
      if (!token) continue;
      const normalized = this.normalizeToken(token);
      const prevNormalized = normalizedHistory[normalizedHistory.length - 1];
      if (normalized && prevNormalized && prevNormalized === normalized) {
        continue;
      }
      deduped.push(token);
      normalizedHistory.push(normalized);
    }

    return deduped.join(' ');
  }

  private normalizeToken(token: string): string {
    return token
      .toLowerCase()
      .replace(/^[\s.,!?;:…'"()\-]+/g, '')
      .replace(/[\s.,!?;:…'"()\-]+$/g, '');
  }

  // ===== SEMANTIC TURN DETECTION =====

  private triggerSemanticEvaluation(trigger: SemanticTurnTrigger): void {
    if (!this.semanticOptions?.detector) {
      this.emitSemanticTelemetry('skipped', trigger, null, 'detector-disabled');
      const shouldForce = this.enablePartials;
      this.scheduleUtteranceFinalization(shouldForce);
      return;
    }

    if (this.semanticEvaluationInFlight) {
      this.pendingSemanticTrigger = trigger;
      return;
    }

    this.semanticEvaluationInFlight = true;
    void this.runSemanticEvaluation(trigger);
  }

  private async runSemanticEvaluation(trigger: SemanticTurnTrigger): Promise<void> {
    try {
      const options = this.semanticOptions;
      if (!options?.detector) return;

      const pendingContent = this.getPendingTranscriptForSemantics();
      if (!pendingContent) {
        this.emitSemanticTelemetry('fallback', trigger, null, 'no-pending-transcript');
        this.scheduleUtteranceFinalization(this.enablePartials);
        return;
      }

      const messages = this.buildSemanticMessages(options.maxContextMessages);
      if (!messages.length) {
        this.emitSemanticTelemetry('fallback', trigger, null, 'no-context');
        this.scheduleUtteranceFinalization(this.enablePartials);
        return;
      }

      const probability = await options.detector.getSemanticEotProb(messages);

      if (typeof probability === 'number' && probability >= options.threshold) {
        this.emitSemanticTelemetry('dispatch', trigger, probability);
        this.clearSemanticHold();
        this.scheduleUtteranceFinalization(true, false);
        return;
      }

      if (probability === null) {
        this.emitSemanticTelemetry('fallback', trigger, probability, 'detector-null');
        this.clearSemanticHold();
        this.resetSilenceTimeout();
        return;
      }

      this.emitSemanticTelemetry('hold', trigger, probability, 'probability-below-threshold-waiting-silence');
      this.clearSemanticHold();
      this.resetSilenceTimeout();
    } catch (error) {
      devError('[Transcription] Semantic detector error', error);
      this.emitSemanticTelemetry('fallback', trigger, null, 'detector-error');
      this.clearSemanticHold();
      this.resetSilenceTimeout();
    } finally {
      this.semanticEvaluationInFlight = false;
      if (this.pendingSemanticTrigger) {
        const nextTrigger = this.pendingSemanticTrigger;
        this.pendingSemanticTrigger = null;
        this.triggerSemanticEvaluation(nextTrigger);
      }
    }
  }

  private clearSemanticHold(): void {
    if (this.semanticHoldTimeout) {
      clearTimeout(this.semanticHoldTimeout);
      this.semanticHoldTimeout = null;
    }
    this.semanticHoldStartedAt = null;
    this.pendingSemanticTrigger = null;
  }

  private emitSemanticTelemetry(
    decision: SemanticTurnDecision,
    trigger: SemanticTurnTrigger,
    probability: number | null,
    reason?: string
  ): void {
    if (!this.semanticOptions?.telemetry) return;

    const pending = this.getPendingTranscriptForSemantics() || '';
    const words = pending ? pending.split(/\s+/).filter(Boolean).length : 0;

    this.semanticOptions.telemetry({
      trigger,
      probability,
      decision,
      reason,
      threshold: this.semanticOptions.threshold,
      pendingChars: pending.length,
      pendingWords: words,
      holdMs: this.getSemanticHoldDuration(),
      timestamp: new Date().toISOString(),
    });
  }

  private getPendingTranscriptForSemantics(): string | null {
    if (!this.pendingFinalTranscript || !this.pendingFinalTranscript.trim()) {
      return null;
    }
    return this.cleanTranscript(this.pendingFinalTranscript.trim());
  }

  private buildSemanticMessages(limit: number): SemanticTurnMessage[] {
    const recentHistory: SemanticTurnMessage[] = this.conversationHistory
      .slice(-limit)
      .map((entry) => ({
        role: (entry.role === 'agent' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: entry.content,
      }));

    const pending = this.getPendingTranscriptForSemantics();
    if (pending) {
      recentHistory.push({ role: 'user', content: pending });
    }

    return recentHistory.slice(-limit);
  }

  private getSemanticHoldDuration(): number {
    if (!this.semanticHoldStartedAt) return 0;
    return Date.now() - this.semanticHoldStartedAt;
  }
}
