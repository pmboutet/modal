/**
 * Barge-in Detection for Speechmatics
 * Handles user interruption detection and validation
 *
 * SIMPLIFIED: Echo detection is now based on speaker identity.
 * If speaker == primary speaker -> process (no echo check needed)
 * If speaker != primary speaker -> show popup to ask user
 */

import { devLog, devWarn } from '@/lib/utils';
import { isLikelyEcho } from './speechmatics-echo-detection';

/**
 * Echo detection details for callback (simplified)
 */
export interface EchoDetails {
  transcript: string;
  speaker?: string;
  detectedAt: number;
}

/**
 * Configuration for barge-in detection
 */
export interface BargeInConfig {
  cooldownMs?: number;
  gracePeriodMs?: number;
  validationTimeoutMs?: number;
}

const DEFAULT_CONFIG: Required<BargeInConfig> = {
  cooldownMs: 1500,
  gracePeriodMs: 500,
  validationTimeoutMs: 600,
};

const PAUSE_ATTEMPT_COOLDOWN_MS = 500;

/**
 * Pending transcript collected during speaker check pause
 */
interface PendingTranscript {
  transcript: string;
  speaker?: string;
}

/**
 * Barge-in Detection module
 */
export class SpeechmaticsBargeIn {
  private readonly config: Required<BargeInConfig>;
  private lastBargeInTime: number = 0;
  private bargeInPendingValidation: boolean = false;
  private bargeInValidationTimer: NodeJS.Timeout | null = null;
  private primaryUserSpeaker: string | undefined = undefined;
  private lastSeenSpeaker: string | undefined = undefined;

  // Speaker-aware barge-in state
  private bargeInPausedForSpeakerCheck: boolean = false;
  private speakerCheckTimeoutId: NodeJS.Timeout | null = null;
  private pendingTranscriptsDuringPause: PendingTranscript[] = [];
  private lastPauseAttemptTime: number = 0;

  static lastEchoDetails: EchoDetails | null = null;

  // Core callbacks
  private onBargeIn?: () => void;
  private onEchoDetected?: (details?: EchoDetails) => void;

  // Speaker-aware barge-in callbacks
  private onPauseForSpeakerCheck?: () => void;
  private onResumePlayback?: () => void;
  private onBargeInSpeakerPending?: (speaker: string, transcript: string, isEchoLikely: boolean) => void;

  // Speaker check functions (injected from TranscriptionManager)
  private isRejectedSpeakerFn?: (speaker: string | undefined) => boolean;
  private isAuthorizedSpeakerFn?: (speaker: string | undefined) => boolean;
  private getCurrentAssistantSpeechFn?: () => string;

  constructor(config: BargeInConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setOnBargeIn(callback: () => void): void {
    this.onBargeIn = callback;
  }

  setOnEchoDetected(callback: (details?: EchoDetails) => void): void {
    this.onEchoDetected = callback;
  }

  // Speaker-aware barge-in callback setters
  setOnPauseForSpeakerCheck(callback: () => void): void {
    this.onPauseForSpeakerCheck = callback;
  }

  setOnResumePlayback(callback: () => void): void {
    this.onResumePlayback = callback;
  }

  setOnBargeInSpeakerPending(callback: (speaker: string, transcript: string, isEchoLikely: boolean) => void): void {
    this.onBargeInSpeakerPending = callback;
  }

  /**
   * Set speaker check functions (injected from TranscriptionManager via Audio facade)
   */
  setSpeakerCheckFunctions(fns: {
    isRejected: (speaker: string | undefined) => boolean;
    isAuthorized: (speaker: string | undefined) => boolean;
    getCurrentAssistantSpeech: () => string;
  }): void {
    this.isRejectedSpeakerFn = fns.isRejected;
    this.isAuthorizedSpeakerFn = fns.isAuthorized;
    this.getCurrentAssistantSpeechFn = fns.getCurrentAssistantSpeech;
  }

  reset(): void {
    this.lastBargeInTime = 0;
    this.cancelValidation();
    this.cancelSpeakerCheck();
    this.primaryUserSpeaker = undefined;
    this.lastSeenSpeaker = undefined;
    this.lastPauseAttemptTime = 0;
  }

  isPendingValidation(): boolean {
    return this.bargeInPendingValidation;
  }

  isPausedForSpeakerCheck(): boolean {
    return this.bargeInPausedForSpeakerCheck;
  }

  getLastSeenSpeaker(): string | undefined {
    return this.lastSeenSpeaker;
  }

  /**
   * Handle potential barge-in when voice is detected during TTS playback.
   *
   * New speaker-aware flow:
   * 1. Early exit if speaker is already rejected (no pause needed)
   * 2. PAUSE playback immediately (don't stop yet)
   * 3. Collect transcripts during validation window (600ms)
   * 4. Finalize decision based on speaker identity
   *
   * @param isPlayingAudio Whether TTS is currently playing
   * @param lastAudioPlaybackEndTime When playback last ended
   * @param recentSpeaker Speaker from most recent transcript (if known)
   */
  handleBargeIn(isPlayingAudio: boolean, lastAudioPlaybackEndTime: number, recentSpeaker?: string): void {
    if (!isPlayingAudio) return;

    const now = Date.now();

    // Cooldown for confirmed barge-ins
    if (now - this.lastBargeInTime < this.config.cooldownMs) return;

    // Cooldown for pause attempts (prevent rapid pauses)
    if (now - this.lastPauseAttemptTime < PAUSE_ATTEMPT_COOLDOWN_MS) return;

    // Grace period after playback ended
    const timeSincePlaybackEnded = now - lastAudioPlaybackEndTime;
    if (lastAudioPlaybackEndTime > 0 && timeSincePlaybackEnded < this.config.gracePeriodMs) return;

    // Already in validation or paused state
    if (this.bargeInPendingValidation || this.bargeInPausedForSpeakerCheck) return;

    // EARLY EXIT: If speaker is already rejected, continue playback without pause
    if (recentSpeaker && this.isRejectedSpeakerFn?.(recentSpeaker)) {
      devLog('[BargeIn] Early exit - rejected speaker:', recentSpeaker);
      return;
    }

    // PAUSE playback and start speaker check
    this.lastPauseAttemptTime = now;
    this.bargeInPausedForSpeakerCheck = true;
    this.pendingTranscriptsDuringPause = [];

    devLog('[BargeIn] 🔄 Pausing for speaker check, recentSpeaker:', recentSpeaker || 'unknown');
    this.onPauseForSpeakerCheck?.();

    // Set timeout for speaker check finalization
    this.speakerCheckTimeoutId = setTimeout(() => {
      this.finalizeSpeakerCheck();
    }, this.config.validationTimeoutMs);
  }

  /**
   * Validate transcript for barge-in.
   * SIMPLIFIED: No echo detection here - speaker identity is checked upstream.
   * Only validates word count requirements.
   */
  validateWithTranscript(
    transcript: string,
    _currentAssistantSpeech: string,
    isInGracePeriod: boolean,
    speaker?: string
  ): boolean {
    this.updateSpeakerTracking(speaker);

    if (!this.bargeInPendingValidation) return false;

    const cleanedTranscript = transcript.trim();
    const words = cleanedTranscript.split(/\s+/).filter(Boolean);
    const requiredWords = isInGracePeriod ? 3 : 2;

    devLog('[BargeIn] 🎤 Validating transcript:', cleanedTranscript.substring(0, 50) + (cleanedTranscript.length > 50 ? '...' : ''));
    devLog('[BargeIn] 👤 Speaker:', speaker || 'unknown', '| Primary:', this.primaryUserSpeaker || 'not set');

    if (words.length < requiredWords) return false;

    this.confirmBargeIn();
    return true;
  }

  cancelValidation(): void {
    if (this.bargeInValidationTimer) {
      clearTimeout(this.bargeInValidationTimer);
      this.bargeInValidationTimer = null;
    }
    this.bargeInPendingValidation = false;
  }

  resetSpeakerTracking(): void {
    this.primaryUserSpeaker = undefined;
    this.lastSeenSpeaker = undefined;
  }

  private updateSpeakerTracking(speaker?: string): void {
    if (speaker) {
      this.lastSeenSpeaker = speaker;
      if (!this.primaryUserSpeaker && speaker !== 'UU') {
        this.primaryUserSpeaker = speaker;
      }
    }
  }

  private confirmBargeIn(): void {
    if (!this.bargeInPendingValidation && !this.bargeInPausedForSpeakerCheck) return;

    if (this.bargeInValidationTimer) {
      clearTimeout(this.bargeInValidationTimer);
      this.bargeInValidationTimer = null;
    }
    this.cancelSpeakerCheck();

    this.bargeInPendingValidation = false;
    this.lastBargeInTime = Date.now();
    this.onBargeIn?.();
  }

  // =========================================================================
  // Speaker-aware barge-in methods
  // =========================================================================

  /**
   * Collect transcript during speaker check pause window.
   * Called by message handler when transcripts arrive while paused.
   */
  collectTranscriptDuringPause(transcript: string, speaker?: string): void {
    if (!this.bargeInPausedForSpeakerCheck) return;
    this.pendingTranscriptsDuringPause.push({ transcript, speaker });
    this.updateSpeakerTracking(speaker);
    devLog('[BargeIn] Collected transcript during pause:', transcript.substring(0, 30), 'speaker:', speaker || 'unknown');
  }

  /**
   * Cancel the speaker check (clear timeout and reset state)
   */
  cancelSpeakerCheck(): void {
    if (this.speakerCheckTimeoutId) {
      clearTimeout(this.speakerCheckTimeoutId);
      this.speakerCheckTimeoutId = null;
    }
    this.bargeInPausedForSpeakerCheck = false;
    this.pendingTranscriptsDuringPause = [];
  }

  /**
   * Called when user confirms unknown speaker in popup.
   * Proceeds with barge-in validation.
   */
  confirmUnknownSpeaker(): void {
    if (!this.bargeInPausedForSpeakerCheck) return;

    devLog('[BargeIn] User confirmed unknown speaker');

    const fullTranscript = this.pendingTranscriptsDuringPause
      .map(e => e.transcript)
      .join(' ')
      .trim();
    const dominantSpeaker = this.getDominantSpeaker();

    // Proceed with echo validation then barge-in
    this.proceedWithBargeInValidation(fullTranscript, dominantSpeaker);
  }

  /**
   * Called when user rejects unknown speaker in popup.
   * Resumes playback and adds speaker to rejected list (handled by caller).
   */
  rejectUnknownSpeaker(): void {
    if (!this.bargeInPausedForSpeakerCheck) return;

    devLog('[BargeIn] User rejected unknown speaker');
    this.handleResume();
  }

  /**
   * Finalize speaker check after timeout.
   * Determines action based on collected transcripts and speaker identity.
   */
  private finalizeSpeakerCheck(): void {
    if (!this.bargeInPausedForSpeakerCheck) return;

    devLog('[BargeIn] Finalizing speaker check, collected transcripts:', this.pendingTranscriptsDuringPause.length);

    // Determine the dominant speaker from collected transcripts
    const dominantSpeaker = this.getDominantSpeaker();
    const fullTranscript = this.pendingTranscriptsDuringPause
      .map(e => e.transcript)
      .join(' ')
      .trim();

    devLog('[BargeIn] Dominant speaker:', dominantSpeaker || 'none', '| Transcript length:', fullTranscript.length);

    // Decision tree based on speaker identity
    if (dominantSpeaker && this.isRejectedSpeakerFn?.(dominantSpeaker)) {
      // Speaker was rejected → RESUME playback
      devLog('[BargeIn] ⏸️→▶️ Rejected speaker detected, resuming playback');
      this.handleResume();
    } else if (dominantSpeaker && this.isAuthorizedSpeakerFn?.(dominantSpeaker)) {
      // Speaker is authorized → proceed with echo validation then BARGE IN
      devLog('[BargeIn] ✅ Authorized speaker detected, validating for echo...');
      this.proceedWithBargeInValidation(fullTranscript, dominantSpeaker);
    } else if (dominantSpeaker && dominantSpeaker !== 'UU') {
      // Unknown speaker (not rejected, not authorized) → show popup
      // Check if transcript looks like AI speech to pre-select popup mode
      const currentAssistantSpeech = this.getCurrentAssistantSpeechFn?.() || '';
      const echoLikely = isLikelyEcho(fullTranscript, currentAssistantSpeech);
      devLog('[BargeIn] ❓ Unknown speaker detected, showing confirmation popup', { echoLikely });
      this.onBargeInSpeakerPending?.(dominantSpeaker, fullTranscript, echoLikely);
      // Stay paused - wait for confirmUnknownSpeaker() or rejectUnknownSpeaker()
    } else {
      // No speaker info or only UU → probably noise → RESUME
      devLog('[BargeIn] ⏸️→▶️ No valid speaker detected (noise?), resuming playback');
      this.handleResume();
    }
  }

  /**
   * Proceed with barge-in after speaker is authorized.
   * Validates word count, then confirms barge-in if valid.
   */
  private proceedWithBargeInValidation(transcript: string, speaker?: string): void {
    // Set pending validation flag for validateWithTranscript
    this.bargeInPendingValidation = true;
    this.cancelSpeakerCheck();

    // Validate transcript (just word count check now)
    const isValid = this.validateWithTranscript(
      transcript,
      '', // No longer used
      false, // Not in grace period
      speaker
    );

    if (!isValid) {
      devLog('[BargeIn] ⏸️→▶️ Validation failed (not enough words), resuming playback');
      this.handleResume();
    }
    // If valid, confirmBargeIn() was already called by validateWithTranscript
  }

  /**
   * Resume playback after speaker check indicates no barge-in.
   */
  private handleResume(): void {
    devLog('[BargeIn] Resuming playback');
    this.cancelSpeakerCheck();
    this.cancelValidation();
    this.onResumePlayback?.();
  }

  /**
   * Get the dominant speaker from collected transcripts.
   * Returns the speaker with the most occurrences, ignoring 'UU'.
   */
  private getDominantSpeaker(): string | undefined {
    const speakerCounts = new Map<string, number>();

    for (const entry of this.pendingTranscriptsDuringPause) {
      if (entry.speaker && entry.speaker !== 'UU') {
        speakerCounts.set(entry.speaker, (speakerCounts.get(entry.speaker) || 0) + 1);
      }
    }

    let dominantSpeaker: string | undefined;
    let maxCount = 0;

    for (const [speaker, count] of speakerCounts) {
      if (count > maxCount) {
        maxCount = count;
        dominantSpeaker = speaker;
      }
    }

    return dominantSpeaker || this.lastSeenSpeaker;
  }
}
