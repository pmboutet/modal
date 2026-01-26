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
import type { StartOfTurnMessage } from './start-of-turn-detection';

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
    this.bargeIn.setOnBargeIn(() => {
      this.stopAgentSpeech(true);
      this.onBargeIn?.();
    });
    this.bargeIn.setOnEchoDetected((details) => this.onEchoDetected?.(details));
    this.playback.setOnPlaybackEnd(() => {
      this.vad.clearSlidingWindow();
      this.onAudioPlaybackEnd?.();
    });
    this.microphone.setOnAudioData((pcmData) => this.handleMicrophoneAudio(pcmData));
    this.microphone.setOnNoiseFloor((noiseFloor) => this.vad.updateNoiseFloor(noiseFloor));
  }

  private handleMicrophoneAudio(pcmData: Int16Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const isPlayingAudio = this.playback.isPlaying();
    const hasVoiceActivity = this.vad.detectVoiceActivityHybrid(pcmData, isPlayingAudio);

    if (isPlayingAudio && hasVoiceActivity) {
      const timeSince = this.playback.getTimeSincePlaybackEnded();
      this.bargeIn.handleBargeIn(isPlayingAudio, timeSince === Infinity ? 0 : Date.now() - timeSince);
    }

    this.vad.updateSlidingWindow(hasVoiceActivity, isPlayingAudio);
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

  updateConversationHistory(history: StartOfTurnMessage[]): void {
    this.bargeIn.updateConversationHistory(history);
  }

  setCurrentAssistantSpeech(text: string): void {
    this.playback.setCurrentAssistantSpeech(text);
  }
}
