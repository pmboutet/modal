/**
 * Tests for useSessionTimer hook
 * @jest-environment jsdom
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useSessionTimer } from '../useSessionTimer';

// Mock fetch for server sync tests
const mockFetch = jest.fn();

// Mock navigator.sendBeacon
const mockSendBeacon = jest.fn();

describe('useSessionTimer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockFetch.mockReset();
    mockSendBeacon.mockReset();
    localStorage.clear();

    // Setup global mocks
    global.fetch = mockFetch;
    Object.defineProperty(navigator, 'sendBeacon', {
      value: mockSendBeacon,
      writable: true,
      configurable: true,
    });

    // Default mock for fetch - returns empty data
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        data: { elapsedActiveSeconds: 0, participantId: 'p1' },
      }),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with running state', () => {
      const { result } = renderHook(() => useSessionTimer());

      expect(result.current.timerState).toBe('running');
      expect(result.current.isPaused).toBe(false);
      expect(result.current.elapsedSeconds).toBe(0);
      expect(result.current.elapsedMinutes).toBe(0);
    });

    it('should accept initial elapsed seconds', () => {
      const { result } = renderHook(() =>
        useSessionTimer({ initialElapsedSeconds: 120 })
      );

      expect(result.current.elapsedSeconds).toBe(120);
      expect(result.current.elapsedMinutes).toBe(2);
    });

    it('should initialize isSyncing as false', () => {
      const { result } = renderHook(() => useSessionTimer());
      expect(result.current.isSyncing).toBe(false);
    });
  });

  describe('time tracking', () => {
    it('should increment elapsed time every second when running', () => {
      const { result } = renderHook(() => useSessionTimer());

      expect(result.current.elapsedSeconds).toBe(0);

      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(result.current.elapsedSeconds).toBe(1);

      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(result.current.elapsedSeconds).toBe(6);
    });

    it('should calculate elapsed minutes with 1 decimal precision', () => {
      const { result } = renderHook(() =>
        useSessionTimer({ initialElapsedSeconds: 90 })
      );

      expect(result.current.elapsedMinutes).toBe(1.5);
    });

    it('should not increment time when paused', () => {
      const { result } = renderHook(() => useSessionTimer());

      // Advance to pause state (30s inactivity)
      act(() => {
        jest.advanceTimersByTime(30000);
      });

      expect(result.current.isPaused).toBe(true);
      const secondsAtPause = result.current.elapsedSeconds;

      // Advance more time - should not increment
      act(() => {
        jest.advanceTimersByTime(10000);
      });

      expect(result.current.elapsedSeconds).toBe(secondsAtPause);
    });
  });

  describe('inactivity pause', () => {
    it('should pause after 30 seconds of inactivity by default', () => {
      const { result } = renderHook(() => useSessionTimer());

      expect(result.current.isPaused).toBe(false);

      act(() => {
        jest.advanceTimersByTime(30000);
      });

      expect(result.current.isPaused).toBe(true);
      expect(result.current.timerState).toBe('paused');
    });

    it('should respect custom inactivity timeout', () => {
      const { result } = renderHook(() =>
        useSessionTimer({ inactivityTimeout: 10000 })
      );

      expect(result.current.isPaused).toBe(false);

      act(() => {
        jest.advanceTimersByTime(10000);
      });

      expect(result.current.isPaused).toBe(true);
    });
  });

  describe('AI streaming activity', () => {
    it('should keep timer running while AI is streaming', () => {
      const { result } = renderHook(() =>
        useSessionTimer({ inactivityTimeout: 5000 })
      );

      // Start AI streaming
      act(() => {
        result.current.notifyAiStreaming(true);
      });

      // Advance past inactivity timeout
      act(() => {
        jest.advanceTimersByTime(10000);
      });

      // Should still be running because AI is streaming
      expect(result.current.isPaused).toBe(false);

      // Stop AI streaming
      act(() => {
        result.current.notifyAiStreaming(false);
      });

      // Now advance to trigger pause
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(result.current.isPaused).toBe(true);
    });
  });

  describe('user typing activity', () => {
    it('should keep timer running while user is typing', () => {
      const { result } = renderHook(() =>
        useSessionTimer({ inactivityTimeout: 5000 })
      );

      // Start typing
      act(() => {
        result.current.notifyUserTyping(true);
      });

      // Advance past inactivity timeout
      act(() => {
        jest.advanceTimersByTime(10000);
      });

      // Should still be running because user is typing
      expect(result.current.isPaused).toBe(false);
    });

    it('should resume timer when user starts typing after pause', () => {
      const { result } = renderHook(() =>
        useSessionTimer({ inactivityTimeout: 5000 })
      );

      // Let it pause
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(result.current.isPaused).toBe(true);

      // Start typing - should resume
      act(() => {
        result.current.notifyUserTyping(true);
      });

      expect(result.current.isPaused).toBe(false);
      expect(result.current.timerState).toBe('running');
    });

    it('should preserve elapsed seconds across pause/resume cycles', () => {
      const { result } = renderHook(() =>
        useSessionTimer({ inactivityTimeout: 5000 })
      );

      // Run for 3 seconds
      act(() => {
        jest.advanceTimersByTime(3000);
      });
      expect(result.current.elapsedSeconds).toBe(3);

      // Let it pause (2 more seconds to reach 5s timeout)
      act(() => {
        jest.advanceTimersByTime(2000);
      });
      expect(result.current.isPaused).toBe(true);
      const secondsAtPause = result.current.elapsedSeconds;
      expect(secondsAtPause).toBe(5); // 3 + 2 = 5 seconds before pause

      // Wait 10 seconds while paused - elapsed should NOT change
      act(() => {
        jest.advanceTimersByTime(10000);
      });
      expect(result.current.elapsedSeconds).toBe(secondsAtPause);
      expect(result.current.isPaused).toBe(true);

      // Resume by typing
      act(() => {
        result.current.notifyUserTyping(true);
      });
      expect(result.current.isPaused).toBe(false);
      // Should still have the same elapsed seconds immediately after resume
      expect(result.current.elapsedSeconds).toBe(secondsAtPause);

      // Run for 2 more seconds
      act(() => {
        jest.advanceTimersByTime(2000);
      });
      // Should be 5 (from before pause) + 2 (after resume) = 7
      expect(result.current.elapsedSeconds).toBe(7);
    });
  });

  describe('voice activity', () => {
    it('should keep timer running while voice is active', () => {
      const { result } = renderHook(() =>
        useSessionTimer({ inactivityTimeout: 5000 })
      );

      // Activate voice
      act(() => {
        result.current.notifyVoiceActive(true);
      });

      // Advance past inactivity timeout
      act(() => {
        jest.advanceTimersByTime(10000);
      });

      // Should still be running because voice is active
      expect(result.current.isPaused).toBe(false);
    });
  });

  describe('message submission', () => {
    it('should resume timer and reset inactivity countdown on message submit', () => {
      const { result } = renderHook(() =>
        useSessionTimer({ inactivityTimeout: 5000 })
      );

      // Let it pause
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(result.current.isPaused).toBe(true);

      // Submit message - should resume
      act(() => {
        result.current.notifyMessageSubmitted();
      });

      expect(result.current.isPaused).toBe(false);

      // Advance partially - should still be running
      act(() => {
        jest.advanceTimersByTime(3000);
      });

      expect(result.current.isPaused).toBe(false);

      // Complete the inactivity timeout - should pause
      act(() => {
        jest.advanceTimersByTime(2000);
      });

      expect(result.current.isPaused).toBe(true);
    });
  });

  describe('manual controls', () => {
    it('should allow manual start', () => {
      const { result } = renderHook(() =>
        useSessionTimer({ inactivityTimeout: 5000 })
      );

      // Let it pause
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(result.current.isPaused).toBe(true);

      // Manual start
      act(() => {
        result.current.start();
      });

      expect(result.current.isPaused).toBe(false);
    });

    it('should allow manual pause', () => {
      const { result } = renderHook(() => useSessionTimer());

      expect(result.current.isPaused).toBe(false);

      act(() => {
        result.current.pause();
      });

      expect(result.current.isPaused).toBe(true);
    });

    it('should allow reset', () => {
      const { result } = renderHook(() =>
        useSessionTimer({ initialElapsedSeconds: 100 })
      );

      expect(result.current.elapsedSeconds).toBe(100);

      act(() => {
        result.current.reset();
      });

      expect(result.current.elapsedSeconds).toBe(0);
      expect(result.current.isPaused).toBe(false);
    });
  });

  describe('multiple activity sources', () => {
    it('should stay running if any activity source is active', () => {
      const { result } = renderHook(() =>
        useSessionTimer({ inactivityTimeout: 5000 })
      );

      // Both typing and AI streaming active
      act(() => {
        result.current.notifyUserTyping(true);
        result.current.notifyAiStreaming(true);
      });

      // Stop typing but AI still streaming
      act(() => {
        result.current.notifyUserTyping(false);
      });

      act(() => {
        jest.advanceTimersByTime(10000);
      });

      // Should still be running because AI is streaming
      expect(result.current.isPaused).toBe(false);

      // Stop AI streaming
      act(() => {
        result.current.notifyAiStreaming(false);
      });

      // Now should pause after timeout
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(result.current.isPaused).toBe(true);
    });
  });

  describe('localStorage persistence', () => {
    it('should save to localStorage when askKey is provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { elapsedActiveSeconds: 0, participantId: 'p1' },
        }),
      });

      const { result } = renderHook(() =>
        useSessionTimer({ askKey: 'test-ask-123' })
      );

      // Wait for server fetch to complete (isLoading becomes false)
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isLoading).toBe(false);

      // Now advance time - this should save to localStorage
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      const stored = localStorage.getItem('session_timer_test-ask-123');
      expect(stored).toBe('5');
    });

    it('should trust server value over localStorage when askKey is provided', async () => {
      localStorage.setItem('session_timer_test-ask-456', '120');

      // Server returns lower value than localStorage - server is the source of truth
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { elapsedActiveSeconds: 100, participantId: 'p1' },
        }),
      });

      const { result } = renderHook(() =>
        useSessionTimer({ askKey: 'test-ask-456' })
      );

      // Initially isLoading and elapsedSeconds is 0
      expect(result.current.isLoading).toBe(true);
      expect(result.current.elapsedSeconds).toBe(0);

      // Wait for server fetch
      await act(async () => {
        await Promise.resolve();
      });

      // After server fetch, trusts server value (100) even if localStorage is higher (120)
      expect(result.current.isLoading).toBe(false);
      expect(result.current.elapsedSeconds).toBe(100);
    });

    it('should use max of localStorage and initialElapsedSeconds', () => {
      localStorage.setItem('session_timer_test-ask-789', '50');

      const { result } = renderHook(() =>
        useSessionTimer({
          askKey: 'test-ask-789',
          initialElapsedSeconds: 100,
        })
      );

      // Should use initialElapsedSeconds (100) because it's higher
      expect(result.current.elapsedSeconds).toBe(100);
    });

    it('should not use localStorage when askKey is not provided', () => {
      localStorage.setItem('session_timer_some-key', '200');

      const { result } = renderHook(() => useSessionTimer());

      expect(result.current.elapsedSeconds).toBe(0);
    });

    it('should update localStorage on reset', async () => {
      localStorage.setItem('session_timer_test-reset', '100');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { elapsedActiveSeconds: 100, participantId: 'p1' },
        }),
      });

      const { result } = renderHook(() =>
        useSessionTimer({ askKey: 'test-reset' })
      );

      // Wait for server fetch
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.elapsedSeconds).toBe(100);

      act(() => {
        result.current.reset();
      });

      expect(result.current.elapsedSeconds).toBe(0);
      expect(localStorage.getItem('session_timer_test-reset')).toBe('0');
    });

    it('should send 0 to server on reset (not stale ref value)', async () => {
      localStorage.setItem('session_timer_test-reset-server', '200');

      // Initial fetch returns 200 seconds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { elapsedActiveSeconds: 200, participantId: 'p1' },
        }),
      });

      const { result } = renderHook(() =>
        useSessionTimer({ askKey: 'test-reset-server' })
      );

      // Wait for server fetch
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.elapsedSeconds).toBe(200);

      // Clear mock to track reset call
      mockFetch.mockClear();

      // Mock the PATCH response for reset
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { elapsedActiveSeconds: 0, participantId: 'p1', timerResetAt: new Date().toISOString() },
        }),
      });

      // Reset the timer
      await act(async () => {
        result.current.reset();
        await Promise.resolve();
      });

      expect(result.current.elapsedSeconds).toBe(0);

      // Verify the PATCH request sent 0, not 200
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/ask/test-reset-server/timer',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('"elapsedActiveSeconds":0'),
        })
      );

      // Also verify reset flag was sent
      const callBody = mockFetch.mock.calls[0][1].body;
      expect(callBody).toContain('"reset":true');
    });

    it('should start paused if user was away for longer than inactivity timeout', async () => {
      // Set last activity to 2 minutes ago (longer than 30s inactivity timeout)
      const twoMinutesAgo = Date.now() - 120000;
      localStorage.setItem('session_timer_test-long-absence_last_activity', String(twoMinutesAgo));
      localStorage.setItem('session_timer_test-long-absence', '300'); // 5 minutes elapsed

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { elapsedActiveSeconds: 300, participantId: 'p1' },
        }),
      });

      const { result } = renderHook(() =>
        useSessionTimer({
          askKey: 'test-long-absence',
          inactivityTimeout: 30000,
        })
      );

      // Should start in paused state because user was away for > 30s
      expect(result.current.isPaused).toBe(true);
      expect(result.current.timerState).toBe('paused');
      // Initially isLoading is true and elapsedSeconds is 0
      expect(result.current.isLoading).toBe(true);
      expect(result.current.elapsedSeconds).toBe(0);

      // Wait for server fetch to complete
      await act(async () => {
        await Promise.resolve();
      });

      // After server fetch, elapsed time is loaded
      expect(result.current.isLoading).toBe(false);
      expect(result.current.elapsedSeconds).toBe(300);
    });

    it('should start running if user was away for less than inactivity timeout', () => {
      // Set last activity to 10 seconds ago (less than 30s inactivity timeout)
      const tenSecondsAgo = Date.now() - 10000;
      localStorage.setItem('session_timer_test-short-absence_last_activity', String(tenSecondsAgo));
      localStorage.setItem('session_timer_test-short-absence', '60');

      const { result } = renderHook(() =>
        useSessionTimer({
          askKey: 'test-short-absence',
          inactivityTimeout: 30000,
        })
      );

      // Should start in running state because user was away for < 30s
      expect(result.current.isPaused).toBe(false);
      expect(result.current.timerState).toBe('running');
    });

    it('should save last activity timestamp on activity', () => {
      const { result } = renderHook(() =>
        useSessionTimer({ askKey: 'test-activity-save' })
      );

      // Trigger activity
      act(() => {
        result.current.notifyUserTyping(true);
      });

      // Check that last activity timestamp was saved
      const stored = localStorage.getItem('session_timer_test-activity-save_last_activity');
      expect(stored).not.toBeNull();
      const timestamp = parseInt(stored!, 10);
      expect(timestamp).toBeGreaterThan(Date.now() - 5000); // Within last 5 seconds
    });
  });

  describe('server sync', () => {
    it('should fetch from server on mount when askKey is provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { elapsedActiveSeconds: 150, participantId: 'p1' },
        }),
      });

      renderHook(() =>
        useSessionTimer({ askKey: 'test-server-fetch' })
      );

      // Flush promises
      await act(async () => {
        await Promise.resolve();
      });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/ask/test-server-fetch/timer',
        expect.any(Object)
      );
    });

    it('should include invite token in fetch headers when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { elapsedActiveSeconds: 0, participantId: 'p1' },
        }),
      });

      renderHook(() =>
        useSessionTimer({
          askKey: 'test-token',
          inviteToken: 'my-invite-token',
        })
      );

      // Flush promises
      await act(async () => {
        await Promise.resolve();
      });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/ask/test-token/timer',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Invite-Token': 'my-invite-token',
          }),
        })
      );
    });

    it('should trust server value as source of truth', async () => {
      localStorage.setItem('session_timer_test-max', '50');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { elapsedActiveSeconds: 100, participantId: 'p1' },
        }),
      });

      const { result } = renderHook(() =>
        useSessionTimer({ askKey: 'test-max' })
      );

      // Initially isLoading is true and elapsedSeconds is 0 (doesn't load from localStorage)
      expect(result.current.isLoading).toBe(true);
      expect(result.current.elapsedSeconds).toBe(0);

      // Flush promises to let server fetch complete
      await act(async () => {
        await Promise.resolve();
      });

      // After server fetch, trusts server value (100), ignoring localStorage (50)
      expect(result.current.isLoading).toBe(false);
      expect(result.current.elapsedSeconds).toBe(100);
    });

    it('should sync to server periodically when running', async () => {
      const { result } = renderHook(() =>
        useSessionTimer({ askKey: 'test-periodic' })
      );

      // Flush initial fetch
      await act(async () => {
        await Promise.resolve();
      });

      mockFetch.mockClear();

      // Keep timer running with activity
      act(() => {
        result.current.notifyUserTyping(true);
      });

      // Advance 30 seconds (sync interval)
      act(() => {
        jest.advanceTimersByTime(30000);
      });

      // Flush promises
      await act(async () => {
        await Promise.resolve();
      });

      // Should have made a PATCH request
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/ask/test-periodic/timer',
        expect.objectContaining({
          method: 'PATCH',
        })
      );
    });

    it('should sync to server on pause', async () => {
      const { result } = renderHook(() =>
        useSessionTimer({
          askKey: 'test-pause-sync',
          inactivityTimeout: 5000,
        })
      );

      // Wait for initial fetch
      await act(async () => {
        await Promise.resolve();
      });

      mockFetch.mockClear();

      // Let it pause
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      // Flush promises
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isPaused).toBe(true);

      // Should have synced to server on pause
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/ask/test-pause-sync/timer',
        expect.objectContaining({
          method: 'PATCH',
        })
      );
    });

    it('should call onServerSync callback when syncing', async () => {
      const onServerSync = jest.fn();

      const { result } = renderHook(() =>
        useSessionTimer({
          askKey: 'test-callback',
          onServerSync,
        })
      );

      await act(async () => {
        await result.current.syncToServer();
      });

      expect(onServerSync).toHaveBeenCalledWith(
        expect.any(Number),
        true
      );
    });

    it('should return false from syncToServer when askKey is not provided', async () => {
      const { result } = renderHook(() => useSessionTimer());

      let syncResult: boolean = true;
      await act(async () => {
        syncResult = await result.current.syncToServer();
      });

      expect(syncResult).toBe(false);
    });

    it('should handle server fetch errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() =>
        useSessionTimer({ askKey: 'test-error' })
      );

      // Should not throw - flush promises
      await act(async () => {
        await Promise.resolve();
      });

      // Timer should still work
      expect(result.current.elapsedSeconds).toBe(0);
      expect(result.current.timerState).toBe('running');
    });
  });

  describe('cleanup', () => {
    it('should cleanup timers on unmount', () => {
      const { result, unmount } = renderHook(() => useSessionTimer());

      // Start some activity
      act(() => {
        result.current.notifyUserTyping(true);
        result.current.notifyUserTyping(false);
      });

      unmount();

      // Should not throw or cause issues - advance timers after unmount
      jest.advanceTimersByTime(100000);
    });

    it('should use sendBeacon on page unload when askKey is provided', () => {
      renderHook(() =>
        useSessionTimer({ askKey: 'test-beacon' })
      );

      // Simulate beforeunload
      const event = new Event('beforeunload');
      window.dispatchEvent(event);

      expect(mockSendBeacon).toHaveBeenCalledWith(
        '/api/ask/test-beacon/timer',
        expect.any(Blob)
      );
    });
  });
});
