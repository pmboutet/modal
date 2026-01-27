/**
 * Echo Detection Utilities for Speechmatics
 *
 * SIMPLIFIED: Echo detection is now based on speaker identity.
 * This module only provides text normalization and a simple heuristic
 * to determine the popup mode (echo vs new-participant).
 */

/**
 * Normalize text for comparison
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

/**
 * Simple heuristic to check if a transcript looks like recent AI speech.
 * Used to pre-select the popup mode ("echo" vs "new-participant").
 * This does NOT auto-discard - the user always makes the final decision.
 *
 * @param transcript - The unknown speaker's transcript
 * @param recentAgentSpeech - Recent AI speech to compare against
 * @param threshold - Word overlap threshold (default 0.5 = 50%)
 * @returns true if transcript likely matches AI speech
 */
export function isLikelyEcho(
  transcript: string,
  recentAgentSpeech: string,
  threshold: number = 0.5
): boolean {
  if (!transcript?.trim() || !recentAgentSpeech?.trim()) {
    return false;
  }

  const normalizedTranscript = normalizeForEchoDetection(transcript);
  const normalizedAgent = normalizeForEchoDetection(recentAgentSpeech);

  // Get significant words (length > 2)
  const transcriptWords = normalizedTranscript.split(/\s+/).filter(w => w.length > 2);
  const agentWords = new Set(normalizedAgent.split(/\s+/).filter(w => w.length > 2));

  if (transcriptWords.length < 3 || agentWords.size === 0) {
    return false;
  }

  // Count matching words
  let matchedWords = 0;
  for (const word of transcriptWords) {
    if (agentWords.has(word)) {
      matchedWords++;
    }
  }

  const similarity = matchedWords / transcriptWords.length;
  return similarity >= threshold;
}
