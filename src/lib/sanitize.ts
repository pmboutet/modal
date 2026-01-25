const forbiddenPattern = /[<>]/g;

export function sanitizeText(value: string): string {
  return value.replace(forbiddenPattern, " ").trim();
}

export function sanitizeOptional(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  return sanitizeText(value);
}

/**
 * Removes STEP_COMPLETE markers from message content for display.
 * Handles all formats including markdown (e.g., STEP_COMPLETE:, STEP_COMPLETE: step_id)
 *
 * BUG-039 FIX: The regex now matches only the marker and step ID, not trailing content.
 * It captures: optional markdown + STEP_COMPLETE: + optional space + optional step_id
 */
export function cleanStepCompleteMarker(content: string): string {
  // Match STEP_COMPLETE with optional step ID (captures only the step ID, not trailing content)
  // Pattern: optional markdown + STEP_COMPLETE: + optional space + optional step_id (word chars only) + optional markdown
  return content
    .replace(/(\*{1,2}|_{1,2})?(STEP_COMPLETE:?\s*)(\w+)?(\*{1,2}|_{1,2})?/gi, '')
    .trim();
}

/**
 * Valid step ID pattern: step_N with optional suffix (e.g., step_1, step_2, step_10, step_10_final)
 * This prevents capturing arbitrary words like "Compr" from AI text as step IDs
 *
 * Valid formats:
 * - step_1, step_2, step_10 (basic format)
 * - step_10_final, step_1_intro (with additional suffix)
 * - STEP_1 (case insensitive)
 *
 * Invalid:
 * - Compr, Hello, myStepId (no step_ prefix)
 * - intro, final (no step_ prefix)
 */
const VALID_STEP_ID_PATTERN = /^step_\d+(_[a-z0-9]+)*$/i;

/**
 * Detects and extracts step completion information from message content.
 * Returns the step ID if present and valid, or null if no marker found or invalid ID.
 *
 * IMPORTANT: Only step IDs matching the pattern "step_N" (e.g., step_1, step_2) are considered valid.
 * If the AI outputs something like "STEP_COMPLETE: Compréhension terminée", the captured word
 * "Compr" is not a valid step ID and will be returned as null (to use current step instead).
 */
export function detectStepComplete(content: string): { hasMarker: boolean; stepId: string | null } {
  // Clean markdown formatting around STEP_COMPLETE for detection
  const cleanedForDetection = content.replace(
    /(\*{1,2}|_{1,2})(STEP_COMPLETE:?\s*\w*)(\*{1,2}|_{1,2})/gi,
    '$2'
  );

  const stepCompleteMatch = cleanedForDetection.match(/STEP_COMPLETE:\s*(\w+)/i);
  const capturedStepId = stepCompleteMatch?.[1] ?? null;

  // Validate that the captured step ID matches expected pattern (step_N)
  // If not valid, treat it as if no step ID was provided
  const validStepId = capturedStepId && VALID_STEP_ID_PATTERN.test(capturedStepId) ? capturedStepId : null;

  // Detect STEP_COMPLETE marker presence (regardless of whether step ID is valid)
  const hasStepCompleteMarker = /STEP_COMPLETE:/i.test(cleanedForDetection);

  return {
    hasMarker: hasStepCompleteMarker,
    stepId: validStepId
  };
}

/**
 * Remove TOPICS_DISCOVERED signal and its JSON array from content
 * Uses bracket counting to correctly handle nested JSON structures
 */
function cleanTopicsDiscovered(content: string): string {
  const marker = content.match(/TOPICS_DISCOVERED:\s*/i);
  if (!marker || marker.index === undefined) return content;

  const startIndex = marker.index;
  const afterMarker = startIndex + marker[0].length;

  // Find the JSON array if it exists
  if (content[afterMarker] !== '[') {
    // No JSON array, just remove the marker
    return content.slice(0, startIndex) + content.slice(afterMarker);
  }

  // Count brackets to find the matching ]
  let depth = 0;
  let endIndex = afterMarker;

  for (let i = afterMarker; i < content.length; i++) {
    if (content[i] === '[') depth++;
    else if (content[i] === ']') {
      depth--;
      if (depth === 0) {
        endIndex = i;
        break;
      }
    }
  }

  if (depth !== 0) {
    // Malformed JSON, just remove the marker
    return content.slice(0, startIndex) + content.slice(afterMarker);
  }

  // Remove the entire signal including JSON array
  // Also remove any leading/trailing newlines around the signal
  const before = content.slice(0, startIndex).replace(/\n\s*$/, '');
  const after = content.slice(endIndex + 1).replace(/^\s*\n/, '');

  // Recursively clean in case there are multiple TOPICS_DISCOVERED signals
  const result = before + after;
  if (/TOPICS_DISCOVERED:/i.test(result)) {
    return cleanTopicsDiscovered(result);
  }
  return result;
}

/**
 * Remove all conversation signals from content for display.
 * This is the comprehensive cleaning function that handles:
 * - STEP_COMPLETE: marker
 * - TOPICS_DISCOVERED: with JSON array
 * - TOPIC_EXPLORED: marker
 * - TOPIC_SKIPPED: marker
 *
 * Can be used both client-side (ChatComponent) and server-side.
 */
export function cleanAllSignalMarkers(content: string): string {
  let result = content
    // Clean STEP_COMPLETE (existing pattern)
    .replace(/(\*{1,2}|_{1,2})?(STEP_COMPLETE:?\s*)(\w+)?(\*{1,2}|_{1,2})?/gi, '')
    // Clean TOPIC_EXPLORED
    .replace(/(\*{1,2}|_{1,2})?(TOPIC_EXPLORED:\s*\w+)(\*{1,2}|_{1,2})?/gi, '')
    // Clean TOPIC_SKIPPED
    .replace(/(\*{1,2}|_{1,2})?(TOPIC_SKIPPED:\s*\w+)(\*{1,2}|_{1,2})?/gi, '');

  // Clean TOPICS_DISCOVERED with proper bracket handling
  result = cleanTopicsDiscovered(result);

  return result.trim();
}

/**
 * Clean text for Text-to-Speech synthesis.
 * Removes markdown formatting and other elements that should not be vocalized.
 *
 * This function handles:
 * - Bold: **text** or __text__ → text
 * - Italic: *text* or _text_ → text
 * - Strikethrough: ~~text~~ → text
 * - Headers: # ## ### etc → removes the # symbols
 * - Links: [text](url) → text
 * - Images: ![alt](url) → removes entirely
 * - Inline code: `code` → code
 * - Code blocks: ```code``` → removes entirely
 * - Blockquotes: > text → text
 * - Horizontal rules: ---, ***, ___ → removes entirely
 * - Lists: - item, * item, 1. item → item
 * - Tables: | cell | → cell
 * - Special delimiters: ⟦⟦ ⟧⟧ → removes
 * - HTML tags: <tag> → removes
 * - Multiple spaces/newlines → single space
 */
export function cleanTextForTTS(content: string): string {
  let result = content;

  // First, clean all signal markers (STEP_COMPLETE, TOPICS_DISCOVERED, etc.)
  result = cleanAllSignalMarkers(result);

  // Remove code blocks (``` ... ```) - must be done before inline code
  result = result.replace(/```[\s\S]*?```/g, '');

  // Remove inline code (`code`)
  result = result.replace(/`([^`]+)`/g, '$1');

  // Remove images ![alt](url) - remove entirely as images can't be spoken
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');

  // Convert links [text](url) → text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Remove horizontal rules (---, ***, ___, or longer variants)
  result = result.replace(/^[\s]*[-*_]{3,}[\s]*$/gm, '');

  // Remove headers (# ## ### etc.) - keep the text
  result = result.replace(/^#{1,6}\s+/gm, '');

  // Remove blockquote markers (> text → text)
  result = result.replace(/^>\s*/gm, '');

  // Remove bold (**text** or __text__) - keep the text
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
  result = result.replace(/__([^_]+)__/g, '$1');

  // Remove italic (*text* or _text_) - keep the text
  // Be careful not to match already-processed bold or list items
  result = result.replace(/(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g, '$1');
  result = result.replace(/(?<!_)_(?!_)([^_]+)(?<!_)_(?!_)/g, '$1');

  // Remove strikethrough (~~text~~) - keep the text
  result = result.replace(/~~([^~]+)~~/g, '$1');

  // Remove list markers at the beginning of lines
  // Unordered: - item, * item, + item
  result = result.replace(/^[\s]*[-*+]\s+/gm, '');
  // Ordered: 1. item, 2. item, etc.
  result = result.replace(/^[\s]*\d+\.\s+/gm, '');

  // Remove table formatting (| cell |)
  result = result.replace(/\|/g, ' ');
  // Remove table separator rows (|---|---|)
  result = result.replace(/^[\s]*[-|:\s]+$/gm, '');

  // Remove special delimiters used in prompts
  result = result.replace(/⟦⟦/g, '');
  result = result.replace(/⟧⟧/g, '');
  result = result.replace(/\[\[/g, '');
  result = result.replace(/\]\]/g, '');

  // Remove HTML tags
  result = result.replace(/<[^>]+>/g, '');

  // Remove leftover markdown artifacts
  result = result.replace(/\*+/g, ''); // Leftover asterisks
  result = result.replace(/_+/g, ' '); // Leftover underscores (replace with space)

  // Clean up whitespace
  // Multiple spaces → single space
  result = result.replace(/[ \t]+/g, ' ');
  // Multiple newlines → single newline
  result = result.replace(/\n{2,}/g, '\n');
  // Trim each line
  result = result.split('\n').map(line => line.trim()).join('\n');
  // Trim overall
  result = result.trim();

  return result;
}
