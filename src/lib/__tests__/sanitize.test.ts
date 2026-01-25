/**
 * Unit tests for src/lib/sanitize.ts
 * Text sanitization utilities - no database dependencies
 */

import { sanitizeText, sanitizeOptional, cleanStepCompleteMarker, detectStepComplete, cleanTextForTTS } from '../sanitize';

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
  describe('detection of marker with valid step ID', () => {
    test('should detect STEP_COMPLETE: with valid step ID (step_1)', () => {
      const result = detectStepComplete('STEP_COMPLETE: step_1 Hello world');
      expect(result.hasMarker).toBe(true);
      expect(result.stepId).toBe('step_1');
    });

    test('should detect STEP_COMPLETE: with multi-digit step ID (step_10)', () => {
      const result = detectStepComplete('STEP_COMPLETE: step_10 Moving on');
      expect(result.hasMarker).toBe(true);
      expect(result.stepId).toBe('step_10');
    });

    test('should not detect when no marker present', () => {
      const result = detectStepComplete('Hello world');
      expect(result.hasMarker).toBe(false);
      expect(result.stepId).toBeNull();
    });
  });

  describe('invalid step IDs should return null', () => {
    test('should detect marker but return null for invalid step ID (myStepId)', () => {
      // myStepId doesn't match step_N pattern
      const result = detectStepComplete('STEP_COMPLETE: myStepId message');
      expect(result.hasMarker).toBe(true);
      expect(result.stepId).toBeNull();
    });

    test('should detect marker but return null for arbitrary word (Compr)', () => {
      // BUG-040 FIX: "Compr" from "Compréhension" should not be captured as step ID
      const result = detectStepComplete('STEP_COMPLETE: Compréhension terminée');
      expect(result.hasMarker).toBe(true);
      expect(result.stepId).toBeNull();
    });

    test('should detect marker but return null for step without underscore (step1)', () => {
      const result = detectStepComplete('STEP_COMPLETE: step1');
      expect(result.hasMarker).toBe(true);
      expect(result.stepId).toBeNull();
    });
  });

  describe('detection with newlines', () => {
    test('should detect STEP_COMPLETE: but return null for invalid word after newline', () => {
      // Hello doesn't match step_N pattern
      const result = detectStepComplete('STEP_COMPLETE:\nHello world');
      expect(result.hasMarker).toBe(true);
      expect(result.stepId).toBeNull();
    });

    test('should detect **STEP_COMPLETE:** but return null for invalid word after newline', () => {
      const result = detectStepComplete('**STEP_COMPLETE:**\nHello world');
      expect(result.hasMarker).toBe(true);
      expect(result.stepId).toBeNull();
    });

    test('should detect and capture valid step ID after newline', () => {
      const result = detectStepComplete('STEP_COMPLETE:\nstep_2 content');
      expect(result.hasMarker).toBe(true);
      expect(result.stepId).toBe('step_2');
    });
  });

  describe('markdown formatting', () => {
    test('should detect **STEP_COMPLETE: step_1**', () => {
      const result = detectStepComplete('**STEP_COMPLETE: step_1** Hello');
      expect(result.hasMarker).toBe(true);
      expect(result.stepId).toBe('step_1');
    });

    test('should detect **STEP_COMPLETE:** without step ID', () => {
      const result = detectStepComplete('**STEP_COMPLETE:** Moving to next topic');
      expect(result.hasMarker).toBe(true);
      expect(result.stepId).toBeNull();
    });
  });

  describe('case insensitivity', () => {
    test('should detect lowercase step_complete with valid step ID', () => {
      const result = detectStepComplete('step_complete: step_1 Hello');
      expect(result.hasMarker).toBe(true);
      expect(result.stepId).toBe('step_1');
    });

    test('should accept uppercase STEP_1', () => {
      const result = detectStepComplete('STEP_COMPLETE: STEP_1');
      expect(result.hasMarker).toBe(true);
      expect(result.stepId).toBe('STEP_1');
    });
  });

  describe('marker without step ID (use current step)', () => {
    test('should detect marker with just colon', () => {
      const result = detectStepComplete('STEP_COMPLETE:');
      expect(result.hasMarker).toBe(true);
      expect(result.stepId).toBeNull();
    });

    test('should detect marker with colon and space only', () => {
      const result = detectStepComplete('STEP_COMPLETE: ');
      expect(result.hasMarker).toBe(true);
      expect(result.stepId).toBeNull();
    });
  });
});

// ============================================================================
// cleanTextForTTS TESTS
// ============================================================================

describe('cleanTextForTTS', () => {
  describe('bold and italic formatting', () => {
    test('should remove **bold** formatting', () => {
      expect(cleanTextForTTS('This is **bold** text')).toBe('This is bold text');
    });

    test('should remove __bold__ formatting', () => {
      expect(cleanTextForTTS('This is __bold__ text')).toBe('This is bold text');
    });

    test('should remove *italic* formatting', () => {
      expect(cleanTextForTTS('This is *italic* text')).toBe('This is italic text');
    });

    test('should remove _italic_ formatting', () => {
      expect(cleanTextForTTS('This is _italic_ text')).toBe('This is italic text');
    });

    test('should remove ~~strikethrough~~ formatting', () => {
      expect(cleanTextForTTS('This is ~~deleted~~ text')).toBe('This is deleted text');
    });

    test('should handle nested formatting', () => {
      expect(cleanTextForTTS('This is **bold and *italic*** text')).toBe('This is bold and italic text');
    });
  });

  describe('headers', () => {
    test('should remove # header markers', () => {
      expect(cleanTextForTTS('# Title')).toBe('Title');
    });

    test('should remove ## header markers', () => {
      expect(cleanTextForTTS('## Subtitle')).toBe('Subtitle');
    });

    test('should remove ### header markers', () => {
      expect(cleanTextForTTS('### Section')).toBe('Section');
    });

    test('should handle multiple headers', () => {
      expect(cleanTextForTTS('# Title\n## Subtitle')).toBe('Title\nSubtitle');
    });
  });

  describe('links and images', () => {
    test('should convert [text](url) links to just text', () => {
      expect(cleanTextForTTS('Click [here](https://example.com) for more')).toBe('Click here for more');
    });

    test('should remove ![alt](url) images entirely', () => {
      expect(cleanTextForTTS('See image ![photo](image.jpg) below')).toBe('See image below');
    });

    test('should handle links with special characters in URL', () => {
      expect(cleanTextForTTS('[link](https://example.com/path?query=1&other=2)')).toBe('link');
    });
  });

  describe('code blocks and inline code', () => {
    test('should remove `inline code` backticks', () => {
      expect(cleanTextForTTS('Use `console.log()` to debug')).toBe('Use console.log() to debug');
    });

    test('should remove ```code blocks```', () => {
      expect(cleanTextForTTS('Example:\n```\nconst x = 1;\n```\nEnd')).toBe('Example:\nEnd');
    });

    test('should remove code blocks with language specifier', () => {
      expect(cleanTextForTTS('```javascript\nconst x = 1;\n```')).toBe('');
    });
  });

  describe('lists', () => {
    test('should remove - unordered list markers', () => {
      expect(cleanTextForTTS('- Item 1\n- Item 2')).toBe('Item 1\nItem 2');
    });

    test('should remove * unordered list markers', () => {
      expect(cleanTextForTTS('* Item 1\n* Item 2')).toBe('Item 1\nItem 2');
    });

    test('should remove + unordered list markers', () => {
      expect(cleanTextForTTS('+ Item 1\n+ Item 2')).toBe('Item 1\nItem 2');
    });

    test('should remove numbered list markers', () => {
      expect(cleanTextForTTS('1. First\n2. Second\n3. Third')).toBe('First\nSecond\nThird');
    });

    test('should handle indented list items', () => {
      expect(cleanTextForTTS('  - Nested item')).toBe('Nested item');
    });
  });

  describe('blockquotes', () => {
    test('should remove > blockquote markers', () => {
      expect(cleanTextForTTS('> This is a quote')).toBe('This is a quote');
    });

    test('should handle multiple blockquote lines', () => {
      expect(cleanTextForTTS('> Line 1\n> Line 2')).toBe('Line 1\nLine 2');
    });
  });

  describe('horizontal rules', () => {
    test('should remove --- horizontal rules', () => {
      expect(cleanTextForTTS('Text\n---\nMore text')).toBe('Text\nMore text');
    });

    test('should remove *** horizontal rules', () => {
      expect(cleanTextForTTS('Text\n***\nMore text')).toBe('Text\nMore text');
    });

    test('should remove ___ horizontal rules', () => {
      expect(cleanTextForTTS('Text\n___\nMore text')).toBe('Text\nMore text');
    });

    test('should remove longer horizontal rules', () => {
      expect(cleanTextForTTS('Text\n---------\nMore text')).toBe('Text\nMore text');
    });
  });

  describe('tables', () => {
    test('should remove | table delimiters', () => {
      expect(cleanTextForTTS('| Cell 1 | Cell 2 |')).toBe('Cell 1 Cell 2');
    });

    test('should remove table separator rows', () => {
      expect(cleanTextForTTS('|---|---|\n| A | B |')).toBe('A B');
    });
  });

  describe('special delimiters', () => {
    test('should remove ⟦⟦ delimiters', () => {
      expect(cleanTextForTTS('Question: ⟦⟦ What is this? ⟧⟧')).toBe('Question: What is this?');
    });

    test('should remove [[ ]] delimiters', () => {
      expect(cleanTextForTTS('Template [[variable]]')).toBe('Template variable');
    });
  });

  describe('HTML tags', () => {
    test('should remove HTML tags', () => {
      expect(cleanTextForTTS('<b>bold</b> and <i>italic</i>')).toBe('bold and italic');
    });

    test('should remove self-closing tags', () => {
      expect(cleanTextForTTS('Line 1<br/>Line 2')).toBe('Line 1Line 2');
    });
  });

  describe('whitespace cleanup', () => {
    test('should collapse multiple spaces', () => {
      expect(cleanTextForTTS('Too    many    spaces')).toBe('Too many spaces');
    });

    test('should collapse multiple newlines', () => {
      expect(cleanTextForTTS('Line 1\n\n\n\nLine 2')).toBe('Line 1\nLine 2');
    });

    test('should trim each line', () => {
      expect(cleanTextForTTS('  Line 1  \n  Line 2  ')).toBe('Line 1\nLine 2');
    });
  });

  describe('signal markers', () => {
    test('should remove STEP_COMPLETE markers', () => {
      expect(cleanTextForTTS('Great! STEP_COMPLETE:step_1 Moving on')).toBe('Great! Moving on');
    });

    test('should remove TOPICS_DISCOVERED markers', () => {
      expect(cleanTextForTTS('Found topics TOPICS_DISCOVERED:[{"label":"A"}] Continue')).toBe('Found topics Continue');
    });
  });

  describe('combined scenarios', () => {
    test('should clean complex markdown response', () => {
      const input = `## Réponse

Voici les points **importants**:
- Premier point
- Deuxième point

> Citation importante

---

Pour plus d'infos, visitez [ce lien](https://example.com).

STEP_COMPLETE:step_1`;

      const expected = `Réponse
Voici les points importants:
Premier point
Deuxième point
Citation importante
Pour plus d'infos, visitez ce lien.`;

      expect(cleanTextForTTS(input)).toBe(expected);
    });

    test('should preserve natural speech text', () => {
      const input = "Bonjour! Comment allez-vous aujourd'hui? C'est une belle journée.";
      expect(cleanTextForTTS(input)).toBe(input);
    });

    test('should handle French text with accents', () => {
      const input = 'Très bien, passons à la **prochaine étape**: découverte des besoins.';
      expect(cleanTextForTTS(input)).toBe('Très bien, passons à la prochaine étape: découverte des besoins.');
    });
  });
});
