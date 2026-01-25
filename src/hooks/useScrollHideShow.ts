/**
 * useScrollHideShow - Hook to hide/show elements based on scroll direction
 *
 * Features:
 * - Hides elements immediately on scroll down
 * - Shows elements after scrolling up past a threshold
 * - Always shows elements at the top of the scroll area
 * - Prevents feedback loops during transitions
 * - Ignores tiny scroll changes to avoid jitter
 */

import { useCallback, useRef, useState } from 'react';

export interface ScrollHideShowConfig {
  /**
   * Scroll distance threshold to show elements when scrolling up (default: 100px)
   */
  showThreshold?: number;

  /**
   * Minimum scroll delta to trigger hide/show (default: 2px)
   * Prevents jitter from tiny scroll changes
   */
  minScrollDelta?: number;

  /**
   * Scroll position considered "at top" where elements always show (default: 10px)
   */
  topThreshold?: number;

  /**
   * Duration of transition animation in ms (default: 200ms)
   * Used to prevent feedback loops during transitions
   */
  transitionDuration?: number;
}

export interface ScrollHideShowState {
  /**
   * Whether the element should be hidden
   */
  isHidden: boolean;

  /**
   * Handler to be called on scroll events
   * @param scrollTop - Current scroll position
   * @param scrollDelta - Change in scroll position (positive = down, negative = up)
   */
  handleScroll: (scrollTop: number, scrollDelta: number) => void;

  /**
   * Reset to initial visible state
   */
  reset: () => void;
}

/**
 * Default configuration values
 */
const DEFAULT_SHOW_THRESHOLD = 100;
const DEFAULT_MIN_SCROLL_DELTA = 2;
const DEFAULT_TOP_THRESHOLD = 10;
const DEFAULT_TRANSITION_DURATION = 200;

// Disabled - too verbose, enable manually for debugging scroll issues
const DEBUG = false;

export function useScrollHideShow(
  config: ScrollHideShowConfig = {}
): ScrollHideShowState {
  const {
    showThreshold = DEFAULT_SHOW_THRESHOLD,
    minScrollDelta = DEFAULT_MIN_SCROLL_DELTA,
    topThreshold = DEFAULT_TOP_THRESHOLD,
    transitionDuration = DEFAULT_TRANSITION_DURATION,
  } = config;

  // State
  const [isHidden, setIsHidden] = useState(false);

  // Refs for tracking scroll accumulation and preventing feedback loops
  const scrollUpAccumulator = useRef(0);
  const isTransitioning = useRef(false);

  /**
   * Set hidden state with transition protection
   */
  const setHiddenWithTransition = useCallback((hidden: boolean) => {
    setIsHidden(prev => {
      if (prev !== hidden) {
        // Mark as transitioning and clear after animation completes
        isTransitioning.current = true;
        setTimeout(() => {
          isTransitioning.current = false;
        }, transitionDuration + 50); // Add buffer for safety
      }
      return hidden;
    });
  }, [transitionDuration]);

  /**
   * Handle scroll events
   */
  const handleScroll = useCallback((scrollTop: number, scrollDelta: number) => {
    // Debug logging (localhost only to avoid memory issues in production)
    if (DEBUG) console.log('[useScrollHideShow] scroll event:', { scrollTop, scrollDelta, isTransitioning: isTransitioning.current });

    // Ignore scroll events during transition to prevent feedback loop
    if (isTransitioning.current) {
      if (DEBUG) console.log('[useScrollHideShow] ignoring - transitioning');
      return;
    }

    // Ignore tiny scroll changes (less than threshold) to avoid jitter
    if (Math.abs(scrollDelta) < minScrollDelta && scrollDelta !== 0) {
      if (DEBUG) console.log('[useScrollHideShow] ignoring - tiny delta');
      return;
    }

    // Initial load: hide if already scrolled down
    if (scrollDelta === 0 && scrollTop > topThreshold * 5) {
      if (DEBUG) console.log('[useScrollHideShow] initial load - hiding');
      setHiddenWithTransition(true);
      return;
    }

    if (scrollDelta > 0) {
      // Scrolling down - hide immediately
      if (DEBUG) console.log('[useScrollHideShow] scrolling DOWN - hiding');
      setHiddenWithTransition(true);
      scrollUpAccumulator.current = 0;
    } else if (scrollDelta < 0) {
      // Scrolling up - accumulate scroll distance
      scrollUpAccumulator.current += Math.abs(scrollDelta);
      if (DEBUG) console.log('[useScrollHideShow] scrolling UP - accumulator:', scrollUpAccumulator.current);

      // Show after scrolling up past threshold
      if (scrollUpAccumulator.current >= showThreshold) {
        if (DEBUG) console.log('[useScrollHideShow] threshold reached - showing');
        setHiddenWithTransition(false);
      }
    }

    // If at the very top, always show
    if (scrollTop <= topThreshold) {
      if (DEBUG) console.log('[useScrollHideShow] at top - showing');
      setHiddenWithTransition(false);
      scrollUpAccumulator.current = 0;
    }
  }, [showThreshold, minScrollDelta, topThreshold, setHiddenWithTransition]);

  /**
   * Reset to initial visible state
   */
  const reset = useCallback(() => {
    setIsHidden(false);
    scrollUpAccumulator.current = 0;
    isTransitioning.current = false;
  }, []);

  return {
    isHidden,
    handleScroll,
    reset,
  };
}
