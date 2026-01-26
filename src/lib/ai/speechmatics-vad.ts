/**
 * Voice Activity Detection (VAD) for Speechmatics Audio
 * Handles voice activity detection, noise floor tracking, and hybrid detection
 */

/**
 * Configuration for VAD
 */
export interface VADConfig {
  /** Base RMS threshold for voice activity (default: 0.015, ~-36 dB) */
  baseRmsThreshold?: number;
  /** Sample stride for RMS calculation (default: 4) */
  sampleStride?: number;
  /** VAD sliding window size (default: 5) */
  windowSize?: number;
  /** Minimum required active chunks in window (default: 3) */
  minActiveChunks?: number;
  /** Enable adaptive sensitivity (default: true) */
  enableAdaptiveSensitivity?: boolean;
  /** Enable adaptive noise gate (default: true) */
  enableAdaptiveNoiseGate?: boolean;
  /** Noise floor history size for smoothing (default: 10) */
  noiseFloorHistorySize?: number;
  /** Spectral energy history size (default: 5) */
  spectralHistorySize?: number;
  /** Minimum VAD threshold (default: 0.005) */
  minVadThreshold?: number;
  /** Maximum VAD threshold (default: 0.1) */
  maxVadThreshold?: number;
  /** Margin above noise floor (default: 0.005) */
  adaptiveThresholdMargin?: number;
}

const DEFAULT_VAD_CONFIG: Required<VADConfig> = {
  baseRmsThreshold: 0.015,
  sampleStride: 4,
  windowSize: 5,
  minActiveChunks: 3,
  enableAdaptiveSensitivity: true,
  enableAdaptiveNoiseGate: true,
  noiseFloorHistorySize: 10,
  spectralHistorySize: 5,
  minVadThreshold: 0.005,
  maxVadThreshold: 0.1,
  adaptiveThresholdMargin: 0.005,
};

/**
 * Voice Activity Detection module
 * Handles all VAD-related state and detection logic
 */
export class SpeechmaticsVAD {
  private readonly config: Required<VADConfig>;

  // VAD state for continuous voice activity tracking
  private recentVoiceActivity: boolean[] = [];
  private hasRecentVoiceActivity: boolean = false;

  // Adaptive sensitivity and noise gate
  private enableAdaptiveSensitivity: boolean;
  private enableAdaptiveNoiseGate: boolean;
  private noiseFloor: number = 0.01;
  private noiseFloorHistory: number[] = [];
  private sensitivityMultiplier: number = 1.0;
  private vadRmsThreshold: number;

  // Hybrid noise gate - spectral energy detection
  private spectralEnergyHistory: number[] = [];

  constructor(config: VADConfig = {}) {
    this.config = { ...DEFAULT_VAD_CONFIG, ...config };
    this.vadRmsThreshold = this.config.baseRmsThreshold;
    this.enableAdaptiveSensitivity = this.config.enableAdaptiveSensitivity;
    this.enableAdaptiveNoiseGate = this.config.enableAdaptiveNoiseGate;
  }

  /**
   * Reset all VAD state
   * Called when microphone starts or stops
   */
  reset(): void {
    this.recentVoiceActivity = [];
    this.hasRecentVoiceActivity = false;
    this.noiseFloor = 0.01;
    this.noiseFloorHistory = [];
    this.spectralEnergyHistory = [];
  }

  /**
   * Reset VAD state when a non-primary speaker is filtered
   * This prevents filtered speakers from affecting "isUserSpeaking" detection
   */
  resetForFilteredSpeaker(): void {
    this.recentVoiceActivity = [];
    this.hasRecentVoiceActivity = false;
  }

  /**
   * Clear VAD sliding window (e.g., after audio playback ends)
   */
  clearSlidingWindow(): void {
    this.recentVoiceActivity = [];
    this.hasRecentVoiceActivity = false;
  }

  /**
   * Basic voice activity detection using RMS
   */
  detectVoiceActivity(chunk: Int16Array): boolean {
    if (!chunk.length) {
      return false;
    }

    let sumSquares = 0;
    let samples = 0;

    for (let i = 0; i < chunk.length; i += this.config.sampleStride) {
      const sample = chunk[i] / 32768;
      sumSquares += sample * sample;
      samples++;
    }

    if (samples === 0) {
      return false;
    }

    const rms = Math.sqrt(sumSquares / samples);
    const threshold = this.enableAdaptiveSensitivity
      ? this.getAdaptiveThreshold()
      : this.vadRmsThreshold;

    return rms > threshold;
  }

  /**
   * Hybrid voice activity detection using RMS + spectral energy
   * More accurate than RMS-only detection
   * Uses stricter criteria when audio is playing to prevent echo detection
   * @param chunk The audio chunk to analyze
   * @param isPlayingAudio Whether audio is currently playing (for stricter criteria)
   */
  detectVoiceActivityHybrid(chunk: Int16Array, isPlayingAudio: boolean = false): boolean {
    if (!chunk.length) {
      return false;
    }

    // Calculate RMS
    let sumSquares = 0;
    let samples = 0;
    for (let i = 0; i < chunk.length; i += this.config.sampleStride) {
      const sample = chunk[i] / 32768;
      sumSquares += sample * sample;
      samples++;
    }

    if (samples === 0) {
      return false;
    }

    const rms = Math.sqrt(sumSquares / samples);

    // Calculate spectral energy in vocal frequency range
    const spectralEnergy = this.calculateSpectralEnergy(chunk);

    // Update spectral energy history
    this.spectralEnergyHistory.push(spectralEnergy);
    if (this.spectralEnergyHistory.length > this.config.spectralHistorySize) {
      this.spectralEnergyHistory.shift();
    }

    // Use adaptive threshold if enabled
    const threshold = this.enableAdaptiveSensitivity
      ? this.getAdaptiveThreshold()
      : this.vadRmsThreshold;

    // Multi-criteria decision
    const rmsCheck = rms > threshold;
    const spectralCheck = spectralEnergy > threshold * 0.75;

    // When audio is playing, use STRICTER criteria (AND logic) to prevent echo detection
    if (isPlayingAudio) {
      return rmsCheck && spectralCheck;
    }

    // When no audio is playing, use standard criteria (OR logic)
    return rmsCheck || spectralCheck;
  }

  /**
   * Update VAD sliding window and return if chunk should be sent
   * @param hasVoiceActivity Whether the current chunk has voice activity
   * @param isPlayingAudio Whether audio is currently playing (skip updates if true)
   * @returns Whether there is recent voice activity
   */
  updateSlidingWindow(hasVoiceActivity: boolean, isPlayingAudio: boolean): boolean {
    // Don't update sliding window when AI is playing audio (would detect echo)
    if (!isPlayingAudio) {
      this.recentVoiceActivity.push(hasVoiceActivity);
      if (this.recentVoiceActivity.length > this.config.windowSize) {
        this.recentVoiceActivity.shift();
      }

      const activeChunks = this.recentVoiceActivity.filter(v => v).length;
      this.hasRecentVoiceActivity = activeChunks >= this.config.minActiveChunks;
    }

    return this.hasRecentVoiceActivity;
  }

  /**
   * Check if audio chunk should be sent based on noise gate
   * @param hasVoiceActivity Whether the current chunk has voice activity
   */
  shouldSendChunk(hasVoiceActivity: boolean): boolean {
    if (this.enableAdaptiveNoiseGate) {
      return this.hasRecentVoiceActivity || hasVoiceActivity;
    }
    return this.hasRecentVoiceActivity || hasVoiceActivity;
  }

  /**
   * Check if user has recent voice activity
   */
  isUserSpeaking(): boolean {
    return this.hasRecentVoiceActivity;
  }

  /**
   * Set microphone sensitivity
   * @param sensitivity Multiplier for VAD threshold (0.5 = more sensitive, 2.0 = less sensitive)
   */
  setSensitivity(sensitivity: number = 1.0): void {
    const clampedSensitivity = Math.max(0.3, Math.min(3.0, sensitivity));
    this.sensitivityMultiplier = clampedSensitivity;
    this.vadRmsThreshold = this.config.baseRmsThreshold * clampedSensitivity;
  }

  /**
   * Configure adaptive features
   */
  setAdaptiveFeatures(config: {
    enableAdaptiveSensitivity?: boolean;
    enableAdaptiveNoiseGate?: boolean;
  }): void {
    if (config.enableAdaptiveSensitivity !== undefined) {
      this.enableAdaptiveSensitivity = config.enableAdaptiveSensitivity;
    }
    if (config.enableAdaptiveNoiseGate !== undefined) {
      this.enableAdaptiveNoiseGate = config.enableAdaptiveNoiseGate;
    }
  }

  /**
   * Update noise floor from AudioWorklet
   */
  updateNoiseFloor(newNoiseFloor: number): void {
    if (!this.enableAdaptiveSensitivity) {
      return;
    }

    // Smooth noise floor updates
    this.noiseFloorHistory.push(newNoiseFloor);
    if (this.noiseFloorHistory.length > this.config.noiseFloorHistorySize) {
      this.noiseFloorHistory.shift();
    }

    // Use median for robustness against outliers
    const sorted = [...this.noiseFloorHistory].sort((a, b) => a - b);
    const medianIndex = Math.floor(sorted.length / 2);
    this.noiseFloor = sorted[medianIndex] || newNoiseFloor;
  }

  /**
   * Calculate spectral energy as approximation of voice frequency content
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
   * Calculate adaptive VAD threshold based on noise floor
   */
  private getAdaptiveThreshold(): number {
    if (!this.enableAdaptiveSensitivity || this.noiseFloor <= 0) {
      return this.vadRmsThreshold;
    }

    const adaptiveThreshold = (this.noiseFloor * this.sensitivityMultiplier) + this.config.adaptiveThresholdMargin;
    return Math.max(this.config.minVadThreshold, Math.min(this.config.maxVadThreshold, adaptiveThreshold));
  }
}
