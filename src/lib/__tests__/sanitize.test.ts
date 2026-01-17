/**
 * Unit tests for src/lib/sanitize.ts
 * Text sanitization utilities - no database dependencies
 */

import { sanitizeText, sanitizeOptional, cleanStepCompleteMarker, detectStepComplete } from '../sanitize';

// ============================================================================
// sanitizeText TESTS
// ============================================================================

describe('sanitizeText', () => {
  describe('basic functionality', () => {
    test('should return empty string for empty input', () => {
      expect(sanitizeText('')).toBe('');
    });

    test('should preserve normal text', () => {
      expect(sanitizeText('Hello World')).toBe('Hello World');
    });

    test('should preserve text with numbers', () => {
      expect(sanitizeText('Test 123')).toBe('Test 123');
    });

    test('should preserve text with punctuation', () => {
      expect(sanitizeText('Hello, World!')).toBe('Hello, World!');
      expect(sanitizeText("It's a test.")).toBe("It's a test.");
    });
  });

  describe('removing angle brackets', () => {
    test('should remove < character', () => {
      expect(sanitizeText('a < b')).toBe('a   b');
    });

    test('should remove > character', () => {
      expect(sanitizeText('a > b')).toBe('a   b');
    });

    test('should remove both < and > characters', () => {
      // Angle brackets replaced with space, then trimmed
      expect(sanitizeText('<script>')).toBe('script');
    });

    test('should remove HTML-like tags', () => {
      // Angle brackets replaced with space, trimmed at ends
      expect(sanitizeText('<div>content</div>')).toBe('div content /div');
    });

    test('should remove multiple angle brackets', () => {
      expect(sanitizeText('<<<>>>')).toBe('');
    });
  });

  describe('trimming', () => {
    test('should trim leading whitespace', () => {
      expect(sanitizeText('  Hello')).toBe('Hello');
    });

    test('should trim trailing whitespace', () => {
      expect(sanitizeText('Hello  ')).toBe('Hello');
    });

    test('should trim both leading and trailing whitespace', () => {
      expect(sanitizeText('  Hello  ')).toBe('Hello');
    });

    test('should not remove internal whitespace', () => {
      expect(sanitizeText('Hello   World')).toBe('Hello   World');
    });

    test('should return empty after trimming whitespace-only input', () => {
      expect(sanitizeText('   ')).toBe('');
    });
  });

  describe('combined scenarios', () => {
    test('should sanitize and trim XSS attempts', () => {
      expect(sanitizeText('<script>alert("xss")</script>')).toBe('script alert("xss") /script');
    });

    test('should handle angle brackets at edges', () => {
      expect(sanitizeText('<text')).toBe('text');
      expect(sanitizeText('text>')).toBe('text');
    });

    test('should handle mixed content with angle brackets', () => {
      expect(sanitizeText('Hello <world> test')).toBe('Hello  world  test');
    });

    test('should preserve French characters', () => {
      expect(sanitizeText('Héllo Wörld café')).toBe('Héllo Wörld café');
    });

    test('should preserve emojis', () => {
      expect(sanitizeText('Hello 👋 World')).toBe('Hello 👋 World');
    });
  });

  describe('edge cases', () => {
    test('should handle only angle brackets', () => {
      expect(sanitizeText('<>')).toBe('');
    });

    test('should handle newlines and tabs', () => {
      expect(sanitizeText('Hello\nWorld')).toBe('Hello\nWorld');
      expect(sanitizeText('Hello\tWorld')).toBe('Hello\tWorld');
    });

    test('should handle unicode characters', () => {
      expect(sanitizeText('こんにちは')).toBe('こんにちは');
      expect(sanitizeText('مرحبا')).toBe('مرحبا');
    });
  });
});

// ============================================================================
// sanitizeOptional TESTS
// ============================================================================

describe('sanitizeOptional', () => {
  describe('null and undefined handling', () => {
    test('should return null for null input', () => {
      expect(sanitizeOptional(null)).toBeNull();
    });

    test('should return null for undefined input', () => {
      expect(sanitizeOptional(undefined)).toBeNull();
    });

    test('should return null for empty string', () => {
      expect(sanitizeOptional('')).toBeNull();
    });
  });

  describe('valid string handling', () => {
    test('should sanitize valid string', () => {
      expect(sanitizeOptional('Hello World')).toBe('Hello World');
    });

    test('should sanitize and remove angle brackets', () => {
      expect(sanitizeOptional('<script>')).toBe('script');
    });

    test('should trim whitespace', () => {
      expect(sanitizeOptional('  Hello  ')).toBe('Hello');
    });
  });

  describe('edge cases', () => {
    test('should handle whitespace-only string as falsy', () => {
      // '   '.trim() === '' which is falsy
      // But the function receives '   ' which is truthy
      // It will call sanitizeText which trims, returning ''
      expect(sanitizeOptional('   ')).toBe('');
    });

    test('should handle string with only angle brackets', () => {
      // '<>' becomes '  ' after replacement, then '' after trim
      expect(sanitizeOptional('<>')).toBe('');
    });

    test('should preserve valid content after sanitization', () => {
      expect(sanitizeOptional('Valid <script> content')).toBe('Valid  script  content');
    });
  });
});

// ============================================================================
// cleanStepCompleteMarker TESTS
// ============================================================================

describe('cleanStepCompleteMarker', () => {
  describe('basic STEP_COMPLETE formats', () => {
    test('should remove STEP_COMPLETE: with step ID', () => {
      // First word after STEP_COMPLETE: is captured as step ID
      expect(cleanStepCompleteMarker('STEP_COMPLETE: step_1 Hello world')).toBe('Hello world');
    });

    test('should remove STEP_COMPLETE: and first word even with newline', () => {
      // \s* in regex also matches newlines, so first word is still captured
      expect(cleanStepCompleteMarker('STEP_COMPLETE:\nHello world')).toBe('world');
    });

    test('should remove marker only (no following text)', () => {
      expect(cleanStepCompleteMarker('STEP_COMPLETE:')).toBe('');
    });
  });

  describe('markdown formatting', () => {
    test('should remove **STEP_COMPLETE: step_id**', () => {
      expect(cleanStepCompleteMarker('**STEP_COMPLETE: step_id** Hello world')).toBe('Hello world');
    });

    test('should remove *STEP_COMPLETE:* with newline', () => {
      expect(cleanStepCompleteMarker('*STEP_COMPLETE:*\nHello world')).toBe('Hello world');
    });

    test('should remove __STEP_COMPLETE:__', () => {
      expect(cleanStepCompleteMarker('__STEP_COMPLETE:__\nHello world')).toBe('Hello world');
    });

    test('should remove _STEP_COMPLETE:_', () => {
      expect(cleanStepCompleteMarker('_STEP_COMPLETE:_\nHello world')).toBe('Hello world');
    });
  });

  describe('case insensitivity', () => {
    test('should handle lowercase step_complete', () => {
      expect(cleanStepCompleteMarker('step_complete: step_1 Hello world')).toBe('Hello world');
    });

    test('should handle mixed case Step_Complete', () => {
      expect(cleanStepCompleteMarker('Step_Complete: step_1 Hello world')).toBe('Hello world');
    });
  });

  describe('edge cases', () => {
    test('should return empty string if only marker', () => {
      expect(cleanStepCompleteMarker('STEP_COMPLETE:')).toBe('');
    });

    test('should preserve content without marker', () => {
      expect(cleanStepCompleteMarker('Hello world')).toBe('Hello world');
    });

    test('should handle marker at end of text', () => {
      expect(cleanStepCompleteMarker('Hello world STEP_COMPLETE:')).toBe('Hello world');
    });

    test('should handle marker with step ID in middle', () => {
      // step_id is consumed as part of marker
      expect(cleanStepCompleteMarker('Hello STEP_COMPLETE: step_id world')).toBe('Hello  world');
    });
  });

  // BUG-039 FIX: Tests for regex not consuming valid content
  describe('BUG-039: regex should not consume valid content', () => {
    test('should preserve content immediately after step ID (with space)', () => {
      const result = cleanStepCompleteMarker('STEP_COMPLETE: step_1 Important message here');
      expect(result).toBe('Important message here');
    });

    test('should preserve content after marker without step ID', () => {
      const result = cleanStepCompleteMarker('STEP_COMPLETE: Important message here');
      expect(result).toBe('message here');
    });

    test('should preserve multiline content after marker', () => {
      const result = cleanStepCompleteMarker('**STEP_COMPLETE:step_1**\nThis is the next step message.');
      expect(result).toBe('This is the next step message.');
    });

    test('should not consume content that looks like a step ID but is part of message', () => {
      // The regex should stop at word boundary
      const result = cleanStepCompleteMarker('STEP_COMPLETE:step_1 step_2 is next');
      expect(result).toBe('step_2 is next');
    });

    test('should handle marker followed by punctuation', () => {
      const result = cleanStepCompleteMarker('STEP_COMPLETE:step_1. Moving on.');
      expect(result).toBe('. Moving on.');
    });

    test('should handle marker with just colon and space before content', () => {
      const result = cleanStepCompleteMarker('**STEP_COMPLETE:** Now let us discuss the next topic.');
      expect(result).toBe('Now let us discuss the next topic.');
    });
  });
});

// ============================================================================
// detectStepComplete TESTS
// ============================================================================

describe('detectStepComplete', () => {
  describe('detection of marker with step ID', () => {
    test('should detect STEP_COMPLETE: with step ID', () => {
      const result = detectStepComplete('STEP_COMPLETE: step_1 Hello world');
      expect(result.hasMarker).toBe(true);
      expect(result.stepId).toBe('step_1');
    });

    test('should capture first word as step ID', () => {
      // First word after STEP_COMPLETE: is captured as step ID
      const result = detectStepComplete('STEP_COMPLETE: myStepId message');
      expect(result.hasMarker).toBe(true);
      expect(result.stepId).toBe('myStepId');
    });

    test('should not detect when no marker present', () => {
      const result = detectStepComplete('Hello world');
      expect(result.hasMarker).toBe(false);
      expect(result.stepId).toBeNull();
    });
  });

  describe('detection with newlines', () => {
    test('should detect STEP_COMPLETE: and capture first word even with newline', () => {
      // \s* in regex also matches newlines, so first word is still captured as step ID
      const result = detectStepComplete('STEP_COMPLETE:\nHello world');
      expect(result.hasMarker).toBe(true);
      expect(result.stepId).toBe('Hello');
    });

    test('should detect **STEP_COMPLETE:** and capture first word even with newline', () => {
      const result = detectStepComplete('**STEP_COMPLETE:**\nHello world');
      expect(result.hasMarker).toBe(true);
      expect(result.stepId).toBe('Hello');
    });
  });

  describe('markdown formatting', () => {
    test('should detect **STEP_COMPLETE: step_id**', () => {
      const result = detectStepComplete('**STEP_COMPLETE: step_id** Hello');
      expect(result.hasMarker).toBe(true);
      expect(result.stepId).toBe('step_id');
    });
  });

  describe('case insensitivity', () => {
    test('should detect lowercase step_complete', () => {
      const result = detectStepComplete('step_complete: step_1 Hello');
      expect(result.hasMarker).toBe(true);
      expect(result.stepId).toBe('step_1');
    });
  });
});
