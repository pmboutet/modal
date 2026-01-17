# Voice Mode Architecture

## Overview

The Voice Mode system provides a real-time conversational AI experience combining:
- **Speechmatics STT** - Real-time speech-to-text transcription via WebSocket
- **LLM Processing** - Response generation via Anthropic Claude or OpenAI GPT
- **ElevenLabs TTS** - High-quality text-to-speech synthesis

This document details the technical architecture, data flows, and component interactions.

---

## Table of Contents

1. [Architecture Diagram](#architecture-diagram)
2. [Core Components](#core-components)
3. [SpeechmaticsVoiceAgent](#speechmaticsvoiceagent)
4. [WebSocket Connection](#websocket-connection)
5. [Audio Processing Pipeline](#audio-processing-pipeline)
6. [Transcription Management](#transcription-management)
7. [Turn Detection](#turn-detection)
8. [Text-to-Speech (ElevenLabs)](#text-to-speech-elevenlabs)
9. [UI Component: PremiumVoiceInterface](#ui-component-premiumvoiceinterface)
10. [Configuration](#configuration)
11. [State Machine Diagrams](#state-machine-diagrams)
12. [API Endpoints](#api-endpoints)
13. [Troubleshooting](#troubleshooting)

---

## Architecture Diagram

```
+---------------------------+
|   PremiumVoiceInterface   |  (React Component)
|  - UI State Management    |
|  - Message Display        |
|  - Audio Visualization    |
+------------+--------------+
             |
             v
+---------------------------+
|  SpeechmaticsVoiceAgent   |  (Main Orchestrator)
|  - Connection Management  |
|  - Message Queue          |
|  - Conversation History   |
+------------+--------------+
             |
    +--------+--------+--------+
    |        |        |        |
    v        v        v        v
+-------+ +-------+ +-------+ +-------+
| Auth  | | WS    | | Audio | | LLM   |
| Module| | Module| | Module| | Module|
+-------+ +-------+ +-------+ +-------+
    |        |        |        |
    v        v        v        v
+-------+ +-------+ +-------+ +-------+
|API/JWT| |Speech-| |Micro- | |Claude/|
|Tokens | |matics | |phone  | |OpenAI |
+-------+ +-------+ +-------+ +-------+
                     |
                     v
              +-------------+
              | ElevenLabs  |
              | TTS Module  |
              +-------------+
                     |
                     v
              +-------------+
              | Audio       |
              | Playback    |
              +-------------+
```

---

## Core Components

### Module Overview

| Module | File | Responsibility |
|--------|------|----------------|
| `SpeechmaticsVoiceAgent` | `src/lib/ai/speechmatics.ts` | Main orchestrator coordinating all modules |
| `SpeechmaticsAuth` | `src/lib/ai/speechmatics-auth.ts` | JWT/API key authentication |
| `SpeechmaticsWebSocket` | `src/lib/ai/speechmatics-websocket.ts` | WebSocket connection management |
| `SpeechmaticsAudio` | `src/lib/ai/speechmatics-audio.ts` | Microphone capture, VAD, barge-in, playback |
| `SpeechmaticsLLM` | `src/lib/ai/speechmatics-llm.ts` | LLM API calls (Anthropic/OpenAI) |
| `TranscriptionManager` | `src/lib/ai/speechmatics-transcription.ts` | Partial/final transcript handling |
| `ElevenLabsTTS` | `src/lib/ai/elevenlabs.ts` | Text-to-speech synthesis |
| `PremiumVoiceInterface` | `src/components/chat/PremiumVoiceInterface.tsx` | React UI component |

---

## SpeechmaticsVoiceAgent

The main orchestrator class that coordinates all voice mode functionality.

### Configuration Interface

```typescript
interface SpeechmaticsConfig {
  // System prompts
  systemPrompt: string;
  userPrompt?: string;
  promptVariables?: Record<string, string | null | undefined>;

  // Initial state
  initialConversationHistory?: Array<{ role: 'user' | 'agent'; content: string }>;

  // Speechmatics STT
  sttLanguage?: string;                    // "fr", "en", etc.
  sttOperatingPoint?: "enhanced" | "standard";
  sttMaxDelay?: number;                    // Default: 1.0s (low latency) or 3.0s
  sttEnablePartials?: boolean;             // Default: true
  sttEndOfUtteranceSilenceTrigger?: number; // 0-2 seconds
  lowLatencyMode?: boolean;                // Default: true

  // Speaker diarization
  sttDiarization?: "none" | "speaker" | "channel" | "channel_and_speaker";
  sttSpeakerSensitivity?: number;          // 0.0-1.0, default: 0.5
  sttPreferCurrentSpeaker?: boolean;       // Default: true
  sttMaxSpeakers?: number;                 // Min 2, null = unlimited

  // Microphone
  microphoneSensitivity?: number;          // VAD threshold multiplier
  microphoneDeviceId?: string;
  voiceIsolation?: boolean;                // Noise suppression

  // Adaptive audio
  enableAdaptiveSensitivity?: boolean;     // Default: true
  enableAdaptiveNoiseGate?: boolean;       // Default: true
  enableWorkletAGC?: boolean;              // Default: true

  // LLM
  llmProvider?: "anthropic" | "openai";
  llmModel?: string;
  llmApiKey?: string;
  enableThinking?: boolean;
  thinkingBudgetTokens?: number;

  // ElevenLabs TTS
  elevenLabsApiKey?: string;
  elevenLabsVoiceId?: string;
  elevenLabsModelId?: string;
  disableElevenLabsTTS?: boolean;          // Text-only mode

  // Consultant mode
  disableLLM?: boolean;                    // Transcription only
}
```

### Callback Events

```typescript
agent.setCallbacks({
  onMessage: (message: SpeechmaticsMessageEvent) => void,
  onError: (error: Error) => void,
  onConnection: (connected: boolean) => void,
  onAudio: (audio: Uint8Array) => void,
  onSemanticTurn: (event: SemanticTurnTelemetryEvent) => void,
  onAudioPlaybackEnd: () => void,
});
```

### Message Event Structure

```typescript
interface SpeechmaticsMessageEvent {
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  isInterim?: boolean;           // true for partial transcriptions
  messageId?: string;            // Unique ID for streaming updates
  speaker?: string;              // Diarization: "S1", "S2", "UU"
}
```

### Key Methods

| Method | Description |
|--------|-------------|
| `connect(config)` | Establishes WebSocket connection and initializes modules |
| `disconnect()` | Clean shutdown of all resources |
| `startMicrophone(deviceId?, voiceIsolation?)` | Starts audio capture |
| `stopMicrophone()` | Stops audio capture |
| `setMicrophoneMuted(muted)` | Mutes/unmutes without disconnecting |
| `setMicrophoneSensitivity(sensitivity)` | Adjusts VAD threshold |
| `speakInitialMessage(text)` | Speaks welcome message via TTS |
| `updatePrompts(prompts)` | Updates prompts without reconnection |
| `abortResponse()` | Cancels current response (barge-in) |

---

## WebSocket Connection

### Connection Flow

```
1. Client calls agent.connect(config)
       |
       v
2. SpeechmaticsAuth.authenticate()
   - Fetches JWT from /api/speechmatics-jwt
   - Falls back to API key from /api/speechmatics-token
       |
       v
3. SpeechmaticsWebSocket.connect()
   - Waits for any pending disconnects
   - Enforces reconnection delays (5s normal, 10s after quota error)
   - Creates WebSocket to wss://eu2.rt.speechmatics.com/v2
       |
       v
4. Send StartRecognition message
   {
     "message": "StartRecognition",
     "audio_format": {
       "type": "raw",
       "encoding": "pcm_s16le",
       "sample_rate": 16000
     },
     "transcription_config": {
       "language": "fr",
       "enable_partials": true,
       "max_delay": 1.0,
       "operating_point": "standard",
       "conversation_config": {
         "end_of_utterance_silence_trigger": 0.7
       },
       "diarization": "speaker",
       "speaker_diarization_config": {
         "speaker_sensitivity": 0.5,
         "prefer_current_speaker": true
       }
     }
   }
       |
       v
5. Receive RecognitionStarted
   - Connection confirmed
   - onConnection(true) callback fired
```

### WebSocket Messages

#### Incoming Messages

| Message Type | Description |
|--------------|-------------|
| `RecognitionStarted` | Connection confirmed, ready for audio |
| `AddPartialTranscript` | Interim transcription (user speaking) |
| `AddTranscript` | Final transcription segment |
| `EndOfUtterance` | Silence detected, user likely finished |
| `EndOfStream` | Server acknowledges stream end |
| `AudioAdded` | Confirmation of audio chunk receipt |
| `Info` | Server information messages |
| `Error` | Error messages (quota, invalid audio, etc.) |

#### Transcript Message Structure

```typescript
// AddPartialTranscript / AddTranscript
{
  "message": "AddPartialTranscript" | "AddTranscript",
  "metadata": {
    "transcript": "Hello world",
    "start_time": 0.5,
    "end_time": 1.2
  },
  "results": [
    {
      "alternatives": [
        {
          "content": "Hello",
          "speaker": "S1",      // Speaker diarization
          "confidence": 0.95
        }
      ],
      "start_time": 0.5,
      "end_time": 0.8
    }
  ]
}
```

### Disconnect Protocol

```
1. agent.disconnect() called
       |
       v
2. Stop microphone (setMicrophoneMuted(true))
       |
       v
3. Wait 800ms for pending audio chunks
       |
       v
4. Send EndOfStream message
   { "message": "EndOfStream", "last_seq_no": 0 }
       |
       v
5. Wait 1.5s for server to process
       |
       v
6. Close WebSocket (code 1000)
       |
       v
7. Wait for WebSocket close confirmation (3s timeout)
       |
       v
8. Wait additional 3s for server session release
       |
       v
9. Clean up all references
```

---

## Audio Processing Pipeline

### Microphone Capture

The `SpeechmaticsAudio` class manages audio capture using Web Audio API.

```
MediaDevices.getUserMedia()
       |
       v
AudioContext (sampleRate: 16000)
       |
       v
MediaStreamSource
       |
       v
AudioWorkletNode (speechmatics-audio-processor.js)
       |
       +---> VAD (Voice Activity Detection)
       |
       +---> Noise Gate (Adaptive)
       |
       +---> Deduplication
       |
       v
WebSocket.send(pcm_s16le audio)
```

### AudioWorklet Processor

Location: `/public/speechmatics-audio-processor.js`

Features:
- Converts Float32 to Int16 PCM
- Calculates noise floor for adaptive sensitivity
- Optional AGC (Automatic Gain Control)
- Sends data via port messages

### Voice Activity Detection (VAD)

The hybrid VAD uses multiple criteria:

```typescript
// RMS-based detection
const rms = Math.sqrt(sumSquares / samples);
const rmsCheck = rms > threshold;

// Spectral energy detection (voice frequencies)
const spectralEnergy = calculateSpectralEnergy(chunk);
const spectralCheck = spectralEnergy > threshold * 0.75;

// Combined logic
if (isPlayingAudio) {
  // Stricter: Both must pass (prevents echo)
  return rmsCheck && spectralCheck;
} else {
  // Relaxed: Either can trigger
  return rmsCheck || spectralCheck;
}
```

### Adaptive Sensitivity

The system adapts to ambient noise:

```typescript
// Noise floor tracked via AudioWorklet
noiseFloor = median(recentNoiseFloorMeasurements);

// Adaptive threshold
threshold = (noiseFloor * sensitivityMultiplier) + margin;

// Clamped to bounds
threshold = clamp(threshold, MIN_THRESHOLD, MAX_THRESHOLD);
```

---

## Transcription Management

### TranscriptionManager Flow

```
Speechmatics Partial
       |
       v
SegmentStore.upsert()  <-- Timestamp-based deduplication
       |
       v
Emit interim message (rate-limited)
       |
       v
Reset silence timeout
       |
       |
Speechmatics Final
       |
       v
SegmentStore.upsert()  <-- Replaces overlapping partials
       |
       v
Schedule utterance finalization
       |
       v
EndOfUtterance received?
       |
       +-- Yes --> Debounce (300ms) --> Process
       |
       +-- No --> Silence timeout (2s) --> Process
       |
       v
Semantic turn detection (optional)
       |
       v
Clean transcript & deduplicate words
       |
       v
Add to conversation history
       |
       v
Fire onMessage callback (isInterim: false)
       |
       v
Call processUserMessage() --> LLM --> TTS
```

### Segment Deduplication

The `SegmentStore` tracks segments by timestamp ranges:

```typescript
interface TimestampedSegment {
  startTime: number;    // Seconds from audio start
  endTime: number;
  transcript: string;
  isFinal: boolean;
  speaker?: string;
  receivedAt: number;   // Timestamp for freshness
}
```

When a final arrives, it removes all partials with overlapping time ranges.

### Utterance Completeness Check

Before processing, transcripts are validated:

```typescript
// Fragment endings that indicate incomplete speech
const FRAGMENT_ENDINGS = [
  'et', 'de', 'des', 'du', 'si', 'que', 'le', 'la', 'les',
  'nous', 'vous', 'je', 'mais', 'ou', 'donc', 'car', 'a', 'en'
];

// Minimum requirements
const MIN_CHARS = 20;
const MIN_WORDS = 3;

function isUtteranceComplete(text: string): boolean {
  const lastWord = extractLastWord(text);
  if (FRAGMENT_ENDINGS.has(lastWord)) return false;
  if (text.length < MIN_CHARS) return false;
  if (wordCount(text) < MIN_WORDS) return false;
  return true;
}
```

---

## Turn Detection

### Semantic Turn Detection (End-of-Turn)

Uses AI to predict when user has finished speaking.

```
User transcript + conversation context
       |
       v
Format as ChatML
       |
       v
Call /api/semantic-turn (Mistral via OpenRouter)
       |
       v
Parse logprobs for tracked tokens
       |
       v
Calculate end-of-turn probability
       |
       v
probability >= threshold (0.72) --> Dispatch
       |
       v
probability < threshold --> Hold (wait for silence)
```

Configuration:

```typescript
interface SemanticTurnDetectorConfig {
  enabled: boolean;
  provider: "openai" | "http" | "disabled";
  model: string;                    // e.g., "gpt-4o-mini"
  baseUrl: string;
  probabilityThreshold: number;     // Default: 0.72
  gracePeriodMs: number;            // Default: 900ms
  maxHoldMs: number;                // Default: 5000ms
  contextMessages: number;          // Default: 6
  trackedTokens: string[];          // ["<|im_end|>", ".", "!", "?", ...]
}
```

### Start-of-Turn Detection (Barge-in)

Validates that detected speech is genuine user input, not echo.

```
Barge-in triggered (VAD during TTS playback)
       |
       v
Pending validation state
       |
       v
Partial transcript received
       |
       v
Local echo detection (fuzzy text match)
       |
       +-- Is echo --> Cancel barge-in, discard transcript
       |
       v
AI validation (optional)
       |
       v
Confirm barge-in --> Stop TTS, abort LLM
```

Local Echo Detection:

```typescript
function detectLocalEcho(transcript, assistantSpeech): boolean {
  const normalized = normalize(transcript);
  const assistant = normalize(assistantSpeech);

  // Direct containment
  if (assistant.includes(normalized)) return true;

  // Word-based fuzzy matching (40% threshold)
  const matchedWords = countMatchingWords(normalized, assistant);
  if (matchedWords / totalWords >= 0.4) return true;

  // Sliding window for fragmented echoes
  for (windowSize = 2; windowSize <= 7; windowSize++) {
    if (findWindowMatch(normalized, assistant, windowSize)) {
      return true;
    }
  }

  return false;
}
```

---

## Text-to-Speech (ElevenLabs)

### TTS Flow

```
LLM response received
       |
       v
Clean STEP_COMPLETE markers
       |
       v
Set currentAssistantSpeech (for echo detection)
       |
       v
ElevenLabsTTS.streamTextToSpeech(text)
       |
       v
POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}/stream
       |
       v
Stream audio chunks
       |
       v
SpeechmaticsAudio.streamToUint8Array()
       |
       v
onAudioCallback (optional)
       |
       v
SpeechmaticsAudio.playAudio()
       |
       v
AudioContext.decodeAudioData()
       |
       v
BufferSourceNode --> GainNode --> Destination
       |
       v
onAudioPlaybackEnd callback
```

### ElevenLabs Configuration

```typescript
interface ElevenLabsConfig {
  apiKey: string;
  voiceId?: string;           // Default: "21m00Tcm4TlvDq8ikWAM" (Rachel)
  modelId?: string;           // Default: "eleven_turbo_v2_5"
  stability?: number;         // 0.0-1.0, default: 0.5
  similarityBoost?: number;   // 0.0-1.0, default: 0.75
  style?: number;             // 0.0-1.0, default: 0.0
  useSpeakerBoost?: boolean;  // Default: true
}
```

### Barge-in Handling

When user interrupts:

```typescript
function abortResponse(): void {
  // 1. Stop ElevenLabs playback
  audio.stopAgentSpeech();

  // 2. Cancel in-flight LLM request
  llmAbortController?.abort();

  // 3. Clear assistant interim message
  onMessageCallback?.({
    role: 'agent',
    content: '',
    isInterim: true,
    messageId: `abort-${Date.now()}`
  });

  // 4. Reset generation state
  isGeneratingResponse = false;
}
```

---

## UI Component: PremiumVoiceInterface

### Component Props

```typescript
interface PremiumVoiceInterfaceProps {
  askKey: string;
  askSessionId?: string;
  systemPrompt: string;
  userPrompt?: string;
  modelConfig?: {
    provider?: "deepgram-voice-agent" | "hybrid-voice-agent" | "speechmatics-voice-agent";
    voiceAgentProvider?: string;
    speechmaticsSttLanguage?: string;
    speechmaticsSttOperatingPoint?: "enhanced" | "standard";
    speechmaticsLlmProvider?: "anthropic" | "openai";
    speechmaticsLlmModel?: string;
    elevenLabsVoiceId?: string;
    elevenLabsModelId?: string;
    disableElevenLabsTTS?: boolean;
  };
  onMessage: (message: SpeechmaticsMessageEvent) => void;
  onError: (error: Error) => void;
  onClose: () => void;
  onEditMessage?: (messageId: string, newContent: string) => Promise<void>;
  messages?: VoiceMessage[];
  conversationPlan?: ConversationPlan | null;
  elapsedMinutes?: number;
  isTimerPaused?: boolean;
  onTogglePause?: () => void;
  expectedDurationMinutes?: number | null;
  consultantMode?: boolean;           // AI listens, doesn't respond
  participants?: ParticipantOption[]; // For speaker assignment
  onSpeakerMappingChange?: (mappings: SpeakerMapping[]) => void;
  inviteToken?: string | null;
  currentUserId?: string | null;
}
```

### State Management

| State | Type | Description |
|-------|------|-------------|
| `isConnected` | boolean | WebSocket connection status |
| `isMicrophoneActive` | boolean | Microphone stream active |
| `isMuted` | boolean | Microphone muted (WebSocket still open) |
| `isSpeaking` | boolean | User currently speaking (visual indicator) |
| `audioLevel` | number | 0-1 audio level for visualization |
| `interimUser` | VoiceMessage | Current user partial transcription |
| `interimAssistant` | VoiceMessage | Current assistant partial response |
| `error` | string | Error message to display |
| `pendingSpeakers` | string[] | Speakers awaiting assignment (consultant mode) |

### Connection Lifecycle

```
Component Mount
       |
       v
StrictMode check (skip first mount)
       |
       v
loadMicrophoneDevices()
       |
       v
User clicks "Start Voice"
       |
       v
connect()
  |-- Wait for pending disconnect (if any)
  |-- Create SpeechmaticsVoiceAgent
  |-- agent.connect(config)
  |-- agent.startMicrophone()
  |-- startAudioVisualization()
  |-- speakInitialMessage() (if no messages)
       |
       v
Voice session active
       |
       v
User clicks "Close"
       |
       v
disconnect()
  |-- cleanupAudioAnalysis()
  |-- agent.disconnect()
  |-- Reset all state
       |
       v
Component Unmount (cleanup effect)
```

### Message Handling

```typescript
function handleMessage(rawMessage: SpeechmaticsMessageEvent) {
  const isInterim = Boolean(rawMessage.isInterim);
  const role = rawMessage.role === 'agent' ? 'assistant' : 'user';

  // Track speaking state for UI animation
  if (role === 'user') {
    setIsSpeaking(true);
    // Reset after 2s of no messages
    clearTimeout(speakingTimeout);
    speakingTimeout = setTimeout(() => setIsSpeaking(false), 2000);
  }

  // Interim messages update local buffers only
  if (isInterim) {
    if (role === 'assistant') {
      setInterimAssistant(prev => ({
        ...prev,
        content: mergeStreamingContent(prev?.content, message.content)
      }));
    } else {
      setInterimUser(message);
    }
    return;
  }

  // Final messages: clear buffers, notify parent
  if (role === 'assistant') {
    setInterimAssistant(null);

    // Detect STEP_COMPLETE marker
    const { hasMarker, stepId } = detectStepComplete(message.content);
    if (hasMarker) {
      // Call step-complete API
      fetch(`/api/ask/${askKey}/step-complete`, {
        method: 'POST',
        body: JSON.stringify({ stepId })
      });
    }
  } else {
    setInterimUser(null);
  }

  // Notify parent
  onMessage({ ...rawMessage, isInterim: false });
}
```

### Periodic Prompt Updates

Time variables in prompts are refreshed every 30 seconds:

```typescript
useEffect(() => {
  // Skip if paused or no elapsed time
  if (isTimerPaused || elapsedMinutes === undefined) return;

  // Calculate 30-second slot
  const currentSlot = Math.floor(elapsedMinutes * 2);
  if (currentSlot === lastSlot) return;

  lastSlot = currentSlot;
  updatePromptsFromApi(`periodic time update at ${elapsedMinutes.toFixed(1)}min`);
}, [elapsedMinutes, isTimerPaused]);
```

---

## Configuration

### Environment Variables

#### Speechmatics

| Variable | Description | Default |
|----------|-------------|---------|
| `SPEECHMATICS_API_KEY` | API key for authentication | Required |
| `NEXT_PUBLIC_SPEECHMATICS_REGION` | WebSocket region | `eu2` |
| `NEXT_PUBLIC_SPEECHMATICS_USE_PROXY` | Use local proxy | `false` |
| `NEXT_PUBLIC_SPEECHMATICS_PROXY_PORT` | Proxy port | `3001` |

#### ElevenLabs

| Variable | Description | Default |
|----------|-------------|---------|
| `ELEVENLABS_API_KEY` | API key for TTS | Required for voice mode |

#### Semantic Turn Detection

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_SEMANTIC_TURN_DETECTOR_PROVIDER` | `openai`, `http`, or `disabled` | `disabled` |
| `NEXT_PUBLIC_SEMANTIC_TURN_DETECTOR_MODEL` | Model for turn detection | `gpt-4o-mini` |
| `NEXT_PUBLIC_SEMANTIC_TURN_PROB_THRESHOLD` | Probability threshold | `0.72` |
| `NEXT_PUBLIC_SEMANTIC_TURN_GRACE_MS` | Grace period after detection | `900` |
| `NEXT_PUBLIC_SEMANTIC_TURN_MAX_HOLD_MS` | Maximum hold time | `5000` |

#### Start-of-Turn Detection

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_START_OF_TURN_ENABLED` | Enable barge-in AI validation | `true` |
| `NEXT_PUBLIC_START_OF_TURN_PROVIDER` | `anthropic` or `openai` | `anthropic` |
| `NEXT_PUBLIC_START_OF_TURN_MODEL` | Model for validation | `claude-3-5-haiku-latest` |
| `NEXT_PUBLIC_START_OF_TURN_TIMEOUT_MS` | Request timeout | `800` |

### Database Configuration

Voice agent settings are stored in `ai_model_configs`:

```sql
SELECT
  code,
  provider,                        -- 'speechmatics-voice-agent'
  voice_agent_provider,            -- 'speechmatics-voice-agent'
  speechmatics_stt_language,       -- 'fr'
  speechmatics_stt_operating_point, -- 'enhanced'
  speechmatics_llm_provider,       -- 'anthropic'
  speechmatics_llm_model,          -- 'claude-3-5-haiku-latest'
  elevenlabs_voice_id,             -- Voice ID
  elevenlabs_model_id              -- 'eleven_turbo_v2_5'
FROM ai_model_configs
WHERE voice_agent_provider = 'speechmatics-voice-agent';
```

---

## State Machine Diagrams

### Connection State Machine

```
                    +-------------+
                    |   INITIAL   |
                    +------+------+
                           |
                    connect()
                           |
                    +------v------+
                    | CONNECTING  |
                    +------+------+
                           |
              +------------+------------+
              |                         |
        RecognitionStarted           Error
              |                         |
       +------v------+          +------v------+
       |  CONNECTED  |          | DISCONNECTED|
       +------+------+          +-------------+
              |
       +------+------+
       |             |
   disconnect()   onclose
       |             |
+------v------+      |
| DISCONNECTING|<----+
+------+------+
       |
       v
+-------------+
| DISCONNECTED|
+-------------+
```

### Message Processing State Machine

```
                 +-------------+
                 |    IDLE     |
                 +------+------+
                        |
              Partial transcript received
                        |
                 +------v------+
                 |  STREAMING  |<-----+
                 +------+------+      |
                        |             |
              +---------+---------+   |
              |                   |   |
         More partials      Final received
              |                   |   |
              +-------------------+   |
                                  |   |
                           +------v------+
                           |  FINALIZING |
                           +------+------+
                                  |
                        Silence timeout OR
                        EndOfUtterance + debounce
                                  |
                           +------v------+
                           | PROCESSING  |
                           +------+------+
                                  |
                           +------v------+
                           |    IDLE     |
                           +-------------+
```

### Response Generation State Machine

```
              +-------------+
              |    IDLE     |
              +------+------+
                     |
            User message received
                     |
              +------v------+
              | GENERATING  |<----------+
              +------+------+           |
                     |                  |
         +-----------+-----------+      |
         |           |           |      |
     Response   Abort      Continuation
     complete   (barge-in)  detected
         |           |           |
         |     +-----v-----+     |
         |     |  ABORTING |-----+
         |     +-----------+
         |
  +------v------+
  |   TTS_PLAY  |
  +------+------+
         |
     Playback complete
         |
  +------v------+
  |    IDLE     |
  +-------------+
```

---

## API Endpoints

### Authentication

#### `GET /api/speechmatics-jwt`

Returns a short-lived JWT for direct Speechmatics WebSocket connection.

**Response:**
```json
{
  "jwt": "eyJ...",
  "ttl": 300
}
```

#### `GET /api/speechmatics-token`

Fallback: Returns API key for proxy-based connection.

#### `GET /api/elevenlabs-token`

Returns ElevenLabs API key (server-side only).

### LLM

#### `POST /api/speechmatics-llm`

Proxies LLM calls to avoid exposing API keys.

**Request:**
```json
{
  "provider": "anthropic",
  "model": "claude-3-5-haiku-latest",
  "messages": [...],
  "systemPrompt": "...",
  "enableThinking": false
}
```

**Response:**
```json
{
  "content": "AI response text"
}
```

### Turn Detection

#### `POST /api/semantic-turn`

Evaluates end-of-turn probability.

#### `POST /api/start-of-turn`

Validates barge-in (start of user turn).

### Voice Session

#### `GET /api/ask/[key]/agent-config`

Returns current agent configuration with rendered prompts.

#### `POST /api/ask/[key]/respond`

Generates AI response (used for initial welcome message).

#### `POST /api/ask/[key]/step-complete`

Marks a conversation step as complete.

---

## Troubleshooting

### Common Issues

#### Microphone Not Working

1. Check browser permissions
2. Verify microphone device is selected
3. Check console for `getUserMedia` errors
4. Try refreshing the page (releases ghost permissions)

```javascript
// Debug: List available microphones
const devices = await navigator.mediaDevices.enumerateDevices();
const mics = devices.filter(d => d.kind === 'audioinput');
console.log('Available microphones:', mics);
```

#### Speechmatics Quota Error

```
Error: Speechmatics quota exceeded. Please wait 10 seconds...
```

**Causes:**
- Too many concurrent sessions
- Multiple tabs with voice mode open
- Rapid connect/disconnect cycles

**Solutions:**
- Close other tabs using voice mode
- Wait 10+ seconds before retrying
- Check Speechmatics dashboard for usage

#### Echo/Feedback Issues

**Symptoms:**
- AI hears its own responses
- Barge-in triggers incorrectly
- Transcripts contain TTS output

**Solutions:**
- Enable voice isolation (noise suppression)
- Use headphones
- Increase microphone sensitivity (less sensitive to distant sounds)
- Check that echo detection is working (see logs for "Echo detected")

#### TTS Not Playing

1. Check ElevenLabs API key is set
2. Verify voice ID is valid
3. Check browser autoplay policies (may need user interaction first)
4. Look for errors in console

```bash
# Test ElevenLabs API directly
curl -X POST "https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM/stream" \
  -H "xi-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello world","model_id":"eleven_turbo_v2_5"}'
```

#### WebSocket Disconnects Unexpectedly

**Check Sentry for errors:**
```bash
curl -s 'http://localhost:3000/api/admin/sentry/issues?query=speechmatics' | jq
```

**Common causes:**
- Network instability
- Server-side timeout
- Invalid audio format
- Authentication expired

### Debug Logging

Enable verbose logging:

```javascript
// In browser console
localStorage.setItem('voiceDebug', 'true');
```

Key log prefixes:
- `[Speechmatics]` - Core agent logs
- `[PremiumVoiceInterface]` - UI component logs
- `[Transcription]` - Transcription processing
- `[TurnDetection]` - Semantic turn detection
- `[StartOfTurn]` - Barge-in validation

---

## Related Documentation

- [ElevenLabs Configuration](./voice-elevenlabs.md) - TTS setup and troubleshooting
- [Agent Configuration](../ai-system/agent-configuration.md) - AI model settings
- [Prompts Chaining](../ai-system/prompts-chaining.md) - Prompt template system
- [Handlebars Templates](./handlebars-templates.md) - Variable substitution
