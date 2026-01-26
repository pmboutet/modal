/**
 * Barge-in Detection for Speechmatics
 * Handles user interruption detection and validation
 */

import * as Sentry from '@sentry/nextjs';
import { devError } from '@/lib/utils';
import {
  createStartOfTurnDetector,
  resolveStartOfTurnDetectorConfig,
  type StartOfTurnDetector,
  type StartOfTurnMessage,
} from './start-of-turn-detection';
import { detectLocalEcho } from './speechmatics-echo-detection';

/**
 * Echo detection details for callback
 */
export interface EchoDetails {
  transcript: string;
  matchType: 'contained' | 'fuzzy-words' | 'speaker-mismatch' | 'ai-detected' | 'none';
  similarity: number;
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

/**
 * Barge-in Detection module
 */
export class SpeechmaticsBargeIn {
  private readonly config: Required<BargeInConfig>;
  private lastBargeInTime: number = 0;
  private bargeInPendingValidation: boolean = false;
  private bargeInValidationTimer: NodeJS.Timeout | null = null;
  private startOfTurnDetector: StartOfTurnDetector | null = null;
  private conversationHistory: StartOfTurnMessage[] = [];
  private primaryUserSpeaker: string | undefined = undefined;
  private lastSeenSpeaker: string | undefined = undefined;

  static lastEchoDetails: EchoDetails | null = null;

  private onBargeIn?: () => void;
  private onEchoDetected?: (details?: EchoDetails) => void;

  constructor(config: BargeInConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const startOfTurnConfig = resolveStartOfTurnDetectorConfig();
    this.startOfTurnDetector = createStartOfTurnDetector(startOfTurnConfig);
  }

  setOnBargeIn(callback: () => void): void {
    this.onBargeIn = callback;
  }

  setOnEchoDetected(callback: (details?: EchoDetails) => void): void {
    this.onEchoDetected = callback;
  }

  reset(): void {
    this.lastBargeInTime = 0;
    this.cancelValidation();
    this.primaryUserSpeaker = undefined;
    this.lastSeenSpeaker = undefined;
    this.conversationHistory = [];
  }

  isPendingValidation(): boolean {
    return this.bargeInPendingValidation;
  }

  handleBargeIn(isPlayingAudio: boolean, lastAudioPlaybackEndTime: number): void {
    if (!isPlayingAudio) return;

    const now = Date.now();
    if (now - this.lastBargeInTime < this.config.cooldownMs) return;

    const timeSincePlaybackEnded = now - lastAudioPlaybackEndTime;
    if (lastAudioPlaybackEndTime > 0 && timeSincePlaybackEnded < this.config.gracePeriodMs) return;

    if (this.bargeInPendingValidation) return;

    this.bargeInPendingValidation = true;
    this.bargeInValidationTimer = setTimeout(() => {
      this.cancelValidation();
    }, this.config.validationTimeoutMs);
  }

  async validateWithTranscript(
    transcript: string,
    currentAssistantSpeech: string,
    isInGracePeriod: boolean,
    speaker?: string
  ): Promise<boolean> {
    this.updateSpeakerTracking(speaker);

    if (!this.bargeInPendingValidation) return false;

    const cleanedTranscript = transcript.trim();
    const words = cleanedTranscript.split(/\s+/).filter(Boolean);
    const requiredWords = isInGracePeriod ? 3 : 2;

    // Local echo detection
    if (currentAssistantSpeech?.trim()) {
      const isSpeakerMismatch = speaker && this.primaryUserSpeaker && speaker !== this.primaryUserSpeaker;
      const suspiciousSpeaker = isSpeakerMismatch || speaker === 'UU';

      const echoResult = detectLocalEcho(cleanedTranscript, currentAssistantSpeech, suspiciousSpeaker);
      if (echoResult.isEcho) {
        this.cancelValidation();
        const echoDetails: EchoDetails = {
          transcript: cleanedTranscript,
          matchType: echoResult.matchType,
          similarity: echoResult.similarity,
          detectedAt: Date.now(),
        };
        SpeechmaticsBargeIn.lastEchoDetails = echoDetails;
        this.onEchoDetected?.(echoDetails);
        return false;
      }
    }

    if (words.length < requiredWords) return false;

    // AI-powered validation
    if (this.startOfTurnDetector) {
      try {
        const result = await this.startOfTurnDetector.validateStartOfTurn(
          cleanedTranscript,
          currentAssistantSpeech,
          this.conversationHistory
        );

        if (result.isEcho) {
          this.cancelValidation();
          const echoDetails: EchoDetails = {
            transcript: cleanedTranscript,
            matchType: 'ai-detected',
            similarity: 1.0,
            detectedAt: Date.now(),
          };
          SpeechmaticsBargeIn.lastEchoDetails = echoDetails;
          this.onEchoDetected?.(echoDetails);
          return false;
        }

        if (!result.isValidStart) return false;

        this.confirmBargeIn();
        return true;
      } catch (error) {
        devError('[Speechmatics BargeIn] AI validation error', error);
        Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
          tags: { component: 'speechmatics-barge-in', error_type: 'start_of_turn_validation_error' },
          extra: {
            transcriptLength: cleanedTranscript.length,
            hasAssistantSpeech: Boolean(currentAssistantSpeech),
            conversationHistoryLength: this.conversationHistory.length,
          },
          level: 'warning',
        });
      }
    }

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

  updateConversationHistory(history: StartOfTurnMessage[]): void {
    this.conversationHistory = history;
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
    if (!this.bargeInPendingValidation) return;

    if (this.bargeInValidationTimer) {
      clearTimeout(this.bargeInValidationTimer);
      this.bargeInValidationTimer = null;
    }

    this.bargeInPendingValidation = false;
    this.lastBargeInTime = Date.now();
    this.onBargeIn?.();
  }
}
