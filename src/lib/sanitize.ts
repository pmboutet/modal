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
