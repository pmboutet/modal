/**
 * Unit tests for SpeechmaticsVoiceAgent state machine
 * Tests the core state flags and their transitions
 */

// ============================================================================
// MOCK SETUP - Must be before imports
// ============================================================================

// Mock all dependent modules
jest.mock('../speechmatics-auth');
jest.mock('../speechmatics-websocket');
jest.mock('../speechmatics-audio');
jest.mock('../speechmatics-audio-dedupe');
jest.mock('../speechmatics-transcription');
jest.mock('../speechmatics-llm');
jest.mock('../elevenlabs');
jest.mock('../turn-detection');
jest.mock('../turn-detection-config');
jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Import after mocks
import { SpeechmaticsVoiceAgent } from '../speechmatics';
import { SpeechmaticsAuth } from '../speechmatics-auth';
import { SpeechmaticsWebSocket } from '../speechmatics-websocket';
import { SpeechmaticsAudio } from '../speechmatics-audio';
import { AudioChunkDedupe } from '../speechmatics-audio-dedupe';
import { TranscriptionManager } from '../speechmatics-transcription';
import { SpeechmaticsLLM } from '../speechmatics-llm';
import { ElevenLabsTTS } from '../elevenlabs';
import { createSemanticTurnDetector, type SemanticTurnDetector } from '../turn-detection';
import { resolveSemanticTurnDetectorConfig } from '../turn-detection-config';
import type { SpeechmaticsConfig } from '../speechmatics-types';
import { SpeechmaticsStateMachine } from '../speechmatics-state-machine';
import { hasSignificantNewContent, extractDominantSpeaker } from '../speechmatics-speaker-utils';

// ============================================================================
// MOCK IMPLEMENTATIONS
// ============================================================================

const mockAuth = {
  authenticate: jest.fn().mockResolvedValue('test-jwt'),
  getElevenLabsApiKey: jest.fn().mockResolvedValue('eleven-labs-key'),
  hasJWT: jest.fn().mockReturnValue(true),
  getJWT: jest.fn().mockReturnValue('test-jwt'),
  getApiKey: jest.fn().mockReturnValue(null),
};

const mockWebSocket = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  isConnected: jest.fn().mockReturnValue(true),
  getWebSocket: jest.fn().mockReturnValue({ readyState: WebSocket.OPEN }),
  send: jest.fn(),
  setMessageHandler: jest.fn(),
};

const mockAudio = {
  startMicrophone: jest.fn().mockResolvedValue(undefined),
  stopMicrophone: jest.fn().mockResolvedValue(undefined),
  updateWebSocket: jest.fn(),
  setMicrophoneSensitivity: jest.fn(),
  setAdaptiveFeatures: jest.fn(),
  setMicrophoneMuted: jest.fn(),
  isPlaying: jest.fn().mockReturnValue(false),
  isUserSpeaking: jest.fn().mockReturnValue(false),
  validateBargeInWithTranscript: jest.fn(),
  resetVADStateForFilteredSpeaker: jest.fn(),
  stopAgentSpeech: jest.fn(),
  playAudio: jest.fn().mockResolvedValue(undefined),
  streamToUint8Array: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  setCurrentAssistantSpeech: jest.fn(),
  updateConversationHistory: jest.fn(),
};

const mockAudioDedupe = {
  reset: jest.fn(),
  computeChunkSignature: jest.fn().mockReturnValue('sig'),
  shouldSkipChunk: jest.fn().mockReturnValue(false),
};

const mockTranscriptionManager = {
  handlePartialTranscript: jest.fn(),
  handleFinalTranscript: jest.fn(),
  markEndOfUtterance: jest.fn(),
  processPendingTranscript: jest.fn().mockResolvedValue(undefined),
  discardPendingTranscript: jest.fn(),
  cleanup: jest.fn(),
  shouldFilterSpeaker: jest.fn().mockReturnValue(false),
  getCurrentSpeaker: jest.fn().mockReturnValue('S1'),
  addAllowedSpeaker: jest.fn(),
  setPrimarySpeaker: jest.fn(),
  resetSpeakerFiltering: jest.fn(),
  getPrimarySpeaker: jest.fn().mockReturnValue('S1'),
  isAwaitingSpeakerConfirmation: jest.fn().mockReturnValue(false),
  confirmCandidateSpeaker: jest.fn(),
  rejectCandidateSpeaker: jest.fn(),
};

const mockLLM = {
  getLLMApiKey: jest.fn().mockResolvedValue('llm-api-key'),
  callLLM: jest.fn().mockResolvedValue('AI response'),
};

const mockElevenLabsTTS = {
  streamTextToSpeech: jest.fn().mockResolvedValue(new ReadableStream()),
};

const mockSemanticTurnDetector: SemanticTurnDetector = {
  getSemanticEotProb: jest.fn().mockResolvedValue(0.5),
};

// Setup mocks
(SpeechmaticsAuth as jest.Mock).mockImplementation(() => mockAuth);
(SpeechmaticsWebSocket as jest.Mock).mockImplementation(() => mockWebSocket);
(SpeechmaticsAudio as jest.Mock).mockImplementation(() => mockAudio);
(AudioChunkDedupe as jest.Mock).mockImplementation(() => mockAudioDedupe);
(TranscriptionManager as jest.Mock).mockImplementation(() => mockTranscriptionManager);
(SpeechmaticsLLM as jest.Mock).mockImplementation(() => mockLLM);
(ElevenLabsTTS as jest.Mock).mockImplementation(() => mockElevenLabsTTS);
(createSemanticTurnDetector as jest.Mock).mockReturnValue(mockSemanticTurnDetector);
(resolveSemanticTurnDetectorConfig as jest.Mock).mockReturnValue({
  enabled: false,
  probabilityThreshold: 0.7,
  gracePeriodMs: 500,
  maxHoldMs: 3000,
  fallbackMode: 'silence',
  contextMessages: 4,
});

// Suppress console logs during tests
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockFetch.mockReset();
  jest.clearAllMocks();
});

afterEach(async () => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  // Clear any pending promises/timers
  await new Promise(resolve => setTimeout(resolve, 0));
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const createDefaultConfig = (): SpeechmaticsConfig => ({
  systemPrompt: 'You are a helpful assistant.',
  elevenLabsVoiceId: 'voice-123',
  llmProvider: 'anthropic',
  llmModel: 'claude-3-5-haiku-latest',
});

/**
 * Access private property using type assertion
 */
const getPrivateProperty = <T>(agent: SpeechmaticsVoiceAgent, prop: string): T => {
  return (agent as any)[prop] as T;
};

/**
 * Set private property using type assertion
 */
const setPrivateProperty = <T>(agent: SpeechmaticsVoiceAgent, prop: string, value: T): void => {
  (agent as any)[prop] = value;
};

/**
 * Call private method using type assertion
 */
const callPrivateMethod = async <T>(
  agent: SpeechmaticsVoiceAgent,
  method: string,
  ...args: any[]
): Promise<T> => {
  return await (agent as any)[method](...args);
};

/**
 * Get the state machine from the agent
 */
const getStateMachine = (agent: SpeechmaticsVoiceAgent): SpeechmaticsStateMachine => {
  return getPrivateProperty<SpeechmaticsStateMachine>(agent, 'stateMachine');
};

// ============================================================================
// TESTS
// ============================================================================

describe('SpeechmaticsVoiceAgent State Machine', () => {
  describe('hasSignificantNewContent', () => {
    it('should return false for shorter transcript', () => {
      const result = hasSignificantNewContent('Hello', 'Hello world');
      expect(result).toBe(false);
    });

    it('should return false for same length transcript', () => {
      const result = hasSignificantNewContent('Hello world', 'Hello world');
      expect(result).toBe(false);
    });

    it('should return true for continuation with 3+ new words', () => {
      const result = hasSignificantNewContent(
        'Hello world I am adding more content here',
        'Hello world'
      );
      expect(result).toBe(true);
    });

    it('should return false for continuation with fewer than 3 new words', () => {
      const result = hasSignificantNewContent('Hello world ok', 'Hello world');
      expect(result).toBe(false);
    });

    it('should normalize accents and punctuation', () => {
      const result = hasSignificantNewContent('Hello, world!', 'Hello world');
      // Same content after normalization
      expect(result).toBe(false);
    });

    it('should return true for genuinely new words not in sent message', () => {
      const result = hasSignificantNewContent(
        'Bonjour completely different message here',
        'Hello world'
      );
      expect(result).toBe(true);
    });
  });

  describe('abortResponse', () => {
    it('should stop agent speech', () => {
      const agent = new SpeechmaticsVoiceAgent();
      setPrivateProperty(agent, 'audio', mockAudio);

      agent.abortResponse();

      expect(mockAudio.stopAgentSpeech).toHaveBeenCalled();
    });

    it('should cancel in-flight LLM request', () => {
      const agent = new SpeechmaticsVoiceAgent();
      const mockAbortController = { abort: jest.fn() };
      setPrivateProperty(agent, 'llmAbortController', mockAbortController);

      agent.abortResponse();

      expect(mockAbortController.abort).toHaveBeenCalled();
    });

    it('should reset generation state via state machine', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());

      // Set up generation state via state machine
      const sm = getStateMachine(agent);
      sm.transition({ type: 'GENERATION_START', message: 'test' });
      sm.transition({ type: 'PARTIAL_TRANSCRIPT', text: 'partial', timestamp: Date.now() });

      agent.abortResponse();

      expect(sm.isGenerating()).toBe(false);
      expect(sm.getContext().generationStartedAt).toBe(0);
      expect(sm.getContext().receivedPartialDuringGeneration).toBe(false);
    });

    it('should emit empty agent message via callback', () => {
      const agent = new SpeechmaticsVoiceAgent();
      const messageCallback = jest.fn();
      agent.setCallbacks({ onMessage: messageCallback });

      agent.abortResponse();

      expect(messageCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'agent',
          content: '',
          isInterim: true,
        })
      );
    });
  });

  describe('consultant mode (disableLLM)', () => {
    it('should not call LLM when disableLLM is true', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      const config = createDefaultConfig();
      config.disableLLM = true;

      await agent.connect(config);

      await callPrivateMethod(agent, 'processUserMessage', 'Hello');

      expect(mockLLM.callLLM).not.toHaveBeenCalled();
    });

    it('should reset isGenerating after processing in consultant mode', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      const config = createDefaultConfig();
      config.disableLLM = true;

      await agent.connect(config);

      await callPrivateMethod(agent, 'processUserMessage', 'Hello');

      expect(getStateMachine(agent).isGenerating()).toBe(false);
    });

    it('should process queued messages in consultant mode', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      const config = createDefaultConfig();
      config.disableLLM = true;

      await agent.connect(config);

      // Queue a message via state machine
      const sm = getStateMachine(agent);
      sm.queueMessage('Queued message', new Date().toISOString());

      // Process first message
      await callPrivateMethod(agent, 'processUserMessage', 'First message');

      // Queue should be processed
      const updatedQueue = sm.getContext().messageQueue;
      expect(updatedQueue.length).toBe(0);
    });
  });

  describe('WebSocket message handling', () => {
    it('should handle RecognitionStarted message', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());

      // Should not throw
      await callPrivateMethod(agent, 'handleWebSocketMessage', { message: 'RecognitionStarted' });
    });

    it('should handle AddPartialTranscript message', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());

      const wsMessage = {
        message: 'AddPartialTranscript',
        metadata: { transcript: 'Hello', start_time: 0, end_time: 1 },
        results: [{ alternatives: [{ speaker: 'S1' }] }],
      };

      await callPrivateMethod(agent, 'handleWebSocketMessage', wsMessage);

      expect(mockTranscriptionManager.handlePartialTranscript).toHaveBeenCalled();
    });

    it('should handle AddTranscript (final) message', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());

      const wsMessage = {
        message: 'AddTranscript',
        metadata: { transcript: 'Hello world', start_time: 0, end_time: 2 },
        results: [{ alternatives: [{ speaker: 'S1' }] }],
      };

      await callPrivateMethod(agent, 'handleWebSocketMessage', wsMessage);

      expect(mockTranscriptionManager.handleFinalTranscript).toHaveBeenCalled();
    });

    it('should handle EndOfUtterance message', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());

      await callPrivateMethod(agent, 'handleWebSocketMessage', { message: 'EndOfUtterance' });

      expect(mockTranscriptionManager.markEndOfUtterance).toHaveBeenCalled();
    });

    it('should handle Error message', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());

      const errorCallback = jest.fn();
      agent.setCallbacks({ onError: errorCallback });

      await callPrivateMethod(agent, 'handleWebSocketMessage', {
        message: 'Error',
        reason: 'Test error',
      });

      expect(errorCallback).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should handle quota error specially', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());

      const errorCallback = jest.fn();
      agent.setCallbacks({ onError: errorCallback });

      await callPrivateMethod(agent, 'handleWebSocketMessage', {
        message: 'Error',
        reason: 'Quota exceeded',
      });

      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('quota'),
        })
      );
    });
  });

  describe('extractDominantSpeaker', () => {
    it('should return undefined for empty results', () => {
      const result = extractDominantSpeaker([]);
      expect(result).toBeUndefined();
    });

    it('should return undefined for undefined results', () => {
      const result = extractDominantSpeaker(undefined);
      expect(result).toBeUndefined();
    });

    it('should return dominant speaker', () => {
      const results = [
        { alternatives: [{ speaker: 'S1' }] },
        { alternatives: [{ speaker: 'S1' }] },
        { alternatives: [{ speaker: 'S2' }] },
      ];
      const result = extractDominantSpeaker(results);
      expect(result).toBe('S1');
    });

    it('should return UU when all speakers are unknown', () => {
      const results = [
        { alternatives: [{ speaker: 'UU' }] },
        { alternatives: [{ speaker: 'UU' }] },
      ];
      const result = extractDominantSpeaker(results);
      expect(result).toBe('UU');
    });
  });

  describe('updatePrompts', () => {
    it('should update systemPrompt', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());

      agent.updatePrompts({ systemPrompt: 'New system prompt' });

      const config = getPrivateProperty<SpeechmaticsConfig>(agent, 'config');
      expect(config.systemPrompt).toBe('New system prompt');
    });

    it('should update userPrompt', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());

      agent.updatePrompts({ userPrompt: 'New user prompt' });

      const config = getPrivateProperty<SpeechmaticsConfig>(agent, 'config');
      expect(config.userPrompt).toBe('New user prompt');
    });

    it('should update promptVariables', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());

      agent.updatePrompts({ promptVariables: { key: 'value' } });

      const config = getPrivateProperty<SpeechmaticsConfig>(agent, 'config');
      expect(config.promptVariables).toEqual({ key: 'value' });
    });

    it('should do nothing if config is null', () => {
      const agent = new SpeechmaticsVoiceAgent();

      // Should not throw
      agent.updatePrompts({ systemPrompt: 'Test' });
    });
  });

  describe('text-only mode', () => {
    it('should set text-only mode via setTextOnlyMode', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());

      agent.setTextOnlyMode(true);

      expect(agent.getTextOnlyMode()).toBe(true);
    });

    it('should disable TTS when text-only mode is enabled', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      const config = createDefaultConfig();
      config.disableElevenLabsTTS = true;

      await agent.connect(config);

      await callPrivateMethod(agent, 'processUserMessage', 'Hello');

      expect(mockElevenLabsTTS.streamTextToSpeech).not.toHaveBeenCalled();
    });
  });

  describe('speaker filtering', () => {
    it('should delegate addAllowedSpeaker to transcriptionManager', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());

      agent.addAllowedSpeaker('S2');

      expect(mockTranscriptionManager.addAllowedSpeaker).toHaveBeenCalledWith('S2');
    });

    it('should delegate setPrimarySpeaker to transcriptionManager', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());

      agent.setPrimarySpeaker('S2');

      expect(mockTranscriptionManager.setPrimarySpeaker).toHaveBeenCalledWith('S2');
    });

    it('should delegate resetSpeakerFiltering to transcriptionManager', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());

      agent.resetSpeakerFiltering();

      expect(mockTranscriptionManager.resetSpeakerFiltering).toHaveBeenCalled();
    });
  });

  describe('State machine - Connect/Disconnect', () => {
    it('should start in idle state', () => {
      const agent = new SpeechmaticsVoiceAgent();
      expect(getStateMachine(agent).getState()).toBe('idle');
    });

    it('should transition to listening on connect', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());
      expect(getStateMachine(agent).getState()).toBe('listening');
    });

    it('should transition to disconnected on disconnect', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());
      await agent.disconnect();
      expect(getStateMachine(agent).getState()).toBe('disconnected');
    });

    it('should clear history and queue on disconnect', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());
      const sm = getStateMachine(agent);
      sm.addUserMessage('test');
      sm.queueMessage('queued', new Date().toISOString());

      await agent.disconnect();
      expect(sm.getContext().conversationHistory.length).toBe(0);
      expect(sm.hasQueuedMessages()).toBe(false);
    });
  });

  describe('State machine - Message Processing', () => {
    it('should be generating during LLM call', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());

      mockLLM.callLLM.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('Response'), 50))
      );

      const promise = callPrivateMethod(agent, 'processUserMessage', 'Hello');
      await new Promise(r => setTimeout(r, 10));
      expect(getStateMachine(agent).isGenerating()).toBe(true);
      await promise;
    });

    it('should return to listening after generation', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());
      mockLLM.callLLM.mockResolvedValue('Response');

      await callPrivateMethod(agent, 'processUserMessage', 'Hello');
      expect(getStateMachine(agent).isGenerating()).toBe(false);
    });

    it('should add messages to history', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());
      mockLLM.callLLM.mockResolvedValue('AI response');

      await callPrivateMethod(agent, 'processUserMessage', 'User message');

      const history = getStateMachine(agent).getContext().conversationHistory;
      expect(history.some(m => m.role === 'user' && m.content === 'User message')).toBe(true);
      expect(history.some(m => m.role === 'agent' && m.content === 'AI response')).toBe(true);
    });

    it('should skip duplicate messages', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());

      await callPrivateMethod(agent, 'processUserMessage', 'Same');
      const count = mockLLM.callLLM.mock.calls.length;
      await callPrivateMethod(agent, 'processUserMessage', 'Same');
      expect(mockLLM.callLLM.mock.calls.length).toBe(count);
    });
  });

  describe('State machine - Queue', () => {
    it('should queue messages when generating', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());
      const sm = getStateMachine(agent);

      sm.transition({ type: 'GENERATION_START', message: 'first' });
      sm.queueMessage('Second', new Date().toISOString());

      expect(sm.hasQueuedMessages()).toBe(true);
    });

    it('should process queue in FIFO order', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());
      const sm = getStateMachine(agent);

      sm.queueMessage('A', '2024-01-01T00:00:00Z');
      sm.queueMessage('B', '2024-01-01T00:00:01Z');

      expect(sm.processNextQueuedMessage()?.content).toBe('A');
      expect(sm.processNextQueuedMessage()?.content).toBe('B');
    });

    it('should not queue duplicates', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());
      const sm = getStateMachine(agent);

      sm.queueMessage('Same', new Date().toISOString());
      sm.queueMessage('Same', new Date().toISOString());

      expect(sm.getContext().messageQueue.length).toBe(1);
    });
  });

  describe('State machine - Flags', () => {
    it('should track lastSentUserMessage', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());
      const sm = getStateMachine(agent);

      sm.transition({ type: 'GENERATION_START', message: 'Hello' });
      expect(sm.getContext().lastSentUserMessage).toBe('Hello');
    });

    it('should track partial during generation', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());
      const sm = getStateMachine(agent);

      sm.transition({ type: 'GENERATION_START', message: 'test' });
      expect(sm.getContext().receivedPartialDuringGeneration).toBe(false);

      sm.transition({ type: 'PARTIAL_TRANSCRIPT', text: 'user', timestamp: Date.now() });
      expect(sm.getContext().receivedPartialDuringGeneration).toBe(true);
    });

    it('should track abort due to continuation', async () => {
      const agent = new SpeechmaticsVoiceAgent();
      await agent.connect(createDefaultConfig());
      const sm = getStateMachine(agent);

      expect(sm.wasAbortedDueToUserContinuation()).toBe(false);
      sm.markAbortedDueToUserContinuation();
      expect(sm.wasAbortedDueToUserContinuation()).toBe(true);
    });
  });
});
