/**
 * useConsultantAnalysis - Hook for AI-assisted consultant analysis
 *
 * Periodically analyzes the conversation and suggests questions to the consultant.
 * Triggers analysis every 10 seconds OR on speaker change (whichever comes first).
 *
 * Features:
 * - Automatic periodic analysis (configurable interval, default 10s)
 * - Speaker change detection triggers immediate analysis
 * - Debouncing to prevent excessive API calls
 * - Error handling with retry logic
 * - Step completion detection and callback
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type { SuggestedQuestion, Insight } from '@/types';

/**
 * Analysis interval in milliseconds (10 seconds)
 */
const DEFAULT_ANALYSIS_INTERVAL = 10000;

/**
 * Minimum time between analyses (debounce)
 */
const MIN_ANALYSIS_GAP = 3000;

/**
 * Retry delay after error
 */
const ERROR_RETRY_DELAY = 5000;

export interface ConsultantAnalysisConfig {
  /**
   * ASK key for the session
   */
  askKey: string;

  /**
   * Whether the session is in consultant mode
   */
  enabled?: boolean;

  /**
   * Analysis interval in milliseconds (default: 10000)
   */
  analysisInterval?: number;

  /**
   * Current message count - analysis only runs when this changes
   */
  messageCount?: number;

  /**
   * Invite token for authenticated API calls
   */
  inviteToken?: string | null;

  /**
   * Callback when questions are updated
   */
  onQuestionsUpdate?: (questions: SuggestedQuestion[]) => void;

  /**
   * Callback when insights are updated
   */
  onInsightsUpdate?: (insights: Insight[]) => void;

  /**
   * Callback when a step is automatically completed
   */
  onStepCompleted?: (stepId: string) => void;

  /**
   * Callback when analysis starts/ends (for loading indicators)
   */
  onAnalyzing?: (isAnalyzing: boolean) => void;
}

export interface ConsultantAnalysisState {
  /**
   * Current suggested questions
   */
  questions: SuggestedQuestion[];

  /**
   * Current detected insights
   */
  insights: Insight[];

  /**
   * Whether an analysis is currently running
   */
  isAnalyzing: boolean;

  /**
   * Last error message (null if no error)
   */
  error: string | null;

  /**
   * Notify that a speaker change occurred (triggers immediate analysis)
   */
  notifySpeakerChange: (speaker: string) => void;

  /**
   * Trigger an immediate analysis
   */
  triggerAnalysis: () => Promise<void>;

  /**
   * Pause automatic analysis
   */
  pause: () => void;

  /**
   * Resume automatic analysis
   */
  resume: () => void;

  /**
   * Whether automatic analysis is paused
   */
  isPaused: boolean;
}

/**
 * Call the consultant-analyze endpoint
 */
async function analyzeConversation(
  askKey: string,
  inviteToken?: string | null
): Promise<{ questions: SuggestedQuestion[]; insights: Insight[]; stepCompleted?: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (inviteToken) {
    headers['X-Invite-Token'] = inviteToken;
  }

  const response = await fetch(`/api/ask/${askKey}/consultant-analyze`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Analysis failed: ${response.status}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || 'Analysis failed');
  }

  return result.data;
}

export function useConsultantAnalysis(config: ConsultantAnalysisConfig): ConsultantAnalysisState {
  const {
    askKey,
    enabled = true,
    analysisInterval = DEFAULT_ANALYSIS_INTERVAL,
    messageCount = 0,
    inviteToken,
    onQuestionsUpdate,
    onInsightsUpdate,
    onStepCompleted,
    onAnalyzing,
  } = config;

  // State
  const [questions, setQuestions] = useState<SuggestedQuestion[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  // Refs for tracking
  const lastAnalysisTimeRef = useRef<number>(0);
  const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pendingAnalysisRef = useRef<boolean>(false);
  const lastSpeakerRef = useRef<string | null>(null);
  const isAnalyzingRef = useRef(false);
  const mountedRef = useRef(true);
  const lastAnalyzedMessageCountRef = useRef<number>(0);
  const performAnalysisRef = useRef<() => Promise<void>>(() => Promise.resolve());
  // BUG-020 FIX: Use ref to track isPaused state to avoid stale closure in interval callback
  const isPausedRef = useRef(isPaused);

  /**
   * Perform the analysis
   */
  const performAnalysis = useCallback(async () => {
    // Skip if askKey is not set (can happen during initial load)
    if (!askKey) {
      return;
    }

    // Skip if no new messages since last analysis
    if (messageCount <= lastAnalyzedMessageCountRef.current) {
      return;
    }

    // Prevent concurrent analyses
    if (isAnalyzingRef.current) {
      pendingAnalysisRef.current = true;
      return;
    }

    // Check minimum gap between analyses
    const now = Date.now();
    const timeSinceLastAnalysis = now - lastAnalysisTimeRef.current;
    if (timeSinceLastAnalysis < MIN_ANALYSIS_GAP) {
      // Schedule for later
      pendingAnalysisRef.current = true;
      return;
    }

    isAnalyzingRef.current = true;
    setIsAnalyzing(true);
    onAnalyzing?.(true);

    // Track the message count we're analyzing
    const analyzingMessageCount = messageCount;

    try {
      const result = await analyzeConversation(askKey, inviteToken);

      if (!mountedRef.current) return;

      lastAnalysisTimeRef.current = Date.now();
      lastAnalyzedMessageCountRef.current = analyzingMessageCount;
      setError(null);

      // Update questions if we got new ones
      if (result.questions && result.questions.length > 0) {
        setQuestions(result.questions);
        onQuestionsUpdate?.(result.questions);
      }

      // Update insights if we got new ones
      if (result.insights && result.insights.length > 0) {
        setInsights(result.insights);
        onInsightsUpdate?.(result.insights);
      }

      // Handle step completion
      if (result.stepCompleted) {
        onStepCompleted?.(result.stepCompleted);
      }
    } catch (err) {
      if (!mountedRef.current) return;

      const errorMessage = err instanceof Error ? err.message : 'Analysis failed';
      setError(errorMessage);
      console.error('[useConsultantAnalysis] API Error:', errorMessage, err);
    } finally {
      if (mountedRef.current) {
        isAnalyzingRef.current = false;
        setIsAnalyzing(false);
        onAnalyzing?.(false);

        // If there was a pending analysis request, schedule it
        if (pendingAnalysisRef.current) {
          pendingAnalysisRef.current = false;
          const remainingGap = MIN_ANALYSIS_GAP - (Date.now() - lastAnalysisTimeRef.current);
          if (remainingGap > 0) {
            setTimeout(() => {
              if (mountedRef.current && !isPaused) {
                performAnalysis();
              }
            }, remainingGap);
          } else {
            performAnalysis();
          }
        }
      }
    }
  }, [askKey, inviteToken, isPaused, messageCount, onQuestionsUpdate, onInsightsUpdate, onStepCompleted, onAnalyzing]);

  // Keep ref updated with latest performAnalysis (avoids stale closure in interval)
  useEffect(() => {
    performAnalysisRef.current = performAnalysis;
  }, [performAnalysis]);

  // BUG-020 FIX: Keep isPausedRef in sync with isPaused state
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  /**
   * Notify speaker change - triggers immediate analysis
   */
  const notifySpeakerChange = useCallback((speaker: string) => {
    if (!enabled || isPaused) return;

    // Only trigger if speaker actually changed
    if (speaker !== lastSpeakerRef.current) {
      lastSpeakerRef.current = speaker;
      // BUG-021 FIX: Check if analysis is already running to prevent race condition
      // with multiple concurrent API calls when rapid speaker changes occur
      if (!isAnalyzingRef.current) {
        performAnalysis();
      } else {
        // Mark as pending so it runs after current analysis completes
        pendingAnalysisRef.current = true;
      }
    }
  }, [enabled, isPaused, performAnalysis]);

  /**
   * Trigger manual analysis
   */
  const triggerAnalysis = useCallback(async () => {
    if (!enabled) return;
    await performAnalysis();
  }, [enabled, performAnalysis]);

  /**
   * Pause automatic analysis
   */
  const pause = useCallback(() => {
    setIsPaused(true);
    if (analysisIntervalRef.current) {
      clearInterval(analysisIntervalRef.current);
      analysisIntervalRef.current = null;
    }
  }, []);

  /**
   * Resume automatic analysis
   */
  const resume = useCallback(() => {
    setIsPaused(false);
  }, []);

  // Set up periodic analysis (uses ref to avoid recreating interval on every messageCount change)
  useEffect(() => {
    if (!enabled || isPaused) {
      if (analysisIntervalRef.current) {
        clearInterval(analysisIntervalRef.current);
        analysisIntervalRef.current = null;
      }
      return;
    }

    // Start periodic analysis
    // BUG-020 FIX: Use isPausedRef.current instead of isPaused to avoid stale closure
    analysisIntervalRef.current = setInterval(() => {
      if (mountedRef.current && !isPausedRef.current) {
        performAnalysisRef.current();
      }
    }, analysisInterval);

    // Trigger initial analysis after a short delay (let the conversation load first)
    // BUG-020 FIX: Use isPausedRef.current instead of isPaused to avoid stale closure
    const initialTimeout = setTimeout(() => {
      if (mountedRef.current && !isPausedRef.current) {
        performAnalysisRef.current();
      }
    }, 2000);

    return () => {
      if (analysisIntervalRef.current) {
        clearInterval(analysisIntervalRef.current);
        analysisIntervalRef.current = null;
      }
      clearTimeout(initialTimeout);
    };
  }, [enabled, isPaused, analysisInterval]); // Removed performAnalysis - using ref instead

  // Track mount state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    questions,
    insights,
    isAnalyzing,
    error,
    notifySpeakerChange,
    triggerAnalysis,
    pause,
    resume,
    isPaused,
  };
}
