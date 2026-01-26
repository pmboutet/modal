/**
 * Echo Detection Utilities for Speechmatics
 * Detects if transcript is likely an echo of assistant's speech
 */

/**
 * Echo detection result
 */
export interface EchoDetectionResult {
  isEcho: boolean;
  similarity: number;
  matchType: 'contained' | 'fuzzy-words' | 'speaker-mismatch' | 'none';
}

/**
 * Detect if transcript is likely an echo of assistant's speech
 * Uses multiple detection strategies: containment, fuzzy matching, and sliding window
 */
export function detectLocalEcho(
  transcript: string,
  assistantSpeech: string,
  suspiciousSpeaker: boolean = false
): EchoDetectionResult {
  const normalizedTranscript = normalizeForEchoDetection(transcript);
  const normalizedAssistant = normalizeForEchoDetection(assistantSpeech);

  // Check 1: Direct containment
  if (normalizedAssistant.includes(normalizedTranscript)) {
    return { isEcho: true, similarity: 1.0, matchType: 'contained' };
  }

  // Check 2: Fuzzy word-based matching
  const transcriptWords = normalizedTranscript.split(/\s+/).filter(w => w.length > 2);
  const assistantWords = new Set(normalizedAssistant.split(/\s+/).filter(w => w.length > 2));

  if (transcriptWords.length === 0) {
    return { isEcho: false, similarity: 0, matchType: 'none' };
  }

  let matchedWords = 0;
  for (const word of transcriptWords) {
    if (assistantWords.has(word)) {
      matchedWords++;
    }
  }

  const similarity = matchedWords / transcriptWords.length;
  const fuzzyThreshold = suspiciousSpeaker ? 0.25 : 0.4;

  if (similarity >= fuzzyThreshold) {
    return {
      isEcho: true,
      similarity,
      matchType: suspiciousSpeaker ? 'speaker-mismatch' : 'fuzzy-words'
    };
  }

  // Check 3: Sliding window for consecutive word sequences
  const slidingResult = checkSlidingWindow(transcriptWords, normalizedAssistant, suspiciousSpeaker);
  if (slidingResult) {
    return slidingResult;
  }

  return { isEcho: false, similarity, matchType: 'none' };
}

/**
 * Check for consecutive word sequences that match (sliding window)
 */
function checkSlidingWindow(
  transcriptWords: string[],
  normalizedAssistant: string,
  suspiciousSpeaker: boolean
): EchoDetectionResult | null {
  const maxWindowSize = Math.min(7, Math.floor(transcriptWords.length / 2));
  const minWindowSize = 2;

  for (let windowSize = maxWindowSize; windowSize >= minWindowSize; windowSize--) {
    if (windowSize > transcriptWords.length) continue;

    for (let i = 0; i <= transcriptWords.length - windowSize; i++) {
      const windowPhrase = transcriptWords.slice(i, i + windowSize).join(' ');
      if (normalizedAssistant.includes(windowPhrase)) {
        const windowConfidence = 0.5 + (windowSize * 0.1);
        return {
          isEcho: true,
          similarity: Math.min(1.0, windowConfidence),
          matchType: suspiciousSpeaker ? 'speaker-mismatch' : 'fuzzy-words'
        };
      }
    }
  }

  return null;
}

/**
 * Normalize text for echo detection comparison
 * Removes accents, punctuation, and normalizes whitespace
 */
export function normalizeForEchoDetection(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    // Comprehensive hyphen/dash normalization
    .replace(/[\u002D\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, ' ')
    .replace(/[.,!?;:'"«»…()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
