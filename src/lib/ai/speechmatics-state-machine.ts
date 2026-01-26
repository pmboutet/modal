/**
 * Explicit state machine for SpeechmaticsVoiceAgent
 *
 * This module extracts the implicit state management from SpeechmaticsVoiceAgent
 * into an explicit, testable state machine with clear states and transitions.
 *
 * The original SpeechmaticsVoiceAgent uses 15+ interdependent flags:
 * - isGeneratingResponse
 * - receivedPartialDuringGeneration
 * - lastPartialDuringGenerationTimestamp
 * - responseAbortedDueToUserContinuation
 * - isDisconnected
 * - lastSentUserMessage
 * - lastProcessedMessage
 * - generationStartedAt
 * - userMessageQueue
 * - conversationHistory
 * - etc.
 *
 * This state machine makes the states and transitions explicit.
 */

import {
  GENERATION_TIMEOUT_MS,
  MAX_QUEUE_SIZE,
  MESSAGE_DEDUPLICATION_WINDOW_MS,
  PARTIAL_FLAG_STALENESS_MS,
} from './speechmatics-constants';

// =============================================================================
// Types
// =============================================================================

/**
 * Possible states of the voice agent
 *
 * State transitions:
 * - idle -> listening (CONNECT)
 * - listening -> processing (USER_SPEECH_END with message)
 * - processing -> generating (GENERATION_START)
 * - generating -> speaking (TTS_START)
 * - speaking -> listening (TTS_END)
 * - any state -> idle (ABORT, DISCONNECT)
 * - any state -> disconnected (DISCONNECT)
 */
export type AgentState =
  | 'idle'           // Not connected, waiting for connection
  | 'listening'      // Connected and actively listening for user input
  | 'processing'     // Processing a user message (pre-LLM)
  | 'generating'     // LLM generation in progress
  | 'speaking'       // TTS audio is playing
  | 'disconnected';  // Explicitly disconnected

/**
 * Events that can trigger state transitions
 */
export type AgentEvent =
  | { type: 'CONNECT' }
  | { type: 'DISCONNECT' }
  | { type: 'USER_SPEECH_START' }
  | { type: 'USER_SPEECH_END'; message: string; timestamp: string }
  | { type: 'PARTIAL_TRANSCRIPT'; text: string; timestamp: number }
  | { type: 'GENERATION_START'; message: string }
  | { type: 'GENERATION_COMPLETE'; response: string }
  | { type: 'GENERATION_ERROR'; error: Error }
  | { type: 'GENERATION_TIMEOUT' }
  | { type: 'TTS_START' }
  | { type: 'TTS_END' }
  | { type: 'BARGE_IN' }
  | { type: 'ABORT' }
  | { type: 'QUEUE_MESSAGE'; content: string; timestamp: string }
  | { type: 'PROCESS_NEXT_QUEUE' };

/**
 * Conversation message structure
 */
export interface ConversationMessage {
  role: 'user' | 'agent';
  content: string;
}

/**
 * Queued message structure
 */
export interface QueuedMessage {
  content: string;
  timestamp: string;
}

/**
 * Last processed message for deduplication
 */
export interface ProcessedMessage {
  content: string;
  timestamp: number;
}

/**
 * Context maintained by the state machine
 */
export interface AgentContext {
  // Conversation history for LLM context
  conversationHistory: ConversationMessage[];

  // Queue of pending user messages
  messageQueue: QueuedMessage[];

  // Last message sent to LLM (for abort-on-continue detection)
  lastSentUserMessage: string;

  // Last successfully processed message (for deduplication)
  lastProcessedMessage: ProcessedMessage | null;

  // Timestamp when generation started (for timeout detection)
  generationStartedAt: number;

  // Flag: received partial transcript during LLM generation
  receivedPartialDuringGeneration: boolean;

  // Timestamp of last partial during generation (for staleness check)
  lastPartialTimestamp: number;

  // Flag: response was aborted because user continued speaking
  responseAbortedDueToUserContinuation: boolean;
}

/**
 * Result of a transition attempt
 */
export interface TransitionResult {
  state: AgentState;
  allowed: boolean;
  reason?: string;
}

/**
 * Callback for state changes
 */
export type StateChangeCallback = (
  newState: AgentState,
  previousState: AgentState,
  context: AgentContext,
  event: AgentEvent
) => void;

// =============================================================================
// State Machine Implementation
// =============================================================================

/**
 * Explicit state machine for SpeechmaticsVoiceAgent
 *
 * Replaces implicit boolean flags with clear states and transitions.
 * All state changes are validated and logged.
 */
export class SpeechmaticsStateMachine {
  private state: AgentState = 'idle';
  private context: AgentContext;
  private onStateChange?: StateChangeCallback;

  constructor(initialContext?: Partial<AgentContext>) {
    this.context = {
      conversationHistory: [],
      messageQueue: [],
      lastSentUserMessage: '',
      lastProcessedMessage: null,
      generationStartedAt: 0,
      receivedPartialDuringGeneration: false,
      lastPartialTimestamp: 0,
      responseAbortedDueToUserContinuation: false,
      ...initialContext,
    };
  }

  // ===========================================================================
  // Public Getters
  // ===========================================================================

  /**
   * Get the current state
   */
  getState(): AgentState {
    return this.state;
  }

  /**
   * Get a copy of the current context
   */
  getContext(): AgentContext {
    return {
      ...this.context,
      conversationHistory: [...this.context.conversationHistory],
      messageQueue: [...this.context.messageQueue],
      lastProcessedMessage: this.context.lastProcessedMessage
        ? { ...this.context.lastProcessedMessage }
        : null,
    };
  }

  /**
   * Set callback for state changes
   */
  setOnStateChange(callback: StateChangeCallback): void {
    this.onStateChange = callback;
  }

  // ===========================================================================
  // State Query Helpers
  // ===========================================================================

  /**
   * Check if agent is currently generating an LLM response
   */
  isGenerating(): boolean {
    return this.state === 'generating';
  }

  /**
   * Check if agent is currently speaking (TTS playing)
   */
  isSpeaking(): boolean {
    return this.state === 'speaking';
  }

  /**
   * Check if agent is disconnected
   */
  isDisconnected(): boolean {
    return this.state === 'disconnected';
  }

  /**
   * Check if agent is connected (not idle or disconnected)
   */
  isConnected(): boolean {
    return !['idle', 'disconnected'].includes(this.state);
  }

  /**
   * Check if agent can accept new user messages
   * Only in listening state (not processing, generating, or speaking)
   */
  canAcceptUserMessage(): boolean {
    return this.state === 'listening';
  }

  /**
   * Check if agent is busy (generating or speaking)
   */
  isBusy(): boolean {
    return ['processing', 'generating', 'speaking'].includes(this.state);
  }

  /**
   * Check if generation has timed out
   */
  isGenerationTimedOut(): boolean {
    if (this.state !== 'generating' || this.context.generationStartedAt === 0) {
      return false;
    }
    return Date.now() - this.context.generationStartedAt > GENERATION_TIMEOUT_MS;
  }

  /**
   * Check if the partial flag is fresh (not stale)
   */
  isPartialFlagFresh(): boolean {
    if (!this.context.receivedPartialDuringGeneration) {
      return false;
    }
    return Date.now() - this.context.lastPartialTimestamp < PARTIAL_FLAG_STALENESS_MS;
  }

  // ===========================================================================
  // Main Transition Method
  // ===========================================================================

  /**
   * Attempt a state transition based on an event
   *
   * @param event - The event triggering the transition
   * @returns Result indicating if transition was allowed and new state
   */
  transition(event: AgentEvent): TransitionResult {
    const previousState = this.state;
    const result = this.computeTransition(event);

    if (result.allowed) {
      this.state = result.state;
      this.updateContext(event);
      this.onStateChange?.(this.state, previousState, this.getContext(), event);
    }

    return result;
  }

  // ===========================================================================
  // Transition Logic
  // ===========================================================================

  /**
   * Compute the resulting state for a given event
   * Implements the state transition table
   */
  private computeTransition(event: AgentEvent): TransitionResult {
    const currentState = this.state;

    switch (event.type) {
      // -----------------------------------------------------------------------
      // Connection events
      // -----------------------------------------------------------------------
      case 'CONNECT':
        if (currentState === 'idle' || currentState === 'disconnected') {
          return { state: 'listening', allowed: true };
        }
        return { state: currentState, allowed: false, reason: `Cannot connect from state: ${currentState}` };

      case 'DISCONNECT':
        // Can always disconnect
        return { state: 'disconnected', allowed: true };

      // -----------------------------------------------------------------------
      // User speech events
      // -----------------------------------------------------------------------
      case 'USER_SPEECH_START':
        // Just informational, doesn't change state
        return { state: currentState, allowed: true };

      case 'USER_SPEECH_END':
        if (currentState === 'listening') {
          return { state: 'processing', allowed: true };
        }
        // If busy, we'll queue the message but state doesn't change
        if (['processing', 'generating', 'speaking'].includes(currentState)) {
          return { state: currentState, allowed: true, reason: 'Message will be queued' };
        }
        return { state: currentState, allowed: false, reason: `Cannot process speech end from state: ${currentState}` };

      case 'PARTIAL_TRANSCRIPT':
        // Partials are always allowed (just update context)
        return { state: currentState, allowed: true };

      // -----------------------------------------------------------------------
      // Generation events
      // -----------------------------------------------------------------------
      case 'GENERATION_START':
        // Allow from both processing and listening states
        // In processUserMessage flow: listening → generating (skipping processing)
        if (currentState === 'processing' || currentState === 'listening') {
          return { state: 'generating', allowed: true };
        }
        return { state: currentState, allowed: false, reason: `Cannot start generation from state: ${currentState}` };

      case 'GENERATION_COMPLETE':
        if (currentState === 'generating') {
          // If TTS is enabled, transition to speaking; otherwise back to listening
          // For now, assume we'll get a TTS_START if TTS is enabled
          return { state: 'listening', allowed: true };
        }
        return { state: currentState, allowed: false, reason: `Cannot complete generation from state: ${currentState}` };

      case 'GENERATION_ERROR':
        if (currentState === 'generating') {
          return { state: 'listening', allowed: true };
        }
        return { state: currentState, allowed: false, reason: `No generation in progress` };

      case 'GENERATION_TIMEOUT':
        if (currentState === 'generating') {
          return { state: 'listening', allowed: true };
        }
        return { state: currentState, allowed: false, reason: `No generation in progress` };

      // -----------------------------------------------------------------------
      // TTS events
      // -----------------------------------------------------------------------
      case 'TTS_START':
        if (currentState === 'generating' || currentState === 'listening') {
          return { state: 'speaking', allowed: true };
        }
        return { state: currentState, allowed: false, reason: `Cannot start TTS from state: ${currentState}` };

      case 'TTS_END':
        if (currentState === 'speaking') {
          return { state: 'listening', allowed: true };
        }
        return { state: currentState, allowed: true }; // TTS end when not speaking is fine

      // -----------------------------------------------------------------------
      // Interruption events
      // -----------------------------------------------------------------------
      case 'BARGE_IN':
        // Barge-in can interrupt generating or speaking
        if (['generating', 'speaking'].includes(currentState)) {
          return { state: 'listening', allowed: true };
        }
        return { state: currentState, allowed: true }; // Barge-in when not busy is a no-op

      case 'ABORT':
        // Abort returns to listening if connected
        if (['processing', 'generating', 'speaking'].includes(currentState)) {
          return { state: 'listening', allowed: true };
        }
        return { state: currentState, allowed: true };

      // -----------------------------------------------------------------------
      // Queue events
      // -----------------------------------------------------------------------
      case 'QUEUE_MESSAGE':
        // Queue events don't change state, just update context
        return { state: currentState, allowed: true };

      case 'PROCESS_NEXT_QUEUE':
        // Only process queue when in listening state
        if (currentState === 'listening' && this.context.messageQueue.length > 0) {
          return { state: 'processing', allowed: true };
        }
        return { state: currentState, allowed: true };

      default:
        return { state: currentState, allowed: false, reason: 'Unknown event type' };
    }
  }

  /**
   * Update context based on the event
   * Called after a successful transition
   */
  private updateContext(event: AgentEvent): void {
    switch (event.type) {
      case 'CONNECT':
        // Reset state on connect
        this.context.lastSentUserMessage = '';
        this.context.responseAbortedDueToUserContinuation = false;
        this.context.receivedPartialDuringGeneration = false;
        this.context.lastPartialTimestamp = 0;
        break;

      case 'DISCONNECT':
        // Clear all state on disconnect
        this.context.conversationHistory = [];
        this.context.messageQueue = [];
        this.context.lastSentUserMessage = '';
        this.context.lastProcessedMessage = null;
        this.context.generationStartedAt = 0;
        this.context.receivedPartialDuringGeneration = false;
        this.context.lastPartialTimestamp = 0;
        this.context.responseAbortedDueToUserContinuation = false;
        break;

      case 'USER_SPEECH_END':
        if (this.state === 'processing') {
          // Starting to process a new message
          this.context.lastSentUserMessage = event.message;
          this.context.receivedPartialDuringGeneration = false;
          this.context.lastPartialTimestamp = 0;
        } else if (this.isBusy()) {
          // Queue the message if busy
          this.queueMessage(event.message, event.timestamp);
        }
        break;

      case 'PARTIAL_TRANSCRIPT':
        // Track partials during generation
        if (this.state === 'generating') {
          this.context.receivedPartialDuringGeneration = true;
          this.context.lastPartialTimestamp = event.timestamp;
        }
        break;

      case 'GENERATION_START':
        this.context.generationStartedAt = Date.now();
        this.context.lastSentUserMessage = event.message;
        this.context.receivedPartialDuringGeneration = false;
        this.context.lastPartialTimestamp = 0;
        break;

      case 'GENERATION_COMPLETE':
        this.context.generationStartedAt = 0;
        this.context.receivedPartialDuringGeneration = false;
        break;

      case 'GENERATION_ERROR':
      case 'GENERATION_TIMEOUT':
        this.context.generationStartedAt = 0;
        this.context.lastSentUserMessage = '';
        break;

      case 'TTS_END':
        // Clear lastSentUserMessage when TTS finishes
        this.context.lastSentUserMessage = '';
        break;

      case 'BARGE_IN':
      case 'ABORT':
        this.context.generationStartedAt = 0;
        this.context.receivedPartialDuringGeneration = false;
        // Keep lastSentUserMessage if aborted due to continuation
        if (!this.context.responseAbortedDueToUserContinuation) {
          this.context.lastSentUserMessage = '';
        }
        // Clear queue on abort (stale fragments)
        this.context.messageQueue = [];
        break;

      case 'QUEUE_MESSAGE':
        this.queueMessage(event.content, event.timestamp);
        break;

      case 'PROCESS_NEXT_QUEUE':
        // Handled by processNextQueuedMessage
        break;
    }
  }

  // ===========================================================================
  // Queue Management
  // ===========================================================================

  /**
   * Add a message to the queue
   * Returns false if queue is full or message is duplicate
   */
  queueMessage(content: string, timestamp: string): boolean {
    const normalizedContent = content.trim().toLowerCase();

    // Check for duplicates
    const isDuplicate = this.context.messageQueue.some(
      (q) => q.content.trim().toLowerCase() === normalizedContent
    );
    if (isDuplicate) {
      return false;
    }

    // Check if currently processing same message
    if (this.context.lastSentUserMessage.trim().toLowerCase() === normalizedContent) {
      return false;
    }

    // Check queue size limit
    if (this.context.messageQueue.length >= MAX_QUEUE_SIZE) {
      // Remove oldest message
      this.context.messageQueue.shift();
    }

    this.context.messageQueue.push({ content, timestamp });
    return true;
  }

  /**
   * Get and remove the next message from the queue
   */
  processNextQueuedMessage(): QueuedMessage | null {
    if (this.context.messageQueue.length === 0) {
      return null;
    }
    return this.context.messageQueue.shift() || null;
  }

  /**
   * Check if there are queued messages
   */
  hasQueuedMessages(): boolean {
    return this.context.messageQueue.length > 0;
  }

  /**
   * Get queue size
   */
  getQueueSize(): number {
    return this.context.messageQueue.length;
  }

  /**
   * Clear the message queue
   */
  clearQueue(): void {
    this.context.messageQueue = [];
  }

  // ===========================================================================
  // History Management
  // ===========================================================================

  /**
   * Add a user message to conversation history
   */
  addUserMessage(content: string): void {
    this.context.conversationHistory.push({ role: 'user', content });
  }

  /**
   * Add an agent message to conversation history
   */
  addAgentMessage(content: string): void {
    this.context.conversationHistory.push({ role: 'agent', content });
  }

  /**
   * Remove the last message from history (if it matches expected role)
   */
  removeLastMessage(expectedRole?: 'user' | 'agent'): ConversationMessage | null {
    if (this.context.conversationHistory.length === 0) {
      return null;
    }

    const lastMessage = this.context.conversationHistory[this.context.conversationHistory.length - 1];
    if (expectedRole && lastMessage?.role !== expectedRole) {
      return null;
    }

    return this.context.conversationHistory.pop() || null;
  }

  /**
   * Get recent conversation history
   */
  getRecentHistory(count: number): ConversationMessage[] {
    return this.context.conversationHistory.slice(-count);
  }

  /**
   * Initialize conversation history
   */
  initializeHistory(history: ConversationMessage[]): void {
    this.context.conversationHistory = [...history];
  }

  // ===========================================================================
  // Deduplication
  // ===========================================================================

  /**
   * Check if a message is a duplicate of recently processed message
   */
  isDuplicateMessage(content: string, timestamp: number = Date.now()): boolean {
    const normalizedContent = content.trim().toLowerCase();

    if (!this.context.lastProcessedMessage) {
      return false;
    }

    const { content: lastContent, timestamp: lastTimestamp } = this.context.lastProcessedMessage;
    const timeDiff = timestamp - lastTimestamp;

    return lastContent === normalizedContent && timeDiff < MESSAGE_DEDUPLICATION_WINDOW_MS;
  }

  /**
   * Mark a message as successfully processed
   */
  markMessageProcessed(content: string): void {
    this.context.lastProcessedMessage = {
      content: content.trim().toLowerCase(),
      timestamp: Date.now(),
    };
  }

  // ===========================================================================
  // Partial Flag Management
  // ===========================================================================

  /**
   * Clear the partial-during-generation flag
   * Called when EndOfUtterance is received and user has stopped speaking
   */
  clearPartialFlag(): void {
    this.context.receivedPartialDuringGeneration = false;
    this.context.lastPartialTimestamp = 0;
  }

  // ===========================================================================
  // Abort-on-Continue Support
  // ===========================================================================

  /**
   * Mark that response was aborted due to user continuing to speak
   */
  markAbortedDueToUserContinuation(): void {
    this.context.responseAbortedDueToUserContinuation = true;
  }

  /**
   * Clear the abort-due-to-continuation flag
   */
  clearAbortedDueToUserContinuation(): void {
    this.context.responseAbortedDueToUserContinuation = false;
  }

  /**
   * Check if response was aborted due to user continuation
   */
  wasAbortedDueToUserContinuation(): boolean {
    return this.context.responseAbortedDueToUserContinuation;
  }

  // ===========================================================================
  // Reset
  // ===========================================================================

  /**
   * Reset the state machine to initial state
   */
  reset(preserveHistory: boolean = false): void {
    const previousState = this.state;
    this.state = 'idle';

    const historyBackup = preserveHistory ? [...this.context.conversationHistory] : [];

    this.context = {
      conversationHistory: historyBackup,
      messageQueue: [],
      lastSentUserMessage: '',
      lastProcessedMessage: null,
      generationStartedAt: 0,
      receivedPartialDuringGeneration: false,
      lastPartialTimestamp: 0,
      responseAbortedDueToUserContinuation: false,
    };

    this.onStateChange?.(this.state, previousState, this.getContext(), { type: 'DISCONNECT' });
  }
}
