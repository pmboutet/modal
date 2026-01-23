/**
 * SegmentStore - Timestamp-based transcript segment storage for Speechmatics
 *
 * This module provides a simple, deterministic approach to transcript deduplication
 * using the start_time/end_time timestamps provided by Speechmatics API.
 *
 * Key principle: A final transcript definitively replaces all partial transcripts
 * that overlap with its time range. No text-based heuristics needed.
 */

/**
 * A transcript segment with timing information from Speechmatics
 */
export interface TimestampedSegment {
  /** Start time in seconds from audio start */
  startTime: number;
  /** End time in seconds from audio start */
  endTime: number;
  /** The transcript text */
  transcript: string;
  /** True for AddTranscript (final), false for AddPartialTranscript */
  isFinal: boolean;
  /** Speaker identifier from diarization (S1, S2, UU) */
  speaker?: string;
  /** Timestamp when this segment was received (Date.now()) */
  receivedAt: number;
}

/**
 * SegmentStore manages transcript segments using timestamp-based deduplication.
 *
 * The deduplication logic is simple and deterministic:
 * 1. When a partial arrives: store it, replacing any existing partial with same time range
 * 2. When a final arrives: remove all partials that overlap with its time range, then store it
 * 3. Finals are authoritative and never replaced by partials
 *
 * This replaces ~235 lines of complex text-based heuristics with ~100 lines of
 * simple timestamp logic.
 */
export class SegmentStore {
  private segments: Map<string, TimestampedSegment> = new Map();

  /**
   * Generate a unique key for a segment based on its time range
   */
  private getKey(startTime: number, endTime: number): string {
    // Use fixed precision to avoid floating point comparison issues
    return `${startTime.toFixed(3)}-${endTime.toFixed(3)}`;
  }

  /**
   * Check if two time ranges overlap
   * Two ranges overlap if one starts before the other ends
   */
  private overlaps(
    aStart: number,
    aEnd: number,
    bStart: number,
    bEnd: number
  ): boolean {
    return aStart < bEnd && bStart < aEnd;
  }

  /**
   * Add or update a segment in the store
   *
   * For finals: removes all overlapping partials first (finals are authoritative)
   * For partials: only replaces existing partials with same time range
   */
  upsert(segment: TimestampedSegment): void {
    const { startTime, endTime, isFinal } = segment;

    // Validate time range
    if (startTime < 0 || endTime < 0 || endTime < startTime) {
      return; // Invalid time range, skip
    }

    // If this is a final transcript, remove all overlapping partials
    if (isFinal) {
      this.removeOverlapping(startTime, endTime, true);
    }

    // Check if there's already a final for this exact range
    const key = this.getKey(startTime, endTime);
    const existing = this.segments.get(key);

    // Don't replace a final with a partial
    if (existing?.isFinal && !isFinal) {
      return;
    }

    // Store the segment
    this.segments.set(key, segment);
  }

  /**
   * Remove segments that overlap with the given time range
   *
   * @param startTime - Start of the range
   * @param endTime - End of the range
   * @param onlyPartials - If true, only remove partials (preserve finals)
   */
  private removeOverlapping(
    startTime: number,
    endTime: number,
    onlyPartials: boolean
  ): void {
    const keysToRemove: string[] = [];

    for (const [key, seg] of this.segments) {
      if (this.overlaps(seg.startTime, seg.endTime, startTime, endTime)) {
        if (!onlyPartials || !seg.isFinal) {
          keysToRemove.push(key);
        }
      }
    }

    for (const key of keysToRemove) {
      this.segments.delete(key);
    }
  }

  /**
   * Get the full transcript by concatenating all segments in time order
   * Performs boundary deduplication to prevent repeated phrases at segment joins
   */
  getFullTranscript(): string {
    if (this.segments.size === 0) {
      return '';
    }

    const sortedSegments = [...this.segments.values()]
      .sort((a, b) => a.startTime - b.startTime);

    if (sortedSegments.length === 1) {
      return sortedSegments[0].transcript.trim();
    }

    // Join segments with boundary deduplication
    let result = sortedSegments[0].transcript.trim();

    for (let i = 1; i < sortedSegments.length; i++) {
      const currentTranscript = sortedSegments[i].transcript.trim();
      if (!currentTranscript) continue;

      // Find how many words to skip from the current transcript
      const wordsToSkip = this.findOverlapWordCount(result, currentTranscript);

      if (wordsToSkip > 0) {
        // Skip the overlapping words from the current transcript
        const words = currentTranscript.split(/\s+/);
        const remainingWords = words.slice(wordsToSkip);
        if (remainingWords.length > 0) {
          result += ' ' + remainingWords.join(' ');
        }
      } else {
        result += ' ' + currentTranscript;
      }
    }

    return result.replace(/\s+/g, ' ').trim();
  }

  /**
   * Find the number of words to skip from `current` that overlap with the end of `previous`
   * Compares normalized words (lowercase, stripped punctuation) to detect duplicates
   */
  private findOverlapWordCount(previous: string, current: string): number {
    // Normalize and split into words
    const normalizeWord = (w: string) =>
      w.toLowerCase().replace(/[.,!?;:'"«»\-–—…()[\]{}]/g, '');

    const prevWords = previous.trim().split(/\s+/).map(normalizeWord);
    const currWords = current.trim().split(/\s+/).map(normalizeWord);

    // Try to find the longest suffix of previous that matches a prefix of current
    // Start from longer overlaps to shorter ones
    const maxOverlapWords = Math.min(prevWords.length, currWords.length, 6);

    for (let numWords = maxOverlapWords; numWords >= 1; numWords--) {
      const suffix = prevWords.slice(-numWords);
      const prefix = currWords.slice(0, numWords);

      // Check if they match
      let matches = true;
      for (let j = 0; j < numWords; j++) {
        if (suffix[j] !== prefix[j]) {
          matches = false;
          break;
        }
      }

      if (matches) {
        // For single-word overlap, require the word to be "substantial" (>= 4 chars)
        // This avoids false positives on very common short words
        // But allows "c'est" (5 chars after stripping apostrophe)
        if (numWords === 1) {
          const word = suffix[0];
          if (word.length < 4) {
            continue; // Skip single short word matches
          }
        }

        return numWords;
      }
    }

    return 0;
  }

  /**
   * Get the most recent speaker from the segments
   */
  getLatestSpeaker(): string | undefined {
    if (this.segments.size === 0) {
      return undefined;
    }

    // Get the segment with the latest end time that has a speaker
    let latestSpeaker: string | undefined;
    let latestEndTime = -1;

    for (const seg of this.segments.values()) {
      if (seg.speaker && seg.endTime > latestEndTime) {
        latestEndTime = seg.endTime;
        latestSpeaker = seg.speaker;
      }
    }

    return latestSpeaker;
  }

  /**
   * Check if store has any segments
   */
  hasSegments(): boolean {
    return this.segments.size > 0;
  }

  /**
   * Get the number of segments in the store
   */
  size(): number {
    return this.segments.size;
  }

  /**
   * Get all segments ordered by start time
   */
  getAllOrdered(): TimestampedSegment[] {
    return [...this.segments.values()].sort((a, b) => a.startTime - b.startTime);
  }

  /**
   * Get the latest end time across all segments
   * Returns 0 if no segments exist
   */
  getLatestEndTime(): number {
    let maxEndTime = 0;
    for (const seg of this.segments.values()) {
      if (seg.endTime > maxEndTime) {
        maxEndTime = seg.endTime;
      }
    }
    return maxEndTime;
  }

  /**
   * Clear all segments from the store
   */
  clear(): void {
    this.segments.clear();
  }

  /**
   * Remove segments older than the given time threshold
   * Useful for cleaning up stale segments after long pauses
   *
   * @param maxAgeMs - Maximum age in milliseconds
   */
  removeStale(maxAgeMs: number): void {
    const now = Date.now();
    const keysToRemove: string[] = [];

    for (const [key, seg] of this.segments) {
      if (now - seg.receivedAt > maxAgeMs) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      this.segments.delete(key);
    }
  }
}
