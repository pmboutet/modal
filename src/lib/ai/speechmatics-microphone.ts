/**
 * Microphone Management for Speechmatics
 * Handles microphone input, AudioWorklet setup, and stream management
 */

import * as Sentry from '@sentry/nextjs';
import { devWarn, devError } from '@/lib/utils';

export type AudioDataCallback = (data: Int16Array) => void;
export type NoiseFloorCallback = (noiseFloor: number) => void;

export interface MicrophoneConfig {
  enableWorkletAGC?: boolean;
}

/**
 * Microphone module - handles microphone input and AudioWorklet setup
 */
export class SpeechmaticsMicrophone {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: AudioWorkletNode | null = null;
  private isMicrophoneActive: boolean = false;
  private isMuted: boolean = false;
  private enableWorkletAGC: boolean;

  private readonly isFirefox = typeof navigator !== 'undefined' && navigator.userAgent.includes('Firefox');
  private readonly isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);

  private onAudioData?: AudioDataCallback;
  private onNoiseFloor?: NoiseFloorCallback;

  constructor(config: MicrophoneConfig = {}) {
    this.enableWorkletAGC = config.enableWorkletAGC ?? true;
  }

  setOnAudioData(callback: AudioDataCallback): void { this.onAudioData = callback; }
  setOnNoiseFloor(callback: NoiseFloorCallback): void { this.onNoiseFloor = callback; }
  getAudioContext(): AudioContext | null { return this.audioContext; }
  isActive(): boolean { return this.isMicrophoneActive; }
  getMuted(): boolean { return this.isMuted; }

  async start(deviceId?: string, voiceIsolation: boolean = true): Promise<AudioContext> {
    if (this.isMicrophoneActive && this.audioContext) {
      devWarn('[Speechmatics Microphone] Already active, stopping before restart');
      await this.stop();
    }

    const audioConstraints = this.buildAudioConstraints(deviceId, voiceIsolation);
    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    this.audioContext = await this.createAudioContext();
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    await this.setupAudioWorklet(this.audioContext, this.sourceNode);
    this.isMicrophoneActive = true;
    this.isMuted = false;
    return this.audioContext;
  }

  async stop(): Promise<void> {
    this.isMicrophoneActive = false;
    this.isMuted = false;

    if (this.processorNode) {
      try {
        this.processorNode.port.onmessage = null;
        this.processorNode.port.postMessage({ type: 'stop' });
        this.processorNode.disconnect();
      } catch (error) {
        Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
          tags: { module: 'speechmatics-microphone', operation: 'stop_processor' },
          level: 'warning',
        });
      }
      this.processorNode = null;
    }

    if (this.mediaStream) {
      try {
        this.mediaStream.getTracks().forEach(track => track.readyState === 'live' && track.stop());
      } catch (error) {
        Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
          tags: { module: 'speechmatics-microphone', operation: 'stop_media_stream' },
          level: 'warning',
        });
      }
      this.mediaStream = null;
    }

    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch { /* ignore */ }
      this.sourceNode = null;
    }

    if (this.audioContext) {
      try { if (this.audioContext.state !== 'closed') this.audioContext.close().catch(() => {}); } catch { /* ignore */ }
      this.audioContext = null;
    }
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    const hasStream = Boolean(this.mediaStream);
    this.isMicrophoneActive = !muted && hasStream;

    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach(track => {
        if (track.readyState === 'live') track.enabled = !muted;
      });
    }

    if (muted) {
      if (this.processorNode) {
        try { this.processorNode.port.postMessage({ type: 'stop' }); } catch { /* ignore */ }
      }
      if (this.processorNode && this.sourceNode) {
        try { this.sourceNode.disconnect(this.processorNode); } catch { /* ignore */ }
      }
    } else if (hasStream && this.processorNode && this.sourceNode && this.audioContext) {
      try {
        this.sourceNode.connect(this.processorNode);
        this.processorNode.connect(this.audioContext.destination);
        this.processorNode.port.postMessage({ type: 'start' });
      } catch { /* ignore */ }
    }
  }

  setWorkletAGC(enabled: boolean): void {
    this.enableWorkletAGC = enabled;
    if (this.processorNode) {
      this.processorNode.port.postMessage({ type: 'config', enableAGC: enabled });
    }
  }

  private buildAudioConstraints(deviceId?: string, voiceIsolation: boolean = true): MediaTrackConstraints {
    const base: MediaTrackConstraints = {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: voiceIsolation,
    };

    if (this.isFirefox) return { ...base, noiseSuppression: false };
    if (this.isIOS) return { ...base, noiseSuppression: voiceIsolation, autoGainControl: voiceIsolation };
    return { ...base, noiseSuppression: voiceIsolation, autoGainControl: voiceIsolation, sampleRate: 16000, channelCount: 1 };
  }

  private async createAudioContext(): Promise<AudioContext> {
    if (this.isFirefox || this.isIOS) {
      const ctx = new AudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
        await new Promise(r => setTimeout(r, 100));
      }
      return ctx;
    }
    return new AudioContext({ sampleRate: 16000 });
  }

  private async setupAudioWorklet(audioContext: AudioContext, source: MediaStreamAudioSourceNode): Promise<void> {
    try {
      await audioContext.audioWorklet.addModule('/speechmatics-audio-processor.js');
    } catch (error) {
      devError('[Speechmatics Microphone] Failed to load AudioWorklet module:', error);
      Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
        tags: { component: 'speechmatics-microphone', error_type: 'audioworklet_load_error' },
        extra: { isFirefox: this.isFirefox, isIOS: this.isIOS, audioContextState: audioContext.state, sampleRate: audioContext.sampleRate },
        level: 'error',
      });
      throw new Error(`Failed to load AudioWorklet: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    const processor = new AudioWorkletNode(audioContext, 'speechmatics-audio-processor', {
      processorOptions: { isFirefox: this.isFirefox, enableAGC: this.enableWorkletAGC },
      numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1
    });
    this.processorNode = processor;

    processor.port.onmessage = (event) => {
      if (!this.isMicrophoneActive || this.isMuted) return;
      if (event.data.type === 'noiseFloor' && !this.isMuted) {
        this.onNoiseFloor?.(event.data.noiseFloor);
        return;
      }
      if (event.data.type === 'audio' && this.isMicrophoneActive && !this.isMuted) {
        this.onAudioData?.(new Int16Array(event.data.data));
      }
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
  }
}
