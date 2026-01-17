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
 * Detects and extracts step completion information from message content.
 * Returns the step ID if present, or null if no marker found.
 */
export function detectStepComplete(content: string): { hasMarker: boolean; stepId: string | null } {
  // Clean markdown formatting around STEP_COMPLETE for detection
  const cleanedForDetection = content.replace(
    /(\*{1,2}|_{1,2})(STEP_COMPLETE:?\s*\w*)(\*{1,2}|_{1,2})/gi,
    '$2'
  );

  const stepCompleteMatch = cleanedForDetection.match(/STEP_COMPLETE:\s*(\w+)/i);
  const hasStepCompleteWithId = stepCompleteMatch !== null;

  // Also detect STEP_COMPLETE without ID (e.g., "STEP_COMPLETE:" or "**STEP_COMPLETE:**")
  const hasStepCompleteWithoutId = !hasStepCompleteWithId && /STEP_COMPLETE:?\s*(?!\w)/i.test(cleanedForDetection);

  return {
    hasMarker: hasStepCompleteWithId || hasStepCompleteWithoutId,
    stepId: stepCompleteMatch?.[1] ?? null
  };
}
