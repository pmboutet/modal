/**
 * ============================================================
 * LEGACY - Hybrid Voice Agent (Deepgram-based)
 * ============================================================
 *
 * ⚠️ THIS CODE IS DEPRECATED - DO NOT USE FOR NEW IMPLEMENTATIONS
 *
 * This agent uses Deepgram for STT, LLM for responses, and ElevenLabs for TTS.
 * It has been superseded by SpeechmaticsVoiceAgent which provides:
 * - Better multilingual support (French/English)
 * - More reliable transcription with semantic turn detection
 * - Better echo cancellation and noise handling
 * - Improved barge-in support
 *
 * For new implementations, use: SpeechmaticsVoiceAgent (./speechmatics.ts)
 *
 * This file is kept for backward compatibility only.
 * ============================================================
 */

import { DeepgramClient, AgentLiveClient, AgentEvents } from '@deepgram/sdk';
import { ElevenLabsTTS, type ElevenLabsConfig } from './elevenlabs';
import type { AiModelConfig } from '@/types';

export interface HybridVoiceAgentConfig {
  systemPrompt: string;
  // Deepgram STT config
  deepgramApiKey?: string;
  sttModel?: string; // Deepgram STT model, default: "nova-3"
  // LLM config
  llmProvider?: "anthropic" | "openai";
  llmModel?: string;
  llmApiKey?: string;
  // ElevenLabs TTS config
  elevenLabsApiKey?: string; // Optional - will be fetched automatically if not provided
  elevenLabsVoiceId?: string;
  elevenLabsModelId?: string;
  // Consultant mode (passive listening)
  disableLLM?: boolean; // If true, disable LLM responses (transcription only)
  disableElevenLabsTTS?: boolean; // If true, disable TTS
}

export interface HybridVoiceAgentMessage {
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  isInterim?: boolean;
}

export type HybridVoiceAgentMessageCallback = (message: HybridVoiceAgentMessage) => void;
export type HybridVoiceAgentErrorCallback = (error: Error) => void;
export type HybridVoiceAgentConnectionCallback = (connected: boolean) => void;
export type HybridVoiceAgentAudioCallback = (audio: Uint8Array) => void;

/**
 * @deprecated Use SpeechmaticsVoiceAgent instead
 * @see SpeechmaticsVoiceAgent
 */
export class HybridVoiceAgent {
  private deepgramClient: AgentLiveClient | null = null;
  private deepgramToken: string | null = null;
  private elevenLabsTTS: ElevenLabsTTS | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private audioQueue: Uint8Array[] = [];
  private nextStartTime: number = 0;
  private currentAudioSource: AudioBufferSourceNode | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private isFirefox: boolean;
  private config: HybridVoiceAgentConfig | null = null;
  private conversationHistory: Array<{ role: 'user' | 'agent'; content: string }> = [];
  private isGeneratingResponse: boolean = false;
  private isPlayingAudio: boolean = false;
  private audioPlaybackQueue: AudioBuffer[] = [];
  private pendingUserMessage: { content: string; timestamp: string } | null = null;
  private userMessageQueue: Array<{ content: string; timestamp: string }> = [];
  private lastPartialUserContent: string | null = null;
  private isMicrophoneActive: boolean = false;
  private isDisconnected: boolean = false; // Flag to prevent event handlers from firing after disconnect
  
  // Event handler references for cleanup
  private eventHandlers: Map<string, (...args: any[]) => void> = new Map();
  
  // Callbacks
  private onMessageCallback: HybridVoiceAgentMessageCallback | null = null;
  private onErrorCallback: HybridVoiceAgentErrorCallback | null = null;
  private onConnectionCallback: HybridVoiceAgentConnectionCallback | null = null;
  private onAudioCallback: HybridVoiceAgentAudioCallback | null = null;

  constructor() {
    this.isFirefox = typeof navigator !== 'undefined' && navigator.userAgent.includes('Firefox');
  }

  setCallbacks(callbacks: {
    onMessage?: HybridVoiceAgentMessageCallback;
    onError?: HybridVoiceAgentErrorCallback;
    onConnection?: HybridVoiceAgentConnectionCallback;
    onAudio?: HybridVoiceAgentAudioCallback;
  }) {
    this.onMessageCallback = callbacks.onMessage || null;
    this.onErrorCallback = callbacks.onError || null;
    this.onConnectionCallback = callbacks.onConnection || null;
    this.onAudioCallback = callbacks.onAudio || null;
  }

  async authenticateDeepgram(): Promise<string> {
    console.log('[HybridVoiceAgent] 🔐 Starting Deepgram authentication...');
    try {
      const response = await fetch('/api/token', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Deepgram authentication failed: ${errorText}`);
      }

      const data = await response.json();
      this.deepgramToken = data.token;
      if (!this.deepgramToken) {
        throw new Error('Failed to get Deepgram token');
      }
      console.log('[HybridVoiceAgent] ✅ Deepgram authentication successful');
      return this.deepgramToken;
    } catch (error) {
      console.error('[HybridVoiceAgent] ❌ Deepgram authentication error:', error);
      throw error;
    }
  }

  async getElevenLabsApiKey(): Promise<string> {
    console.log('[HybridVoiceAgent] 🔐 Getting ElevenLabs API key...');
    try {
      const response = await fetch('/api/elevenlabs-token', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get ElevenLabs API key: ${errorText}`);
      }

      const data = await response.json();
      const apiKey = data.apiKey;
      if (!apiKey) {
        throw new Error('Failed to get ElevenLabs API key');
      }
      console.log('[HybridVoiceAgent] ✅ ElevenLabs API key retrieved');
      return apiKey;
    } catch (error) {
      console.error('[HybridVoiceAgent] ❌ Error getting ElevenLabs API key:', error);
      throw error;
    }
  }

  async connect(config: HybridVoiceAgentConfig): Promise<void> {
    console.log('[HybridVoiceAgent] Starting connection process...');
    
    // Reset disconnect flag when connecting
    this.isDisconnected = false;
    this.eventHandlers.clear();
    
    this.config = config;

    // Validate required ElevenLabs configuration
    if (!config.elevenLabsVoiceId) {
      throw new Error('ElevenLabs voice ID is required for hybrid voice agent');
    }

    // Get ElevenLabs API key if not provided
    let elevenLabsApiKey = config.elevenLabsApiKey;
    if (!elevenLabsApiKey) {
      elevenLabsApiKey = await this.getElevenLabsApiKey();
    }

    // Initialize ElevenLabs TTS
    const elevenLabsConfig: ElevenLabsConfig = {
      apiKey: elevenLabsApiKey,
      voiceId: config.elevenLabsVoiceId,
      modelId: config.elevenLabsModelId,
    };
    this.elevenLabsTTS = new ElevenLabsTTS(elevenLabsConfig);
    console.log('[HybridVoiceAgent] ✅ ElevenLabs TTS initialized');

    // Authenticate with Deepgram
    if (!this.deepgramToken) {
      await this.authenticateDeepgram();
    }

    if (!this.deepgramToken) {
      throw new Error('No Deepgram token available');
    }

    // Create Deepgram client for STT only
    try {
      const client = new DeepgramClient({ accessToken: this.deepgramToken }).agent();
      this.deepgramClient = client;
      console.log('[HybridVoiceAgent] ✅ Deepgram client created');
    } catch (error) {
      console.error('[HybridVoiceAgent] ❌ Error creating Deepgram client:', error);
      throw error;
    }

    const client = this.deepgramClient!;

    // Set up Deepgram event handlers
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const error = new Error('Connection timeout: Did not receive Welcome event within 10 seconds');
        console.error('[HybridVoiceAgent] ❌', error.message);
        reject(error);
      }, 10000);

      // Handle Welcome event
      client.once(AgentEvents.Welcome, (welcomeMessage) => {
        console.log('[HybridVoiceAgent] ✅ Welcome event received:', welcomeMessage);
        clearTimeout(timeout);
        
        // Configure Deepgram for STT only (no TTS)
        // Use multilingual model (nova-2 or nova-3) for automatic language detection
        // Nova-2 and Nova-3 are multilingual models that can transcribe multiple languages
        // For streaming, we use the multilingual model which supports FR and EN
        const sttModel = config.sttModel || "nova-3";
        const isMultilingualModel = sttModel.includes("nova-2") || sttModel.includes("nova-3");
        
        // Ensure we're using a multilingual model (nova-3 supports FR and EN automatically)
        const finalSttModel = isMultilingualModel ? sttModel : "nova-3";
        
        console.log('[HybridVoiceAgent] Using STT model:', finalSttModel, '- This model supports automatic language detection for French (fr) and English (en)');
        
        const settings: any = {
          audio: {
            input: {
              encoding: "linear16" as const,
              sample_rate: 24000
            },
            output: {
              encoding: "linear16" as const,
              sample_rate: 24000,
              container: "none" as const
            }
          },
          agent: {
            listen: {
              provider: {
                type: "deepgram" as const,
                model: finalSttModel
                // Nova-2 and Nova-3 are multilingual models that automatically detect language
                // They support both French (fr) and English (en) automatically
                // The model will auto-detect the language based on the speech content
                // Note: The 'language' parameter is NOT supported in agent.listen.provider for Agent API
                // Multilingual mode is enabled by default with nova-2 and nova-3 models
                // detect_language: true at agent level helps improve language detection accuracy
              }
            },
            // Disable Deepgram TTS - we'll use ElevenLabs instead
            speak: {
              provider: {
                type: "deepgram" as const,
                model: "aura-2-thalia-en" // Required but won't be used
              }
            },
          },
          think: {
            provider: {
              type: config.llmProvider || "anthropic",
              model: config.llmModel || (config.llmProvider === "openai" ? "gpt-4o" : "claude-3-5-haiku-latest")
            },
            prompt: config.systemPrompt
          }
        };
        
        console.log('[HybridVoiceAgent] Configuring Deepgram with settings:', JSON.stringify(settings, null, 2));
        client.configure(settings);
      });

      // Handle SettingsApplied event
      const settingsAppliedTimeout = setTimeout(() => {
        const error = new Error('Connection timeout: Did not receive SettingsApplied event within 10 seconds');
        console.error('[HybridVoiceAgent] ❌', error.message);
        clearTimeout(timeout);
        reject(error);
      }, 10000);

      client.once(AgentEvents.SettingsApplied, (appliedSettings) => {
        console.log('[HybridVoiceAgent] ✅ SettingsApplied event received:', appliedSettings);
        clearTimeout(timeout);
        clearTimeout(settingsAppliedTimeout);
        this.onConnectionCallback?.(true);
        
        // Start keep-alive
        client.keepAlive();
        this.keepAliveInterval = setInterval(() => {
          if (this.deepgramClient) {
            this.deepgramClient.keepAlive();
          } else {
            if (this.keepAliveInterval) {
              clearInterval(this.keepAliveInterval);
              this.keepAliveInterval = null;
            }
          }
        }, 8000);
        
        console.log('[HybridVoiceAgent] ✅ Connection fully established!');
        resolve();
      });

      // Handle ConversationText events (user transcriptions)
      const conversationTextHandler = (message: any) => {
        if (this.isDisconnected) {
          console.log('[HybridVoiceAgent] 🔇 Ignoring ConversationText event - agent is disconnected');
          return;
        }
        console.log('[HybridVoiceAgent] 💬 ConversationText:', message.role, ':', message.content.substring(0, 100));
        
        if (message.role === 'user') {
          const transcript = (message.content || '').trim();
          if (!transcript) {
            return;
          }

          const timestamp = new Date().toISOString();
          this.pendingUserMessage = { content: transcript, timestamp };

          if (transcript !== this.lastPartialUserContent) {
            this.lastPartialUserContent = transcript;
            this.onMessageCallback?.({
              role: 'user',
              content: transcript,
              timestamp,
              isInterim: true
            });
          }
        } else {
          // Agent response from Deepgram (if any) - we'll ignore this since we use our own LLM
          console.log('[HybridVoiceAgent] Ignoring Deepgram agent response, using custom LLM');
        }
      };
      client.on(AgentEvents.ConversationText, conversationTextHandler);
      this.eventHandlers.set('ConversationText', conversationTextHandler);

      const agentThinkingHandler = () => {
        if (this.isDisconnected) {
          console.log('[HybridVoiceAgent] 🔇 Ignoring AgentThinking event - agent is disconnected');
          return;
        }
        console.log('[HybridVoiceAgent] 🧠 AgentThinking event received - finalizing user turn');
        if (!this.pendingUserMessage) {
          console.log('[HybridVoiceAgent] No pending user message to finalize');
          return;
        }

        const finalizedMessage = this.pendingUserMessage;
        this.pendingUserMessage = null;
        this.lastPartialUserContent = null;

        const cleanedContent = finalizedMessage.content.trim();
        if (!cleanedContent) {
          console.log('[HybridVoiceAgent] Finalized message empty, skipping');
          return;
        }

        this.conversationHistory.push({
          role: 'user',
          content: cleanedContent
        });

        this.onMessageCallback?.({
          role: 'user',
          content: cleanedContent,
          timestamp: finalizedMessage.timestamp
        });

        this.userMessageQueue.push({
          content: cleanedContent,
          timestamp: finalizedMessage.timestamp
        });

        void this.processUserMessageQueue();
      };
      client.on(AgentEvents.AgentThinking, agentThinkingHandler);
      this.eventHandlers.set('AgentThinking', agentThinkingHandler);

      // Handle Audio events from Deepgram (we'll ignore these since we use ElevenLabs)
      const audioHandler = (audio: Uint8Array) => {
        if (this.isDisconnected) {
          console.log('[HybridVoiceAgent] 🔇 Ignoring Audio event - agent is disconnected');
          return;
        }
        console.log('[HybridVoiceAgent] 🔊 Audio chunk from Deepgram (ignoring, using ElevenLabs)');
        // We ignore Deepgram audio and use ElevenLabs instead
      };
      client.on(AgentEvents.Audio, audioHandler);
      this.eventHandlers.set('Audio', audioHandler);

      // Handle user started speaking
      const userStartedSpeakingHandler = () => {
        if (this.isDisconnected) {
          console.log('[HybridVoiceAgent] 🔇 Ignoring UserStartedSpeaking event - agent is disconnected');
          return;
        }
        console.log('[HybridVoiceAgent] 👤 User started speaking');
        // Stop current audio playback when user starts speaking
        if (this.currentAudioSource) {
          try {
            this.currentAudioSource.stop();
            this.currentAudioSource = null;
          } catch (error) {
            console.warn('[HybridVoiceAgent] Error stopping audio on user speech:', error);
          }
        }
        // Clear audio queues
        this.audioQueue = [];
        this.audioPlaybackQueue = [];
        this.nextStartTime = 0;
        this.isPlayingAudio = false;
        this.pendingUserMessage = null;
        this.lastPartialUserContent = null;
      };
      client.on(AgentEvents.UserStartedSpeaking, userStartedSpeakingHandler);
      this.eventHandlers.set('UserStartedSpeaking', userStartedSpeakingHandler);

      // Handle errors
      const errorHandler = (error: any) => {
        if (this.isDisconnected) {
          console.log('[HybridVoiceAgent] 🔇 Ignoring Error event - agent is disconnected');
          return;
        }
        console.error('[HybridVoiceAgent] ❌ Error event:', error);
        const errorMessage = error.description || error.message || 'Unknown error';
        const err = new Error(`HybridVoiceAgent error: ${errorMessage}`);
        this.onErrorCallback?.(err);
        clearTimeout(timeout);
        clearTimeout(settingsAppliedTimeout);
        reject(err);
        this.disconnect();
      };
      client.on(AgentEvents.Error, errorHandler);
      this.eventHandlers.set('Error', errorHandler);

      // Handle close
      const closeHandler = (closeEvent: any) => {
        console.log('[HybridVoiceAgent] ⚠️ Close event received:', closeEvent);
        this.onConnectionCallback?.(false);
        this.deepgramClient = null;
      };
      client.on(AgentEvents.Close, closeHandler);
      this.eventHandlers.set('Close', closeHandler);

      console.log('[HybridVoiceAgent] ✅ All event handlers registered');
    });
  }

  private async processUserMessageQueue(): Promise<void> {
    // Don't process messages if microphone is not active (user has paused/muted)
    if (!this.isMicrophoneActive) {
      console.log('[HybridVoiceAgent] ⏸️ Microphone inactive, skipping message queue processing');
      // Clear the queue when microphone is inactive
      this.userMessageQueue = [];
      return;
    }

    if (this.isGeneratingResponse) {
      return;
    }

    if (this.userMessageQueue.length === 0) {
      return;
    }

    const nextMessage = this.userMessageQueue.shift();
    if (!nextMessage) {
      return;
    }

    try {
      await this.generateAndSpeakResponse(nextMessage.content);
    } catch (error) {
      console.error('[HybridVoiceAgent] ❌ Error processing user message queue:', error);
      this.onErrorCallback?.(error instanceof Error ? error : new Error('Failed to process queued message'));
    }
  }

  private async generateAndSpeakResponse(userMessage: string): Promise<void> {
    if (!this.config || !this.elevenLabsTTS) {
      console.error('[HybridVoiceAgent] Cannot generate response: config or TTS not initialized');
      return;
    }

    // Don't generate response if microphone is not active (user has paused/muted)
    if (!this.isMicrophoneActive) {
      console.log('[HybridVoiceAgent] ⏸️ Microphone inactive, aborting response generation');
      return;
    }

    // Prevent multiple simultaneous responses
    if (this.isGeneratingResponse) {
      console.log('[HybridVoiceAgent] ⚠️ Already generating a response, skipping');
      return;
    }

    this.isGeneratingResponse = true;

    try {
      // In consultant mode (disableLLM), skip LLM response generation entirely
      if (this.config?.disableLLM) {
        console.log('[HybridVoiceAgent] 🎧 Consultant mode - skipping LLM response');
        return;
      }

      // Check again before calling LLM (user might have muted during the check)
      if (!this.isMicrophoneActive) {
        console.log('[HybridVoiceAgent] ⏸️ Microphone became inactive, aborting response generation');
        return;
      }

      // Call LLM API to generate response
      const llmResponse = await this.callLLM(userMessage);
      
      // Check again after LLM call (user might have muted during generation)
      if (!this.isMicrophoneActive) {
        console.log('[HybridVoiceAgent] ⏸️ Microphone became inactive during generation, aborting');
        return;
      }
      
      // Add to conversation history
      this.conversationHistory.push({
        role: 'agent',
        content: llmResponse
      });

      // Notify callback
      this.onMessageCallback?.({
        role: 'agent',
        content: llmResponse,
        timestamp: new Date().toISOString()
      });

      // Convert response to speech using ElevenLabs (only if still active)
      if (this.isMicrophoneActive) {
        await this.speakWithElevenLabs(llmResponse);
      }
    } catch (error) {
      console.error('[HybridVoiceAgent] Error generating response:', error);
      this.onErrorCallback?.(error instanceof Error ? error : new Error('Failed to generate response'));
    } finally {
      this.isGeneratingResponse = false;
      // Only process queue if microphone is still active
      if (this.isMicrophoneActive) {
        void this.processUserMessageQueue();
      }
    }
  }

  private async callLLM(userMessage: string): Promise<string> {
    if (!this.config) {
      throw new Error('Config not initialized');
    }

    const provider = this.config.llmProvider || 'anthropic';
    const model = this.config.llmModel || (provider === 'openai' ? 'gpt-4o' : 'claude-3-5-haiku-latest');
    
    // Get API key from config or fetch from server
    let apiKey = this.config.llmApiKey;
    if (!apiKey) {
      // Try to get from server endpoint
      try {
        const response = await fetch('/api/llm-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider }),
        });
        if (response.ok) {
          const data = await response.json();
          apiKey = data.apiKey;
        }
      } catch (error) {
        console.warn('[HybridVoiceAgent] Could not fetch LLM API key from server:', error);
      }
    }

    if (!apiKey) {
      throw new Error(`API key not found for ${provider}. Please configure the LLM API key.`);
    }

    // Build messages array from conversation history
    const messages = [
      { role: 'system', content: this.config.systemPrompt },
      ...this.conversationHistory.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      }))
    ];

    if (provider === 'anthropic') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages: messages.filter(m => m.role !== 'system'),
          system: this.config.systemPrompt,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Anthropic API error: ${errorText}`);
      }

      const data = await response.json();
      const content = data.content?.[0]?.text || '';
      return content;
    } else if (provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 1024,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      return content;
    } else {
      throw new Error(`Unsupported LLM provider: ${provider}`);
    }
  }

  private async speakWithElevenLabs(text: string): Promise<void> {
    // BUG-001 FIX: Extra guard - never play TTS in consultant mode (disableLLM) even if other code paths
    // accidentally call this method. This is a belt-and-suspenders check.
    if (this.config?.disableLLM) {
      console.log('[HybridVoiceAgent] 🛡️ Consultant mode active - blocking TTS playback');
      return;
    }

    if (!this.elevenLabsTTS || !this.audioContext) {
      console.error('[HybridVoiceAgent] Cannot speak: TTS or audio context not initialized');
      return;
    }

    try {
      // Stream audio from ElevenLabs
      const audioStream = await this.elevenLabsTTS.streamTextToSpeech(text);
      const reader = audioStream.getReader();
      const chunks: Uint8Array[] = [];

      // Read all chunks
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        // Call audio callback for each chunk
        this.onAudioCallback?.(value);
      }

      // Combine chunks
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      // Decode MP3 to AudioBuffer and play
      try {
        const audioBuffer = await this.audioContext.decodeAudioData(combined.buffer);
        await this.playAudioBuffer(audioBuffer);
      } catch (error) {
        console.error('[HybridVoiceAgent] Error decoding audio:', error);
        // Fallback: try to play as-is
        throw error;
      }
    } catch (error) {
      console.error('[HybridVoiceAgent] Error speaking with ElevenLabs:', error);
      throw error;
    }
  }

  private async playAudioBuffer(audioBuffer: AudioBuffer): Promise<void> {
    if (!this.audioContext) return;

    // If already playing, add to queue
    if (this.isPlayingAudio) {
      this.audioPlaybackQueue.push(audioBuffer);
      console.log('[HybridVoiceAgent] 🔊 Audio queued, current queue length:', this.audioPlaybackQueue.length);
      return;
    }

    // Start playing
    this.isPlayingAudio = true;
    await this.playAudioBufferInternal(audioBuffer);
  }

  private async playAudioBufferInternal(audioBuffer: AudioBuffer): Promise<void> {
    if (!this.audioContext) {
      this.isPlayingAudio = false;
      return;
    }

    return new Promise((resolve) => {
      const source = this.audioContext!.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext!.destination);

      const currentTime = this.audioContext!.currentTime;
      if (this.nextStartTime < currentTime) {
        this.nextStartTime = currentTime;
      }

      source.onended = () => {
        this.currentAudioSource = null;
        
        // Check if there's more audio to play
        if (this.audioPlaybackQueue.length > 0) {
          const nextBuffer = this.audioPlaybackQueue.shift()!;
          console.log('[HybridVoiceAgent] 🔊 Playing next queued audio, remaining:', this.audioPlaybackQueue.length);
          this.playAudioBufferInternal(nextBuffer).then(resolve);
        } else {
          this.isPlayingAudio = false;
          resolve();
        }
      };

      source.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;
      this.currentAudioSource = source;
    });
  }

  async startMicrophone(deviceId?: string, voiceIsolation: boolean = true): Promise<void> {
    console.log('[HybridVoiceAgent] 🎤 Starting microphone...', { deviceId, voiceIsolation });
    if (!this.deepgramClient) {
      throw new Error('Not connected to Deepgram');
    }

    const isFirefox = this.isFirefox;
    let audioConstraints: MediaTrackConstraints;
    
    if (isFirefox) {
      audioConstraints = {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: voiceIsolation,
        noiseSuppression: false,
      };
    } else {
      audioConstraints = {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: voiceIsolation,
        noiseSuppression: voiceIsolation,
        autoGainControl: voiceIsolation,
        sampleRate: 24000,
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

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: finalConstraints
    });
    this.mediaStream = stream;

    let audioContext: AudioContext;
    if (isFirefox) {
      audioContext = new AudioContext();
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } else {
      audioContext = new AudioContext({ sampleRate: 24000 });
    }
    this.audioContext = audioContext;

    const source = audioContext.createMediaStreamSource(stream);
    this.sourceNode = source;

    const processor = audioContext.createScriptProcessor(2048, 1, 1);
    this.processorNode = processor;

    let audioChunkCount = 0;
    processor.onaudioprocess = (audioProcessingEvent) => {
      // Check if microphone is active BEFORE processing audio
      if (!this.deepgramClient || !this.isMicrophoneActive) {
        return; // Don't process or send audio if muted
      }

      const inputBuffer = audioProcessingEvent.inputBuffer;
      const inputData = inputBuffer.getChannelData(0);

      let processedData: Float32Array;
      if (isFirefox) {
        const downsampledLength = Math.floor(inputData.length / 2);
        processedData = new Float32Array(downsampledLength);
        for (let i = 0; i < downsampledLength; i++) {
          processedData[i] = inputData[i * 2];
        }
      } else {
        processedData = inputData;
      }

      const pcmData = new Int16Array(processedData.length);
      for (let i = 0; i < processedData.length; i++) {
        const sample = Math.max(-1, Math.min(1, processedData[i]));
        pcmData[i] = Math.round(sample * 0x7FFF);
      }

      // Double-check before sending (user might have muted during processing)
      if (!this.isMicrophoneActive) {
        return;
      }

      try {
        this.deepgramClient.send(pcmData.buffer);
        audioChunkCount++;
        if (audioChunkCount % 100 === 0) {
          console.log('[HybridVoiceAgent] 🔊 Sent', audioChunkCount, 'audio chunks to Deepgram');
        }
      } catch (error) {
        console.error('[HybridVoiceAgent] ❌ Error sending audio to Deepgram:', error);
      }
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
    
    this.isMicrophoneActive = true;
    console.log('[HybridVoiceAgent] ✅ Audio graph connected, microphone is active');
  }

  stopMicrophone(): void {
    console.log('[HybridVoiceAgent] 🎤 Stopping microphone and closing WebSocket...');

    // Set flags to stop processing IMMEDIATELY (before any other cleanup)
    // This ensures no audio is sent and no events are processed after mute is activated
    this.isDisconnected = true;
    this.isMicrophoneActive = false;

    // Stop any ongoing response generation
    if (this.isGeneratingResponse) {
      console.log('[HybridVoiceAgent] ⏸️ Stopping ongoing response generation...');
      this.isGeneratingResponse = false;
    }

    // Clear message queues
    this.userMessageQueue = [];
    this.pendingUserMessage = null;
    this.lastPartialUserContent = null;

    // Stop current audio playback
    if (this.currentAudioSource) {
      try {
        this.currentAudioSource.stop();
        this.currentAudioSource = null;
        console.log('[HybridVoiceAgent] ✅ Stopped current audio playback');
      } catch (error) {
        console.warn('[HybridVoiceAgent] Error stopping audio playback:', error);
      }
    }

    // Clear audio queues
    this.audioQueue = [];
    this.audioPlaybackQueue = [];
    this.isPlayingAudio = false;

    // CRITICAL: Stop media stream tracks FIRST to prevent new audio capture
    // This stops the audio at the source before any processing
    if (this.mediaStream) {
      try {
        this.mediaStream.getTracks().forEach(track => {
          if (track.readyState === 'live') {
            track.stop();
            console.log('[HybridVoiceAgent] ✅ Stopped track:', track.kind, track.label || 'unnamed');
          }
        });
        this.mediaStream = null;
        console.log('[HybridVoiceAgent] ✅ Media stream stopped');
      } catch (error) {
        console.warn('[HybridVoiceAgent] Error stopping media stream:', error);
      }
    }

    // Clear the processor's audio handler BEFORE disconnecting to drop any pending audio
    if (this.processorNode) {
      const processorNode = this.processorNode;
      processorNode.onaudioprocess = null;
      console.log('[HybridVoiceAgent] ✅ Cleared audio processor handler');

      try {
        processorNode.disconnect();
        console.log('[HybridVoiceAgent] ✅ Processor node disconnected');
      } catch (error) {
        console.warn('[HybridVoiceAgent] Error disconnecting processor:', error);
      }
      this.processorNode = null;
    }

    // Disconnect source node
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
        console.log('[HybridVoiceAgent] ✅ Source node disconnected');
      } catch (error) {
        console.warn('[HybridVoiceAgent] Error disconnecting source:', error);
      }
      this.sourceNode = null;
    }
    
    // Close audio context
    if (this.audioContext) {
      try {
        if (this.audioContext.state !== 'closed') {
          this.audioContext.close();
          console.log('[HybridVoiceAgent] ✅ Audio context closed');
        }
      } catch (error) {
        console.warn('[HybridVoiceAgent] Error closing audio context:', error);
      }
      this.audioContext = null;
    }

    // CRITICAL: Remove all event listeners BEFORE disconnecting
    // This prevents events from firing after disconnect
    if (this.deepgramClient) {
      try {
        // Remove all event listeners
        this.eventHandlers.forEach((handler, eventName) => {
          try {
            (this.deepgramClient as any).off(AgentEvents[eventName as keyof typeof AgentEvents], handler);
            console.log('[HybridVoiceAgent] ✅ Removed event listener:', eventName);
          } catch (error) {
            console.warn('[HybridVoiceAgent] Error removing event listener:', eventName, error);
          }
        });
        this.eventHandlers.clear();
        console.log('[HybridVoiceAgent] ✅ All event listeners removed');
      } catch (error) {
        console.warn('[HybridVoiceAgent] Error removing event listeners:', error);
      }

      // Close WebSocket connection
      try {
        this.deepgramClient.disconnect();
        console.log('[HybridVoiceAgent] ✅ WebSocket disconnected (mute)');
      } catch (error) {
        console.warn('[HybridVoiceAgent] Error disconnecting WebSocket on mute:', error);
      }
      this.deepgramClient = null;
    }

    // Clear keep-alive interval
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
      console.log('[HybridVoiceAgent] ✅ Cleared keep-alive interval');
    }

    // Notify connection callback that we're disconnected
    this.onConnectionCallback?.(false);
    
    console.log('[HybridVoiceAgent] ✅ Microphone stopped and WebSocket closed');
  }

  disconnect(): void {
    console.log('[HybridVoiceAgent] 🔌 Disconnecting completely (websocket + microphone)...');
    
    // Set disconnect flag FIRST to prevent any new events from being processed
    this.isDisconnected = true;
    
    // Mark microphone as inactive FIRST to prevent any new processing
    this.isMicrophoneActive = false;
    
    // Stop any ongoing response generation immediately
    this.isGeneratingResponse = false;
    
    // Stop microphone (this will stop all audio streams)
    this.stopMicrophone();

    // Stop current audio playback
    if (this.currentAudioSource) {
      try {
        this.currentAudioSource.stop();
        this.currentAudioSource = null;
        console.log('[HybridVoiceAgent] ✅ Stopped current audio source');
      } catch (error) {
        console.warn('[HybridVoiceAgent] Error stopping audio source:', error);
      }
    }
    
    // Clear all audio queues
    this.audioQueue = [];
    this.audioPlaybackQueue = [];
    this.nextStartTime = 0;
    this.isPlayingAudio = false;
    
    // Clear all message queues
    this.pendingUserMessage = null;
    this.userMessageQueue = [];
    this.lastPartialUserContent = null;

    // Remove all event listeners and disconnect Deepgram WebSocket client
    if (this.deepgramClient) {
      try {
        // Remove all event listeners
        this.eventHandlers.forEach((handler, eventName) => {
          try {
            (this.deepgramClient as any).off(AgentEvents[eventName as keyof typeof AgentEvents], handler);
            console.log('[HybridVoiceAgent] ✅ Removed event listener:', eventName);
          } catch (error) {
            console.warn('[HybridVoiceAgent] Error removing event listener:', eventName, error);
          }
        });
        this.eventHandlers.clear();
        console.log('[HybridVoiceAgent] ✅ All event listeners removed');
      } catch (error) {
        console.warn('[HybridVoiceAgent] Error removing event listeners:', error);
      }

      // Disconnect Deepgram WebSocket client
      try {
        this.deepgramClient.disconnect();
        console.log('[HybridVoiceAgent] ✅ Disconnected Deepgram WebSocket client');
      } catch (error) {
        console.warn('[HybridVoiceAgent] Error disconnecting Deepgram client:', error);
      }
      this.deepgramClient = null;
    }

    // Clear keep-alive interval
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
      console.log('[HybridVoiceAgent] ✅ Cleared keep-alive interval');
    }

    // Close audio context
    if (this.audioContext) {
      try {
        if (this.audioContext.state !== 'closed') {
          this.audioContext.close();
          console.log('[HybridVoiceAgent] ✅ Closed audio context');
        }
      } catch (error) {
        console.warn('[HybridVoiceAgent] Error closing audio context:', error);
      }
      this.audioContext = null;
    }
    
    // Reset ElevenLabs TTS
    this.elevenLabsTTS = null;
    
    // Clear config
    this.config = null;
    
    // Notify connection callback that we're disconnected
    this.onConnectionCallback?.(false);
    
    console.log('[HybridVoiceAgent] ✅ Complete disconnection finished - websocket closed, microphone stopped, all queues cleared');
  }

  isConnected(): boolean {
    return this.deepgramClient !== null;
  }

  /**
   * Inject a text message and trigger AI response
   * Used when user edits a transcription in voice mode
   *
   * @param text - The edited/corrected message text
   */
  async injectUserMessageAndRespond(text: string): Promise<void> {
    if (!text?.trim()) {
      console.warn('[HybridVoiceAgent] injectUserMessageAndRespond: empty text, skipping');
      return;
    }

    console.log('[HybridVoiceAgent] 📝 Injecting edited message and triggering response:', text.substring(0, 50) + '...');

    try {
      // Add user message to conversation history
      this.conversationHistory.push({
        role: 'user',
        content: text
      });

      // Generate and speak the AI response
      await this.generateAndSpeakResponse(text);
    } catch (error) {
      console.error('[HybridVoiceAgent] Error processing injected message:', error);
      this.onErrorCallback?.(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
