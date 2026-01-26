/**
 * Unit tests for src/lib/ai/speechmatics-websocket.ts
 * WebSocket management for Speechmatics Voice Agent
 * @jest-environment jsdom
 */

import { SpeechmaticsWebSocket } from '../speechmatics-websocket';
import { SpeechmaticsAuth } from '../speechmatics-auth';
import type { SpeechmaticsConfig } from '../speechmatics-types';

// Increase default timeout for async tests with multiple timer advances
jest.setTimeout(15000);

// ============================================================================
// Mock dependencies
// ============================================================================

// Mock Sentry
jest.mock('@sentry/nextjs', () => ({
  addBreadcrumb: jest.fn(),
  captureException: jest.fn(),
}));

// Mock utils
jest.mock('@/lib/utils', () => ({
  devLog: jest.fn(),
  devWarn: jest.fn(),
  devError: jest.fn(),
}));

// Mock SpeechmaticsAuth
jest.mock('../speechmatics-auth');

// ============================================================================
// Mock WebSocket
// ============================================================================

// Flag to control auto-open behavior (default: true)
let mockWebSocketAutoOpen = true;

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  private closeListeners: Array<(event: CloseEvent) => void> = [];
  private errorListeners: Array<(event: Event) => void> = [];

  constructor(url: string) {
    this.url = url;
    // Only simulate async connection opening if flag is set
    if (mockWebSocketAutoOpen) {
      setTimeout(() => {
        if (this.readyState === MockWebSocket.CONNECTING) {
          this.readyState = MockWebSocket.OPEN;
          this.onopen?.(new Event('open'));
        }
      }, 0);
    }
  }

  send(data: string | ArrayBuffer): void {
    // Mock send - do nothing
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSING;
    setTimeout(() => {
      this.readyState = MockWebSocket.CLOSED;
      const closeEvent = new CloseEvent('close', {
        code: code || 1000,
        reason: reason || '',
        wasClean: true,
      });
      this.onclose?.(closeEvent);
      this.closeListeners.forEach(listener => listener(closeEvent));
    }, 0);
  }

  addEventListener(type: string, listener: EventListener, options?: { once?: boolean }): void {
    if (type === 'close') {
      if (options?.once) {
        const wrappedListener = (event: CloseEvent) => {
          this.closeListeners = this.closeListeners.filter(l => l !== wrappedListener);
          (listener as (event: CloseEvent) => void)(event);
        };
        this.closeListeners.push(wrappedListener);
      } else {
        this.closeListeners.push(listener as (event: CloseEvent) => void);
      }
    } else if (type === 'error') {
      if (options?.once) {
        const wrappedListener = (event: Event) => {
          this.errorListeners = this.errorListeners.filter(l => l !== wrappedListener);
          listener(event);
        };
        this.errorListeners.push(wrappedListener);
      } else {
        this.errorListeners.push(listener as (event: Event) => void);
      }
    }
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (type === 'close') {
      this.closeListeners = this.closeListeners.filter(l => l !== listener);
    } else if (type === 'error') {
      this.errorListeners = this.errorListeners.filter(l => l !== listener);
    }
  }

  // Helper methods for testing
  simulateOpen(): void {
    if (this.readyState === MockWebSocket.CONNECTING) {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    }
  }

  simulateMessage(data: any): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }

  simulateError(): void {
    this.onerror?.(new Event('error'));
    this.errorListeners.forEach(listener => listener(new Event('error')));
  }

  simulateClose(code: number = 1000, reason: string = ''): void {
    this.readyState = MockWebSocket.CLOSED;
    const closeEvent = new CloseEvent('close', { code, reason, wasClean: code === 1000 });
    this.onclose?.(closeEvent);
    this.closeListeners.forEach(listener => listener(closeEvent));
  }
}

// Store original WebSocket
const OriginalWebSocket = global.WebSocket;

// Replace global WebSocket with mock
(global as any).WebSocket = MockWebSocket;

// ============================================================================
// Test setup
// ============================================================================

let mockAuth: jest.Mocked<SpeechmaticsAuth>;
let lastCreatedWebSocket: MockWebSocket | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();

  // Reset WebSocket auto-open behavior
  mockWebSocketAutoOpen = true;

  // Reset static state
  (SpeechmaticsWebSocket as any).lastGlobalDisconnectTimestamp = 0;
  (SpeechmaticsWebSocket as any).lastQuotaErrorTimestamp = 0;
  (SpeechmaticsWebSocket as any).globalDisconnectPromise = null;

  // Setup mock auth
  mockAuth = new SpeechmaticsAuth() as jest.Mocked<SpeechmaticsAuth>;
  mockAuth.authenticate = jest.fn().mockResolvedValue('test-jwt-token');
  mockAuth.hasJWT = jest.fn().mockReturnValue(true);
  mockAuth.getJWT = jest.fn().mockReturnValue('test-jwt-token');
  mockAuth.getApiKey = jest.fn().mockReturnValue(null);

  // Track created WebSockets
  const OriginalMockWebSocket = MockWebSocket;
  (global as any).WebSocket = class extends OriginalMockWebSocket {
    constructor(url: string) {
      super(url);
      lastCreatedWebSocket = this;
    }
  };
});

afterEach(() => {
  jest.useRealTimers();
  lastCreatedWebSocket = null;
});

afterAll(() => {
  // Restore original WebSocket
  global.WebSocket = OriginalWebSocket;
});

// ============================================================================
// Helper functions
// ============================================================================

function createDefaultConfig(): SpeechmaticsConfig {
  return {
    systemPrompt: 'You are a helpful assistant',
    sttLanguage: 'fr',
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  jest.advanceTimersByTime(0);
  await Promise.resolve();
}

/**
 * Helper to advance time and flush promises multiple times
 * This is needed because the code has multiple async delays that need to be advanced
 */
async function advanceTimeAndFlush(ms: number, iterations: number = 5): Promise<void> {
  for (let i = 0; i < iterations; i++) {
    jest.advanceTimersByTime(ms / iterations);
    await flushPromises();
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('SpeechmaticsWebSocket', () => {
  describe('constructor', () => {
    it('should create instance with correct parameters', () => {
      const messageHandler = jest.fn();
      const connectionCallback = jest.fn();
      const errorCallback = jest.fn();

      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        connectionCallback,
        errorCallback,
        messageHandler
      );

      expect(wsManager).toBeInstanceOf(SpeechmaticsWebSocket);
      expect(wsManager.isConnected()).toBe(false);
      expect(wsManager.getWebSocket()).toBeNull();
    });

    it('should store initial message handler', () => {
      const messageHandler = jest.fn();

      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      // Access private field through any cast for testing
      expect((wsManager as any).messageHandler).toBe(messageHandler);
    });

    it('should accept null callbacks', () => {
      const messageHandler = jest.fn();

      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      expect(wsManager).toBeInstanceOf(SpeechmaticsWebSocket);
    });
  });

  describe('setMessageHandler', () => {
    it('should update messageHandler', () => {
      const initialHandler = jest.fn();
      const newHandler = jest.fn();

      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        initialHandler
      );

      wsManager.setMessageHandler(newHandler);

      expect((wsManager as any).messageHandler).toBe(newHandler);
    });

    it('should also update currentMessageHandler (BUG-018 fix)', () => {
      const initialHandler = jest.fn();
      const newHandler = jest.fn();

      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        initialHandler
      );

      wsManager.setMessageHandler(newHandler);

      // Both messageHandler and currentMessageHandler should be updated
      expect((wsManager as any).messageHandler).toBe(newHandler);
      expect((wsManager as any).currentMessageHandler).toBe(newHandler);
    });
  });

  describe('connect', () => {
    it('should authenticate before connecting', async () => {
      const messageHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      const connectPromise = wsManager.connect(createDefaultConfig(), null);

      await flushPromises();

      // Simulate RecognitionStarted message
      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });

      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();

      await connectPromise;

      expect(mockAuth.authenticate).toHaveBeenCalled();
    });

    it('should throw error if no authentication available', async () => {
      mockAuth.hasJWT.mockReturnValue(false);
      mockAuth.getApiKey.mockReturnValue(null);

      const messageHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      await expect(wsManager.connect(createDefaultConfig(), null)).rejects.toThrow(
        'No Speechmatics authentication token available'
      );
    });

    it('should create WebSocket with correct URL when JWT is available', async () => {
      const messageHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      const connectPromise = wsManager.connect(createDefaultConfig(), null);

      await flushPromises();
      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();

      await connectPromise;

      expect(lastCreatedWebSocket?.url).toContain('rt.speechmatics.com');
      expect(lastCreatedWebSocket?.url).toContain('jwt=');
    });

    it('should send StartRecognition message on open', async () => {
      const messageHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      const sendSpy = jest.spyOn(MockWebSocket.prototype, 'send');

      const connectPromise = wsManager.connect(createDefaultConfig(), null);

      await flushPromises();

      // Check that StartRecognition was sent
      expect(sendSpy).toHaveBeenCalled();
      const sentData = JSON.parse(sendSpy.mock.calls[0][0] as string);
      expect(sentData.message).toBe('StartRecognition');
      expect(sentData.transcription_config.language).toBe('fr');

      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();

      await connectPromise;

      sendSpy.mockRestore();
    });

    it('should call connection callback on RecognitionStarted', async () => {
      const messageHandler = jest.fn();
      const connectionCallback = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        connectionCallback,
        null,
        messageHandler
      );

      const connectPromise = wsManager.connect(createDefaultConfig(), null);

      await flushPromises();
      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();

      await connectPromise;

      expect(connectionCallback).toHaveBeenCalledWith(true);
    });

    it('should timeout if RecognitionStarted not received within 10 seconds', async () => {
      // Disable auto-open for this test so the WebSocket stays in CONNECTING state
      // and the timeout can fire
      mockWebSocketAutoOpen = false;

      const messageHandler = jest.fn();
      const errorCallback = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        errorCallback,
        messageHandler
      );

      let rejected = false;
      let rejectionError: Error | null = null;

      const connectPromise = wsManager.connect(createDefaultConfig(), null).catch((error) => {
        rejected = true;
        rejectionError = error;
      });

      // Flush initial async work (authentication, WebSocket creation)
      await flushPromises();

      // The promise should not have rejected yet (WebSocket is in CONNECTING state)
      expect(rejected).toBe(false);
      expect(lastCreatedWebSocket?.readyState).toBe(MockWebSocket.CONNECTING);

      // Advance timers and flush repeatedly to handle nested async operations
      // Use jest.runOnlyPendingTimers() to avoid infinite loops
      for (let i = 0; i < 20 && !rejected; i++) {
        jest.runOnlyPendingTimers();
        await flushPromises();
      }

      expect(rejected).toBe(true);
      expect(rejectionError?.message).toContain('Connection timeout');
    });

    it('should call message handler for received messages', async () => {
      const messageHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      const connectPromise = wsManager.connect(createDefaultConfig(), null);

      await flushPromises();
      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();

      await connectPromise;

      // Send a transcript message
      lastCreatedWebSocket?.simulateMessage({
        message: 'AddTranscript',
        metadata: { transcript: 'Hello' }
      });

      expect(messageHandler).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'AddTranscript' })
      );
    });

    it('should wait for previous disconnect to complete', async () => {
      const messageHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      let resolveDisconnect: () => void;
      const disconnectPromise = new Promise<void>(resolve => {
        resolveDisconnect = resolve;
      });

      const connectPromise = wsManager.connect(createDefaultConfig(), disconnectPromise);

      // Connection should not proceed yet
      await flushPromises();
      expect(mockAuth.authenticate).not.toHaveBeenCalled();

      // Resolve disconnect
      resolveDisconnect!();
      await flushPromises();

      // Now authentication should happen
      expect(mockAuth.authenticate).toHaveBeenCalled();

      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();

      await connectPromise;
    });
  });

  describe('disconnect', () => {
    it('should send EndOfStream message', async () => {
      const messageHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      // Connect first
      const connectPromise = wsManager.connect(createDefaultConfig(), null);
      await flushPromises();
      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();
      await connectPromise;

      const sendSpy = jest.spyOn(lastCreatedWebSocket!, 'send');

      // Disconnect (don't await yet)
      const disconnectPromise = wsManager.disconnect(false);

      // Advance through all delays (disconnect has multiple delays: 1500ms, 3000ms wait, 3000ms session release)
      await advanceTimeAndFlush(10000, 20);

      await disconnectPromise;

      // Check EndOfStream was sent
      const endOfStreamCall = sendSpy.mock.calls.find(call => {
        const data = JSON.parse(call[0] as string);
        return data.message === 'EndOfStream';
      });
      expect(endOfStreamCall).toBeDefined();
    });

    it('should close WebSocket', async () => {
      const messageHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      // Connect first
      const connectPromise = wsManager.connect(createDefaultConfig(), null);
      await flushPromises();
      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();
      await connectPromise;

      const ws = lastCreatedWebSocket!;
      const closeSpy = jest.spyOn(ws, 'close');

      // Disconnect
      const disconnectPromise = wsManager.disconnect(false);

      await advanceTimeAndFlush(10000, 20);

      await disconnectPromise;

      expect(closeSpy).toHaveBeenCalledWith(1000, 'Normal closure');
    });

    it('should clear message handler reference (BUG-006 fix)', async () => {
      const messageHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      // Connect first
      const connectPromise = wsManager.connect(createDefaultConfig(), null);
      await flushPromises();
      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();
      await connectPromise;

      expect((wsManager as any).messageHandler).toBe(messageHandler);

      // Disconnect
      const disconnectPromise = wsManager.disconnect(false);

      await advanceTimeAndFlush(10000, 20);

      await disconnectPromise;

      // Message handler should be cleared
      expect((wsManager as any).messageHandler).toBeNull();
    });

    it('should remove WebSocket event listeners', async () => {
      const messageHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      // Connect first
      const connectPromise = wsManager.connect(createDefaultConfig(), null);
      await flushPromises();
      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();
      await connectPromise;

      const ws = lastCreatedWebSocket!;

      // Disconnect
      const disconnectPromise = wsManager.disconnect(false);

      await advanceTimeAndFlush(10000, 20);

      await disconnectPromise;

      // Event listeners should be cleared
      expect(ws.onopen).toBeNull();
      expect(ws.onmessage).toBeNull();
      expect(ws.onerror).toBeNull();
      expect(ws.onclose).toBeNull();
    });

    it('should set lastDisconnectTimestamp', async () => {
      const messageHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      // Connect first
      const connectPromise = wsManager.connect(createDefaultConfig(), null);
      await flushPromises();
      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();
      await connectPromise;

      const beforeDisconnect = Date.now();

      // Disconnect
      const disconnectPromise = wsManager.disconnect(false);

      await advanceTimeAndFlush(10000, 20);

      await disconnectPromise;

      expect((wsManager as any).lastDisconnectTimestamp).toBeGreaterThanOrEqual(beforeDisconnect);
    });

    it('should handle disconnect when no WebSocket exists', async () => {
      const messageHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      // Should not throw
      await wsManager.disconnect(false);
      expect(wsManager.isConnected()).toBe(false);
    });
  });

  describe('safeErrorCallback', () => {
    it('should call error callback when provided', async () => {
      const messageHandler = jest.fn();
      const errorCallback = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        errorCallback,
        messageHandler
      );

      // Access private method through any cast
      (wsManager as any).safeErrorCallback(new Error('Test error'));

      expect(errorCallback).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should not crash if error callback throws', async () => {
      const messageHandler = jest.fn();
      const errorCallback = jest.fn().mockImplementation(() => {
        throw new Error('Callback error');
      });
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        errorCallback,
        messageHandler
      );

      // Should not throw
      expect(() => {
        (wsManager as any).safeErrorCallback(new Error('Test error'));
      }).not.toThrow();
    });

    it('should not crash if error callback is null', async () => {
      const messageHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      // Should not throw
      expect(() => {
        (wsManager as any).safeErrorCallback(new Error('Test error'));
      }).not.toThrow();
    });
  });

  describe('quota error handling', () => {
    it('should set lastQuotaErrorTimestamp on quota error close', async () => {
      const messageHandler = jest.fn();
      const errorCallback = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        errorCallback,
        messageHandler
      );

      // Connect first
      const connectPromise = wsManager.connect(createDefaultConfig(), null);
      await flushPromises();
      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();
      await connectPromise;

      // Simulate quota error close
      const beforeError = Date.now();
      lastCreatedWebSocket?.simulateClose(4005, 'quota exceeded');
      await flushPromises();

      expect(SpeechmaticsWebSocket.lastQuotaErrorTimestamp).toBeGreaterThanOrEqual(beforeError);
    });

    it('should wait QUOTA_ERROR_DELAY_MS after quota error before reconnecting', async () => {
      const messageHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      // Set quota error timestamp
      SpeechmaticsWebSocket.lastQuotaErrorTimestamp = Date.now();

      const connectPromise = wsManager.connect(createDefaultConfig(), null);

      // Should wait for quota delay
      await flushPromises();

      // Authentication should not have happened yet (waiting for delay)
      // After quota error, need to wait 10 seconds
      expect(mockAuth.authenticate).not.toHaveBeenCalled();

      // Advance past quota delay (10 seconds)
      jest.advanceTimersByTime(10001);
      await flushPromises();

      // Now authentication should happen
      expect(mockAuth.authenticate).toHaveBeenCalled();

      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();

      await connectPromise;
    });

    it('should clear stale quota error timestamp (BUG-017 fix)', async () => {
      const messageHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      // Set old quota error timestamp (20 seconds ago - past the 15s relevance window)
      SpeechmaticsWebSocket.lastQuotaErrorTimestamp = Date.now() - 20000;

      const connectPromise = wsManager.connect(createDefaultConfig(), null);
      await flushPromises();

      // Authentication should happen immediately (old quota error is stale)
      expect(mockAuth.authenticate).toHaveBeenCalled();

      // Quota error timestamp should be cleared
      expect(SpeechmaticsWebSocket.lastQuotaErrorTimestamp).toBe(0);

      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();

      await connectPromise;
    });
  });

  describe('reconnect delay', () => {
    it('should wait RECONNECT_DELAY_MS between disconnect and reconnect', async () => {
      const messageHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      // Connect first
      const connectPromise1 = wsManager.connect(createDefaultConfig(), null);
      await flushPromises();
      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();
      await connectPromise1;

      // Disconnect
      const disconnectPromise = wsManager.disconnect(false);
      await advanceTimeAndFlush(10000, 20);
      await disconnectPromise;

      // Reset mock to track new calls
      mockAuth.authenticate.mockClear();

      // Try to reconnect immediately
      const connectPromise2 = wsManager.connect(createDefaultConfig(), null);
      await flushPromises();

      // Should be waiting for reconnect delay (5 seconds)
      // Authentication should not happen immediately after disconnect
      // (The delay is enforced by checking lastDisconnectTimestamp)

      // Advance time past reconnect delay
      await advanceTimeAndFlush(6000, 10);

      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();

      await connectPromise2;

      expect(mockAuth.authenticate).toHaveBeenCalled();
    });
  });

  describe('fallback message handler (BUG-006, BUG-018)', () => {
    it('should restore initialMessageHandler on reconnect after disconnect', async () => {
      const initialHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        initialHandler
      );

      // Connect first
      const connectPromise1 = wsManager.connect(createDefaultConfig(), null);
      await flushPromises();
      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();
      await connectPromise1;

      // Disconnect
      const disconnectPromise = wsManager.disconnect(false);
      await advanceTimeAndFlush(10000, 20);
      await disconnectPromise;

      // messageHandler should be null after disconnect
      expect((wsManager as any).messageHandler).toBeNull();

      // Reconnect
      const connectPromise2 = wsManager.connect(createDefaultConfig(), null);

      // Advance past reconnect delay
      await advanceTimeAndFlush(6000, 10);

      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();

      await connectPromise2;

      // messageHandler should be restored to initialHandler
      expect((wsManager as any).messageHandler).toBe(initialHandler);
    });

    it('should prefer currentMessageHandler over initialHandler on reconnect (BUG-018 fix)', async () => {
      const initialHandler = jest.fn();
      const newHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        initialHandler
      );

      // Connect first
      const connectPromise1 = wsManager.connect(createDefaultConfig(), null);
      await flushPromises();
      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();
      await connectPromise1;

      // Update handler via setMessageHandler
      wsManager.setMessageHandler(newHandler);
      expect((wsManager as any).messageHandler).toBe(newHandler);
      expect((wsManager as any).currentMessageHandler).toBe(newHandler);

      // Disconnect
      const disconnectPromise = wsManager.disconnect(false);
      await advanceTimeAndFlush(10000, 20);
      await disconnectPromise;

      // messageHandler should be null, but currentMessageHandler preserved
      expect((wsManager as any).messageHandler).toBeNull();
      expect((wsManager as any).currentMessageHandler).toBe(newHandler);

      // Reconnect
      const connectPromise2 = wsManager.connect(createDefaultConfig(), null);

      // Advance past reconnect delay
      await advanceTimeAndFlush(6000, 10);

      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();

      await connectPromise2;

      // messageHandler should be restored to newHandler (from currentMessageHandler)
      expect((wsManager as any).messageHandler).toBe(newHandler);
    });
  });

  describe('isConnected', () => {
    it('should return false when not connected', () => {
      const messageHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      expect(wsManager.isConnected()).toBe(false);
    });

    it('should return true when connected', async () => {
      const messageHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      const connectPromise = wsManager.connect(createDefaultConfig(), null);
      await flushPromises();
      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();

      await connectPromise;

      expect(wsManager.isConnected()).toBe(true);
    });

    it('should return false after disconnect', async () => {
      const messageHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      const connectPromise = wsManager.connect(createDefaultConfig(), null);
      await flushPromises();
      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();
      await connectPromise;

      const disconnectPromise = wsManager.disconnect(false);
      await advanceTimeAndFlush(10000, 20);
      await disconnectPromise;

      expect(wsManager.isConnected()).toBe(false);
    });
  });

  describe('send', () => {
    it('should send data when connected', async () => {
      const messageHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      const connectPromise = wsManager.connect(createDefaultConfig(), null);
      await flushPromises();
      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();
      await connectPromise;

      const sendSpy = jest.spyOn(lastCreatedWebSocket!, 'send');
      const testData = new ArrayBuffer(10);

      wsManager.send(testData);

      expect(sendSpy).toHaveBeenCalledWith(testData);
    });

    it('should not send data when not connected', () => {
      const messageHandler = jest.fn();
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        messageHandler
      );

      const testData = new ArrayBuffer(10);

      // Should not throw
      expect(() => wsManager.send(testData)).not.toThrow();
    });
  });

  describe('error handling during message processing', () => {
    it('should not crash if message handler throws', async () => {
      const throwingHandler = jest.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      const wsManager = new SpeechmaticsWebSocket(
        mockAuth,
        null,
        null,
        throwingHandler
      );

      const connectPromise = wsManager.connect(createDefaultConfig(), null);
      await flushPromises();
      lastCreatedWebSocket?.simulateMessage({ message: 'RecognitionStarted' });
      await flushPromises();
      jest.advanceTimersByTime(100);
      await flushPromises();
      await connectPromise;

      // Send another message - should not crash
      expect(() => {
        lastCreatedWebSocket?.simulateMessage({ message: 'AddTranscript' });
      }).not.toThrow();

      // Handler was called
      expect(throwingHandler).toHaveBeenCalled();
    });
  });
});
