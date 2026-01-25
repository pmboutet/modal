// AudioWorkletProcessor pour traiter l'audio du microphone
// Accumule les buffers jusqu'à 8192 samples avant d'envoyer

class DeepgramAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.isActive = true;
    this.isFirefox = options.processorOptions?.isFirefox || false;
    this.bufferAccumulator = new Float32Array(0); // Accumulateur pour atteindre 8192 samples
    this.targetBufferSize = 8192; // Taille cible du buffer
    
    // Écouter les messages du thread principal
    this.port.onmessage = (event) => {
      if (event.data.type === 'stop') {
        this.isActive = false;
        // CRITICAL: Clear the buffer immediately instead of flushing it
        // We don't want to send any more audio data when muted
        this.bufferAccumulator = new Float32Array(0);
      } else if (event.data.type === 'start') {
        this.isActive = true;
      }
    };
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

    // Handle downsampling for Firefox (48kHz → 24kHz)
    let processedData;
    if (this.isFirefox) {
      const downsampledLength = Math.floor(inputChannel.length / 2);
      processedData = new Float32Array(downsampledLength);
      for (let i = 0; i < downsampledLength; i++) {
        processedData[i] = inputChannel[i * 2];
      }
    } else {
      processedData = inputChannel;
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

registerProcessor('deepgram-audio-processor', DeepgramAudioProcessor);

