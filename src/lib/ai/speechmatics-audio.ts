/**
 * Audio management for Speechmatics Voice Agent
 * Facade that coordinates microphone, playback, VAD, and barge-in modules
 */

import * as Sentry from '@sentry/nextjs';
import { devLog, devError } from '@/lib/utils';
import { AudioChunkDedupe } from './speechmatics-audio-dedupe';
import { SpeechmaticsVAD } from './speechmatics-vad';
import { SpeechmaticsAudioPlayback } from './speechmatics-audio-playback';
import { SpeechmaticsMicrophone } from './speechmatics-microphone';
import { SpeechmaticsBargeIn, type EchoDetails } from './speechmatics-barge-in';

export type { EchoDetails } from './speechmatics-barge-in';

/**
 * Main audio class - facade for the audio system
 */
export class SpeechmaticsAudio {
  private static instanceCounter = 0;
  private readonly vad: SpeechmaticsVAD;
  private readonly playback: SpeechmaticsAudioPlayback;
  private readonly microphone: SpeechmaticsMicrophone;
  private readonly bargeIn: SpeechmaticsBargeIn;
  private readonly audioDedupe: AudioChunkDedupe;
  private ws: WebSocket | null;
  private onBargeIn?: () => void;
  private onAudioPlaybackEnd?: () => void;
  private onEchoDetected?: (details?: EchoDetails) => void;
  private onBargeInSpeakerPending?: (speaker: string, transcript: string, isEchoLikely: boolean) => void;

  // Throttle for barge-in debug logging (avoid spam)
  private lastBargeInLogTime: number = 0;
  private readonly BARGE_IN_LOG_THROTTLE_MS = 500;

  static get lastEchoDetails(): EchoDetails | null { return SpeechmaticsBargeIn.lastEchoDetails; }
  static set lastEchoDetails(value: EchoDetails | null) { SpeechmaticsBargeIn.lastEchoDetails = value; }

  constructor(
    audioDedupe: AudioChunkDedupe,
    _onAudioChunk: (chunk: Int16Array) => void,
    ws: WebSocket | null,
    onBargeIn?: () => void,
    onAudioPlaybackEnd?: () => void,
    onEchoDetected?: (details?: EchoDetails) => void
  ) {
    SpeechmaticsAudio.instanceCounter++;
    this.audioDedupe = audioDedupe;
    this.ws = ws;
    this.onBargeIn = onBargeIn;
    this.onAudioPlaybackEnd = onAudioPlaybackEnd;
    this.onEchoDetected = onEchoDetected;

    this.vad = new SpeechmaticsVAD();
    this.playback = new SpeechmaticsAudioPlayback();
    this.microphone = new SpeechmaticsMicrophone();
    this.bargeIn = new SpeechmaticsBargeIn();
    this.setupCallbacks();
  }

  private setupCallbacks(): void {
    // Core barge-in callback: when barge-in is confirmed, stop TTS and notify
    this.bargeIn.setOnBargeIn(() => {
      // Use cancelPauseAndStop to fully stop (in case we were paused)
      this.playback.cancelPauseAndStop();
      this.onBargeIn?.();
    });
    this.bargeIn.setOnEchoDetected((details) => this.onEchoDetected?.(details));

    // Speaker-aware barge-in callbacks
    this.bargeIn.setOnPauseForSpeakerCheck(() => {
      this.playback.pausePlayback();
    });
    this.bargeIn.setOnResumePlayback(() => {
      this.playback.resumePlayback();
    });
    this.bargeIn.setOnBargeInSpeakerPending((speaker, transcript, isEchoLikely) => {
      this.onBargeInSpeakerPending?.(speaker, transcript, isEchoLikely);
    });

    // Playback end callback
    this.playback.setOnPlaybackEnd(() => {
      this.vad.clearSlidingWindow();
      // Also cancel any pending speaker check if playback ended naturally
      if (this.bargeIn.isPausedForSpeakerCheck()) {
        this.bargeIn.cancelSpeakerCheck();
      }
      this.onAudioPlaybackEnd?.();
    });

    this.microphone.setOnAudioData((pcmData) => this.handleMicrophoneAudio(pcmData));
    this.microphone.setOnNoiseFloor((noiseFloor) => this.vad.updateNoiseFloor(noiseFloor));
  }

  private handleMicrophoneAudio(pcmData: Int16Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Consider both playing and paused states for barge-in purposes
    const isPlayingAudio = this.playback.isPlaying();
    const isPaused = this.playback.isPausedForSpeakerCheck();
    const isActivePlayback = isPlayingAudio || isPaused;

    const hasVoiceActivity = this.vad.detectVoiceActivityHybrid(pcmData, isActivePlayback);

    // DEBUG: Log barge-in trigger conditions (throttled to avoid spam)
    // Only log when there's voice activity or when playing
    if (hasVoiceActivity || isPlayingAudio) {
      this.logBargeInConditions(isPlayingAudio, isPaused, hasVoiceActivity);
    }

    // Trigger barge-in detection only when actively playing (not when paused)
    if (isPlayingAudio && hasVoiceActivity) {
      const timeSince = this.playback.getTimeSincePlaybackEnded();
      const recentSpeaker = this.bargeIn.getLastSeenSpeaker();
      this.bargeIn.handleBargeIn(
        isPlayingAudio,
        timeSince === Infinity ? 0 : Date.now() - timeSince,
        recentSpeaker
      );
    }

    this.vad.updateSlidingWindow(hasVoiceActivity, isActivePlayback);
    if (!this.vad.shouldSendChunk(hasVoiceActivity)) return;

    const signature = this.audioDedupe.computeChunkSignature(pcmData);
    if (this.audioDedupe.shouldSkipChunk(signature)) return;

    try {
      this.ws?.send(pcmData.buffer);
    } catch (error) {
      Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
        tags: { module: 'speechmatics-audio', operation: 'send_audio_chunk' },
        extra: { chunkSize: pcmData.length, wsReadyState: this.ws?.readyState },
        level: 'warning',
      });
      devError('[Speechmatics] Error sending audio:', error);
    }
  }

  /**
   * Log barge-in trigger conditions (throttled to avoid spam)
   * This helps debug why barge-in isn't triggering during TTS playback
   */
  private logBargeInConditions(isPlayingAudio: boolean, isPaused: boolean, hasVoiceActivity: boolean): void {
    const now = Date.now();
    if (now - this.lastBargeInLogTime < this.BARGE_IN_LOG_THROTTLE_MS) {
      return;
    }
    this.lastBargeInLogTime = now;

    // Log when there's a mismatch (voice detected but not playing, or playing but no voice)
    if (hasVoiceActivity && !isPlayingAudio) {
      devLog('[Audio] 🎤 VAD detected voice but TTS not playing:', {
        isPlayingAudio,
        isPaused,
        hasVoiceActivity,
      });
    } else if (isPlayingAudio && hasVoiceActivity) {
      devLog('[Audio] 🔊 Barge-in trigger conditions MET:', {
        isPlayingAudio,
        isPaused,
        hasVoiceActivity,
      });
    } else if (isPlayingAudio && !hasVoiceActivity) {
      devLog('[Audio] 🔇 TTS playing but no voice detected (VAD negative)');
    }
  }

  async startMicrophone(deviceId?: string, voiceIsolation: boolean = true): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to Speechmatics');
    }
    const audioContext = await this.microphone.start(deviceId, voiceIsolation);
    this.playback.setAudioContext(audioContext);
    this.vad.reset();
    this.bargeIn.reset();
    this.audioDedupe.reset();
  }

  async stopMicrophone(): Promise<void> {
    this.stopAgentSpeech(false);
    this.playback.cleanup();
    await this.microphone.stop();
    this.vad.reset();
    this.bargeIn.cancelValidation();
    this.bargeIn.resetSpeakerTracking();
  }

  setMicrophoneMuted(muted: boolean): void {
    if (muted) this.stopAgentSpeech(true);
    this.microphone.setMuted(muted);
  }

  setMicrophoneSensitivity(sensitivity: number = 1.0): void {
    this.vad.setSensitivity(sensitivity);
  }

  setAdaptiveFeatures(config: {
    enableAdaptiveSensitivity?: boolean;
    enableAdaptiveNoiseGate?: boolean;
    enableWorkletAGC?: boolean;
  }): void {
    this.vad.setAdaptiveFeatures({
      enableAdaptiveSensitivity: config.enableAdaptiveSensitivity,
      enableAdaptiveNoiseGate: config.enableAdaptiveNoiseGate,
    });
    if (config.enableWorkletAGC !== undefined) {
      this.microphone.setWorkletAGC(config.enableWorkletAGC);
    }
  }

  async playAudio(audioData: Uint8Array): Promise<void> {
    await this.playback.playAudio(audioData);
  }

  stopAgentSpeech(applyFade: boolean = true): void {
    this.playback.stopAgentSpeech(applyFade);
  }

  async validateBargeInWithTranscript(transcript: string, _recentContext?: string, speaker?: string): Promise<boolean> {
    return this.bargeIn.validateWithTranscript(
      transcript,
      this.playback.getCurrentAssistantSpeech(),
      this.playback.isInGracePeriod(),
      speaker
    );
  }

  cancelBargeInValidation(): void {
    this.bargeIn.cancelValidation();
  }

  async streamToUint8Array(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    return this.playback.streamToUint8Array(stream);
  }

  updateWebSocket(ws: WebSocket | null): void {
    this.ws = ws;
  }

  isPlaying(): boolean {
    return this.playback.isPlaying();
  }

  isUserSpeaking(): boolean {
    return this.vad.isUserSpeaking();
  }

  resetVADStateForFilteredSpeaker(): void {
    this.vad.resetForFilteredSpeaker();
    this.bargeIn.cancelValidation();
    devLog('[Speechmatics Audio] VAD state reset due to filtered speaker');
  }

  setCurrentAssistantSpeech(text: string): void {
    this.playback.setCurrentAssistantSpeech(text);
  }

  // =========================================================================
  // Speaker-aware barge-in methods
  // =========================================================================

  /**
   * Set callback for when an unknown speaker is detected during barge-in.
   * The callback should show a popup asking user to confirm/reject.
   * @param callback - Receives speaker ID, transcript, and whether it looks like echo
   */
  setOnBargeInSpeakerPending(callback: (speaker: string, transcript: string, isEchoLikely: boolean) => void): void {
    this.onBargeInSpeakerPending = callback;
  }

  /**
   * Set speaker check functions (injected from TranscriptionManager).
   * These are used by the barge-in module to make speaker-based decisions.
   */
  setSpeakerCheckFunctions(fns: {
    isRejected: (speaker: string | undefined) => boolean;
    isAuthorized: (speaker: string | undefined) => boolean;
  }): void {
    this.bargeIn.setSpeakerCheckFunctions({
      isRejected: fns.isRejected,
      isAuthorized: fns.isAuthorized,
      getCurrentAssistantSpeech: () => this.playback.getCurrentAssistantSpeech(),
    });
  }

  /**
   * Called by UI when user confirms the unknown speaker during barge-in.
   * Proceeds with barge-in validation (echo check) then interrupts if valid.
   */
  confirmBargeInSpeaker(): void {
    this.bargeIn.confirmUnknownSpeaker();
  }

  /**
   * Called by UI when user rejects the unknown speaker during barge-in.
   * Resumes playback and continues TTS.
   */
  rejectBargeInSpeaker(): void {
    this.bargeIn.rejectUnknownSpeaker();
  }

  /**
   * Collect transcript during speaker check pause.
   * Called by message handler when transcripts arrive while paused.
   */
  collectTranscriptDuringPause(transcript: string, speaker?: string): void {
    this.bargeIn.collectTranscriptDuringPause(transcript, speaker);
  }

  /**
   * Check if currently paused for speaker check.
   */
  isPausedForSpeakerCheck(): boolean {
    return this.playback.isPausedForSpeakerCheck() || this.bargeIn.isPausedForSpeakerCheck();
  }
}
