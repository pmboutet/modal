/**
 * Speechmatics Voice Agent Constants
 * Centralized configuration values for the voice agent modules
 *
 * This file contains all magic numbers and configuration values used across
 * the Speechmatics voice agent system. Centralizing these values makes it
 * easier to tune, test, and maintain the voice agent behavior.
 */

// =============================================================================
// LLM Response Generation
// =============================================================================

/** Maximum time allowed for LLM response generation before auto-reset (60 seconds) */
export const GENERATION_TIMEOUT_MS = 60000;

/** Maximum queue size for pending user messages to prevent unbounded memory growth */
export const MAX_QUEUE_SIZE = 10;

/**
 * Maximum age of receivedPartialDuringGeneration flag before it's considered stale (3 seconds)
 * Used to determine if a partial transcript is still relevant when LLM response arrives
 */
export const PARTIAL_FLAG_STALENESS_MS = 3000;

/** Time to wait before retrying queued message processing after error (100ms) */
export const QUEUED_MESSAGE_RETRY_DELAY_MS = 100;

/**
 * Deduplication window for user messages (5 seconds)
 * Messages with identical content within this window are considered duplicates
 */
export const MESSAGE_DEDUPLICATION_WINDOW_MS = 5000;

// =============================================================================
// WebSocket Connection
// =============================================================================

/** Minimum delay between disconnect and reconnect to ensure server releases session (5 seconds) */
export const RECONNECT_DELAY_MS = 5000;

/** Extended delay after quota errors before reconnecting (10 seconds) */
export const QUOTA_ERROR_DELAY_MS = 10000;

/** Time to wait after disconnect for server to fully release the session (3 seconds) */
export const SERVER_SESSION_RELEASE_DELAY_MS = 3000;

/**
 * Time window during which a quota error is considered relevant (15 seconds)
 * After this window, quota errors are considered stale and won't block reconnection
 */
export const QUOTA_ERROR_RELEVANCE_WINDOW_MS = 15000;

/** Time to wait after sending EndOfStream for server to process (1.5 seconds) */
export const END_OF_STREAM_WAIT_MS = 1500;

/** Time to wait if EndOfStream couldn't be sent (server may have session active) (2 seconds) */
export const END_OF_STREAM_ERROR_WAIT_MS = 2000;

/** Maximum time to wait for WebSocket close event (3 seconds) */
export const WEBSOCKET_CLOSE_TIMEOUT_MS = 3000;

/** Timeout for RecognitionStarted event before considering connection failed (10 seconds) */
export const RECOGNITION_STARTED_TIMEOUT_MS = 10000;

/** Interval for checking if WebSocket has closed (100ms) */
export const WEBSOCKET_CLOSE_CHECK_INTERVAL_MS = 100;

/** Time to wait after microphone stops before sending EndOfStream (800ms) */
export const MICROPHONE_STOP_WAIT_MS = 800;

/** Time to wait after disconnect for cleanup before enumerating devices (500ms) */
export const DISCONNECT_CLEANUP_DELAY_MS = 500;

// =============================================================================
// Transcription (Speech-to-Text)
// =============================================================================

/** Fallback silence timeout when partials are enabled (2 seconds) */
export const SILENCE_DETECTION_TIMEOUT_MS = 2000;

/** Fallback silence timeout when partials are disabled (2 seconds) */
export const SILENCE_DETECTION_TIMEOUT_NO_PARTIALS_MS = 2000;

/** Debounce delay after EndOfUtterance before processing (300ms) */
export const UTTERANCE_FINALIZATION_DELAY_MS = 300;

/** Maximum time before forcing transcript processing if EndOfUtterance never received (15 seconds) */
export const ABSOLUTE_FALLBACK_TIMEOUT_MS = 15000;

/** Time before auto-rejecting unconfirmed speaker (30 seconds) */
export const SPEAKER_CONFIRMATION_TIMEOUT_MS = 30000;

/** Minimum interval between partial transcript updates to avoid UI spam (100ms) */
export const MIN_PARTIAL_UPDATE_INTERVAL_MS = 100;

/** Minimum character length for a complete utterance */
export const MIN_UTTERANCE_CHAR_LENGTH = 20;

/** Minimum word count for a complete utterance */
export const MIN_UTTERANCE_WORDS = 3;

/** Number of recent conversation messages to use for context (last 4 messages) */
export const RECENT_HISTORY_COUNT = 4;

/** Number of recent conversation messages for audio detection context (last 2 messages) */
export const ECHO_DETECTION_CONTEXT_MESSAGES = 2;

/** Maximum characters of recent context for echo detection */
export const ECHO_DETECTION_CONTEXT_LENGTH = 200;

// =============================================================================
// Audio Processing
// =============================================================================

/** Maximum TTS audio chunks in playback queue (~30 seconds of audio) */
export const MAX_AUDIO_QUEUE_SIZE = 10;

/** Cooldown period between barge-in events to prevent echo-triggered interruptions (1.5 seconds) */
export const BARGE_IN_COOLDOWN_MS = 1500;

/** Base VAD RMS threshold (~-36 dB) */
export const BASE_VAD_RMS_THRESHOLD = 0.015;

/** Stride for VAD sample processing (every 4th sample) */
export const VAD_SAMPLE_STRIDE = 4;

/** Grace period after audio playback ends for echo protection (500ms) */
export const AUDIO_PLAYBACK_GRACE_PERIOD_MS = 500;

/**
 * Timeout for barge-in validation - increased from 300ms to 600ms
 * to allow partial transcripts to arrive before canceling (BUG-018 FIX)
 */
export const BARGE_IN_VALIDATION_TIMEOUT_MS = 600;

/** Number of audio chunks to track for VAD sliding window */
export const VAD_WINDOW_SIZE = 5;

/** Minimum number of active chunks in VAD window to consider user speaking */
export const VAD_ACTIVE_CHUNKS_THRESHOLD = 3;

/** History size for noise floor smoothing */
export const NOISE_FLOOR_HISTORY_SIZE = 10;

/** History size for spectral energy analysis */
export const SPECTRAL_HISTORY_SIZE = 5;

/** Minimum sensitivity multiplier for microphone */
export const MIN_SENSITIVITY_MULTIPLIER = 0.3;

/** Maximum sensitivity multiplier for microphone */
export const MAX_SENSITIVITY_MULTIPLIER = 3.0;

/** Margin above noise floor for adaptive threshold */
export const ADAPTIVE_THRESHOLD_MARGIN = 0.005;

/** Minimum VAD threshold (floor) */
export const MIN_VAD_THRESHOLD = 0.005;

/** Maximum VAD threshold (ceiling) */
export const MAX_VAD_THRESHOLD = 0.1;

/** Default microphone sensitivity multiplier */
export const DEFAULT_MICROPHONE_SENSITIVITY = 1.5;

/** Spectral energy threshold multiplier relative to VAD threshold */
export const SPECTRAL_THRESHOLD_MULTIPLIER = 0.75;

/** Audio fade duration for stopping agent speech (100ms) */
export const AUDIO_FADE_DURATION_S = 0.1;

/** Time to wait for AudioContext to resume on iOS (100ms) */
export const AUDIO_CONTEXT_RESUME_DELAY_MS = 100;

// =============================================================================
// Barge-in Validation
// =============================================================================

/** Minimum words required for barge-in validation (in grace period) */
export const BARGE_IN_MIN_WORDS_GRACE_PERIOD = 3;

/** Minimum words required for barge-in validation (normal) */
export const BARGE_IN_MIN_WORDS_NORMAL = 2;

// =============================================================================
// Authentication
// =============================================================================

/**
 * JWT expiry safety factor (90% of TTL)
 * Token is refreshed when 90% of its lifetime has passed
 */
export const JWT_EXPIRY_SAFETY_FACTOR = 900;

// =============================================================================
// Speechmatics STT Configuration Defaults
// =============================================================================

/** Default STT end-of-utterance silence trigger (0.7 seconds) */
export const DEFAULT_END_OF_UTTERANCE_SILENCE_TRIGGER = 0.7;

/** Maximum end-of-utterance silence trigger (2 seconds) */
export const MAX_END_OF_UTTERANCE_SILENCE_TRIGGER = 2;

/** Minimum end-of-utterance silence trigger (0 seconds) */
export const MIN_END_OF_UTTERANCE_SILENCE_TRIGGER = 0;

/** Default max delay for low latency mode (1 second) */
export const DEFAULT_MAX_DELAY_LOW_LATENCY = 1.0;

/** Default max delay for standard mode (3 seconds) */
export const DEFAULT_MAX_DELAY_STANDARD = 3.0;

/** Default speaker sensitivity for diarization */
export const DEFAULT_SPEAKER_SENSITIVITY = 0.5;

/** Minimum speakers for max_speakers config */
export const MIN_SPEAKERS_CONFIG = 2;

// =============================================================================
// Content Analysis
// =============================================================================

/** Minimum new words to consider user continuing after interruption */
export const SIGNIFICANT_NEW_WORDS_THRESHOLD = 3;

/** Minimum content length to process (characters) */
export const MIN_CONTENT_LENGTH = 2;

// =============================================================================
// Loop Detection (Rate Limiting)
// =============================================================================

/** Minimum time between AI responses to prevent loops (2 seconds) */
export const MIN_RESPONSE_INTERVAL_MS = 2000;

/** Maximum rapid responses before triggering circuit breaker */
export const MAX_RAPID_RESPONSES = 3;

/** Time window for counting rapid responses (10 seconds) */
export const RAPID_RESPONSE_WINDOW_MS = 10000;

/** Circuit breaker cooldown after detecting potential loop (5 seconds) */
export const CIRCUIT_BREAKER_COOLDOWN_MS = 5000;
