/**
 * useSessionTimer - Hook for intelligent session timer with persistence
 *
 * Tracks active session time with smart pause/resume logic:
 * - Timer runs while AI is streaming
 * - Timer runs while user is typing or speaking
 * - Timer continues for 30 seconds after activity stops
 * - Timer pauses if no activity after 30 seconds
 * - Timer resumes when activity starts again
 *
 * Persistence:
 * - Saves to localStorage for instant restore on page refresh
 * - Syncs to server periodically (every 30s) and on pause
 */

import { useEffect, useRef, useCallback, useState } from 'react';

/**
 * Timer state: 'running' when active, 'paused' when waiting for activity
 */
export type TimerState = 'running' | 'paused';

/**
 * Storage key prefix for localStorage
 */
const STORAGE_KEY_PREFIX = 'session_timer_';

/**
 * Server sync interval in milliseconds (30 seconds)
 */
const SERVER_SYNC_INTERVAL = 30000;

export interface SessionTimerConfig {
  /**
   * Inactivity timeout before pausing (in ms). Default: 30000 (30s)
   */
  inactivityTimeout?: number;

  /**
   * Initial elapsed time in seconds (for resuming sessions)
   * @deprecated Use askKey instead for automatic persistence
   */
  initialElapsedSeconds?: number;

  /**
   * ASK key for persistence (localStorage + server sync)
   * When provided, the timer will:
   * - Load initial value from localStorage (instant)
   * - Fetch server value and use the higher one
   * - Save to localStorage on every tick
   * - Sync to server periodically
   */
  askKey?: string;

  /**
   * Invite token for authenticated API calls
   */
  inviteToken?: string | null;

  /**
   * Current step ID for step-level time tracking
   * When provided, the timer will also track time for the current step
   * and sync it to the server
   */
  currentStepId?: string | null;

  /**
   * Callback when timer syncs to server
   */
  onServerSync?: (elapsedSeconds: number, success: boolean) => void;
}

export interface SessionTimerState {
  /**
   * Elapsed time in seconds (total session)
   */
  elapsedSeconds: number;

  /**
   * Elapsed time in minutes (for display)
   */
  elapsedMinutes: number;

  /**
   * Elapsed time for current step in seconds
   */
  stepElapsedSeconds: number;

  /**
   * Elapsed time for current step in minutes (for display)
   */
  stepElapsedMinutes: number;

  /**
   * Current timer state
   */
  timerState: TimerState;

  /**
   * Whether the timer is paused
   */
  isPaused: boolean;

  /**
   * Whether the timer is syncing to server
   */
  isSyncing: boolean;

  /**
   * Notify that AI is streaming (keeps timer active)
   */
  notifyAiStreaming: (isStreaming: boolean) => void;

  /**
   * Notify that user is typing (keeps timer active)
   */
  notifyUserTyping: (isTyping: boolean) => void;

  /**
   * Notify that user is speaking/voice active (keeps timer active)
   */
  notifyVoiceActive: (isActive: boolean) => void;

  /**
   * Notify that a message was submitted (resets inactivity countdown)
   */
  notifyMessageSubmitted: () => void;

  /**
   * Manually start the timer
   */
  start: () => void;

  /**
   * Manually pause the timer
   */
  pause: () => void;

  /**
   * Reset the timer to zero
   */
  reset: () => void;

  /**
   * Force sync to server immediately
   */
  syncToServer: () => Promise<boolean>;
}

/**
 * Get the localStorage key for a given ASK key
 */
function getStorageKey(askKey: string): string {
  return `${STORAGE_KEY_PREFIX}${askKey}`;
}

/**
 * Get the last activity timestamp key for localStorage
 */
function getLastActivityKey(askKey: string): string {
  return `${STORAGE_KEY_PREFIX}${askKey}_last_activity`;
}

/**
 * Save last activity timestamp to localStorage
 */
function saveLastActivity(askKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getLastActivityKey(askKey), String(Date.now()));
  } catch (error) {
    // Silent fail
  }
}

/**
 * Load last activity timestamp from localStorage
 */
function loadLastActivity(askKey: string): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(getLastActivityKey(askKey));
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
  } catch (error) {
    // Silent fail
  }
  return null;
}

/**
 * Load elapsed seconds from localStorage
 */
function loadFromLocalStorage(askKey: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    const stored = localStorage.getItem(getStorageKey(askKey));
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        return parsed;
      }
    }
  } catch (error) {
    console.warn('Failed to load timer from localStorage:', error);
  }
  return 0;
}

/**
 * Save elapsed seconds to localStorage
 */
function saveToLocalStorage(askKey: string, elapsedSeconds: number): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getStorageKey(askKey), String(Math.floor(elapsedSeconds)));
  } catch (error) {
    console.warn('Failed to save timer to localStorage:', error);
  }
}

/**
 * Get the localStorage key for step elapsed seconds
 */
function getStepStorageKey(askKey: string, stepId: string): string {
  return `${STORAGE_KEY_PREFIX}${askKey}_step_${stepId}`;
}

/**
 * Load step elapsed seconds from localStorage
 */
function loadStepFromLocalStorage(askKey: string, stepId: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    const stored = localStorage.getItem(getStepStorageKey(askKey, stepId));
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        return parsed;
      }
    }
  } catch (error) {
    // Silent fail
  }
  return 0;
}

/**
 * Save step elapsed seconds to localStorage
 */
function saveStepToLocalStorage(askKey: string, stepId: string, elapsedSeconds: number): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getStepStorageKey(askKey, stepId), String(Math.floor(elapsedSeconds)));
  } catch (error) {
    // Silent fail
  }
}

/**
 * Get the localStorage key for timer reset timestamp
 */
function getTimerResetKey(askKey: string): string {
  return `${STORAGE_KEY_PREFIX}${askKey}_reset_at`;
}

/**
 * Load timer reset timestamp from localStorage
 */
function loadTimerResetFromLocalStorage(askKey: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(getTimerResetKey(askKey));
  } catch (error) {
    // Silent fail
  }
  return null;
}

/**
 * Save timer reset timestamp to localStorage
 */
function saveTimerResetToLocalStorage(askKey: string, resetAt: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (resetAt) {
      localStorage.setItem(getTimerResetKey(askKey), resetAt);
    } else {
      localStorage.removeItem(getTimerResetKey(askKey));
    }
  } catch (error) {
    // Silent fail
  }
}

/**
 * Clear all timer data from localStorage for a given ASK key
 */
function clearTimerFromLocalStorage(askKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(getStorageKey(askKey));
    localStorage.removeItem(getLastActivityKey(askKey));
    // Also clear any step timers (we can't enumerate them all, but we clear what we know)
  } catch (error) {
    // Silent fail
  }
}

/**
 * Fetch elapsed seconds from server
 */
interface ServerTimerData {
  elapsedActiveSeconds: number;
  stepElapsedSeconds?: number;
  currentStepId?: string;
  timerResetAt?: string | null;
}

async function fetchFromServer(askKey: string, inviteToken?: string | null): Promise<ServerTimerData | null> {
  try {
    const headers: Record<string, string> = {};
    if (inviteToken) {
      headers['X-Invite-Token'] = inviteToken;
    }

    const response = await fetch(`/api/ask/${askKey}/timer`, { headers });
    if (!response.ok) {
      console.warn('Failed to fetch timer from server:', response.status);
      return null;
    }

    const result = await response.json();
    if (result.success && typeof result.data?.elapsedActiveSeconds === 'number') {
      return {
        elapsedActiveSeconds: result.data.elapsedActiveSeconds,
        stepElapsedSeconds: result.data.stepElapsedSeconds,
        currentStepId: result.data.currentStepId,
        timerResetAt: result.data.timerResetAt,
      };
    }
  } catch (error) {
    console.warn('Failed to fetch timer from server:', error);
  }
  return null;
}

/**
 * Save elapsed seconds to server (includes step time if provided)
 */
async function saveToServer(
  askKey: string,
  elapsedSeconds: number,
  inviteToken?: string | null,
  currentStepId?: string | null,
  stepElapsedSeconds?: number
): Promise<boolean> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (inviteToken) {
      headers['X-Invite-Token'] = inviteToken;
    }

    const body: Record<string, unknown> = {
      elapsedActiveSeconds: elapsedSeconds,
    };

    // Include step info if available
    if (currentStepId && typeof stepElapsedSeconds === 'number') {
      body.currentStepId = currentStepId;
      body.stepElapsedSeconds = stepElapsedSeconds;
    }

    const response = await fetch(`/api/ask/${askKey}/timer`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });

    return response.ok;
  } catch (error) {
    console.warn('Failed to save timer to server:', error);
    return false;
  }
}

export function useSessionTimer(config: SessionTimerConfig = {}): SessionTimerState {
  const {
    inactivityTimeout = 30000, // 30 seconds
    initialElapsedSeconds = 0,
    askKey,
    inviteToken,
    currentStepId,
    onServerSync,
  } = config;

  // Determine initial value from localStorage if askKey is provided
  const getInitialElapsedSeconds = () => {
    if (askKey) {
      const localValue = loadFromLocalStorage(askKey);
      return Math.max(localValue, initialElapsedSeconds);
    }
    return initialElapsedSeconds;
  };

  // Determine if we should start paused (user was away for longer than inactivity timeout)
  const shouldStartPaused = (): boolean => {
    if (!askKey) return false;
    const lastActivity = loadLastActivity(askKey);
    if (lastActivity === null) return false;
    const timeSinceLastActivity = Date.now() - lastActivity;
    // If user was away for more than inactivity timeout, start paused
    return timeSinceLastActivity > inactivityTimeout;
  };

  // Determine initial step elapsed seconds from localStorage
  const getInitialStepElapsedSeconds = () => {
    if (askKey && currentStepId) {
      return loadStepFromLocalStorage(askKey, currentStepId);
    }
    return 0;
  };

  // State
  const [elapsedSeconds, setElapsedSeconds] = useState(getInitialElapsedSeconds);
  const [stepElapsedSeconds, setStepElapsedSeconds] = useState(getInitialStepElapsedSeconds);
  const [timerState, setTimerState] = useState<TimerState>(() => shouldStartPaused() ? 'paused' : 'running');
  const [isSyncing, setIsSyncing] = useState(false);

  // Track current step ID to detect changes
  const previousStepIdRef = useRef<string | null | undefined>(currentStepId);

  // Activity tracking refs
  const isAiStreamingRef = useRef(false);
  const isUserTypingRef = useRef(false);
  const isVoiceActiveRef = useRef(false);

  // Timer refs
  const tickIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const inactivityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const serverSyncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityTimestampRef = useRef<number>(Date.now());
  const lastServerSyncRef = useRef<number>(0);

  // Track elapsed seconds for server sync
  const elapsedSecondsRef = useRef(elapsedSeconds);
  useEffect(() => {
    elapsedSecondsRef.current = elapsedSeconds;
  }, [elapsedSeconds]);

  // Track step elapsed seconds for server sync
  const stepElapsedSecondsRef = useRef(stepElapsedSeconds);
  useEffect(() => {
    stepElapsedSecondsRef.current = stepElapsedSeconds;
  }, [stepElapsedSeconds]);

  // Track current step ID for sync
  // IMPORTANT: Always keep this ref in sync with the prop, not just on step changes
  const currentStepIdRef = useRef(currentStepId);
  useEffect(() => {
    // Always update the ref when prop changes (for tick interval to access)
    if (currentStepIdRef.current !== currentStepId) {
      currentStepIdRef.current = currentStepId;
    }
  }, [currentStepId]);

  /**
   * Sync to server (includes step time if available)
   */
  const syncToServer = useCallback(async (): Promise<boolean> => {
    if (!askKey) return false;

    setIsSyncing(true);
    try {
      const success = await saveToServer(
        askKey,
        elapsedSecondsRef.current,
        inviteToken,
        currentStepIdRef.current,
        stepElapsedSecondsRef.current
      );
      lastServerSyncRef.current = Date.now();
      onServerSync?.(elapsedSecondsRef.current, success);
      return success;
    } finally {
      setIsSyncing(false);
    }
  }, [askKey, inviteToken, onServerSync]);

  /**
   * Check if any activity is currently happening
   */
  const hasActiveActivity = useCallback(() => {
    return isAiStreamingRef.current || isUserTypingRef.current || isVoiceActiveRef.current;
  }, []);

  /**
   * Clear the inactivity timeout
   */
  const clearInactivityTimeout = useCallback(() => {
    if (inactivityTimeoutRef.current) {
      clearTimeout(inactivityTimeoutRef.current);
      inactivityTimeoutRef.current = null;
    }
  }, []);

  /**
   * Start the inactivity countdown (30s until pause)
   */
  const startInactivityCountdown = useCallback(() => {
    clearInactivityTimeout();

    // Only start countdown if no active activity
    if (hasActiveActivity()) {
      return;
    }

    inactivityTimeoutRef.current = setTimeout(() => {
      // Double-check no activity before pausing
      if (!hasActiveActivity()) {
        setTimerState('paused');
        // Sync to server when pausing
        if (askKey) {
          syncToServer();
        }
      }
    }, inactivityTimeout);
  }, [clearInactivityTimeout, hasActiveActivity, inactivityTimeout, askKey, syncToServer]);

  /**
   * Update activity and manage timer state
   */
  const updateActivityState = useCallback(() => {
    lastActivityTimestampRef.current = Date.now();
    // Save last activity to localStorage for detecting long absences on page reload
    if (askKey) {
      saveLastActivity(askKey);
    }

    if (hasActiveActivity()) {
      // Activity detected - ensure timer is running
      clearInactivityTimeout();
      setTimerState('running');
    } else {
      // No active activity - start countdown to pause
      startInactivityCountdown();
    }
  }, [hasActiveActivity, clearInactivityTimeout, startInactivityCountdown, askKey]);

  /**
   * Notify that AI is streaming
   */
  const notifyAiStreaming = useCallback((isStreaming: boolean) => {
    isAiStreamingRef.current = isStreaming;
    updateActivityState();
  }, [updateActivityState]);

  /**
   * Notify that user is typing
   */
  const notifyUserTyping = useCallback((isTyping: boolean) => {
    isUserTypingRef.current = isTyping;
    updateActivityState();
  }, [updateActivityState]);

  /**
   * Notify that voice is active
   */
  const notifyVoiceActive = useCallback((isActive: boolean) => {
    isVoiceActiveRef.current = isActive;
    updateActivityState();
  }, [updateActivityState]);

  /**
   * Notify that a message was submitted
   */
  const notifyMessageSubmitted = useCallback(() => {
    lastActivityTimestampRef.current = Date.now();
    // Save last activity to localStorage
    if (askKey) {
      saveLastActivity(askKey);
    }
    clearInactivityTimeout();
    setTimerState('running');
    // Start countdown since submit is a one-time event
    startInactivityCountdown();
  }, [clearInactivityTimeout, startInactivityCountdown, askKey]);

  /**
   * Manually start the timer
   */
  const start = useCallback(() => {
    setTimerState('running');
    lastActivityTimestampRef.current = Date.now();
    if (askKey) {
      saveLastActivity(askKey);
    }
    startInactivityCountdown();
  }, [startInactivityCountdown, askKey]);

  /**
   * Manually pause the timer
   */
  const pause = useCallback(() => {
    setTimerState('paused');
    clearInactivityTimeout();
    // Sync to server when manually pausing
    if (askKey) {
      syncToServer();
    }
  }, [clearInactivityTimeout, askKey, syncToServer]);

  /**
   * Reset the timer
   */
  const reset = useCallback(() => {
    setElapsedSeconds(0);
    setTimerState('running');
    lastActivityTimestampRef.current = Date.now();
    clearInactivityTimeout();
    startInactivityCountdown();
    // Clear localStorage and sync reset to server
    if (askKey) {
      saveToLocalStorage(askKey, 0);
      syncToServer();
    }
  }, [clearInactivityTimeout, startInactivityCountdown, askKey, syncToServer]);

  // Load from server on mount (async, detects resets)
  useEffect(() => {
    if (!askKey) return;

    let mounted = true;

    const loadServerValue = async () => {
      const serverData = await fetchFromServer(askKey, inviteToken);
      if (mounted && serverData !== null) {
        // Check if a timer reset occurred (e.g., after purge)
        const localResetAt = loadTimerResetFromLocalStorage(askKey);
        const serverResetAt = serverData.timerResetAt;

        // Detect if server has a newer reset timestamp
        const resetDetected = serverResetAt && (
          !localResetAt ||
          new Date(serverResetAt).getTime() > new Date(localResetAt).getTime()
        );

        if (resetDetected) {
          // A reset was triggered on the server - clear local cache and use server value
          console.log('[useSessionTimer] Timer reset detected, clearing localStorage');
          clearTimerFromLocalStorage(askKey);
          saveTimerResetToLocalStorage(askKey, serverResetAt);
          setElapsedSeconds(serverData.elapsedActiveSeconds);
          setStepElapsedSeconds(0);
          return;
        }

        // No reset - use the higher value between local and server
        setElapsedSeconds(prev => {
          const maxValue = Math.max(prev, serverData.elapsedActiveSeconds);
          // Update localStorage with the max value
          saveToLocalStorage(askKey, maxValue);
          return maxValue;
        });

        // Save the server's reset timestamp if we don't have one locally
        if (serverResetAt && !localResetAt) {
          saveTimerResetToLocalStorage(askKey, serverResetAt);
        }

        // Update step elapsed time if server returned it and matches current step
        if (
          typeof serverData.stepElapsedSeconds === 'number' &&
          serverData.currentStepId &&
          serverData.currentStepId === currentStepIdRef.current
        ) {
          setStepElapsedSeconds(prev => {
            const maxValue = Math.max(prev, serverData.stepElapsedSeconds!);
            // Update localStorage with the max value
            saveStepToLocalStorage(askKey, serverData.currentStepId!, maxValue);
            return maxValue;
          });
        }
      }
    };

    loadServerValue();

    return () => {
      mounted = false;
    };
  }, [askKey, inviteToken]);

  // Save to localStorage on every change
  useEffect(() => {
    if (askKey) {
      saveToLocalStorage(askKey, elapsedSeconds);
    }
  }, [askKey, elapsedSeconds]);

  // Periodic server sync
  useEffect(() => {
    if (!askKey) return;

    serverSyncIntervalRef.current = setInterval(() => {
      // Only sync if timer is running and there's been activity recently
      if (timerState === 'running') {
        syncToServer();
      }
    }, SERVER_SYNC_INTERVAL);

    return () => {
      if (serverSyncIntervalRef.current) {
        clearInterval(serverSyncIntervalRef.current);
        serverSyncIntervalRef.current = null;
      }
    };
  }, [askKey, timerState, syncToServer]);

  // Sync on unmount or page unload
  useEffect(() => {
    if (!askKey) return;

    const handleUnload = () => {
      // Use sendBeacon for reliable delivery on page unload
      if (navigator.sendBeacon) {
        const payload: Record<string, unknown> = {
          elapsedActiveSeconds: elapsedSecondsRef.current,
        };
        // Include step info if available
        if (currentStepIdRef.current) {
          payload.currentStepId = currentStepIdRef.current;
          payload.stepElapsedSeconds = stepElapsedSecondsRef.current;
        }
        const blob = new Blob(
          [JSON.stringify(payload)],
          { type: 'application/json' }
        );
        navigator.sendBeacon(`/api/ask/${askKey}/timer`, blob);
      }
    };

    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);

    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
      // Final sync on unmount
      syncToServer();
    };
  }, [askKey, syncToServer]);

  // Tick interval - increment elapsed time every second when running
  useEffect(() => {
    if (timerState === 'running') {
      tickIntervalRef.current = setInterval(() => {
        setElapsedSeconds(prev => prev + 1);
        // Also increment step timer if we have a current step
        if (currentStepIdRef.current) {
          setStepElapsedSeconds(prev => prev + 1);
        }
      }, 1000);
    } else {
      if (tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current);
        tickIntervalRef.current = null;
      }
    }

    return () => {
      if (tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current);
        tickIntervalRef.current = null;
      }
    };
  }, [timerState]);

  // Handle step change - reset step timer and load from localStorage/server
  useEffect(() => {
    if (currentStepId !== previousStepIdRef.current) {
      // Step changed - sync old step time first, then reset
      if (previousStepIdRef.current && askKey) {
        syncToServer();
      }

      // Update refs
      previousStepIdRef.current = currentStepId;
      currentStepIdRef.current = currentStepId;

      // Load step time from localStorage first
      if (askKey && currentStepId) {
        const storedStepTime = loadStepFromLocalStorage(askKey, currentStepId);

        // If localStorage has value, use it
        if (storedStepTime > 0) {
          setStepElapsedSeconds(storedStepTime);
        } else {
          // No localStorage value - try to load from server
          // This handles the case where user accesses from a different browser/session
          setStepElapsedSeconds(0); // Set to 0 immediately while we fetch

          fetchFromServer(askKey, inviteToken).then(serverData => {
            if (
              serverData &&
              typeof serverData.stepElapsedSeconds === 'number' &&
              serverData.currentStepId === currentStepId &&
              serverData.stepElapsedSeconds > 0
            ) {
              setStepElapsedSeconds(serverData.stepElapsedSeconds);
              saveStepToLocalStorage(askKey, currentStepId, serverData.stepElapsedSeconds);
            }
          });
        }
      } else {
        setStepElapsedSeconds(0);
      }
    }
  }, [currentStepId, askKey, inviteToken, syncToServer]);

  // Save step elapsed seconds to localStorage on every change
  useEffect(() => {
    if (askKey && currentStepId) {
      saveStepToLocalStorage(askKey, currentStepId, stepElapsedSeconds);
    }
  }, [askKey, currentStepId, stepElapsedSeconds]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearInactivityTimeout();
      if (tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current);
      }
      if (serverSyncIntervalRef.current) {
        clearInterval(serverSyncIntervalRef.current);
      }
    };
  }, [clearInactivityTimeout]);

  // Start inactivity countdown on mount
  useEffect(() => {
    startInactivityCountdown();
  }, [startInactivityCountdown]);

  // Calculate elapsed minutes with 1 decimal precision
  const elapsedMinutes = Math.round((elapsedSeconds / 60) * 10) / 10;
  const stepElapsedMinutes = Math.round((stepElapsedSeconds / 60) * 10) / 10;

  return {
    elapsedSeconds,
    elapsedMinutes,
    stepElapsedSeconds,
    stepElapsedMinutes,
    timerState,
    isPaused: timerState === 'paused',
    isSyncing,
    notifyAiStreaming,
    notifyUserTyping,
    notifyVoiceActive,
    notifyMessageSubmitted,
    start,
    pause,
    reset,
    syncToServer,
  };
}
