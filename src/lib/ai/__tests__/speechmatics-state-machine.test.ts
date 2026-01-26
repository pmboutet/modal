/**
 * Unit tests for src/lib/ai/speechmatics-state-machine.ts
 * Explicit state machine for SpeechmaticsVoiceAgent
 */

import {
  SpeechmaticsStateMachine,
  type AgentState,
  type AgentEvent,
  type ConversationMessage,
  type StateChangeCallback,
} from '../speechmatics-state-machine';

// =============================================================================
// Test Helpers
// =============================================================================

function createMachine(initialState?: AgentState): SpeechmaticsStateMachine {
  const machine = new SpeechmaticsStateMachine();
  if (initialState === 'listening') {
    machine.transition({ type: 'CONNECT' });
  } else if (initialState === 'processing') {
    machine.transition({ type: 'CONNECT' });
    machine.transition({ type: 'USER_SPEECH_END', message: 'test', timestamp: new Date().toISOString() });
  } else if (initialState === 'generating') {
    machine.transition({ type: 'CONNECT' });
    machine.transition({ type: 'USER_SPEECH_END', message: 'test', timestamp: new Date().toISOString() });
    machine.transition({ type: 'GENERATION_START', message: 'test' });
  } else if (initialState === 'speaking') {
    machine.transition({ type: 'CONNECT' });
    machine.transition({ type: 'USER_SPEECH_END', message: 'test', timestamp: new Date().toISOString() });
    machine.transition({ type: 'GENERATION_START', message: 'test' });
    machine.transition({ type: 'TTS_START' });
  } else if (initialState === 'disconnected') {
    machine.transition({ type: 'CONNECT' });
    machine.transition({ type: 'DISCONNECT' });
  }
  return machine;
}

// =============================================================================
// Initial State Tests
// =============================================================================

describe('SpeechmaticsStateMachine', () => {
  describe('initial state', () => {
    it('should start in idle state', () => {
      const machine = new SpeechmaticsStateMachine();
      expect(machine.getState()).toBe('idle');
    });

    it('should start with empty conversation history', () => {
      const machine = new SpeechmaticsStateMachine();
      expect(machine.getContext().conversationHistory).toEqual([]);
    });

    it('should start with empty message queue', () => {
      const machine = new SpeechmaticsStateMachine();
      expect(machine.getContext().messageQueue).toEqual([]);
    });

    it('should accept initial context', () => {
      const history: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'agent', content: 'Hi there!' },
      ];
      const machine = new SpeechmaticsStateMachine({ conversationHistory: history });
      expect(machine.getContext().conversationHistory).toEqual(history);
    });

    it('should report correct state via helper methods', () => {
      const machine = new SpeechmaticsStateMachine();
      expect(machine.isGenerating()).toBe(false);
      expect(machine.isSpeaking()).toBe(false);
      expect(machine.isDisconnected()).toBe(false);
      expect(machine.isConnected()).toBe(false);
      expect(machine.canAcceptUserMessage()).toBe(false);
      expect(machine.isBusy()).toBe(false);
    });
  });

  // ===========================================================================
  // Connection Transitions
  // ===========================================================================

  describe('connection transitions', () => {
    it('should transition from idle to listening on CONNECT', () => {
      const machine = new SpeechmaticsStateMachine();
      const result = machine.transition({ type: 'CONNECT' });

      expect(result.allowed).toBe(true);
      expect(result.state).toBe('listening');
      expect(machine.getState()).toBe('listening');
      expect(machine.isConnected()).toBe(true);
    });

    it('should transition from disconnected to listening on CONNECT', () => {
      const machine = createMachine('disconnected');
      const result = machine.transition({ type: 'CONNECT' });

      expect(result.allowed).toBe(true);
      expect(result.state).toBe('listening');
    });

    it('should reject CONNECT when already listening', () => {
      const machine = createMachine('listening');
      const result = machine.transition({ type: 'CONNECT' });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Cannot connect');
      expect(machine.getState()).toBe('listening');
    });

    it('should transition to disconnected from any state on DISCONNECT', () => {
      const states: AgentState[] = ['idle', 'listening', 'processing', 'generating', 'speaking'];

      for (const state of states) {
        const machine = createMachine(state);
        const result = machine.transition({ type: 'DISCONNECT' });

        expect(result.allowed).toBe(true);
        expect(machine.getState()).toBe('disconnected');
        expect(machine.isDisconnected()).toBe(true);
      }
    });

    it('should clear context on DISCONNECT', () => {
      const machine = createMachine('listening');
      machine.addUserMessage('Test message');
      machine.queueMessage('Queued', new Date().toISOString());

      machine.transition({ type: 'DISCONNECT' });

      const context = machine.getContext();
      expect(context.conversationHistory).toEqual([]);
      expect(context.messageQueue).toEqual([]);
      expect(context.lastSentUserMessage).toBe('');
    });
  });

  // ===========================================================================
  // User Speech Transitions
  // ===========================================================================

  describe('user speech transitions', () => {
    it('should transition from listening to processing on USER_SPEECH_END', () => {
      const machine = createMachine('listening');
      const result = machine.transition({
        type: 'USER_SPEECH_END',
        message: 'Hello',
        timestamp: new Date().toISOString(),
      });

      expect(result.allowed).toBe(true);
      expect(result.state).toBe('processing');
      expect(machine.getContext().lastSentUserMessage).toBe('Hello');
    });

    it('should queue message when USER_SPEECH_END during generating', () => {
      const machine = createMachine('generating');
      const result = machine.transition({
        type: 'USER_SPEECH_END',
        message: 'New message',
        timestamp: new Date().toISOString(),
      });

      expect(result.allowed).toBe(true);
      expect(result.state).toBe('generating'); // State unchanged
      expect(machine.getQueueSize()).toBe(1);
    });

    it('should queue message when USER_SPEECH_END during speaking', () => {
      const machine = createMachine('speaking');
      const result = machine.transition({
        type: 'USER_SPEECH_END',
        message: 'Interrupt',
        timestamp: new Date().toISOString(),
      });

      expect(result.allowed).toBe(true);
      expect(result.state).toBe('speaking'); // State unchanged
      expect(machine.hasQueuedMessages()).toBe(true);
    });

    it('should reject USER_SPEECH_END when disconnected', () => {
      const machine = createMachine('disconnected');
      const result = machine.transition({
        type: 'USER_SPEECH_END',
        message: 'Test',
        timestamp: new Date().toISOString(),
      });

      expect(result.allowed).toBe(false);
    });

    it('should allow USER_SPEECH_START without state change', () => {
      const machine = createMachine('listening');
      const result = machine.transition({ type: 'USER_SPEECH_START' });

      expect(result.allowed).toBe(true);
      expect(machine.getState()).toBe('listening');
    });
  });

  // ===========================================================================
  // Generation Transitions
  // ===========================================================================

  describe('generation transitions', () => {
    it('should transition from processing to generating on GENERATION_START', () => {
      const machine = createMachine('processing');
      const result = machine.transition({ type: 'GENERATION_START', message: 'test' });

      expect(result.allowed).toBe(true);
      expect(result.state).toBe('generating');
      expect(machine.isGenerating()).toBe(true);
      expect(machine.getContext().generationStartedAt).toBeGreaterThan(0);
    });

    it('should allow GENERATION_START from listening state (direct transition)', () => {
      // processUserMessage can transition directly from listening -> generating
      const machine = createMachine('listening');
      const result = machine.transition({ type: 'GENERATION_START', message: 'test' });

      expect(result.allowed).toBe(true);
      expect(machine.getState()).toBe('generating');
    });

    it('should reject GENERATION_START from disconnected state', () => {
      const machine = createMachine('disconnected');
      const result = machine.transition({ type: 'GENERATION_START', message: 'test' });

      expect(result.allowed).toBe(false);
      expect(machine.getState()).toBe('disconnected');
    });

    it('should transition from generating to listening on GENERATION_COMPLETE', () => {
      const machine = createMachine('generating');
      const result = machine.transition({
        type: 'GENERATION_COMPLETE',
        response: 'AI response',
      });

      expect(result.allowed).toBe(true);
      expect(result.state).toBe('listening');
      expect(machine.getContext().generationStartedAt).toBe(0);
    });

    it('should transition from generating to listening on GENERATION_ERROR', () => {
      const machine = createMachine('generating');
      const result = machine.transition({
        type: 'GENERATION_ERROR',
        error: new Error('API error'),
      });

      expect(result.allowed).toBe(true);
      expect(result.state).toBe('listening');
      expect(machine.getContext().lastSentUserMessage).toBe('');
    });

    it('should transition from generating to listening on GENERATION_TIMEOUT', () => {
      const machine = createMachine('generating');
      const result = machine.transition({ type: 'GENERATION_TIMEOUT' });

      expect(result.allowed).toBe(true);
      expect(result.state).toBe('listening');
    });

    it('should reject GENERATION_COMPLETE when not generating', () => {
      const machine = createMachine('listening');
      const result = machine.transition({
        type: 'GENERATION_COMPLETE',
        response: 'Test',
      });

      expect(result.allowed).toBe(false);
    });
  });

  // ===========================================================================
  // TTS Transitions
  // ===========================================================================

  describe('TTS transitions', () => {
    it('should transition from generating to speaking on TTS_START', () => {
      const machine = createMachine('generating');
      const result = machine.transition({ type: 'TTS_START' });

      expect(result.allowed).toBe(true);
      expect(result.state).toBe('speaking');
      expect(machine.isSpeaking()).toBe(true);
    });

    it('should also allow TTS_START from listening', () => {
      // For cases where TTS is triggered without LLM (e.g., initial greeting)
      const machine = createMachine('listening');
      const result = machine.transition({ type: 'TTS_START' });

      expect(result.allowed).toBe(true);
      expect(result.state).toBe('speaking');
    });

    it('should reject TTS_START from processing', () => {
      const machine = createMachine('processing');
      const result = machine.transition({ type: 'TTS_START' });

      expect(result.allowed).toBe(false);
    });

    it('should transition from speaking to listening on TTS_END', () => {
      const machine = createMachine('speaking');
      const result = machine.transition({ type: 'TTS_END' });

      expect(result.allowed).toBe(true);
      expect(result.state).toBe('listening');
      expect(machine.getContext().lastSentUserMessage).toBe('');
    });

    it('should allow TTS_END when not speaking (no-op)', () => {
      const machine = createMachine('listening');
      const result = machine.transition({ type: 'TTS_END' });

      expect(result.allowed).toBe(true);
      expect(machine.getState()).toBe('listening');
    });
  });

  // ===========================================================================
  // Interruption Transitions
  // ===========================================================================

  describe('interruption transitions', () => {
    it('should transition from generating to listening on BARGE_IN', () => {
      const machine = createMachine('generating');
      const result = machine.transition({ type: 'BARGE_IN' });

      expect(result.allowed).toBe(true);
      expect(result.state).toBe('listening');
      expect(machine.getContext().generationStartedAt).toBe(0);
      expect(machine.getContext().messageQueue).toEqual([]);
    });

    it('should transition from speaking to listening on BARGE_IN', () => {
      const machine = createMachine('speaking');
      const result = machine.transition({ type: 'BARGE_IN' });

      expect(result.allowed).toBe(true);
      expect(result.state).toBe('listening');
    });

    it('should allow BARGE_IN when listening (no-op)', () => {
      const machine = createMachine('listening');
      const result = machine.transition({ type: 'BARGE_IN' });

      expect(result.allowed).toBe(true);
      expect(machine.getState()).toBe('listening');
    });

    it('should transition from processing to listening on ABORT', () => {
      const machine = createMachine('processing');
      const result = machine.transition({ type: 'ABORT' });

      expect(result.allowed).toBe(true);
      expect(result.state).toBe('listening');
    });

    it('should clear queue on ABORT', () => {
      const machine = createMachine('generating');
      machine.queueMessage('Message 1', new Date().toISOString());
      machine.queueMessage('Message 2', new Date().toISOString());

      machine.transition({ type: 'ABORT' });

      expect(machine.getQueueSize()).toBe(0);
    });

    it('should preserve lastSentUserMessage on ABORT if aborted due to continuation', () => {
      const machine = createMachine('generating');
      machine.markAbortedDueToUserContinuation();

      machine.transition({ type: 'ABORT' });

      // lastSentUserMessage should be preserved when responseAbortedDueToUserContinuation is true
      expect(machine.wasAbortedDueToUserContinuation()).toBe(true);
    });
  });

  // ===========================================================================
  // Partial Transcript Handling
  // ===========================================================================

  describe('partial transcript handling', () => {
    it('should track partials during generation', () => {
      const machine = createMachine('generating');
      const now = Date.now();

      machine.transition({
        type: 'PARTIAL_TRANSCRIPT',
        text: 'User speaking',
        timestamp: now,
      });

      const context = machine.getContext();
      expect(context.receivedPartialDuringGeneration).toBe(true);
      expect(context.lastPartialTimestamp).toBe(now);
    });

    it('should not track partials when not generating', () => {
      const machine = createMachine('listening');

      machine.transition({
        type: 'PARTIAL_TRANSCRIPT',
        text: 'User speaking',
        timestamp: Date.now(),
      });

      expect(machine.getContext().receivedPartialDuringGeneration).toBe(false);
    });

    it('should report fresh partial flag when recent', () => {
      const machine = createMachine('generating');

      machine.transition({
        type: 'PARTIAL_TRANSCRIPT',
        text: 'Test',
        timestamp: Date.now(),
      });

      expect(machine.isPartialFlagFresh()).toBe(true);
    });

    it('should report stale partial flag when old', () => {
      const machine = createMachine('generating');
      const oldTimestamp = Date.now() - 5000; // 5 seconds ago

      machine.transition({
        type: 'PARTIAL_TRANSCRIPT',
        text: 'Test',
        timestamp: oldTimestamp,
      });

      expect(machine.isPartialFlagFresh()).toBe(false);
    });

    it('should reset partial flag on GENERATION_COMPLETE', () => {
      const machine = createMachine('generating');

      machine.transition({
        type: 'PARTIAL_TRANSCRIPT',
        text: 'Test',
        timestamp: Date.now(),
      });
      expect(machine.getContext().receivedPartialDuringGeneration).toBe(true);

      machine.transition({ type: 'GENERATION_COMPLETE', response: 'Done' });

      expect(machine.getContext().receivedPartialDuringGeneration).toBe(false);
    });
  });

  // ===========================================================================
  // Queue Management
  // ===========================================================================

  describe('queue management', () => {
    it('should queue messages correctly', () => {
      const machine = createMachine('listening');
      const timestamp = new Date().toISOString();

      const success = machine.queueMessage('Hello', timestamp);

      expect(success).toBe(true);
      expect(machine.getQueueSize()).toBe(1);
    });

    it('should reject duplicate messages', () => {
      const machine = createMachine('listening');
      const timestamp = new Date().toISOString();

      machine.queueMessage('Hello', timestamp);
      const success = machine.queueMessage('hello', timestamp); // Same content, different case

      expect(success).toBe(false);
      expect(machine.getQueueSize()).toBe(1);
    });

    it('should reject message identical to lastSentUserMessage', () => {
      const machine = createMachine('processing');
      // lastSentUserMessage is set when transitioning to processing

      const success = machine.queueMessage('test', new Date().toISOString());

      expect(success).toBe(false);
    });

    it('should enforce queue size limit', () => {
      const machine = createMachine('listening');

      // Add more messages than MAX_QUEUE_SIZE
      for (let i = 0; i < 15; i++) {
        machine.queueMessage(`Message ${i}`, new Date().toISOString());
      }

      // Queue should be capped at MAX_QUEUE_SIZE (10)
      expect(machine.getQueueSize()).toBeLessThanOrEqual(10);
    });

    it('should process queued messages in order', () => {
      const machine = createMachine('listening');

      machine.queueMessage('First', '2024-01-01T00:00:00Z');
      machine.queueMessage('Second', '2024-01-01T00:00:01Z');
      machine.queueMessage('Third', '2024-01-01T00:00:02Z');

      const first = machine.processNextQueuedMessage();
      expect(first?.content).toBe('First');

      const second = machine.processNextQueuedMessage();
      expect(second?.content).toBe('Second');

      const third = machine.processNextQueuedMessage();
      expect(third?.content).toBe('Third');

      expect(machine.processNextQueuedMessage()).toBeNull();
    });

    it('should clear queue correctly', () => {
      const machine = createMachine('listening');

      machine.queueMessage('Message 1', new Date().toISOString());
      machine.queueMessage('Message 2', new Date().toISOString());
      machine.clearQueue();

      expect(machine.getQueueSize()).toBe(0);
      expect(machine.hasQueuedMessages()).toBe(false);
    });
  });

  // ===========================================================================
  // History Management
  // ===========================================================================

  describe('history management', () => {
    it('should add user messages to history', () => {
      const machine = new SpeechmaticsStateMachine();

      machine.addUserMessage('Hello');
      machine.addUserMessage('How are you?');

      const history = machine.getContext().conversationHistory;
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(history[1]).toEqual({ role: 'user', content: 'How are you?' });
    });

    it('should add agent messages to history', () => {
      const machine = new SpeechmaticsStateMachine();

      machine.addAgentMessage('Hi there!');

      const history = machine.getContext().conversationHistory;
      expect(history).toHaveLength(1);
      expect(history[0]).toEqual({ role: 'agent', content: 'Hi there!' });
    });

    it('should remove last message with matching role', () => {
      const machine = new SpeechmaticsStateMachine();

      machine.addUserMessage('Hello');
      machine.addAgentMessage('Hi');

      const removed = machine.removeLastMessage('agent');
      expect(removed).toEqual({ role: 'agent', content: 'Hi' });
      expect(machine.getContext().conversationHistory).toHaveLength(1);
    });

    it('should not remove last message if role does not match', () => {
      const machine = new SpeechmaticsStateMachine();

      machine.addUserMessage('Hello');
      machine.addAgentMessage('Hi');

      const removed = machine.removeLastMessage('user');
      expect(removed).toBeNull();
      expect(machine.getContext().conversationHistory).toHaveLength(2);
    });

    it('should get recent history', () => {
      const machine = new SpeechmaticsStateMachine();

      for (let i = 0; i < 10; i++) {
        machine.addUserMessage(`Message ${i}`);
      }

      const recent = machine.getRecentHistory(3);
      expect(recent).toHaveLength(3);
      expect(recent[0]?.content).toBe('Message 7');
      expect(recent[2]?.content).toBe('Message 9');
    });

    it('should initialize history', () => {
      const machine = new SpeechmaticsStateMachine();
      const history: ConversationMessage[] = [
        { role: 'user', content: 'Previous message' },
        { role: 'agent', content: 'Previous response' },
      ];

      machine.initializeHistory(history);

      expect(machine.getContext().conversationHistory).toEqual(history);
    });
  });

  // ===========================================================================
  // Deduplication
  // ===========================================================================

  describe('deduplication', () => {
    it('should detect duplicate messages within time window', () => {
      const machine = new SpeechmaticsStateMachine();
      const now = Date.now();

      machine.markMessageProcessed('Hello world');

      expect(machine.isDuplicateMessage('Hello world', now + 1000)).toBe(true);
      expect(machine.isDuplicateMessage('hello world', now + 1000)).toBe(true); // Case insensitive
    });

    it('should not detect duplicate outside time window', () => {
      const machine = new SpeechmaticsStateMachine();
      const now = Date.now();

      machine.markMessageProcessed('Hello world');

      // 10 seconds later (outside MESSAGE_DEDUPLICATION_WINDOW_MS)
      expect(machine.isDuplicateMessage('Hello world', now + 10000)).toBe(false);
    });

    it('should not detect duplicate for different content', () => {
      const machine = new SpeechmaticsStateMachine();

      machine.markMessageProcessed('Hello world');

      expect(machine.isDuplicateMessage('Goodbye world')).toBe(false);
    });
  });

  // ===========================================================================
  // State Change Callback
  // ===========================================================================

  describe('state change callback', () => {
    it('should call callback on state change', () => {
      const machine = new SpeechmaticsStateMachine();
      const callback = jest.fn();

      machine.setOnStateChange(callback);
      machine.transition({ type: 'CONNECT' });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        'listening',
        'idle',
        expect.any(Object),
        { type: 'CONNECT' }
      );
    });

    it('should not call callback when transition is rejected', () => {
      const machine = createMachine('listening');
      const callback = jest.fn();

      machine.setOnStateChange(callback);
      machine.transition({ type: 'CONNECT' }); // Should be rejected

      expect(callback).not.toHaveBeenCalled();
    });

    it('should call callback for each transition', () => {
      const machine = new SpeechmaticsStateMachine();
      const callback = jest.fn();

      machine.setOnStateChange(callback);
      machine.transition({ type: 'CONNECT' });
      machine.transition({ type: 'USER_SPEECH_END', message: 'test', timestamp: new Date().toISOString() });
      machine.transition({ type: 'GENERATION_START', message: 'test' });

      expect(callback).toHaveBeenCalledTimes(3);
    });
  });

  // ===========================================================================
  // Generation Timeout Detection
  // ===========================================================================

  describe('generation timeout detection', () => {
    it('should not report timeout when not generating', () => {
      const machine = createMachine('listening');
      expect(machine.isGenerationTimedOut()).toBe(false);
    });

    it('should not report timeout immediately after starting generation', () => {
      const machine = createMachine('generating');
      expect(machine.isGenerationTimedOut()).toBe(false);
    });

    it('should report timeout when generation exceeds limit', () => {
      const machine = createMachine('processing');

      // Mock Date.now to simulate time passing
      const originalNow = Date.now;
      let currentTime = 1000000;
      Date.now = jest.fn(() => currentTime);

      machine.transition({ type: 'GENERATION_START', message: 'test' });

      // Advance time past timeout (60 seconds)
      currentTime += 70000;

      expect(machine.isGenerationTimedOut()).toBe(true);

      Date.now = originalNow;
    });
  });

  // ===========================================================================
  // Reset
  // ===========================================================================

  describe('reset', () => {
    it('should reset to idle state', () => {
      const machine = createMachine('generating');
      machine.addUserMessage('Test');
      machine.queueMessage('Queued', new Date().toISOString());

      machine.reset();

      expect(machine.getState()).toBe('idle');
      expect(machine.getContext().conversationHistory).toEqual([]);
      expect(machine.getContext().messageQueue).toEqual([]);
    });

    it('should preserve history when requested', () => {
      const machine = createMachine('listening');
      machine.addUserMessage('Important message');

      machine.reset(true);

      expect(machine.getState()).toBe('idle');
      expect(machine.getContext().conversationHistory).toHaveLength(1);
      expect(machine.getContext().conversationHistory[0]?.content).toBe('Important message');
    });

    it('should call state change callback on reset', () => {
      const machine = createMachine('generating');
      const callback = jest.fn();

      machine.setOnStateChange(callback);
      machine.reset();

      expect(callback).toHaveBeenCalledWith(
        'idle',
        'generating',
        expect.any(Object),
        { type: 'DISCONNECT' }
      );
    });
  });

  // ===========================================================================
  // Context Immutability
  // ===========================================================================

  describe('context immutability', () => {
    it('should return copy of context, not reference', () => {
      const machine = new SpeechmaticsStateMachine();
      machine.addUserMessage('Test');

      const context1 = machine.getContext();
      const context2 = machine.getContext();

      expect(context1).not.toBe(context2);
      expect(context1.conversationHistory).not.toBe(context2.conversationHistory);

      // Modifying returned context should not affect machine
      context1.conversationHistory.push({ role: 'agent', content: 'Modified' });
      expect(machine.getContext().conversationHistory).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Full Workflow Integration Tests
  // ===========================================================================

  describe('full workflow', () => {
    it('should handle complete conversation cycle', () => {
      const machine = new SpeechmaticsStateMachine();
      const stateHistory: AgentState[] = [];
      const callback: StateChangeCallback = (newState, previousState) => {
        // Only track actual state changes
        if (newState !== previousState) {
          stateHistory.push(newState);
        }
      };

      machine.setOnStateChange(callback);

      // Connect
      machine.transition({ type: 'CONNECT' });
      expect(machine.getState()).toBe('listening');

      // User speaks
      machine.transition({ type: 'USER_SPEECH_START' }); // No state change
      machine.transition({
        type: 'USER_SPEECH_END',
        message: 'Hello AI',
        timestamp: new Date().toISOString(),
      });
      expect(machine.getState()).toBe('processing');
      machine.addUserMessage('Hello AI');

      // Start generation
      machine.transition({ type: 'GENERATION_START', message: 'test' });
      expect(machine.getState()).toBe('generating');

      // Complete generation
      machine.transition({ type: 'GENERATION_COMPLETE', response: 'Hello human!' });
      machine.addAgentMessage('Hello human!');

      // Start TTS
      machine.transition({ type: 'TTS_START' });
      expect(machine.getState()).toBe('speaking');

      // TTS ends
      machine.transition({ type: 'TTS_END' });
      expect(machine.getState()).toBe('listening');

      // Verify conversation history
      const history = machine.getContext().conversationHistory;
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({ role: 'user', content: 'Hello AI' });
      expect(history[1]).toEqual({ role: 'agent', content: 'Hello human!' });

      // Verify state history (only actual state changes)
      expect(stateHistory).toEqual([
        'listening',
        'processing',
        'generating',
        'listening',
        'speaking',
        'listening',
      ]);
    });

    it('should handle barge-in during generation', () => {
      const machine = new SpeechmaticsStateMachine();

      machine.transition({ type: 'CONNECT' });
      machine.transition({
        type: 'USER_SPEECH_END',
        message: 'First message',
        timestamp: new Date().toISOString(),
      });
      machine.addUserMessage('First message');
      machine.transition({ type: 'GENERATION_START', message: 'test' });

      // User interrupts
      machine.transition({ type: 'BARGE_IN' });

      expect(machine.getState()).toBe('listening');
      expect(machine.getContext().generationStartedAt).toBe(0);
    });

    it('should handle message queue when busy', () => {
      const machine = new SpeechmaticsStateMachine();

      machine.transition({ type: 'CONNECT' });
      machine.transition({
        type: 'USER_SPEECH_END',
        message: 'First',
        timestamp: new Date().toISOString(),
      });
      machine.transition({ type: 'GENERATION_START', message: 'test' });

      // User sends another message while generating
      machine.transition({
        type: 'USER_SPEECH_END',
        message: 'Second',
        timestamp: new Date().toISOString(),
      });
      machine.transition({
        type: 'USER_SPEECH_END',
        message: 'Third',
        timestamp: new Date().toISOString(),
      });

      expect(machine.getQueueSize()).toBe(2);

      // Complete generation
      machine.transition({ type: 'GENERATION_COMPLETE', response: 'Response' });
      machine.transition({ type: 'TTS_START' });
      machine.transition({ type: 'TTS_END' });

      // Process queue
      const next = machine.processNextQueuedMessage();
      expect(next?.content).toBe('Second');
      expect(machine.getQueueSize()).toBe(1);
    });
  });
});
