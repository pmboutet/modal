/**
 * @jest-environment node
 */
import { SegmentStore } from '../speechmatics-segment-store';

describe('SegmentStore', () => {
  let store: SegmentStore;

  beforeEach(() => {
    store = new SegmentStore();
  });

  describe('getFullTranscript with boundary deduplication', () => {
    it('should deduplicate overlapping phrases at segment boundaries', () => {
      // Scenario: User says "Je veux dire, c'est difficile"
      // Speechmatics sends two adjacent partials with overlapping content
      store.upsert({
        startTime: 0.0,
        endTime: 2.0,
        transcript: "je veux dire, c'est",
        isFinal: false,
        receivedAt: Date.now(),
      });

      store.upsert({
        startTime: 2.0,
        endTime: 3.5,
        transcript: "c'est difficile",
        isFinal: false,
        receivedAt: Date.now(),
      });

      // Should NOT produce "je veux dire, c'est c'est difficile"
      // Should produce "je veux dire, c'est difficile"
      const result = store.getFullTranscript();
      expect(result).toBe("je veux dire, c'est difficile");
    });

    it('should handle multiple word overlaps', () => {
      store.upsert({
        startTime: 0.0,
        endTime: 2.5,
        transcript: 'je pense que nous devons',
        isFinal: false,
        receivedAt: Date.now(),
      });

      store.upsert({
        startTime: 2.5,
        endTime: 5.0,
        transcript: 'nous devons faire attention',
        isFinal: false,
        receivedAt: Date.now(),
      });

      const result = store.getFullTranscript();
      expect(result).toBe('je pense que nous devons faire attention');
    });

    it('should not deduplicate single word matches (false positives)', () => {
      store.upsert({
        startTime: 0.0,
        endTime: 1.0,
        transcript: 'le chat',
        isFinal: false,
        receivedAt: Date.now(),
      });

      store.upsert({
        startTime: 1.0,
        endTime: 2.0,
        transcript: 'le chien',
        isFinal: false,
        receivedAt: Date.now(),
      });

      // Should NOT deduplicate "le" - single word overlap is too common
      const result = store.getFullTranscript();
      expect(result).toBe('le chat le chien');
    });

    it('should handle non-overlapping segments normally', () => {
      store.upsert({
        startTime: 0.0,
        endTime: 1.0,
        transcript: 'bonjour',
        isFinal: false,
        receivedAt: Date.now(),
      });

      store.upsert({
        startTime: 1.0,
        endTime: 2.0,
        transcript: 'comment allez-vous',
        isFinal: false,
        receivedAt: Date.now(),
      });

      const result = store.getFullTranscript();
      expect(result).toBe('bonjour comment allez-vous');
    });

    it('should handle the exact bug case: repeated filler phrase', () => {
      // This is the actual bug scenario reported
      // Note: Speechmatics typically sends the comma attached in the second segment
      store.upsert({
        startTime: 0.0,
        endTime: 1.5,
        transcript: 'je veux dire',
        isFinal: false,
        receivedAt: Date.now(),
      });

      store.upsert({
        startTime: 1.5,
        endTime: 3.0,
        transcript: 'je veux dire, c\'est important',
        isFinal: false,
        receivedAt: Date.now(),
      });

      // Should deduplicate "je veux dire" - we keep the first segment's content
      // and add only the non-overlapping part from the second segment
      // The comma is part of the overlapping phrase in segment 2, so it's not preserved
      const result = store.getFullTranscript();
      expect(result).toBe("je veux dire c'est important");
    });

    it('should preserve punctuation when first segment has it', () => {
      // When the first segment has the punctuation, it should be preserved
      store.upsert({
        startTime: 0.0,
        endTime: 1.5,
        transcript: 'je veux dire,',
        isFinal: false,
        receivedAt: Date.now(),
      });

      store.upsert({
        startTime: 1.5,
        endTime: 3.0,
        transcript: 'je veux dire, c\'est important',
        isFinal: false,
        receivedAt: Date.now(),
      });

      const result = store.getFullTranscript();
      expect(result).toBe("je veux dire, c'est important");
    });

    it('should handle punctuation differences in overlap detection', () => {
      store.upsert({
        startTime: 0.0,
        endTime: 2.0,
        transcript: 'oui, bien sûr,',
        isFinal: false,
        receivedAt: Date.now(),
      });

      store.upsert({
        startTime: 2.0,
        endTime: 4.0,
        transcript: 'bien sûr je comprends',
        isFinal: false,
        receivedAt: Date.now(),
      });

      const result = store.getFullTranscript();
      expect(result).toBe('oui, bien sûr, je comprends');
    });

    it('should work correctly with a single segment', () => {
      store.upsert({
        startTime: 0.0,
        endTime: 2.0,
        transcript: 'hello world',
        isFinal: false,
        receivedAt: Date.now(),
      });

      const result = store.getFullTranscript();
      expect(result).toBe('hello world');
    });

    it('should return empty string for empty store', () => {
      const result = store.getFullTranscript();
      expect(result).toBe('');
    });
  });

  describe('upsert and overlap removal for finals', () => {
    it('should remove overlapping partials when final arrives', () => {
      // Add a partial first
      store.upsert({
        startTime: 0.0,
        endTime: 2.0,
        transcript: 'partial content',
        isFinal: false,
        receivedAt: Date.now(),
      });

      expect(store.size()).toBe(1);

      // Add a final that overlaps
      store.upsert({
        startTime: 0.5,
        endTime: 2.5,
        transcript: 'final content',
        isFinal: true,
        receivedAt: Date.now(),
      });

      expect(store.size()).toBe(1);
      expect(store.getFullTranscript()).toBe('final content');
    });

    it('should not replace final with partial', () => {
      store.upsert({
        startTime: 0.0,
        endTime: 2.0,
        transcript: 'final content',
        isFinal: true,
        receivedAt: Date.now(),
      });

      store.upsert({
        startTime: 0.0,
        endTime: 2.0,
        transcript: 'partial trying to replace',
        isFinal: false,
        receivedAt: Date.now(),
      });

      expect(store.getFullTranscript()).toBe('final content');
    });
  });
});
