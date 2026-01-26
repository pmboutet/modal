/**
 * Speaker utilities for Speechmatics Voice Agent
 * Pure functions for speaker extraction and content analysis
 *
 * These functions are extracted from the main SpeechmaticsVoiceAgent class
 * to improve testability and maintainability. They have no side effects
 * and depend only on their inputs.
 */

import {
  SIGNIFICANT_NEW_WORDS_THRESHOLD,
  ECHO_DETECTION_CONTEXT_MESSAGES,
  ECHO_DETECTION_CONTEXT_LENGTH,
} from './speechmatics-constants';

// =============================================================================
// Types
// =============================================================================

/** Speechmatics result structure with speaker information */
export interface SpeechmaticsResult {
  alternatives?: Array<{ speaker?: string }>;
}

/** Conversation history message structure */
export interface ConversationMessage {
  role: 'user' | 'agent';
  content: string;
}

// =============================================================================
// Speaker Extraction
// =============================================================================

/**
 * Extract the dominant speaker from Speechmatics results array
 *
 * According to Speechmatics API docs, speaker is in alternatives[0].speaker (S1, S2, S3, UU for unknown).
 * This function counts speaker occurrences and returns the most frequently occurring speaker.
 *
 * @param results - Array of recognition results with speaker info from Speechmatics
 * @returns The most common speaker ID (e.g., "S1", "S2") or undefined if no valid speaker found
 *
 * @example
 * ```typescript
 * const results = [
 *   { alternatives: [{ speaker: 'S1' }] },
 *   { alternatives: [{ speaker: 'S1' }] },
 *   { alternatives: [{ speaker: 'S2' }] },
 * ];
 * extractDominantSpeaker(results); // Returns 'S1'
 * ```
 */
export function extractDominantSpeaker(
  results?: SpeechmaticsResult[]
): string | undefined {
  if (!results || !Array.isArray(results) || results.length === 0) {
    return undefined;
  }

  // Count speaker occurrences
  const speakerCounts: Record<string, number> = {};
  for (const result of results) {
    // Speaker is in alternatives[0].speaker according to Speechmatics API docs
    const speaker = result.alternatives?.[0]?.speaker;
    if (speaker && speaker !== 'UU') {
      // Skip unknown speakers for counting
      speakerCounts[speaker] = (speakerCounts[speaker] || 0) + 1;
    }
  }

  // Find the most frequent speaker
  let dominantSpeaker: string | undefined;
  let maxCount = 0;
  for (const [speaker, count] of Object.entries(speakerCounts)) {
    if (count > maxCount) {
      maxCount = count;
      dominantSpeaker = speaker;
    }
  }

  // If no dominant speaker found but we have results with UU, return UU
  if (
    !dominantSpeaker &&
    results.some((r) => r.alternatives?.[0]?.speaker === 'UU')
  ) {
    return 'UU';
  }

  return dominantSpeaker;
}

// =============================================================================
// Content Analysis
// =============================================================================

/**
 * Normalize text for content comparison
 *
 * Removes accents, punctuation, and extra whitespace for reliable comparison.
 * This is a helper function used by hasSignificantNewContent.
 *
 * @param text - The text to normalize
 * @returns Normalized lowercase text with no accents or punctuation
 */
function normalizeTextForComparison(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[.,!?;:'"«»\-–—…()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if new transcript contains significant new content beyond what was already sent
 *
 * Used to detect when user continues speaking after we started generating a response.
 * This enables the "abort-on-continue" feature that stops the AI response when
 * the user adds substantial new content.
 *
 * @param newTranscript - The new/updated transcript from speech recognition
 * @param sentMessage - The message that was already sent to the LLM
 * @returns true if the new transcript contains at least SIGNIFICANT_NEW_WORDS_THRESHOLD new words
 *
 * @example
 * ```typescript
 * hasSignificantNewContent("Hello how are you today", "Hello how are you");
 * // Returns true - "today" is new content
 *
 * hasSignificantNewContent("Hello", "Hello how are you");
 * // Returns false - new transcript is shorter
 * ```
 */
export function hasSignificantNewContent(
  newTranscript: string,
  sentMessage: string
): boolean {
  const normalizedNew = normalizeTextForComparison(newTranscript);
  const normalizedSent = normalizeTextForComparison(sentMessage);

  // If new is shorter or same length, likely just a variation/repetition
  if (normalizedNew.length <= normalizedSent.length) {
    return false;
  }

  // Check if new content starts with sent content (continuation)
  if (normalizedNew.startsWith(normalizedSent)) {
    // Calculate new words added
    const newPortion = normalizedNew.substring(normalizedSent.length).trim();
    const newWords = newPortion.split(/\s+/).filter((w) => w.length > 1);
    // Require at least SIGNIFICANT_NEW_WORDS_THRESHOLD new words to consider it significant continuation
    if (newWords.length >= SIGNIFICANT_NEW_WORDS_THRESHOLD) {
      return true;
    }
  }

  // Check word-based: count new words not in sent message
  const sentWords = new Set(
    normalizedSent.split(/\s+/).filter((w) => w.length > 1)
  );
  const newWords = normalizedNew.split(/\s+/).filter((w) => w.length > 1);
  const genuinelyNewWords = newWords.filter((w) => !sentWords.has(w));

  // If SIGNIFICANT_NEW_WORDS_THRESHOLD+ genuinely new words, user is continuing
  if (genuinelyNewWords.length >= SIGNIFICANT_NEW_WORDS_THRESHOLD) {
    return true;
  }

  return false;
}

// =============================================================================
// Conversation Context
// =============================================================================

/**
 * Get recent conversation context for echo detection
 *
 * Returns a condensed string of recent conversation for detecting when
 * the microphone picks up TTS playback (echo). The context is limited
 * to the last few messages and truncated to a maximum character length.
 *
 * @param history - Full conversation history array
 * @param sliceCount - Number of recent messages to include (default: ECHO_DETECTION_CONTEXT_MESSAGES)
 * @param maxChars - Maximum characters in output (default: ECHO_DETECTION_CONTEXT_LENGTH)
 * @returns Concatenated recent messages, space-separated, truncated from the start
 *
 * @example
 * ```typescript
 * const history = [
 *   { role: 'user', content: 'Hello' },
 *   { role: 'agent', content: 'Hi there! How can I help you today?' },
 *   { role: 'user', content: 'What time is it?' },
 * ];
 * getRecentConversationContext(history);
 * // Returns last 200 chars of "Hello Hi there! How can I help you today? What time is it?"
 * ```
 */
export function getRecentConversationContext(
  history: ConversationMessage[],
  sliceCount: number = ECHO_DETECTION_CONTEXT_MESSAGES,
  maxChars: number = ECHO_DETECTION_CONTEXT_LENGTH
): string {
  return history
    .slice(-sliceCount)
    .map((msg) => msg.content)
    .join(' ')
    .slice(-maxChars);
}
