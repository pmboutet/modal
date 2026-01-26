// AudioWorkletProcessor pour traiter l'audio du microphone pour Speechmatics
// Speechmatics nécessite PCM16 16kHz mono
// Accumule les buffers jusqu'à 16384 samples avant d'envoyer (1 seconde d'audio à 16kHz)

class SpeechmaticsAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.isActive = true;
    this.isFirefox = options.processorOptions?.isFirefox || false;
    this.bufferAccumulator = new Float32Array(0); // Accumulateur pour atteindre 16384 samples
    this.targetBufferSize = 16384; // Taille cible du buffer (1 seconde à 16kHz)
    this.targetSampleRate = 16000; // Speechmatics nécessite 16kHz
    
    // AGC (Automatic Gain Control) parameters
    this.enableAGC = options.processorOptions?.enableAGC !== false; // Default: true
    this.targetRMS = 0.15; // Target RMS level (~-12dB) for normalization
    this.currentGain = 1.0; // Current gain multiplier
    this.gainAttackTime = 0.01; // Attack time in seconds (10ms)
    this.gainReleaseTime = 0.1; // Release time in seconds (100ms)
    this.minGain = 0.1; // Minimum gain (avoid silence amplification)
    this.maxGain = 10.0; // Maximum gain (avoid saturation)
    this.sampleRate = 16000; // Will be updated from sampleRate
    
    // Noise floor estimation
    this.noiseFloorWindow = []; // Sliding window for noise floor calculation
    this.noiseFloorWindowSize = 50; // ~3 seconds at 16kHz (50 chunks of 16384 samples)
    this.noiseFloor = 0.01; // Estimated noise floor (initial guess)
    this.rmsHistory = []; // History of RMS values for noise floor estimation
    this.rmsHistorySize = 50;

    // Noise floor calibration timing
    this.chunkCount = 0; // Count of chunks processed since start
    this.WARMUP_CHUNKS = 15; // Skip noise floor updates for first ~15 seconds
    this.NOISE_FLOOR_UPDATE_INTERVAL = 30; // Send noise floor updates every ~30 seconds (was 10)
    
    // Écouter les messages du thread principal
    this.port.onmessage = (event) => {
      if (event.data.type === 'stop') {
        this.isActive = false;
        // CRITICAL: Clear the buffer immediately instead of flushing it
        // We don't want to send any more audio data when muted
        this.bufferAccumulator = new Float32Array(0);
      } else if (event.data.type === 'start') {
        this.isActive = true;
      } else if (event.data.type === 'config') {
        // Update AGC configuration
        if (event.data.enableAGC !== undefined) {
          this.enableAGC = event.data.enableAGC;
        }
        if (event.data.targetRMS !== undefined) {
          this.targetRMS = event.data.targetRMS;
        }
      }
    };
  }
  
  // Calculate RMS (Root Mean Square) of audio buffer
  calculateRMS(buffer) {
    if (!buffer || buffer.length === 0) return 0;
    let sumSquares = 0;
    for (let i = 0; i < buffer.length; i++) {
      sumSquares += buffer[i] * buffer[i];
    }
    return Math.sqrt(sumSquares / buffer.length);
  }
  
  // Apply AGC to audio buffer
  applyAGC(buffer, currentRMS) {
    if (!this.enableAGC || currentRMS === 0) {
      return buffer;
    }
    
    // Calculate target gain
    const targetGain = this.targetRMS / Math.max(currentRMS, 0.001);
    
    // Clamp gain to min/max
    const clampedTargetGain = Math.max(this.minGain, Math.min(this.maxGain, targetGain));
    
    // Smooth gain changes (attack/release)
    // FIX: AGC coefficients must account for buffer-based processing
    // AudioWorklet processes 128-sample buffers, not individual samples
    // So we need to calculate coefficients per-buffer, not per-sample
    const gainDiff = clampedTargetGain - this.currentGain;
    const bufferSize = 128; // AudioWorklet quantum
    const buffersPerSecond = this.sampleRate / bufferSize;
    const attackCoeff = Math.exp(-1 / (this.gainAttackTime * buffersPerSecond));
    const releaseCoeff = Math.exp(-1 / (this.gainReleaseTime * buffersPerSecond));
    
    // Use attack for increasing gain, release for decreasing
    const coeff = gainDiff > 0 ? attackCoeff : releaseCoeff;
    this.currentGain = this.currentGain + (1 - coeff) * gainDiff;
    
    // Apply gain to buffer
    const output = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      output[i] = buffer[i] * this.currentGain;
      // Hard limit to prevent clipping
      output[i] = Math.max(-1, Math.min(1, output[i]));
    }
    
    return output;
  }
  
  // Update noise floor estimation
  updateNoiseFloor(rms) {
    this.chunkCount++;

    this.rmsHistory.push(rms);
    if (this.rmsHistory.length > this.rmsHistorySize) {
      this.rmsHistory.shift();
    }

    // Skip noise floor calibration during warm-up period (~15 seconds)
    // This prevents adapting to ambient noise before the user starts speaking
    if (this.chunkCount <= this.WARMUP_CHUNKS) {
      return;
    }

    // Noise floor is the minimum RMS over recent history (when not speaking)
    // Use percentile approach: take 10th percentile as noise floor
    if (this.rmsHistory.length >= 10) {
      const sorted = [...this.rmsHistory].sort((a, b) => a - b);
      const percentile10 = sorted[Math.floor(sorted.length * 0.1)];
      this.noiseFloor = Math.max(0.001, percentile10);

      // Send noise floor update to main thread periodically (only when active)
      // Update every ~30 seconds instead of 10 for more stability
      if (this.isActive && this.chunkCount % this.NOISE_FLOOR_UPDATE_INTERVAL === 0) {
        this.port.postMessage({
          type: 'noiseFloor',
          noiseFloor: this.noiseFloor,
          currentRMS: rms,
          currentGain: this.currentGain
        });
      }
    }
  }

  flushBuffer() {
    if (this.bufferAccumulator.length > 0) {
      // Convert Float32 [-1, 1] → Int16 [-32768, 32767]
      const pcmData = new Int16Array(this.bufferAccumulator.length);
      for (let i = 0; i < this.bufferAccumulator.length; i++) {
        const sample = Math.max(-1, Math.min(1, this.bufferAccumulator[i]));
        pcmData[i] = Math.round(sample * 0x7FFF);
      }

      // Envoyer les données audio au thread principal
      this.port.postMessage({
        type: 'audio',
        data: pcmData.buffer
      }, [pcmData.buffer]);

      this.bufferAccumulator = new Float32Array(0);
    }
  }

  // Downsample to 16kHz
  downsampleTo16kHz(inputData, inputSampleRate) {
    const ratio = inputSampleRate / this.targetSampleRate;
    const outputLength = Math.floor(inputData.length / ratio);
    const output = new Float32Array(outputLength);
    
    for (let i = 0; i < outputLength; i++) {
      const sourceIndex = Math.floor(i * ratio);
      output[i] = inputData[sourceIndex];
    }
    
    return output;
  }

  process(inputs, outputs) {
    if (!this.isActive) {
      return true; // Continue le processing même si inactif
    }

    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const inputChannel = input[0]; // Float32Array
    if (!inputChannel || inputChannel.length === 0) {
      return true;
    }

    // Update sample rate (needed for AGC timing calculations)
    if (sampleRate) {
      this.sampleRate = sampleRate;
    }

    // Get the actual sample rate from the AudioContext
    // We need to downsample to 16kHz for Speechmatics
    // The AudioContext is created with 16kHz, but browsers may provide different rates
    let processedData;
    
    // Downsample if needed (handle Firefox 48kHz or other sample rates)
    if (this.isFirefox) {
      // Firefox typically provides 48kHz, downsample to 16kHz
      processedData = this.downsampleTo16kHz(inputChannel, 48000);
    } else {
      // Most browsers will provide the requested sample rate, but we downsample to be safe
      // If AudioContext is 16kHz, no downsampling needed
      // If it's higher (e.g., 44.1kHz or 48kHz), downsample
      const currentSampleRate = (typeof sampleRate !== 'undefined' ? sampleRate : 44100); // Default fallback
      if (currentSampleRate > this.targetSampleRate) {
        processedData = this.downsampleTo16kHz(inputChannel, currentSampleRate);
      } else {
        processedData = inputChannel;
      }
    }

    // Apply AGC if enabled
    if (this.enableAGC && processedData.length > 0) {
      const rms = this.calculateRMS(processedData);
      this.updateNoiseFloor(rms);
      processedData = this.applyAGC(processedData, rms);
    }

    // Accumuler les données jusqu'à atteindre targetBufferSize
    const newLength = this.bufferAccumulator.length + processedData.length;
    const combinedBuffer = new Float32Array(newLength);
    combinedBuffer.set(this.bufferAccumulator);
    combinedBuffer.set(processedData, this.bufferAccumulator.length);
    this.bufferAccumulator = combinedBuffer;

    // Si on a atteint ou dépassé la taille cible, envoyer
    while (this.bufferAccumulator.length >= this.targetBufferSize) {
      // Double-check that we're still active before sending
      // This prevents race conditions where stop message arrives between checks
      if (!this.isActive) {
        this.bufferAccumulator = new Float32Array(0);
        break;
      }

      const chunkToSend = this.bufferAccumulator.slice(0, this.targetBufferSize);

      // Convert Float32 [-1, 1] → Int16 [-32768, 32767]
      const pcmData = new Int16Array(this.targetBufferSize);
      for (let i = 0; i < this.targetBufferSize; i++) {
        const sample = Math.max(-1, Math.min(1, chunkToSend[i]));
        pcmData[i] = Math.round(sample * 0x7FFF);
      }

      // Triple-check before actually sending the message
      if (!this.isActive) {
        this.bufferAccumulator = new Float32Array(0);
        break;
      }

      // Envoyer les données audio au thread principal
      this.port.postMessage({
        type: 'audio',
        data: pcmData.buffer
      }, [pcmData.buffer]);

      // Garder le reste pour le prochain cycle
      this.bufferAccumulator = this.bufferAccumulator.slice(this.targetBufferSize);
    }

    return true; // Continue le processing
  }
}

registerProcessor('speechmatics-audio-processor', SpeechmaticsAudioProcessor);

