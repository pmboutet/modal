/**
 * Types and interfaces for Speechmatics Voice Agent
 */

export interface SpeechmaticsConfig {
  systemPrompt: string;
  userPrompt?: string; // User prompt template (same as text mode)
  // Prompt variables for template rendering (same as text mode)
  promptVariables?: Record<string, string | null | undefined>; // Variables for userPrompt template rendering
  // Initial conversation history (to continue from existing messages)
  initialConversationHistory?: Array<{ role: 'user' | 'agent'; content: string }>;
  // Speechmatics STT config
  sttLanguage?: string; // e.g., "fr", "en", "multi", "fr,en"
  sttOperatingPoint?: "enhanced" | "standard";
  sttMaxDelay?: number; // Max delay between segments (default: 1.0 in low latency mode, 3.0 otherwise)
  sttEnablePartials?: boolean; // Enable partial transcription results
  sttEndOfUtteranceSilenceTrigger?: number; // Seconds of silence (0-2) before EndOfUtterance is emitted
  lowLatencyMode?: boolean; // Enable low latency mode (default: true) - uses max_delay: 1.0 and operating_point: "standard"
  // Speechmatics diarization config (speaker identification)
  sttDiarization?: "none" | "speaker" | "channel" | "channel_and_speaker"; // Diarization mode (default: "speaker")
  sttSpeakerSensitivity?: number; // 0.0-1.0, higher = more unique speakers detected (default: 0.5)
  sttPreferCurrentSpeaker?: boolean; // Reduce false speaker switches (default: true)
  sttMaxSpeakers?: number; // Max speakers to detect (>=2, null = unlimited)
  // Microphone sensitivity config
  microphoneSensitivity?: number; // VAD threshold multiplier (0.5 = more sensitive, 2.0 = less sensitive, default: 1.0)
  microphoneDeviceId?: string; // Device ID for specific microphone selection
  voiceIsolation?: boolean; // Enable voice isolation (noise suppression, echo cancellation)
  // Audio processing enhancements
  enableAdaptiveSensitivity?: boolean; // Enable adaptive VAD threshold based on noise floor (default: true)
  enableAdaptiveNoiseGate?: boolean; // Enable adaptive noise gate (default: true)
  enableWorkletAGC?: boolean; // Enable AGC (Automatic Gain Control) in AudioWorklet (default: true)
  // LLM config
  llmProvider?: "anthropic" | "openai";
  llmModel?: string;
  llmApiKey?: string;
  enableThinking?: boolean;
  thinkingBudgetTokens?: number;
  // ElevenLabs TTS config
  elevenLabsApiKey?: string; // Optional - will be fetched automatically if not provided
  elevenLabsVoiceId?: string;
  elevenLabsModelId?: string;
  disableElevenLabsTTS?: boolean; // If true, disable ElevenLabs TTS (only STT will work)
  // Consultant mode (passive listening)
  disableLLM?: boolean; // If true, disable LLM responses (transcription only, for consultant mode)
  // Speaker filtering (individual mode)
  enableSpeakerFiltering?: boolean; // If true, filter out non-primary speakers (for individual mode)
  onSpeakerEstablished?: (speaker: string) => void; // Callback when primary speaker is established
  onSpeakerFiltered?: (speaker: string, transcript: string) => void; // Callback when a non-primary speaker is filtered
}

export interface SpeechmaticsMessageEvent {
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  isInterim?: boolean;
  messageId?: string; // Unique ID for streaming message updates
  speaker?: string; // Speaker identifier from diarization (e.g., "S1", "S2", "UU" for unknown)
}

export type SpeechmaticsMessageCallback = (message: SpeechmaticsMessageEvent) => void;
export type SpeechmaticsErrorCallback = (error: Error) => void;
export type SpeechmaticsConnectionCallback = (connected: boolean) => void;
export type SpeechmaticsAudioCallback = (audio: Uint8Array) => void;

// Re-export segment store types for convenience
export type { TimestampedSegment } from './speechmatics-segment-store';

/**
 * Word-level timing information from Speechmatics results array
 */
export interface WordSegment {
  /** Start time in seconds from audio start */
  startTime: number;
  /** End time in seconds from audio start */
  endTime: number;
  /** The word content */
  content: string;
  /** Speaker identifier from diarization */
  speaker?: string;
}
