/**
 * Unit tests for Conversation Plan module
 * Tests formatting functions and step completion detection
 */

import {
  formatPlanForPrompt,
  formatCurrentStepForPrompt,
  formatCompletedStepsForPrompt,
  formatPlanProgress,
  detectStepCompletion,
  getCurrentStep,
  type ConversationPlan,
  type ConversationPlanWithSteps,
  type ConversationPlanStep,
  type LegacyConversationPlanStep,
} from '../conversation-plan';

// ============================================================================
// MOCK DATA FACTORIES
// ============================================================================

function createMockStep(overrides: Partial<ConversationPlanStep> = {}): ConversationPlanStep {
  return {
    id: 'step-uuid-1',
    plan_id: 'plan-uuid-1',
    step_identifier: 'step_1',
    step_order: 1,
    title: 'Introduction',
    objective: 'Get to know the participants',
    status: 'pending',
    summary: null,
    created_at: '2024-01-15T10:00:00Z',
    activated_at: null,
    completed_at: null,
    ...overrides,
  };
}

function createMockLegacyStep(overrides: Partial<LegacyConversationPlanStep> = {}): LegacyConversationPlanStep {
  return {
    id: 'step_1',
    title: 'Introduction',
    objective: 'Get to know the participants',
    status: 'pending',
    summary: null,
    ...overrides,
  };
}

function createMockPlan(overrides: Partial<ConversationPlan> = {}): ConversationPlan {
  return {
    id: 'plan-uuid-1',
    conversation_thread_id: 'thread-uuid-1',
    title: 'Test Plan',
    objective: 'Test Objective',
    total_steps: 3,
    completed_steps: 0,
    status: 'active',
    current_step_id: 'step_1',
    plan_data: null,
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
    ...overrides,
  };
}

function createMockPlanWithSteps(overrides: Partial<ConversationPlanWithSteps> = {}): ConversationPlanWithSteps {
  return {
    ...createMockPlan(),
    steps: [
      createMockStep({
        step_identifier: 'step_1',
        step_order: 1,
        title: 'Introduction',
        objective: 'Get to know participants',
        status: 'completed',
        summary: 'Participants introduced themselves',
      }),
      createMockStep({
        id: 'step-uuid-2',
        step_identifier: 'step_2',
        step_order: 2,
        title: 'Discussion',
        objective: 'Discuss main topics',
        status: 'active',
      }),
      createMockStep({
        id: 'step-uuid-3',
        step_identifier: 'step_3',
        step_order: 3,
        title: 'Conclusion',
        objective: 'Summarize findings',
        status: 'pending',
      }),
    ],
    ...overrides,
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('Conversation Plan', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // detectStepCompletion
  // --------------------------------------------------------------------------
  describe('detectStepCompletion', () => {
    test('should detect STEP_COMPLETE:step_id format', () => {
      const content = 'Great work! STEP_COMPLETE:step_1';
      expect(detectStepCompletion(content)).toBe('step_1');
    });

    test('should detect STEP_COMPLETE: step_id format with space', () => {
      const content = 'Moving on. STEP_COMPLETE: step_2';
      expect(detectStepCompletion(content)).toBe('step_2');
    });

    test('should detect **STEP_COMPLETE:step_id** markdown bold format', () => {
      const content = 'Step completed! **STEP_COMPLETE:step_3**';
      expect(detectStepCompletion(content)).toBe('step_3');
    });

    test('should detect *STEP_COMPLETE:step_id* markdown italic format', () => {
      const content = 'Done. *STEP_COMPLETE:step_1*';
      expect(detectStepCompletion(content)).toBe('step_1');
    });

    // Note: __STEP_COMPLETE:step_id__ format has a limitation where underscore is part of \w
    // so the regex cannot cleanly separate step_id from trailing underscores.
    // Use **..** or *..*  instead for markdown formatting.
    test('should handle _STEP_COMPLETE:step_id_ markdown underscore format', () => {
      const content = 'Complete _STEP_COMPLETE:intro_';
      // Single underscore works because the regex matches the full pattern
      expect(detectStepCompletion(content)).toBe('intro');
    });

    test('should return CURRENT when no step_id provided', () => {
      const content = 'Step is done. STEP_COMPLETE:';
      expect(detectStepCompletion(content)).toBe('CURRENT');
    });

    test('should return CURRENT for **STEP_COMPLETE:** format', () => {
      const content = 'All done! **STEP_COMPLETE:**';
      expect(detectStepCompletion(content)).toBe('CURRENT');
    });

    test('should return null when no marker present', () => {
      const content = 'Just a regular message without any markers.';
      expect(detectStepCompletion(content)).toBeNull();
    });

    test('should be case insensitive', () => {
      const content = 'Done! step_complete:step_1';
      expect(detectStepCompletion(content)).toBe('step_1');
    });

    test('should handle step_id with numbers and underscores', () => {
      const content = 'STEP_COMPLETE:step_10_final';
      expect(detectStepCompletion(content)).toBe('step_10_final');
    });

    test('should detect marker in middle of content', () => {
      const content = 'Before text STEP_COMPLETE:step_1 after text';
      expect(detectStepCompletion(content)).toBe('step_1');
    });

    test('should handle multiline content', () => {
      const content = `This is a long response.

We covered many topics.

**STEP_COMPLETE:step_2**

Moving to the next step.`;
      expect(detectStepCompletion(content)).toBe('step_2');
    });
  });

  // --------------------------------------------------------------------------
  // formatPlanForPrompt
  // --------------------------------------------------------------------------
  describe('formatPlanForPrompt', () => {
    test('should format plan with normalized steps', () => {
      const plan = createMockPlanWithSteps();

      const result = formatPlanForPrompt(plan);

      expect(result).toContain('Plan de conversation');
      expect(result).toContain('3 étapes');
      expect(result).toContain('Introduction');
      expect(result).toContain('Discussion');
      expect(result).toContain('Conclusion');
    });

    test('should include correct status emojis', () => {
      const plan = createMockPlanWithSteps();

      const result = formatPlanForPrompt(plan);

      expect(result).toContain('✅'); // completed
      expect(result).toContain('▶️'); // active
      expect(result).toContain('⏳'); // pending
    });

    test('should include step identifiers', () => {
      const plan = createMockPlanWithSteps();

      const result = formatPlanForPrompt(plan);

      expect(result).toContain('step_1');
      expect(result).toContain('step_2');
      expect(result).toContain('step_3');
    });

    test('should include objectives', () => {
      const plan = createMockPlanWithSteps();

      const result = formatPlanForPrompt(plan);

      expect(result).toContain('Objectif:');
      expect(result).toContain('Get to know participants');
    });

    test('should fall back to legacy plan_data format', () => {
      const plan: ConversationPlan = {
        ...createMockPlan(),
        plan_data: {
          steps: [
            createMockLegacyStep({ id: 'step_1', title: 'Legacy Step', status: 'active' }),
          ],
        },
      };

      const result = formatPlanForPrompt(plan);

      expect(result).toContain('Legacy Step');
      expect(result).toContain('▶️');
    });

    test('should return default message when no plan data', () => {
      const plan: ConversationPlan = {
        ...createMockPlan(),
        plan_data: null,
      };

      const result = formatPlanForPrompt(plan);

      expect(result).toBe('Aucun plan disponible');
    });

    test('should handle skipped status', () => {
      const plan = createMockPlanWithSteps({
        steps: [
          createMockStep({ status: 'skipped', step_identifier: 'step_1' }),
        ],
      });

      const result = formatPlanForPrompt(plan);

      expect(result).toContain('⏭️');
    });
  });

  // --------------------------------------------------------------------------
  // formatCurrentStepForPrompt
  // --------------------------------------------------------------------------
  describe('formatCurrentStepForPrompt', () => {
    test('should format normalized step', () => {
      const step = createMockStep({
        step_identifier: 'step_2',
        title: 'Main Discussion',
        objective: 'Cover all main topics',
        status: 'active',
      });

      const result = formatCurrentStepForPrompt(step);

      expect(result).toContain('Étape courante: Main Discussion');
      expect(result).toContain('step_2');
      expect(result).toContain('Objectif: Cover all main topics');
      expect(result).toContain('Statut: active');
    });

    test('should format legacy step', () => {
      const step = createMockLegacyStep({
        id: 'step_1',
        title: 'Intro',
        objective: 'Introduce everyone',
        status: 'active',
      });

      const result = formatCurrentStepForPrompt(step);

      expect(result).toContain('Intro');
      expect(result).toContain('step_1');
    });

    test('should return default message when step is null', () => {
      const result = formatCurrentStepForPrompt(null);

      expect(result).toBe('Aucune étape active');
    });
  });

  // --------------------------------------------------------------------------
  // formatCompletedStepsForPrompt
  // --------------------------------------------------------------------------
  describe('formatCompletedStepsForPrompt', () => {
    test('should format completed steps with summaries', () => {
      const plan = createMockPlanWithSteps();

      const result = formatCompletedStepsForPrompt(plan);

      expect(result).toContain('Étapes complétées');
      expect(result).toContain('1/3');
      expect(result).toContain('✅ Introduction');
      expect(result).toContain('Résumé: Participants introduced themselves');
    });

    test('should return default message when no completed steps', () => {
      const plan = createMockPlanWithSteps({
        steps: [
          createMockStep({ status: 'active' }),
          createMockStep({ status: 'pending', step_order: 2, step_identifier: 'step_2' }),
        ],
      });

      const result = formatCompletedStepsForPrompt(plan);

      expect(result).toBe('Aucune étape complétée pour le moment');
    });

    test('should show default summary when none provided', () => {
      const plan = createMockPlanWithSteps({
        steps: [
          createMockStep({ status: 'completed', summary: null }),
        ],
      });

      const result = formatCompletedStepsForPrompt(plan);

      expect(result).toContain('Pas de résumé disponible');
    });

    test('should fall back to legacy format', () => {
      const plan: ConversationPlan = {
        ...createMockPlan(),
        plan_data: {
          steps: [
            createMockLegacyStep({
              id: 'step_1',
              title: 'Done Step',
              status: 'completed',
              summary: 'Legacy summary',
            }),
          ],
        },
      };

      const result = formatCompletedStepsForPrompt(plan);

      expect(result).toContain('Done Step');
      expect(result).toContain('Legacy summary');
    });

    test('should return default when no steps at all', () => {
      const plan: ConversationPlan = {
        ...createMockPlan(),
        plan_data: null,
      };

      const result = formatCompletedStepsForPrompt(plan);

      expect(result).toBe('Aucune étape complétée');
    });
  });

  // --------------------------------------------------------------------------
  // formatPlanProgress
  // --------------------------------------------------------------------------
  describe('formatPlanProgress', () => {
    test('should format progress correctly', () => {
      const plan = createMockPlan({
        completed_steps: 2,
        total_steps: 5,
      });

      const result = formatPlanProgress(plan);

      expect(result).toBe('Progression du plan: 2/5 étapes (40%)');
    });

    test('should show 0% when no steps completed', () => {
      const plan = createMockPlan({
        completed_steps: 0,
        total_steps: 3,
      });

      const result = formatPlanProgress(plan);

      expect(result).toContain('0/3');
      expect(result).toContain('0%');
    });

    test('should show 100% when all steps completed', () => {
      const plan = createMockPlan({
        completed_steps: 4,
        total_steps: 4,
      });

      const result = formatPlanProgress(plan);

      expect(result).toContain('4/4');
      expect(result).toContain('100%');
    });

    test('should handle edge case of zero total steps', () => {
      const plan = createMockPlan({
        completed_steps: 0,
        total_steps: 0,
      });

      const result = formatPlanProgress(plan);

      expect(result).toContain('0/0');
      expect(result).toContain('0%');
    });

    test('should round percentage', () => {
      const plan = createMockPlan({
        completed_steps: 1,
        total_steps: 3,
      });

      const result = formatPlanProgress(plan);

      expect(result).toContain('33%'); // 33.33... rounded
    });
  });

  // --------------------------------------------------------------------------
  // getCurrentStep
  // --------------------------------------------------------------------------
  describe('getCurrentStep', () => {
    test('should return current step from normalized steps', () => {
      const plan = createMockPlanWithSteps({
        current_step_id: 'step_2',
      });

      const result = getCurrentStep(plan);

      expect(result).not.toBeNull();
      expect((result as ConversationPlanStep).step_identifier).toBe('step_2');
      expect(result?.title).toBe('Discussion');
    });

    test('should return null when no current_step_id', () => {
      const plan = createMockPlanWithSteps({
        current_step_id: null,
      });

      const result = getCurrentStep(plan);

      expect(result).toBeNull();
    });

    test('should fall back to legacy plan_data', () => {
      const plan: ConversationPlan = {
        ...createMockPlan(),
        current_step_id: 'step_1',
        plan_data: {
          steps: [
            createMockLegacyStep({ id: 'step_1', title: 'Legacy Current Step' }),
          ],
        },
      };

      const result = getCurrentStep(plan);

      expect(result).not.toBeNull();
      expect(result?.title).toBe('Legacy Current Step');
    });

    test('should return null when step not found', () => {
      const plan = createMockPlanWithSteps({
        current_step_id: 'nonexistent_step',
      });

      const result = getCurrentStep(plan);

      expect(result).toBeNull();
    });

    test('should return null when no steps available', () => {
      const plan: ConversationPlan = {
        ...createMockPlan(),
        current_step_id: 'step_1',
        plan_data: null,
      };

      const result = getCurrentStep(plan);

      expect(result).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // BUG-025: Step status validation
  // --------------------------------------------------------------------------
  describe('BUG-025: Step status validation', () => {
    test('should identify completed steps correctly', () => {
      const plan = createMockPlanWithSteps({
        steps: [
          createMockStep({
            step_identifier: 'step_1',
            status: 'completed',
          }),
          createMockStep({
            id: 'step-uuid-2',
            step_identifier: 'step_2',
            step_order: 2,
            status: 'active',
          }),
        ],
        current_step_id: 'step_2',
      });

      const currentStep = getCurrentStep(plan);
      expect(currentStep).not.toBeNull();
      expect((currentStep as ConversationPlanStep).status).toBe('active');
    });

    test('should identify skipped steps correctly', () => {
      const plan = createMockPlanWithSteps({
        steps: [
          createMockStep({
            step_identifier: 'step_1',
            status: 'skipped',
          }),
          createMockStep({
            id: 'step-uuid-2',
            step_identifier: 'step_2',
            step_order: 2,
            status: 'active',
          }),
        ],
        current_step_id: 'step_2',
      });

      const skippedStep = plan.steps.find(s => s.step_identifier === 'step_1');
      expect(skippedStep?.status).toBe('skipped');
    });

    test('formatPlanForPrompt shows correct status for all step states', () => {
      const plan = createMockPlanWithSteps({
        steps: [
          createMockStep({ step_identifier: 'step_1', step_order: 1, status: 'completed' }),
          createMockStep({ id: 'step-uuid-2', step_identifier: 'step_2', step_order: 2, status: 'skipped' }),
          createMockStep({ id: 'step-uuid-3', step_identifier: 'step_3', step_order: 3, status: 'active' }),
          createMockStep({ id: 'step-uuid-4', step_identifier: 'step_4', step_order: 4, status: 'pending' }),
        ],
      });

      const result = formatPlanForPrompt(plan);

      expect(result).toContain('✅'); // completed
      expect(result).toContain('⏭️'); // skipped
      expect(result).toContain('▶️'); // active
      expect(result).toContain('⏳'); // pending
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases and Integration
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    test('should handle special characters in step titles', () => {
      const plan = createMockPlanWithSteps({
        steps: [
          createMockStep({
            title: 'Step with "quotes" & <tags>',
            objective: 'Test special chars: éàüö',
            status: 'active',
          }),
        ],
      });

      const result = formatPlanForPrompt(plan);

      expect(result).toContain('"quotes"');
      expect(result).toContain('&');
      expect(result).toContain('éàüö');
    });

    test('should handle very long step titles', () => {
      const longTitle = 'A'.repeat(500);
      const plan = createMockPlanWithSteps({
        steps: [
          createMockStep({ title: longTitle, status: 'active' }),
        ],
      });

      const result = formatPlanForPrompt(plan);

      expect(result).toContain(longTitle);
    });

    test('should handle empty step arrays', () => {
      const plan = createMockPlanWithSteps({
        steps: [],
      });

      const result = formatPlanForPrompt(plan);

      expect(result).toContain('0 étapes');
    });

    test('should handle plan with many steps', () => {
      const steps = Array.from({ length: 20 }, (_, i) =>
        createMockStep({
          id: `step-uuid-${i + 1}`,
          step_identifier: `step_${i + 1}`,
          step_order: i + 1,
          title: `Step ${i + 1}`,
          status: i < 10 ? 'completed' : i === 10 ? 'active' : 'pending',
        })
      );

      const plan = createMockPlanWithSteps({ steps });

      const result = formatPlanForPrompt(plan);

      expect(result).toContain('20 étapes');
      expect(result).toContain('step_20');
    });
  });
});
