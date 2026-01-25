/**
 * Audio management for Speechmatics Voice Agent
 * Handles microphone input, audio playback, VAD, and barge-in
 */

import { devLog, devWarn, devError } from '@/lib/utils';
import { AudioChunkDedupe } from './speechmatics-audio-dedupe';
import {
  createStartOfTurnDetector,
  resolveStartOfTurnDetectorConfig,
  type StartOfTurnDetector,
  type StartOfTurnMessage,
} from './start-of-turn-detection';

export class SpeechmaticsAudio {
  private static instanceCounter = 0;
  private instanceId: number;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: AudioWorkletNode | null = null;
  private currentAudioSource: AudioBufferSourceNode | null = null;
  private currentGainNode: GainNode | null = null;
  private audioPlaybackQueue: AudioBuffer[] = [];
  private isPlayingAudio: boolean = false;
  private nextStartTime: number = 0;
  private isMicrophoneActive: boolean = false;
  private isMuted: boolean = false;
  private isFirefox: boolean;
  
  private lastUserSpeechTimestamp: number = 0;
  private lastBargeInTime: number = 0;
  private readonly BARGE_IN_COOLDOWN_MS = 1500; // Increased from 750ms to prevent echo-triggered barge-ins
  private readonly BASE_VAD_RMS_THRESHOLD = 0.015; // ~-36 dB threshold (base)
  private vadRmsThreshold: number = 0.015; // Dynamic threshold based on sensitivity
  private readonly VAD_SAMPLE_STRIDE = 4;

  // Grace period after audio playback ends to prevent echo-triggered barge-ins
  // SIMPLIFIED: Reduced to 500ms - we rely more on echo text matching now
  private lastAudioPlaybackEndTime: number = 0;
  private readonly AUDIO_PLAYBACK_GRACE_PERIOD_MS = 500; // 500ms minimal echo protection

  // Timer to clear currentAssistantSpeech after grace period
  // We keep the assistant speech text for echo detection even after audio stops
  private clearAssistantSpeechTimer: NodeJS.Timeout | null = null;
  // BUG-016 FIX: Version token to detect stale reads during race conditions
  // Incremented when new speech is set, checked before clearing to avoid race
  private assistantSpeechVersion: number = 0;

  // Semantic barge-in detection state
  // SIMPLIFIED: Immediate barge-in, no complex validation
  private bargeInPendingValidation: boolean = false;
  private bargeInValidationTimer: NodeJS.Timeout | null = null;
  // BUG-018 FIX: Increased timeout from 300ms to 600ms to allow partial transcripts
  // to arrive before canceling barge-in (300ms was too short for reliable detection)
  private readonly BARGE_IN_VALIDATION_TIMEOUT_MS = 600;
  private currentAssistantSpeech: string = ''; // Track what assistant is currently saying (for echo detection)

  // Start-of-turn detection (AI-powered validation)
  private startOfTurnDetector: StartOfTurnDetector | null = null;
  private conversationHistory: StartOfTurnMessage[] = []; // Track conversation for context

  // Speaker identification from diarization (for echo detection)
  private primaryUserSpeaker: string | undefined = undefined; // Established user speaker ID (S1, S2, etc.)
  private lastSeenSpeaker: string | undefined = undefined; // Most recent speaker from transcription
  
  // VAD state for continuous voice activity tracking
  private recentVoiceActivity: boolean[] = []; // Sliding window of recent VAD results
  private readonly VAD_WINDOW_SIZE = 5; // Number of chunks to track
  private hasRecentVoiceActivity: boolean = false; // Cached result
  
  // Adaptive sensitivity and noise gate
  private enableAdaptiveSensitivity: boolean = true;
  private enableAdaptiveNoiseGate: boolean = true;
  private enableWorkletAGC: boolean = true;
  private noiseFloor: number = 0.01; // Estimated noise floor from AudioWorklet
  private noiseFloorHistory: number[] = []; // History for smoothing
  private readonly NOISE_FLOOR_HISTORY_SIZE = 10;
  private sensitivityMultiplier: number = 1.0; // User-set sensitivity multiplier
  private adaptiveThresholdMargin: number = 0.005; // Margin above noise floor
  private readonly MIN_VAD_THRESHOLD = 0.005; // Minimum threshold
  private readonly MAX_VAD_THRESHOLD = 0.1; // Maximum threshold
  private adaptiveThresholdUpdateCount: number = 0;
  
  // Hybrid noise gate - spectral energy detection
  private spectralEnergyHistory: number[] = []; // History for spectral analysis
  private readonly SPECTRAL_HISTORY_SIZE = 5;

  /**
   * Echo detection details passed to the onEchoDetected callback
   * BUG-008 FIX: Provide context about why echo was detected
   */
  public static lastEchoDetails: {
    transcript: string;
    matchType: 'contained' | 'fuzzy-words' | 'speaker-mismatch' | 'ai-detected' | 'none';
    similarity: number;
    detectedAt: number;
  } | null = null;

  constructor(
    private audioDedupe: AudioChunkDedupe,
    private onAudioChunk: (chunk: Int16Array) => void,
    private ws: WebSocket | null,
    private onBargeIn?: () => void,
    private onAudioPlaybackEnd?: () => void,
    // BUG-008 FIX: Updated callback signature to include echo details
    private onEchoDetected?: (details?: { transcript: string; matchType: string; similarity: number }) => void
  ) {
    this.instanceId = ++SpeechmaticsAudio.instanceCounter;
    this.isFirefox = typeof navigator !== 'undefined' && navigator.userAgent.includes('Firefox');

    // Initialize start-of-turn detector
    const startOfTurnConfig = resolveStartOfTurnDetectorConfig();
    this.startOfTurnDetector = createStartOfTurnDetector(startOfTurnConfig);

  }

  async startMicrophone(deviceId?: string, voiceIsolation: boolean = true): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to Speechmatics');
    }

    // MEMORY LEAK FIX: Check if microphone is already active
    // If so, stop it first to prevent AudioContext accumulation
    if (this.isMicrophoneActive && this.audioContext) {
      devWarn('[Speechmatics Audio] ⚠️ Microphone already active, stopping before restart');
      await this.stopMicrophone();
    }

    // Configure audio constraints
    let audioConstraints: MediaTrackConstraints;
    
    if (this.isFirefox) {
      audioConstraints = {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: voiceIsolation,
        noiseSuppression: false, // Firefox doesn't support noiseSuppression well
      };
    } else {
      audioConstraints = {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: voiceIsolation,
        noiseSuppression: voiceIsolation,
        autoGainControl: voiceIsolation,
        sampleRate: 16000,
        channelCount: 1
      };
    }

    // Remove undefined values (TypeScript-safe way)
    const cleanedConstraints: MediaTrackConstraints = {};
    Object.keys(audioConstraints).forEach(key => {
      const value = audioConstraints[key as keyof MediaTrackConstraints];
      if (value !== undefined) {
        (cleanedConstraints as any)[key] = value;
      }
    });
    const finalConstraints = Object.keys(cleanedConstraints).length > 0 ? cleanedConstraints : audioConstraints;

    // Get microphone stream
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: finalConstraints
    });
    this.mediaStream = stream;

    // Create audio context
    let audioContext: AudioContext;
    if (this.isFirefox) {
      audioContext = new AudioContext();
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } else {
      audioContext = new AudioContext({ sampleRate: 16000 });
    }
    this.audioContext = audioContext;

    // Create source from stream
    const source = audioContext.createMediaStreamSource(stream);
    this.sourceNode = source;

    // Load AudioWorklet module
    try {
      await audioContext.audioWorklet.addModule('/speechmatics-audio-processor.js');
    } catch (error) {
      devError('[Speechmatics] ❌ Failed to load AudioWorklet module:', error);
      throw new Error(`Failed to load AudioWorklet: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Create AudioWorkletNode
    const processorOptions = {
      processorOptions: {
        isFirefox: this.isFirefox,
        enableAGC: this.enableWorkletAGC
      },
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1
    };
    
    const processor = new AudioWorkletNode(audioContext, 'speechmatics-audio-processor', processorOptions);
    this.processorNode = processor;

    this.isMicrophoneActive = true;
    this.isMuted = false;
    this.lastUserSpeechTimestamp = 0;
    this.lastBargeInTime = 0;
    
    // Reset VAD state
    this.recentVoiceActivity = [];
    this.hasRecentVoiceActivity = false;
    
    // Reset adaptive sensitivity state
    this.noiseFloor = 0.01;
    this.noiseFloorHistory = [];
    this.adaptiveThresholdUpdateCount = 0;
    this.spectralEnergyHistory = [];
    
    // Reset dedupe cache
    this.audioDedupe.reset();

    // Handle audio data from AudioWorklet
    processor.port.onmessage = (event) => {
      // CRITICAL: Check flags FIRST to prevent any audio from being sent after disconnect
      // According to Speechmatics API: "Protocol specification doesn't allow adding audio after EndOfStream"
      if (!this.isMicrophoneActive || this.isMuted) {
        return; // Stop immediately if microphone is inactive or muted
      }

      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return; // Stop if WebSocket is not open
      }

      // Handle noise floor updates from AudioWorklet
      if (event.data.type === 'noiseFloor') {
        // Don't process noise floor updates when muted
        if (!this.isMuted) {
          this.updateNoiseFloor(event.data.noiseFloor);
        }
        return;
      }

      if (event.data.type === 'audio') {
        // Triple-check microphone state (race condition protection)
        // This ensures no audio is sent after stopMicrophone() is called
        if (!this.isMicrophoneActive || this.isMuted) {
          return;
        }

        const pcmData = new Int16Array(event.data.data);
        
        // Hybrid noise gate: Use multi-criteria detection (RMS + spectral energy)
        const hasVoiceActivity = this.detectVoiceActivityHybrid(pcmData);
        
        // Check for barge-in
        if (!this.isMuted && this.isPlayingAudio && hasVoiceActivity) {
          this.handleBargeIn();
        }

        // BUG FIX: Only update VAD sliding window when AI is NOT playing audio
        // When AI is playing, the microphone picks up the echo which causes false "user speaking" detection
        // This was causing LLM responses to be dropped because isUserSpeaking() returned true due to echo
        if (!this.isPlayingAudio) {
          // Update VAD sliding window
          this.recentVoiceActivity.push(hasVoiceActivity);
          if (this.recentVoiceActivity.length > this.VAD_WINDOW_SIZE) {
            this.recentVoiceActivity.shift();
          }

          // Calculate if we have recent voice activity
          // Increased from 2 to 3 out of 5 chunks to reduce false positives from brief noise/echo
          const activeChunks = this.recentVoiceActivity.filter(v => v).length;
          this.hasRecentVoiceActivity = activeChunks >= 3;
        }
        
        // Adaptive noise gate: Only send audio chunks if we have recent voice activity
        // This filters out background noise and distant conversations while allowing
        // natural speech pauses (we send a few chunks after voice stops)
        if (this.enableAdaptiveNoiseGate) {
          if (!this.hasRecentVoiceActivity && !hasVoiceActivity) {
            return; // Skip silent/background audio chunks
          }
        } else {
          // Fallback to simple VAD if adaptive noise gate is disabled
          if (!this.hasRecentVoiceActivity && !hasVoiceActivity) {
            return;
          }
        }
        
        // Deduplicate and send
        const signature = this.audioDedupe.computeChunkSignature(pcmData);
        if (this.audioDedupe.shouldSkipChunk(signature)) {
          return;
        }

        // Send audio to WebSocket (chunks with voice activity or recent voice activity)
        try {
          if (this.ws) {
            this.ws.send(pcmData.buffer);
          }
        } catch (error) {
          devError('[Speechmatics] ❌ Error sending audio:', error);
        }
      }
    };

    // Connect audio graph
    source.connect(processor);
    processor.connect(audioContext.destination);
  }

  async stopMicrophone(): Promise<void> {
    // CRITICAL: Set flags FIRST to stop any audio from being sent
    // This must happen before we stop the stream to prevent race conditions
    this.isMicrophoneActive = false;
    this.isMuted = false;
    this.stopAgentSpeech(false);

    // Clear barge-in validation state
    this.cancelBargeInValidation();

    // Clear assistant speech clearing timer
    if (this.clearAssistantSpeechTimer) {
      clearTimeout(this.clearAssistantSpeechTimer);
      this.clearAssistantSpeechTimer = null;
    }
    this.currentAssistantSpeech = '';

    // Reset speaker tracking (will be re-established on next session)
    this.primaryUserSpeaker = undefined;
    this.lastSeenSpeaker = undefined;

    // Clear AudioWorklet handler FIRST to stop processing new audio chunks
    // This prevents any audio from being sent after we start disconnecting
    if (this.processorNode) {
      try {
        this.processorNode.port.onmessage = null;
        this.processorNode.port.postMessage({ type: 'stop' });
        this.processorNode.disconnect();
        this.processorNode = null;
      } catch (error) {
        devWarn('[Speechmatics] Error stopping processor:', error);
      }
    }

    // Stop media stream tracks AFTER clearing handler
    // This ensures no new audio chunks are generated
    // CRITICAL: Stop ALL tracks (audio + video if present) to fully release the microphone
    if (this.mediaStream) {
      try {
        const tracks = this.mediaStream.getTracks();
        tracks.forEach(track => {
          if (track.readyState === 'live') {
            track.stop();
          }
        });
        this.mediaStream = null;
      } catch (error) {
        devWarn('[Speechmatics] Error stopping media stream:', error);
      }
    }

    // CRITICAL: Disconnect ALL AudioNodes before closing AudioContext
    // This ensures no audio graph connections remain active
    // Order matters: disconnect nodes before closing context
    
    // Disconnect gain node if present (from audio playback)
    if (this.currentGainNode) {
      try {
        this.currentGainNode.disconnect();
        this.currentGainNode = null;
      } catch {
        // Ignore disconnect errors
      }
    }

    // Disconnect source node
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
        this.sourceNode = null;
      } catch {
        // Ignore disconnect errors
      }
    }

    // Close audio context AFTER all nodes are disconnected
    if (this.audioContext) {
      try {
        if (this.audioContext.state !== 'closed') {
          this.audioContext.close().catch(() => {});
        }
        this.audioContext = null;
      } catch {
        // Ignore close errors
      }
    }

    // NOTE: enumerateDevices() is now called AFTER WebSocket disconnect in speechmatics.ts
    // This ensures all resources are fully released before forcing browser cleanup
  }

  setMicrophoneMuted(muted: boolean): void {
    this.isMuted = muted;
    const hasStream = Boolean(this.mediaStream);
    this.isMicrophoneActive = !muted && hasStream;

    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach(track => {
        if (track.readyState === 'live') {
          track.enabled = !muted;
        }
      });
    }

    if (muted) {
      this.stopAgentSpeech(true);
      // Tell AudioWorklet to stop processing FIRST
      if (this.processorNode) {
        try {
          this.processorNode.port.postMessage({ type: 'stop' });
        } catch {
          // Ignore errors
        }
      }
      // Then disconnect audio processor to stop audio flow
      if (this.processorNode && this.sourceNode) {
        try {
          this.sourceNode.disconnect(this.processorNode);
        } catch {
          // Ignore disconnect errors
        }
      }
    } else if (!hasStream) {
      this.isMicrophoneActive = false;
    } else {
      // Reconnect audio processor when unmuting
      if (this.processorNode && this.sourceNode && this.audioContext) {
        try {
          this.sourceNode.connect(this.processorNode);
          this.processorNode.connect(this.audioContext.destination);
          this.processorNode.port.postMessage({ type: 'start' });
        } catch {
          // Ignore reconnect errors
        }
      }
    }
  }

  /**
   * Set microphone sensitivity
   * @param sensitivity Multiplier for VAD threshold (0.5 = more sensitive, 2.0 = less sensitive)
   * Higher values = less sensitive = ignores distant/quieter sounds
   */
  setMicrophoneSensitivity(sensitivity: number = 1.0): void {
    // Clamp sensitivity between 0.3 and 3.0
    const clampedSensitivity = Math.max(0.3, Math.min(3.0, sensitivity));
    this.sensitivityMultiplier = clampedSensitivity;
    
    // Update base threshold (used when adaptive sensitivity is disabled)
    this.vadRmsThreshold = this.BASE_VAD_RMS_THRESHOLD * clampedSensitivity;
    
    // Update adaptive threshold if enabled
    if (this.enableAdaptiveSensitivity) {
      this.updateAdaptiveThreshold();
    }
    
  }
  
  /**
   * Configure adaptive features
   */
  setAdaptiveFeatures(config: {
    enableAdaptiveSensitivity?: boolean;
    enableAdaptiveNoiseGate?: boolean;
    enableWorkletAGC?: boolean;
  }): void {
    if (config.enableAdaptiveSensitivity !== undefined) {
      this.enableAdaptiveSensitivity = config.enableAdaptiveSensitivity;
      if (this.enableAdaptiveSensitivity) {
        this.updateAdaptiveThreshold();
      }
    }
    if (config.enableAdaptiveNoiseGate !== undefined) {
      this.enableAdaptiveNoiseGate = config.enableAdaptiveNoiseGate;
    }
    if (config.enableWorkletAGC !== undefined) {
      this.enableWorkletAGC = config.enableWorkletAGC;
      // Update AudioWorklet if processor exists
      if (this.processorNode) {
        this.processorNode.port.postMessage({
          type: 'config',
          enableAGC: this.enableWorkletAGC
        });
      }
    }
  }

  async playAudio(audioData: Uint8Array): Promise<void> {
    if (!this.audioContext) {
      devWarn('[Speechmatics] ⚠️ No audio context for playback');
      return;
    }

    try {
      const buffer = await this.audioDataToBuffer(audioData);
      this.audioPlaybackQueue.push(buffer);
      if (!this.isPlayingAudio) {
        this.playAudioBuffer();
      }
    } catch (error) {
      devError('[Speechmatics] ❌ Error playing audio:', error);
      this.isPlayingAudio = false;
    }
  }

  private playAudioBuffer(): void {
    if (!this.audioContext) {
      return;
    }

    const nextBuffer = this.audioPlaybackQueue.shift();
    if (!nextBuffer) {
      this.isPlayingAudio = false;
      this.currentAudioSource = null;
      this.currentGainNode = null;
      this.nextStartTime = this.audioContext.currentTime;
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
      if (this.currentGainNode) {
        this.currentGainNode.disconnect();
      }
      source.disconnect();
      this.currentAudioSource = null;
      this.currentGainNode = null;

      if (this.audioPlaybackQueue.length > 0) {
        this.playAudioBuffer();
      } else {
        this.isPlayingAudio = false;
        this.nextStartTime = this.audioContext ? this.audioContext.currentTime : 0;
        // Record when audio playback ended for grace period tracking
        this.lastAudioPlaybackEndTime = Date.now();
        // BUG FIX: Clear VAD sliding window when audio playback ends
        // This ensures we start fresh without echo contamination
        this.recentVoiceActivity = [];
        this.hasRecentVoiceActivity = false;
        // Notify parent that audio playback has ended (for inactivity timer)
        this.onAudioPlaybackEnd?.();
      }
    };

    source.start();
  }

  stopAgentSpeech(applyFade: boolean = true): void {
    // Record when audio stopped for grace period tracking
    this.lastAudioPlaybackEndTime = Date.now();

    if (!this.audioContext) {
      this.audioPlaybackQueue = [];
      this.isPlayingAudio = false;
      this.currentAudioSource = null;
      this.currentGainNode = null;
      // Schedule clearing of assistant speech after grace period (for echo detection)
      this.scheduleClearAssistantSpeech();
      return;
    }

    if (!this.currentAudioSource) {
      this.audioPlaybackQueue = [];
      this.isPlayingAudio = false;
      // Schedule clearing of assistant speech after grace period (for echo detection)
      this.scheduleClearAssistantSpeech();
      return;
    }

    const source = this.currentAudioSource;
    const gainNode = this.currentGainNode;
    source.onended = null;
    this.audioPlaybackQueue = [];
    this.isPlayingAudio = false;
    this.nextStartTime = this.audioContext.currentTime;

    try {
      if (gainNode) {
        const now = this.audioContext.currentTime;
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);

        if (applyFade) {
          const fadeEnd = now + 0.1;
          gainNode.gain.linearRampToValueAtTime(0.0001, fadeEnd);
          source.stop(fadeEnd);
        } else {
          source.stop();
        }

        gainNode.disconnect();
      } else {
        source.stop();
      }
    } catch (error) {
      devWarn('[Speechmatics] Error stopping agent speech:', error);
      try {
        source.stop();
      } catch {
        // Ignore additional errors
      }
    } finally {
      source.disconnect();
      this.currentAudioSource = null;
      this.currentGainNode = null;
      // DON'T clear currentAssistantSpeech immediately - keep it for echo detection
      // Schedule clearing after grace period instead
      this.scheduleClearAssistantSpeech();
    }
  }

  /**
   * Schedule clearing of currentAssistantSpeech after grace period
   * This keeps the text available for echo detection while residual echo may still be captured
   *
   * BUG-016 FIX: Use version token to prevent race condition where echo detection
   * reads stale content just as the clearing timer fires. The timer captures the
   * current version and only clears if it hasn't changed (no new speech started).
   */
  private scheduleClearAssistantSpeech(): void {
    // Clear any existing timer
    if (this.clearAssistantSpeechTimer) {
      clearTimeout(this.clearAssistantSpeechTimer);
    }

    // BUG-016 FIX: Capture current version to detect if new speech starts before timer fires
    const versionAtSchedule = this.assistantSpeechVersion;

    // Schedule clearing after grace period
    this.clearAssistantSpeechTimer = setTimeout(() => {
      // BUG-016 FIX: Only clear if version hasn't changed (no new speech started)
      // This prevents clearing content that was set by a newer setCurrentAssistantSpeech() call
      if (this.assistantSpeechVersion === versionAtSchedule) {
        this.currentAssistantSpeech = '';
      }
      this.clearAssistantSpeechTimer = null;
    }, this.AUDIO_PLAYBACK_GRACE_PERIOD_MS);
  }

  private detectVoiceActivity(chunk: Int16Array): boolean {
    if (!chunk.length) {
      return false;
    }

    let sumSquares = 0;
    let samples = 0;

    for (let i = 0; i < chunk.length; i += this.VAD_SAMPLE_STRIDE) {
      const sample = chunk[i] / 32768;
      sumSquares += sample * sample;
      samples++;
    }

    if (samples === 0) {
      return false;
    }

    const rms = Math.sqrt(sumSquares / samples);
    
    // Use adaptive threshold if enabled
    const threshold = this.enableAdaptiveSensitivity 
      ? this.getAdaptiveThreshold() 
      : this.vadRmsThreshold;
    
    return rms > threshold;
  }
  
  /**
   * Hybrid voice activity detection using RMS + spectral energy
   * More accurate than RMS-only detection
   * Uses stricter criteria when audio is playing to prevent echo detection
   */
  private detectVoiceActivityHybrid(chunk: Int16Array): boolean {
    if (!chunk.length) {
      return false;
    }

    // Calculate RMS
    let sumSquares = 0;
    let samples = 0;
    for (let i = 0; i < chunk.length; i += this.VAD_SAMPLE_STRIDE) {
      const sample = chunk[i] / 32768;
      sumSquares += sample * sample;
      samples++;
    }

    if (samples === 0) {
      return false;
    }

    const rms = Math.sqrt(sumSquares / samples);

    // Calculate spectral energy in vocal frequency range (300-3400 Hz)
    // Simple approximation: use high-frequency content as proxy
    const spectralEnergy = this.calculateSpectralEnergy(chunk);

    // Update spectral energy history
    this.spectralEnergyHistory.push(spectralEnergy);
    if (this.spectralEnergyHistory.length > this.SPECTRAL_HISTORY_SIZE) {
      this.spectralEnergyHistory.shift();
    }

    // Use adaptive threshold if enabled
    const threshold = this.enableAdaptiveSensitivity
      ? this.getAdaptiveThreshold()
      : this.vadRmsThreshold;

    // Multi-criteria decision:
    // 1. RMS above threshold (basic energy)
    // 2. Spectral energy indicates voice frequencies
    const rmsCheck = rms > threshold;
    // Increased spectral threshold from 0.5 to 0.75 to reduce false positives from echo
    const spectralCheck = spectralEnergy > threshold * 0.75;

    // When audio is playing, use STRICTER criteria (AND logic) to prevent echo detection
    // The speaker output creates both RMS and spectral energy that can trigger false positives
    if (this.isPlayingAudio) {
      // Both conditions must be met when audio is playing
      // This significantly reduces echo-triggered barge-ins
      return rmsCheck && spectralCheck;
    }

    // When no audio is playing, use standard criteria (OR logic)
    // This allows detection of quiet speech with good spectral characteristics
    return rmsCheck || spectralCheck;
  }
  
  /**
   * Calculate spectral energy as approximation of voice frequency content
   * Uses simple high-frequency emphasis filter
   */
  private calculateSpectralEnergy(chunk: Int16Array): number {
    if (chunk.length < 2) return 0;
    
    // Simple high-pass filter approximation: emphasize differences
    let energy = 0;
    for (let i = 1; i < chunk.length; i++) {
      const diff = Math.abs(chunk[i] - chunk[i - 1]) / 32768;
      energy += diff * diff;
    }
    
    return Math.sqrt(energy / (chunk.length - 1));
  }
  
  /**
   * Update noise floor from AudioWorklet and adjust adaptive threshold
   */
  private updateNoiseFloor(newNoiseFloor: number): void {
    if (!this.enableAdaptiveSensitivity) {
      return;
    }
    
    // Smooth noise floor updates
    this.noiseFloorHistory.push(newNoiseFloor);
    if (this.noiseFloorHistory.length > this.NOISE_FLOOR_HISTORY_SIZE) {
      this.noiseFloorHistory.shift();
    }
    
    // Use median for robustness against outliers
    const sorted = [...this.noiseFloorHistory].sort((a, b) => a - b);
    const medianIndex = Math.floor(sorted.length / 2);
    this.noiseFloor = sorted[medianIndex] || newNoiseFloor;
    
    // Update adaptive threshold
    this.updateAdaptiveThreshold();
  }
  
  /**
   * Calculate adaptive VAD threshold based on noise floor
   */
  private getAdaptiveThreshold(): number {
    if (!this.enableAdaptiveSensitivity || this.noiseFloor <= 0) {
      return this.vadRmsThreshold;
    }
    
    // Adaptive threshold = noise floor * sensitivity multiplier + margin
    const adaptiveThreshold = (this.noiseFloor * this.sensitivityMultiplier) + this.adaptiveThresholdMargin;
    
    // Clamp to min/max bounds
    return Math.max(this.MIN_VAD_THRESHOLD, Math.min(this.MAX_VAD_THRESHOLD, adaptiveThreshold));
  }
  
  /**
   * Update adaptive threshold and log changes periodically
   */
  private updateAdaptiveThreshold(): void {
    if (!this.enableAdaptiveSensitivity) {
      return;
    }
    
    const newThreshold = this.getAdaptiveThreshold();
    
    // Track updates silently (removed log - too noisy)
    this.adaptiveThresholdUpdateCount++;
  }

  private handleBargeIn(): void {
    if (!this.isPlayingAudio) {
      return;
    }

    const now = Date.now();
    if (now - this.lastBargeInTime < this.BARGE_IN_COOLDOWN_MS) {
      return;
    }

    // CRITICAL: Check if we're in the grace period after audio playback ended
    // This prevents echo-triggered barge-ins when residual audio is still in the room
    const timeSincePlaybackEnded = now - this.lastAudioPlaybackEndTime;
    if (this.lastAudioPlaybackEndTime > 0 && timeSincePlaybackEnded < this.AUDIO_PLAYBACK_GRACE_PERIOD_MS) {
      return;
    }

    // If barge-in is already pending validation, don't trigger again
    if (this.bargeInPendingValidation) {
      return;
    }

    // Mark barge-in as pending validation
    this.bargeInPendingValidation = true;
    this.lastUserSpeechTimestamp = now;

    // Set timeout to CANCEL barge-in if we don't get valid transcript within timeout
    // This prevents echo from triggering interruption when no real user speech is detected
    this.bargeInValidationTimer = setTimeout(() => {
      this.cancelBargeInValidation();
    }, this.BARGE_IN_VALIDATION_TIMEOUT_MS);
  }

  /**
   * Confirm barge-in and interrupt assistant response
   * Called either by transcript validation or by timeout
   */
  private confirmBargeIn(): void {
    if (!this.bargeInPendingValidation) {
      return;
    }

    // Clear validation timer
    if (this.bargeInValidationTimer) {
      clearTimeout(this.bargeInValidationTimer);
      this.bargeInValidationTimer = null;
    }

    // Reset validation state
    this.bargeInPendingValidation = false;
    this.lastBargeInTime = Date.now();

    this.stopAgentSpeech(true);

    // Notify parent agent to abort response
    this.onBargeIn?.();
  }

  /**
   * Validate barge-in with transcript content using AI-powered start-of-turn detection
   * Called by parent agent when partial transcript is received
   * @param transcript The partial transcript content
   * @param recentContext Recent conversation content (deprecated - using conversationHistory now)
   * @param speaker Optional speaker identifier from diarization (S1, S2, UU)
   * @returns true if barge-in should be confirmed, false otherwise
   */
  async validateBargeInWithTranscript(transcript: string, recentContext?: string, speaker?: string): Promise<boolean> {
    // Track speaker for echo detection
    if (speaker) {
      this.lastSeenSpeaker = speaker;

      // Establish primary user speaker if not set (first speaker we see when not playing audio)
      if (!this.primaryUserSpeaker && !this.isPlayingAudio && speaker !== 'UU') {
        this.primaryUserSpeaker = speaker;
      }
    }
    if (!this.bargeInPendingValidation) {
      return false;
    }

    // CRITICAL: Check if we're in the grace period after audio playback ended
    // Even if barge-in is pending, we should be extra cautious during this period
    const now = Date.now();
    const timeSincePlaybackEnded = now - this.lastAudioPlaybackEndTime;
    const inGracePeriod = this.lastAudioPlaybackEndTime > 0 && timeSincePlaybackEnded < this.AUDIO_PLAYBACK_GRACE_PERIOD_MS;

    const cleanedTranscript = transcript.trim();
    const words = cleanedTranscript.split(/\s+/).filter(Boolean);

    // SIMPLIFIED: Minimal word requirement for immediate barge-in
    // Echo protection relies on text matching (checking if transcript matches TTS)
    // 2 words is enough to distinguish real speech from noise
    const requiredWords = inGracePeriod ? 3 : 2;

    // LOCAL ECHO DETECTION: Check FIRST, even for short transcripts
    // This catches cases where the TTS starts with "Très bien" and the microphone picks it up
    // Short transcripts that match the beginning of assistant speech are almost certainly echo
    // This is a fast local check before calling the AI validation API
    if (this.currentAssistantSpeech && this.currentAssistantSpeech.trim()) {
      // DIARIZATION-ENHANCED ECHO DETECTION:
      // If speaker changes during TTS playback (especially to UU or different speaker),
      // lower the echo detection threshold since it's more likely to be echo
      const isSpeakerMismatch = speaker && this.primaryUserSpeaker && speaker !== this.primaryUserSpeaker;
      const isUnknownSpeaker = speaker === 'UU';
      const suspiciousSpeaker = isSpeakerMismatch || isUnknownSpeaker;

      const echoCheckResult = this.detectLocalEcho(cleanedTranscript, this.currentAssistantSpeech, suspiciousSpeaker);
      if (echoCheckResult.isEcho) {
        this.cancelBargeInValidation();
        // BUG-008 FIX: Store and pass echo details for UI feedback
        const echoDetails = {
          transcript: cleanedTranscript,
          matchType: echoCheckResult.matchType,
          similarity: echoCheckResult.similarity,
          detectedAt: Date.now(),
        };
        SpeechmaticsAudio.lastEchoDetails = echoDetails;
        // CRITICAL: Notify parent to discard the pending transcript (it's echo, not user speech)
        this.onEchoDetected?.(echoDetails);
        return false;
      }
    }

    // Quick check: Need minimum words for AI validation to be meaningful
    // (Local echo check above runs for ALL transcripts, even short ones)
    if (words.length < requiredWords) {
      return false;
    }

    // Use AI-powered start-of-turn detection
    if (this.startOfTurnDetector) {
      try {
        const result = await this.startOfTurnDetector.validateStartOfTurn(
          cleanedTranscript,
          this.currentAssistantSpeech,
          this.conversationHistory
        );

        if (result.isEcho) {
          this.cancelBargeInValidation();
          // BUG-008 FIX: Store and pass echo details for UI feedback (AI-detected)
          const echoDetails = {
            transcript: cleanedTranscript,
            matchType: 'ai-detected' as const,
            similarity: 1.0, // AI determined it's echo
            detectedAt: Date.now(),
          };
          SpeechmaticsAudio.lastEchoDetails = echoDetails;
          // CRITICAL: Notify parent to discard the pending transcript (it's echo, not user speech)
          this.onEchoDetected?.(echoDetails);
          return false;
        }

        if (!result.isValidStart) {
          // Don't cancel yet - wait for more transcript or timeout
          return false;
        }

        // AI confirmed valid start of turn
        this.confirmBargeIn();
        return true;
      } catch (error) {
        devError('[Speechmatics Audio] AI validation error', error);
        // Fall through to simple validation
      }
    }

    // Fallback: Simple validation if AI is disabled or failed
    // SIMPLIFIED: Minimal word requirement (2-3 words) for immediate barge-in
    if (words.length < requiredWords) {
      return false;
    }

    this.confirmBargeIn();
    return true;
  }

  /**
   * Detect if the transcript is likely an echo of the assistant's speech
   * Uses fuzzy matching to detect partial containment
   * @param transcript The user transcript to check
   * @param assistantSpeech The assistant's current speech
   * @param suspiciousSpeaker If true, use lower thresholds (speaker mismatch detected via diarization)
   * @returns Object with isEcho flag, similarity score, and match type
   */
  private detectLocalEcho(transcript: string, assistantSpeech: string, suspiciousSpeaker: boolean = false): {
    isEcho: boolean;
    similarity: number;
    matchType: 'contained' | 'fuzzy-words' | 'speaker-mismatch' | 'none';
  } {
    const normalizedTranscript = this.normalizeForEchoDetection(transcript);
    const normalizedAssistant = this.normalizeForEchoDetection(assistantSpeech);

    // Check 1: Is the transcript directly contained in assistant speech?
    if (normalizedAssistant.includes(normalizedTranscript)) {
      return { isEcho: true, similarity: 1.0, matchType: 'contained' };
    }

    // Check 2: Fuzzy word-based matching
    // Extract words and check what percentage of transcript words appear in assistant speech
    const transcriptWords = normalizedTranscript.split(/\s+/).filter(w => w.length > 2);
    const assistantWords = new Set(normalizedAssistant.split(/\s+/).filter(w => w.length > 2));

    if (transcriptWords.length === 0) {
      return { isEcho: false, similarity: 0, matchType: 'none' };
    }

    // Count how many transcript words are found in assistant speech
    let matchedWords = 0;
    for (const word of transcriptWords) {
      if (assistantWords.has(word)) {
        matchedWords++;
      }
    }

    const similarity = matchedWords / transcriptWords.length;

    // DIARIZATION-ENHANCED: Lower threshold when speaker is suspicious (mismatch or unknown)
    // If the speaker doesn't match the established user, even 25% word overlap is suspicious
    const fuzzyThreshold = suspiciousSpeaker ? 0.25 : 0.4;

    // If threshold% or more of the transcript words are in the assistant speech, it's likely an echo
    if (similarity >= fuzzyThreshold) {
      return {
        isEcho: true,
        similarity,
        matchType: suspiciousSpeaker ? 'speaker-mismatch' : 'fuzzy-words'
      };
    }

    // Check 3: Sliding window - check if any consecutive sequence of transcript words
    // appears in the assistant speech (catches fragmented echoes)
    // Use multiple window sizes from 2 to 7 words to catch various echo patterns
    const maxWindowSize = Math.min(7, Math.floor(transcriptWords.length / 2));
    const minWindowSize = 2; // Detect even 2-word sequences that match

    for (let windowSize = maxWindowSize; windowSize >= minWindowSize; windowSize--) {
      if (windowSize > transcriptWords.length) continue;

      for (let i = 0; i <= transcriptWords.length - windowSize; i++) {
        const windowPhrase = transcriptWords.slice(i, i + windowSize).join(' ');
        if (normalizedAssistant.includes(windowPhrase)) {
          // Larger windows = higher confidence of echo
          const windowConfidence = 0.5 + (windowSize * 0.1); // 0.7 for 2 words, up to 1.2 for 7 words
          return {
            isEcho: true,
            similarity: Math.min(1.0, windowConfidence),
            matchType: suspiciousSpeaker ? 'speaker-mismatch' : 'fuzzy-words'
          };
        }
      }
    }

    return { isEcho: false, similarity, matchType: 'none' };
  }

  /**
   * Normalize text for echo detection comparison
   * Removes punctuation, accents, and converts to lowercase
   */
  private normalizeForEchoDetection(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove accents
      // BUG-039 FIX: Comprehensive hyphen/dash normalization for names like "Pierre-Marie" vs "Pierre Marie"
      // Covers: hyphen-minus (-), en-dash (–), em-dash (—), hyphen (‐), non-breaking hyphen (‑), minus sign (−)
      .replace(/[\u002D\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, ' ')
      .replace(/[.,!?;:'"«»…()[\]{}]/g, ' ') // Remove other punctuation
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Cancel pending barge-in validation
   * Called when voice activity stops before we got meaningful content
   */
  cancelBargeInValidation(): void {
    if (this.bargeInValidationTimer) {
      clearTimeout(this.bargeInValidationTimer);
      this.bargeInValidationTimer = null;
    }
    this.bargeInPendingValidation = false;
  }

  private async audioDataToBuffer(audioData: Uint8Array): Promise<AudioBuffer> {
    if (!this.audioContext) {
      throw new Error('No audio context');
    }

    try {
      // BUG-029 FIX: Avoid unnecessary memory copy when creating ArrayBuffer
      // decodeAudioData() consumes the ArrayBuffer, so we need a dedicated copy.
      // Using slice() creates a proper copy of just the data we need, avoiding
      // the issue where new Uint8Array(audioData).buffer could reference the
      // original buffer if it's already an ArrayBuffer view.
      let arrayBuffer: ArrayBuffer;
      if (audioData.byteOffset === 0 && audioData.byteLength === audioData.buffer.byteLength) {
        // BUG-029 FIX: View spans entire buffer - can use buffer directly
        // But we still need a copy since decodeAudioData detaches the buffer
        // Note: slice() on ArrayBufferLike returns ArrayBuffer, cast needed for TypeScript
        arrayBuffer = audioData.buffer.slice(0) as ArrayBuffer;
      } else {
        // BUG-029 FIX: View is a subset - use slice to copy only the relevant portion
        // This is more memory-efficient than creating a full Uint8Array wrapper
        // Note: slice() on ArrayBufferLike returns ArrayBuffer, cast needed for TypeScript
        arrayBuffer = audioData.buffer.slice(
          audioData.byteOffset,
          audioData.byteOffset + audioData.byteLength
        ) as ArrayBuffer;
      }
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      return audioBuffer;
    } catch (error) {
      devError('[Speechmatics] ❌ Error decoding audio:', error);
      throw error;
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

    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    return combined;
  }

  updateWebSocket(ws: WebSocket | null): void {
    this.ws = ws;
  }

  /**
   * Check if audio is currently playing (TTS playback)
   * Used for barge-in detection and echo filtering
   */
  isPlaying(): boolean {
    return this.isPlayingAudio;
  }

  /**
   * Check if user has recent voice activity (VAD detection)
   * Used to determine if user is currently speaking
   * Returns true if at least 3 out of the last 5 audio chunks had voice activity
   */
  isUserSpeaking(): boolean {
    return this.hasRecentVoiceActivity;
  }

  /**
   * Reset VAD state when a non-primary speaker is filtered
   * This prevents filtered speakers (e.g., S2) from affecting "isUserSpeaking" detection
   * which would cause LLM responses to be incorrectly dropped
   */
  resetVADStateForFilteredSpeaker(): void {
    this.recentVoiceActivity = [];
    this.hasRecentVoiceActivity = false;
    // Also cancel any pending barge-in validation since it was from a filtered speaker
    this.cancelBargeInValidation();
    devLog('[Speechmatics Audio] ✅ VAD state reset due to filtered speaker');
  }

  /**
   * Update conversation history for start-of-turn detection
   * Called by parent agent when messages are added to conversation
   */
  updateConversationHistory(history: StartOfTurnMessage[]): void {
    this.conversationHistory = history;
  }

  /**
   * Update what the assistant is currently saying (for echo detection)
   * Called by parent agent when assistant starts speaking
   *
   * BUG-021 FIX: Clear any pending clear timer when setting new speech
   * This prevents echo detection from being triggered by stale speech content
   *
   * BUG-016 FIX: Increment version token to invalidate any pending clear timers
   * This prevents race conditions where echo detection reads stale content
   */
  setCurrentAssistantSpeech(text: string): void {
    // BUG-016 FIX: Increment version to invalidate any pending clear timer
    // The timer checks this version before clearing, ensuring atomicity
    this.assistantSpeechVersion++;

    // BUG-021 FIX: Cancel any pending clear timer when starting new TTS
    // This ensures we don't accidentally clear the new speech prematurely
    if (this.clearAssistantSpeechTimer) {
      clearTimeout(this.clearAssistantSpeechTimer);
      this.clearAssistantSpeechTimer = null;
    }

    // Set the new assistant speech for echo detection
    this.currentAssistantSpeech = text;
  }
}

