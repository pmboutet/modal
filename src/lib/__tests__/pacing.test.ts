/**
 * Unit tests for src/lib/pacing.ts
 * Conversation pacing utilities - no database dependencies
 */

import {
  getDurationLabel,
  getPacingLevel,
  getAlertLevel,
  getDurationAlert,
  getOptimalQuestionCount,
  calculatePacingConfig,
  getPacingInstructions,
  formatPacingVariables,
  calculateTimeTrackingStats,
  formatTimeTrackingVariables,
  PACING_THRESHOLDS,
  DURATION_LABELS,
} from '../pacing';

// ============================================================================
// CONSTANTS TESTS
// ============================================================================

describe('Pacing Constants', () => {
  test('PACING_THRESHOLDS should have correct values', () => {
    expect(PACING_THRESHOLDS.WARNING).toBe(8);
    expect(PACING_THRESHOLDS.CRITICAL).toBe(16);
  });

  test('DURATION_LABELS should contain expected durations', () => {
    expect(DURATION_LABELS[5]).toBe('5 min - Court');
    expect(DURATION_LABELS[8]).toBe('8 min - Standard');
    expect(DURATION_LABELS[15]).toBe('15 min - Détaillé');
  });
});

// ============================================================================
// getDurationLabel TESTS
// ============================================================================

describe('getDurationLabel', () => {
  test('should return exact match when available', () => {
    expect(getDurationLabel(5)).toBe('5 min - Court');
    expect(getDurationLabel(8)).toBe('8 min - Standard');
    expect(getDurationLabel(10)).toBe('10 min - Modéré');
    expect(getDurationLabel(15)).toBe('15 min - Détaillé');
  });

  test('should return generic format for non-standard durations', () => {
    expect(getDurationLabel(7)).toBe('7 min');
    expect(getDurationLabel(9)).toBe('9 min');
    expect(getDurationLabel(11)).toBe('11 min');
  });

  test('should handle very short durations', () => {
    expect(getDurationLabel(1)).toBe('1 min - Ultra-rapide');
    expect(getDurationLabel(2)).toBe('2 min - Très rapide');
  });

  test('should handle very long durations', () => {
    expect(getDurationLabel(30)).toBe('30 min - Très long');
    expect(getDurationLabel(45)).toBe('45 min');
    expect(getDurationLabel(60)).toBe('60 min');
  });

  test('should handle edge case of 0 minutes', () => {
    expect(getDurationLabel(0)).toBe('0 min');
  });
});

// ============================================================================
// getPacingLevel TESTS
// ============================================================================

describe('getPacingLevel', () => {
  test('should return "intensive" for short durations (<=7 min)', () => {
    expect(getPacingLevel(1)).toBe('intensive');
    expect(getPacingLevel(5)).toBe('intensive');
    expect(getPacingLevel(7)).toBe('intensive');
  });

  test('should return "standard" for medium durations (8-15 min)', () => {
    expect(getPacingLevel(8)).toBe('standard');
    expect(getPacingLevel(10)).toBe('standard');
    expect(getPacingLevel(15)).toBe('standard');
  });

  test('should return "deep" for long durations (>15 min)', () => {
    expect(getPacingLevel(16)).toBe('deep');
    expect(getPacingLevel(20)).toBe('deep');
    expect(getPacingLevel(30)).toBe('deep');
  });

  test('should handle boundary values correctly', () => {
    expect(getPacingLevel(7)).toBe('intensive');
    expect(getPacingLevel(8)).toBe('standard');
    expect(getPacingLevel(15)).toBe('standard');
    expect(getPacingLevel(16)).toBe('deep');
  });
});

// ============================================================================
// getAlertLevel TESTS
// ============================================================================

describe('getAlertLevel', () => {
  test('should return "none" for short durations (<8 min)', () => {
    expect(getAlertLevel(0)).toBe('none');
    expect(getAlertLevel(5)).toBe('none');
    expect(getAlertLevel(7)).toBe('none');
  });

  test('should return "warning" for medium durations (8-15 min)', () => {
    expect(getAlertLevel(8)).toBe('warning');
    expect(getAlertLevel(10)).toBe('warning');
    expect(getAlertLevel(15)).toBe('warning');
  });

  test('should return "critical" for long durations (>=16 min)', () => {
    expect(getAlertLevel(16)).toBe('critical');
    expect(getAlertLevel(20)).toBe('critical');
    expect(getAlertLevel(30)).toBe('critical');
  });

  test('should handle boundary values correctly', () => {
    expect(getAlertLevel(7)).toBe('none');
    expect(getAlertLevel(8)).toBe('warning');
    expect(getAlertLevel(15)).toBe('warning');
    expect(getAlertLevel(16)).toBe('critical');
  });
});

// ============================================================================
// getDurationAlert TESTS
// ============================================================================

describe('getDurationAlert', () => {
  test('should return empty config for safe durations', () => {
    const result = getDurationAlert(5);
    expect(result.level).toBe('none');
    expect(result.color).toBe('');
    expect(result.message).toBe('');
  });

  test('should return warning config for medium durations', () => {
    const result = getDurationAlert(10);
    expect(result.level).toBe('warning');
    expect(result.color).toBe('text-orange-600');
    expect(result.bgColor).toBe('bg-orange-50');
    expect(result.borderColor).toBe('border-orange-200');
    expect(result.message).toContain('attention');
  });

  test('should return critical config for long durations', () => {
    const result = getDurationAlert(20);
    expect(result.level).toBe('critical');
    expect(result.color).toBe('text-red-600');
    expect(result.bgColor).toBe('bg-red-50');
    expect(result.borderColor).toBe('border-red-200');
    expect(result.message).toContain('diviser');
  });
});

// ============================================================================
// getOptimalQuestionCount TESTS
// ============================================================================

describe('getOptimalQuestionCount', () => {
  test('should return 3-5 questions for very short sessions (<=7 min)', () => {
    const result = getOptimalQuestionCount(5);
    expect(result.min).toBe(3);
    expect(result.max).toBe(5);
    expect(result.format).toContain('directes');
  });

  test('should return 5-7 questions for short sessions (8-12 min)', () => {
    const result = getOptimalQuestionCount(10);
    expect(result.min).toBe(5);
    expect(result.max).toBe(7);
    expect(result.format).toContain('équilibré');
  });

  test('should return 8-12 questions for medium sessions (13-20 min)', () => {
    const result = getOptimalQuestionCount(15);
    expect(result.min).toBe(8);
    expect(result.max).toBe(12);
    expect(result.format).toContain('blocs');
  });

  test('should return 12-18 questions for long sessions (21-35 min)', () => {
    const result = getOptimalQuestionCount(30);
    expect(result.min).toBe(12);
    expect(result.max).toBe(18);
    expect(result.format).toContain('redémarrages');
  });

  test('should discourage very long sessions (>35 min)', () => {
    const result = getOptimalQuestionCount(45);
    expect(result.min).toBe(0);
    expect(result.max).toBe(0);
    expect(result.format).toContain('déconseillé');
  });

  test('should handle boundary values', () => {
    expect(getOptimalQuestionCount(7).min).toBe(3);
    expect(getOptimalQuestionCount(8).min).toBe(5);
    expect(getOptimalQuestionCount(12).min).toBe(5);
    expect(getOptimalQuestionCount(13).min).toBe(8);
    expect(getOptimalQuestionCount(20).min).toBe(8);
    expect(getOptimalQuestionCount(21).min).toBe(12);
    expect(getOptimalQuestionCount(35).min).toBe(12);
    expect(getOptimalQuestionCount(36).min).toBe(0);
  });
});

// ============================================================================
// calculatePacingConfig TESTS
// ============================================================================

describe('calculatePacingConfig', () => {
  test('should calculate complete pacing config', () => {
    const config = calculatePacingConfig(10, 4);
    expect(config.expectedDurationMinutes).toBe(10);
    expect(config.totalSteps).toBe(4);
    expect(config.durationPerStep).toBe(2.5);
    expect(config.pacingLevel).toBe('standard');
    expect(config.alertLevel).toBe('warning');
    expect(config.optimalQuestionsMin).toBe(5);
    expect(config.optimalQuestionsMax).toBe(7);
  });

  test('should handle zero steps', () => {
    const config = calculatePacingConfig(10, 0);
    expect(config.durationPerStep).toBe(10);
  });

  test('should handle short duration', () => {
    const config = calculatePacingConfig(5, 3);
    expect(config.pacingLevel).toBe('intensive');
    expect(config.alertLevel).toBe('none');
  });

  test('should handle long duration', () => {
    const config = calculatePacingConfig(25, 5);
    expect(config.pacingLevel).toBe('deep');
    expect(config.alertLevel).toBe('critical');
    expect(config.alertMessage).toBeDefined();
  });

  test('should round durationPerStep to 1 decimal', () => {
    const config = calculatePacingConfig(10, 3);
    expect(config.durationPerStep).toBe(3.3); // 10/3 = 3.333... rounded to 3.3
  });
});

// ============================================================================
// getPacingInstructions TESTS
// ============================================================================

describe('getPacingInstructions', () => {
  test('should return intensive instructions', () => {
    const instructions = getPacingInstructions('intensive');
    expect(instructions).toContain('INTENSIF');
    expect(instructions).toContain('droit au but');
  });

  test('should return standard instructions', () => {
    const instructions = getPacingInstructions('standard');
    expect(instructions).toContain('STANDARD');
    expect(instructions).toContain('équilibrée');
  });

  test('should return deep instructions', () => {
    const instructions = getPacingInstructions('deep');
    expect(instructions).toContain('APPROFONDI');
    expect(instructions).toContain('exploration');
  });
});

// ============================================================================
// formatPacingVariables TESTS
// ============================================================================

describe('formatPacingVariables', () => {
  test('should format all pacing variables as strings', () => {
    const config = calculatePacingConfig(10, 4);
    const variables = formatPacingVariables(config);

    expect(variables.expected_duration_minutes).toBe('10');
    expect(variables.duration_per_step).toBe('2.5');
    expect(variables.optimal_questions_min).toBe('5');
    expect(variables.optimal_questions_max).toBe('7');
    expect(variables.pacing_level).toBe('standard');
    expect(variables.pacing_instructions).toContain('STANDARD');
  });
});

// ============================================================================
// calculateTimeTrackingStats TESTS
// ============================================================================

describe('calculateTimeTrackingStats', () => {
  const createMessages = (aiCount: number, userCount: number, stepId?: string) => {
    const messages = [];
    for (let i = 0; i < aiCount; i++) {
      messages.push({
        senderType: 'ai',
        timestamp: new Date().toISOString(),
        planStepId: stepId,
      });
    }
    for (let i = 0; i < userCount; i++) {
      messages.push({
        senderType: 'user',
        timestamp: new Date().toISOString(),
        planStepId: stepId,
      });
    }
    return messages;
  };

  test('should calculate elapsed time from seconds', () => {
    const stats = calculateTimeTrackingStats(
      [],
      10, // expectedDurationMinutes
      2.5, // durationPerStep
      300, // 5 minutes in seconds
      60, // 1 minute in seconds for step
    );

    expect(stats.conversationElapsedMinutes).toBe(5);
    expect(stats.stepElapsedMinutes).toBe(1);
  });

  test('should count AI questions', () => {
    const messages = createMessages(3, 2);
    const stats = calculateTimeTrackingStats(messages, 10, 2.5, 0, 0);

    expect(stats.questionsAskedTotal).toBe(3);
  });

  test('should count AI questions in current step', () => {
    const messages = [
      { senderType: 'ai', timestamp: '', planStepId: 'step_1' },
      { senderType: 'ai', timestamp: '', planStepId: 'step_1' },
      { senderType: 'ai', timestamp: '', planStepId: 'step_2' },
      { senderType: 'user', timestamp: '', planStepId: 'step_1' },
    ];
    const stats = calculateTimeTrackingStats(messages, 10, 2.5, 0, 0, 'step_1');

    expect(stats.questionsAskedTotal).toBe(3);
    expect(stats.questionsAskedInStep).toBe(2);
  });

  test('should calculate remaining time', () => {
    const stats = calculateTimeTrackingStats([], 10, 2.5, 420, 0); // 7 minutes elapsed

    expect(stats.conversationElapsedMinutes).toBe(7);
    expect(stats.timeRemainingMinutes).toBe(3);
    expect(stats.isOvertime).toBe(false);
    expect(stats.overtimeMinutes).toBe(0);
  });

  test('should detect overtime', () => {
    const stats = calculateTimeTrackingStats([], 10, 2.5, 720, 0); // 12 minutes elapsed

    expect(stats.conversationElapsedMinutes).toBe(12);
    expect(stats.timeRemainingMinutes).toBe(0);
    expect(stats.isOvertime).toBe(true);
    expect(stats.overtimeMinutes).toBe(2);
  });

  test('should detect step overtime', () => {
    const stats = calculateTimeTrackingStats([], 10, 2.5, 0, 180); // 3 minutes step, 2.5 budget

    expect(stats.stepElapsedMinutes).toBe(3);
    expect(stats.stepIsOvertime).toBe(true);
    expect(stats.stepOvertimeMinutes).toBe(0.5);
  });

  test('should handle zero step elapsed time', () => {
    const stats = calculateTimeTrackingStats([], 10, 2.5, 300, 0);

    expect(stats.stepElapsedMinutes).toBe(0);
    expect(stats.stepIsOvertime).toBe(false);
    expect(stats.stepOvertimeMinutes).toBe(0);
  });

  test('should return 0 for questionsAskedInStep when no currentStepId', () => {
    const messages = createMessages(5, 3, 'step_1');
    const stats = calculateTimeTrackingStats(messages, 10, 2.5, 0, 0);

    expect(stats.questionsAskedInStep).toBe(0);
  });

  test('should calculate durationPerRemainingStep with default values', () => {
    // 10 min total, 5 min elapsed = 5 min remaining
    // Default: 0 completed, 5 total = 5 remaining steps
    // 5 min / 5 steps = 1 min per step
    const stats = calculateTimeTrackingStats([], 10, 2, 300, 0);

    expect(stats.durationPerRemainingStep).toBe(1);
  });

  test('should calculate durationPerRemainingStep with explicit step counts', () => {
    // 10 min total, 4 min elapsed = 6 min remaining
    // 2 completed, 5 total = 3 remaining steps
    // 6 min / 3 steps = 2 min per step
    const stats = calculateTimeTrackingStats([], 10, 2, 240, 0, null, 2, 5);

    expect(stats.durationPerRemainingStep).toBe(2);
  });

  test('should redistribute time when step finishes early', () => {
    // 10 min total, 1 min elapsed (step finished early) = 9 min remaining
    // 1 completed, 5 total = 4 remaining steps
    // 9 min / 4 steps = 2.3 min per step (rounded)
    const stats = calculateTimeTrackingStats([], 10, 2, 60, 0, null, 1, 5);

    expect(stats.durationPerRemainingStep).toBe(2.3); // 9/4 = 2.25 rounded to 2.3
  });

  test('should redistribute time when step runs late', () => {
    // 10 min total, 6 min elapsed (step ran late) = 4 min remaining
    // 1 completed, 5 total = 4 remaining steps
    // 4 min / 4 steps = 1 min per step
    const stats = calculateTimeTrackingStats([], 10, 2, 360, 0, null, 1, 5);

    expect(stats.durationPerRemainingStep).toBe(1);
  });

  test('should return 0 for durationPerRemainingStep when all steps completed', () => {
    const stats = calculateTimeTrackingStats([], 10, 2, 600, 0, null, 5, 5);

    expect(stats.durationPerRemainingStep).toBe(0);
  });

  test('should return 0 for durationPerRemainingStep when overtime', () => {
    // 10 min total, 12 min elapsed = 0 min remaining
    // Remaining time is 0, so duration per step should be 0
    const stats = calculateTimeTrackingStats([], 10, 2, 720, 0, null, 2, 5);

    expect(stats.durationPerRemainingStep).toBe(0);
  });
});

// ============================================================================
// formatTimeTrackingVariables TESTS
// ============================================================================

describe('formatTimeTrackingVariables', () => {
  test('should format all time tracking variables as strings', () => {
    const stats = calculateTimeTrackingStats([], 10, 2.5, 300, 60);
    const variables = formatTimeTrackingVariables(stats);

    expect(variables.conversation_elapsed_minutes).toBe('5');
    expect(variables.step_elapsed_minutes).toBe('1');
    expect(variables.time_remaining_minutes).toBe('5');
    expect(variables.is_overtime).toBe('false');
    expect(variables.overtime_minutes).toBe('0');
    expect(variables.step_is_overtime).toBe('false');
    expect(variables.step_overtime_minutes).toBe('0');
    expect(variables.duration_per_remaining_step).toBe('1'); // 5 min remaining / 5 default steps
  });

  test('should format overtime variables correctly', () => {
    const stats = calculateTimeTrackingStats([], 10, 2.5, 720, 180); // Overtime
    const variables = formatTimeTrackingVariables(stats);

    expect(variables.is_overtime).toBe('true');
    expect(variables.overtime_minutes).toBe('2');
    expect(variables.step_is_overtime).toBe('true');
    expect(variables.step_overtime_minutes).toBe('0.5');
    expect(variables.duration_per_remaining_step).toBe('0'); // 0 remaining time
  });

  test('should format duration_per_remaining_step with step progress', () => {
    // 10 min total, 4 min elapsed = 6 min remaining
    // 2 completed, 5 total = 3 remaining steps
    // 6 min / 3 steps = 2 min per step
    const stats = calculateTimeTrackingStats([], 10, 2, 240, 0, null, 2, 5);
    const variables = formatTimeTrackingVariables(stats);

    expect(variables.duration_per_remaining_step).toBe('2');
  });
});
