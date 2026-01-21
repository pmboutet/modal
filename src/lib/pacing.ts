/**
 * Conversation pacing utilities
 *
 * Based on attention research data:
 * - 8-12 min: sustained attention sweet spot (5-7 questions)
 * - 15-20 min: requires 2 blocks + synthesis (8-12 questions)
 * - 25-35 min: requires 3 blocks + attention restarts (12-18 questions)
 * - >35 min: discouraged - attention collapses without support changes
 */

import type { PacingConfig, PacingLevel, PacingAlertLevel } from '@/types';

/**
 * Duration thresholds for alerts (in minutes)
 */
export const PACING_THRESHOLDS = {
  WARNING: 8,   // Orange alert - slight attention loss risk
  CRITICAL: 16, // Red alert - attention drop, suggest splitting
} as const;

/**
 * Duration labels for UI display
 */
export const DURATION_LABELS: Record<number, string> = {
  1: "1 min - Ultra-rapide",
  2: "2 min - Très rapide",
  3: "3 min - Rapide",
  5: "5 min - Court",
  8: "8 min - Standard",
  10: "10 min - Modéré",
  12: "12 min - Approfondi",
  15: "15 min - Détaillé",
  20: "20 min - Exploration",
  25: "25 min - Long",
  30: "30 min - Très long",
};

/**
 * Get the display label for a duration value
 */
export function getDurationLabel(minutes: number): string {
  // Find exact match or closest lower value
  const keys = Object.keys(DURATION_LABELS).map(Number).sort((a, b) => a - b);
  let closestKey = keys[0];

  for (const key of keys) {
    if (key <= minutes) {
      closestKey = key;
    } else {
      break;
    }
  }

  if (DURATION_LABELS[minutes]) {
    return DURATION_LABELS[minutes];
  }

  return `${minutes} min`;
}

/**
 * Determine the pacing level based on expected duration
 */
export function getPacingLevel(durationMinutes: number): PacingLevel {
  if (durationMinutes <= 7) {
    return 'intensive';
  }
  if (durationMinutes <= 15) {
    return 'standard';
  }
  return 'deep';
}

/**
 * Get the alert level for a given duration
 */
export function getAlertLevel(durationMinutes: number): PacingAlertLevel {
  if (durationMinutes >= PACING_THRESHOLDS.CRITICAL) {
    return 'critical';
  }
  if (durationMinutes >= PACING_THRESHOLDS.WARNING) {
    return 'warning';
  }
  return 'none';
}

/**
 * Get alert configuration for UI display
 */
export function getDurationAlert(minutes: number): {
  level: PacingAlertLevel;
  color: string;
  bgColor: string;
  borderColor: string;
  message: string;
} {
  if (minutes >= PACING_THRESHOLDS.CRITICAL) {
    return {
      level: 'critical',
      color: 'text-red-600',
      bgColor: 'bg-red-50',
      borderColor: 'border-red-200',
      message: "Risque de baisse d'attention. Envisagez de diviser en plusieurs ASKs plus courts."
    };
  }
  if (minutes >= PACING_THRESHOLDS.WARNING) {
    return {
      level: 'warning',
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
      borderColor: 'border-orange-200',
      message: "Légère perte d'attention possible. Prévoyez des micro-synthèses pour maintenir l'engagement."
    };
  }
  return {
    level: 'none',
    color: '',
    bgColor: '',
    borderColor: '',
    message: ''
  };
}

/**
 * Get optimal question count range based on duration
 * Based on attention research data provided
 */
export function getOptimalQuestionCount(durationMinutes: number): {
  min: number;
  max: number;
  format: string;
} {
  if (durationMinutes <= 7) {
    return {
      min: 3,
      max: 5,
      format: "questions directes, peu de relances"
    };
  }
  if (durationMinutes <= 12) {
    return {
      min: 5,
      max: 7,
      format: "mix équilibré ouvert/simple"
    };
  }
  if (durationMinutes <= 20) {
    return {
      min: 8,
      max: 12,
      format: "2 blocs + 1 synthèse intermédiaire"
    };
  }
  if (durationMinutes <= 35) {
    return {
      min: 12,
      max: 18,
      format: "3 blocs + 2 redémarrages d'attention"
    };
  }
  return {
    min: 0,
    max: 0,
    format: "déconseillé - diviser la session"
  };
}

/**
 * Calculate complete pacing configuration
 */
export function calculatePacingConfig(
  expectedDurationMinutes: number,
  totalSteps: number
): PacingConfig {
  const durationPerStep = totalSteps > 0
    ? Math.round((expectedDurationMinutes / totalSteps) * 10) / 10
    : expectedDurationMinutes;

  const pacingLevel = getPacingLevel(expectedDurationMinutes);
  const alertLevel = getAlertLevel(expectedDurationMinutes);
  const optimalQuestions = getOptimalQuestionCount(expectedDurationMinutes);
  const alert = getDurationAlert(expectedDurationMinutes);

  return {
    expectedDurationMinutes,
    totalSteps,
    durationPerStep,
    pacingLevel,
    optimalQuestionsMin: optimalQuestions.min,
    optimalQuestionsMax: optimalQuestions.max,
    alertLevel,
    alertMessage: alert.message || undefined,
  };
}

/**
 * Get pacing instructions text for prompt variables
 */
export function getPacingInstructions(pacingLevel: PacingLevel): string {
  switch (pacingLevel) {
    case 'intensive':
      return `Mode INTENSIF (conversation courte):
- Une question = une réponse, on avance
- Maximum 1 relance par sujet
- Pas de bavardage, droit au but
- Si la réponse est "suffisante", on passe à la suite
- Ne pas demander d'exemples sauf si critique`;

    case 'standard':
      return `Mode STANDARD (conversation équilibrée):
- 1-2 relances autorisées par point clé
- Brève reconnaissance avant la question suivante
- Demander UN exemple max par étape
- Avancer dès qu'on a une compréhension solide`;

    case 'deep':
      return `Mode APPROFONDI (exploration):
- 2-3 relances si elles apportent de la valeur
- Insérer une micro-synthèse tous les 3-4 échanges
- Explorer les nuances quand elles émergent
- Mais surveiller les signes de fatigue`;
  }
}

/**
 * Format pacing config as prompt variables
 */
export function formatPacingVariables(config: PacingConfig): Record<string, string> {
  return {
    expected_duration_minutes: String(config.expectedDurationMinutes),
    duration_per_step: String(config.durationPerStep),
    optimal_questions_min: String(config.optimalQuestionsMin),
    optimal_questions_max: String(config.optimalQuestionsMax),
    pacing_level: config.pacingLevel,
    pacing_instructions: getPacingInstructions(config.pacingLevel),
  };
}

/**
 * Time tracking statistics for real-time pacing
 */
export interface TimeTrackingStats {
  /** Estimated active conversation time (based on activity signals) */
  conversationElapsedMinutes: number;
  /** Estimated active time for current step */
  stepElapsedMinutes: number;
  /** Total AI messages count */
  questionsAskedTotal: number;
  /** AI messages count in current step */
  questionsAskedInStep: number;
  /** Remaining time budget */
  timeRemainingMinutes: number;
  /** Whether conversation exceeds expected duration */
  isOvertime: boolean;
  /** Minutes over expected duration */
  overtimeMinutes: number;
  /** Whether current step exceeds its time budget */
  stepIsOvertime: boolean;
  /** Minutes over step time budget */
  stepOvertimeMinutes: number;
  /** Dynamic time budget per remaining step (redistributed based on actual progress) */
  durationPerRemainingStep: number;
}

/**
 * Message format for time tracking calculations
 */
interface MessageForTimeTracking {
  senderType: string;
  timestamp: string;
  planStepId?: string | null;
}

/**
 * Calculate real-time time tracking statistics
 *
 * Uses actual elapsed time from the UI timer (which handles auto-pause)
 * instead of estimating from messages.
 *
 * @param messages - Array of messages for counting questions
 * @param expectedDurationMinutes - Target session duration
 * @param durationPerStep - Static time budget per step (initial calculation)
 * @param elapsedActiveSeconds - Real elapsed time from participant timer (DB)
 * @param stepElapsedActiveSeconds - Real elapsed time for current step (DB)
 * @param currentStepId - ID of the current active step (for question counting)
 * @param completedSteps - Number of steps already completed
 * @param totalSteps - Total number of steps in the plan
 */
export function calculateTimeTrackingStats(
  messages: MessageForTimeTracking[],
  expectedDurationMinutes: number,
  durationPerStep: number,
  elapsedActiveSeconds: number,
  stepElapsedActiveSeconds: number,
  currentStepId?: string | null,
  completedSteps?: number,
  totalSteps?: number,
): TimeTrackingStats {
  // Convert real elapsed seconds to minutes with 1 decimal precision
  const conversationElapsedMinutes = Math.round((elapsedActiveSeconds / 60) * 10) / 10;
  const stepElapsedMinutes = Math.round((stepElapsedActiveSeconds / 60) * 10) / 10;

  // Count AI questions (assistant messages) in total conversation
  const questionsAskedTotal = messages.filter(m => m.senderType === 'ai').length;

  // Count AI questions in current step
  let questionsAskedInStep = 0;
  if (currentStepId) {
    const stepMessages = messages.filter(m => m.planStepId === currentStepId);
    questionsAskedInStep = stepMessages.filter(m => m.senderType === 'ai').length;
  }

  // Calculate remaining time
  const timeRemainingMinutes = Math.max(0, expectedDurationMinutes - conversationElapsedMinutes);
  const isOvertime = conversationElapsedMinutes > expectedDurationMinutes;
  const overtimeMinutes = isOvertime
    ? Math.round((conversationElapsedMinutes - expectedDurationMinutes) * 10) / 10
    : 0;

  // Step overtime calculations
  const stepIsOvertime = stepElapsedMinutes > durationPerStep;
  const stepOvertimeMinutes = stepIsOvertime
    ? Math.round((stepElapsedMinutes - durationPerStep) * 10) / 10
    : 0;

  // Calculate dynamic time per remaining step (redistributed based on actual progress)
  // This divides remaining time equally among remaining steps
  const safeCompletedSteps = completedSteps ?? 0;
  const safeTotalSteps = totalSteps ?? 5;
  const remainingSteps = Math.max(0, safeTotalSteps - safeCompletedSteps);
  const durationPerRemainingStep = remainingSteps > 0
    ? Math.round((timeRemainingMinutes / remainingSteps) * 10) / 10
    : 0;

  return {
    conversationElapsedMinutes,
    stepElapsedMinutes,
    questionsAskedTotal,
    questionsAskedInStep,
    timeRemainingMinutes,
    isOvertime,
    overtimeMinutes,
    stepIsOvertime,
    stepOvertimeMinutes,
    durationPerRemainingStep,
  };
}

/**
 * Format time tracking stats as prompt variables
 */
export function formatTimeTrackingVariables(stats: TimeTrackingStats): Record<string, string> {
  return {
    conversation_elapsed_minutes: String(stats.conversationElapsedMinutes),
    step_elapsed_minutes: String(stats.stepElapsedMinutes),
    questions_asked_total: String(stats.questionsAskedTotal),
    questions_asked_in_step: String(stats.questionsAskedInStep),
    time_remaining_minutes: String(stats.timeRemainingMinutes),
    is_overtime: String(stats.isOvertime),
    overtime_minutes: String(stats.overtimeMinutes),
    step_is_overtime: String(stats.stepIsOvertime),
    step_overtime_minutes: String(stats.stepOvertimeMinutes),
    duration_per_remaining_step: String(stats.durationPerRemainingStep),
  };
}
