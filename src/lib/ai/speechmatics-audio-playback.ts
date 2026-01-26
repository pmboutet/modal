/**
 * Audio Playback for Speechmatics
 * Handles TTS audio playback, queue management, and speech stopping
 */

import * as Sentry from '@sentry/nextjs';
import { devWarn, devError } from '@/lib/utils';

export interface AudioPlaybackConfig {
  maxQueueSize?: number;
  gracePeriodMs?: number;
}

/**
 * Audio Playback module - handles TTS audio playback queue and controls
 */
export class SpeechmaticsAudioPlayback {
  private readonly maxQueueSize: number;
  private readonly gracePeriodMs: number;

  private audioContext: AudioContext | null = null;
  private currentAudioSource: AudioBufferSourceNode | null = null;
  private currentGainNode: GainNode | null = null;
  private audioPlaybackQueue: AudioBuffer[] = [];
  private isPlayingAudio: boolean = false;
  private lastAudioPlaybackEndTime: number = 0;

  private currentAssistantSpeech: string = '';
  private clearAssistantSpeechTimer: NodeJS.Timeout | null = null;
  private assistantSpeechVersion: number = 0;
  private onPlaybackEnd?: () => void;

  constructor(config: AudioPlaybackConfig = {}) {
    this.maxQueueSize = config.maxQueueSize ?? 10;
    this.gracePeriodMs = config.gracePeriodMs ?? 500;
  }

  setAudioContext(context: AudioContext | null): void { this.audioContext = context; }
  getAudioContext(): AudioContext | null { return this.audioContext; }
  setOnPlaybackEnd(callback: () => void): void { this.onPlaybackEnd = callback; }
  isPlaying(): boolean { return this.isPlayingAudio; }

  getTimeSincePlaybackEnded(): number {
    return this.lastAudioPlaybackEndTime === 0 ? Infinity : Date.now() - this.lastAudioPlaybackEndTime;
  }

  isInGracePeriod(): boolean {
    return this.lastAudioPlaybackEndTime > 0 && this.getTimeSincePlaybackEnded() < this.gracePeriodMs;
  }

  getCurrentAssistantSpeech(): string { return this.currentAssistantSpeech; }

  setCurrentAssistantSpeech(text: string): void {
    this.assistantSpeechVersion++;
    if (this.clearAssistantSpeechTimer) {
      clearTimeout(this.clearAssistantSpeechTimer);
      this.clearAssistantSpeechTimer = null;
    }
    this.currentAssistantSpeech = text;
  }

  async playAudio(audioData: Uint8Array): Promise<void> {
    if (!this.audioContext) {
      devWarn('[Speechmatics Playback] No audio context for playback');
      return;
    }

    try {
      const buffer = await this.audioDataToBuffer(audioData);
      if (this.audioPlaybackQueue.length >= this.maxQueueSize) {
        devWarn('[Speechmatics Playback] Audio queue full, dropping oldest buffer');
        this.audioPlaybackQueue.shift();
      }
      this.audioPlaybackQueue.push(buffer);
      if (!this.isPlayingAudio) this.playAudioBuffer();
    } catch (error) {
      devError('[Speechmatics Playback] Error playing audio:', error);
      Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
        tags: { component: 'speechmatics-audio-playback', error_type: 'audio_playback_error' },
        extra: { audioDataLength: audioData.length, isPlaying: this.isPlayingAudio, queueSize: this.audioPlaybackQueue.length },
        level: 'error',
      });
      this.isPlayingAudio = false;
    }
  }

  stopAgentSpeech(applyFade: boolean = true): void {
    this.lastAudioPlaybackEndTime = Date.now();

    if (!this.audioContext || !this.currentAudioSource) {
      this.audioPlaybackQueue = [];
      this.isPlayingAudio = false;
      this.currentAudioSource = null;
      this.currentGainNode = null;
      this.scheduleClearAssistantSpeech();
      return;
    }

    const source = this.currentAudioSource;
    const gainNode = this.currentGainNode;
    source.onended = null;
    this.audioPlaybackQueue = [];
    this.isPlayingAudio = false;

    try {
      if (gainNode && this.audioContext) {
        const now = this.audioContext.currentTime;
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        if (applyFade) {
          gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.1);
          source.stop(now + 0.1);
        } else {
          source.stop();
        }
        gainNode.disconnect();
      } else {
        source.stop();
      }
    } catch (error) {
      Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
        tags: { module: 'speechmatics-audio-playback', operation: 'stop_agent_speech' },
        level: 'warning',
      });
      try { source.stop(); } catch { /* ignore */ }
    } finally {
      source.disconnect();
      this.currentAudioSource = null;
      this.currentGainNode = null;
      this.scheduleClearAssistantSpeech();
    }
  }

  cleanup(): void {
    this.audioPlaybackQueue = [];
    this.isPlayingAudio = false;
    this.currentAssistantSpeech = '';
    if (this.clearAssistantSpeechTimer) {
      clearTimeout(this.clearAssistantSpeechTimer);
      this.clearAssistantSpeechTimer = null;
    }
    if (this.currentGainNode) {
      try { this.currentGainNode.disconnect(); } catch { /* ignore */ }
      this.currentGainNode = null;
    }
  }

  async streamToUint8Array(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return combined;
  }

  private playAudioBuffer(): void {
    if (!this.audioContext) return;

    const nextBuffer = this.audioPlaybackQueue.shift();
    if (!nextBuffer) {
      this.isPlayingAudio = false;
      this.currentAudioSource = null;
      this.currentGainNode = null;
      return;
    }

    this.isPlayingAudio = true;
    const source = this.audioContext.createBufferSource();
    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = 1.0;
    source.buffer = nextBuffer;
    source.playbackRate.value = 1.0;
    source.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    this.currentAudioSource = source;
    this.currentGainNode = gainNode;

    source.onended = () => {
      if (this.currentGainNode) this.currentGainNode.disconnect();
      source.disconnect();
      this.currentAudioSource = null;
      this.currentGainNode = null;
      if (this.audioPlaybackQueue.length > 0) {
        this.playAudioBuffer();
      } else {
        this.isPlayingAudio = false;
        this.lastAudioPlaybackEndTime = Date.now();
        this.onPlaybackEnd?.();
      }
    };

    source.start();
  }

  private scheduleClearAssistantSpeech(): void {
    if (this.clearAssistantSpeechTimer) clearTimeout(this.clearAssistantSpeechTimer);
    const versionAtSchedule = this.assistantSpeechVersion;
    this.clearAssistantSpeechTimer = setTimeout(() => {
      if (this.assistantSpeechVersion === versionAtSchedule) this.currentAssistantSpeech = '';
      this.clearAssistantSpeechTimer = null;
    }, this.gracePeriodMs);
  }

  private async audioDataToBuffer(audioData: Uint8Array): Promise<AudioBuffer> {
    if (!this.audioContext) throw new Error('No audio context');
    try {
      let arrayBuffer: ArrayBuffer;
      if (audioData.byteOffset === 0 && audioData.byteLength === audioData.buffer.byteLength) {
        arrayBuffer = audioData.buffer.slice(0) as ArrayBuffer;
      } else {
        arrayBuffer = audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength) as ArrayBuffer;
      }
      return await this.audioContext.decodeAudioData(arrayBuffer);
    } catch (error) {
      Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
        tags: { module: 'speechmatics-audio-playback', operation: 'decode_audio_data' },
        extra: { audioDataLength: audioData.length, audioContextState: this.audioContext?.state },
        level: 'error',
      });
      throw error;
    }
  }
}
