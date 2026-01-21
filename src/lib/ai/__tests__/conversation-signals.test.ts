/**
 * @jest-environment node
 */

import {
  detectConversationSignals,
  hasSignals,
  cleanAllSignalMarkers,
  formatSubtopicsForPrompt,
  type ConversationSignals,
  type DiscoveredSubtopic,
} from '../conversation-signals';

// ============================================================================
// detectConversationSignals TESTS
// ============================================================================

describe('detectConversationSignals', () => {
  describe('STEP_COMPLETE detection', () => {
    test('should detect STEP_COMPLETE:step_1', () => {
      const content = 'Some message STEP_COMPLETE:step_1';
      const signals = detectConversationSignals(content);

      expect(signals.stepComplete).toBeDefined();
      expect(signals.stepComplete?.stepId).toBe('step_1');
    });

    test('should detect STEP_COMPLETE: step_2 (with space)', () => {
      const content = 'Message STEP_COMPLETE: step_2';
      const signals = detectConversationSignals(content);

      expect(signals.stepComplete).toBeDefined();
      expect(signals.stepComplete?.stepId).toBe('step_2');
    });

    test('should detect **STEP_COMPLETE:step_1** (markdown)', () => {
      const content = '**STEP_COMPLETE:step_1** Rest of message';
      const signals = detectConversationSignals(content);

      expect(signals.stepComplete).toBeDefined();
      expect(signals.stepComplete?.stepId).toBe('step_1');
    });

    test('should return CURRENT for STEP_COMPLETE without valid step ID', () => {
      const content = 'STEP_COMPLETE: Compréhension terminée';
      const signals = detectConversationSignals(content);

      expect(signals.stepComplete).toBeDefined();
      expect(signals.stepComplete?.stepId).toBe('CURRENT');
    });

    test('should return CURRENT for bare STEP_COMPLETE:', () => {
      const content = 'STEP_COMPLETE:';
      const signals = detectConversationSignals(content);

      expect(signals.stepComplete).toBeDefined();
      expect(signals.stepComplete?.stepId).toBe('CURRENT');
    });
  });

  describe('TOPICS_DISCOVERED detection', () => {
    test('should detect TOPICS_DISCOVERED with valid JSON array', () => {
      const content = 'Message TOPICS_DISCOVERED:[{"label":"print","priority":"high"},{"label":"digital","priority":"medium"}]';
      const signals = detectConversationSignals(content);

      expect(signals.topicsDiscovered).toBeDefined();
      expect(signals.topicsDiscovered?.topics).toHaveLength(2);
      expect(signals.topicsDiscovered?.topics[0]).toEqual({
        label: 'print',
        priority: 'high',
        relevant_for_steps: undefined,
      });
      expect(signals.topicsDiscovered?.topics[1]).toEqual({
        label: 'digital',
        priority: 'medium',
        relevant_for_steps: undefined,
      });
    });

    test('should handle TOPICS_DISCOVERED with relevant_for_steps', () => {
      const content = 'TOPICS_DISCOVERED:[{"label":"print","priority":"high","relevant_for_steps":["step_3","step_4"]}]';
      const signals = detectConversationSignals(content);

      expect(signals.topicsDiscovered?.topics[0].relevant_for_steps).toEqual(['step_3', 'step_4']);
    });

    test('should normalize invalid priority to medium', () => {
      const content = 'TOPICS_DISCOVERED:[{"label":"test","priority":"invalid"}]';
      const signals = detectConversationSignals(content);

      expect(signals.topicsDiscovered?.topics[0].priority).toBe('medium');
    });

    test('should filter out topics with empty labels', () => {
      const content = 'TOPICS_DISCOVERED:[{"label":"","priority":"high"},{"label":"valid","priority":"low"}]';
      const signals = detectConversationSignals(content);

      expect(signals.topicsDiscovered?.topics).toHaveLength(1);
      expect(signals.topicsDiscovered?.topics[0].label).toBe('valid');
    });

    test('should handle invalid JSON gracefully', () => {
      const content = 'TOPICS_DISCOVERED:[invalid json]';
      const signals = detectConversationSignals(content);

      expect(signals.topicsDiscovered).toBeUndefined();
    });

    test('should handle empty array', () => {
      const content = 'TOPICS_DISCOVERED:[]';
      const signals = detectConversationSignals(content);

      expect(signals.topicsDiscovered).toBeUndefined();
    });
  });

  describe('TOPIC_EXPLORED detection', () => {
    test('should detect TOPIC_EXPLORED:subtopic_1', () => {
      const content = 'Message TOPIC_EXPLORED:subtopic_1';
      const signals = detectConversationSignals(content);

      expect(signals.topicExplored).toBeDefined();
      expect(signals.topicExplored?.topicId).toBe('subtopic_1');
    });

    test('should detect TOPIC_EXPLORED: subtopic_2 (with space)', () => {
      const content = 'TOPIC_EXPLORED: subtopic_2';
      const signals = detectConversationSignals(content);

      expect(signals.topicExplored?.topicId).toBe('subtopic_2');
    });
  });

  describe('TOPIC_SKIPPED detection', () => {
    test('should detect TOPIC_SKIPPED:subtopic_3', () => {
      const content = 'TOPIC_SKIPPED:subtopic_3';
      const signals = detectConversationSignals(content);

      expect(signals.topicSkipped).toBeDefined();
      expect(signals.topicSkipped?.topicId).toBe('subtopic_3');
    });
  });

  describe('Multiple signals', () => {
    test('should detect multiple signals in same content', () => {
      const content = `
        TOPICS_DISCOVERED:[{"label":"topic1","priority":"high"}]
        Some discussion...
        TOPIC_EXPLORED:subtopic_1
        Final wrap up
        STEP_COMPLETE:step_1
      `;
      const signals = detectConversationSignals(content);

      expect(signals.topicsDiscovered?.topics).toHaveLength(1);
      expect(signals.topicExplored?.topicId).toBe('subtopic_1');
      expect(signals.stepComplete?.stepId).toBe('step_1');
    });
  });

  describe('No signals', () => {
    test('should return empty object for content without signals', () => {
      const content = 'This is just a normal message without any signals.';
      const signals = detectConversationSignals(content);

      expect(signals).toEqual({});
    });

    test('should return empty object for empty content', () => {
      const signals = detectConversationSignals('');

      expect(signals).toEqual({});
    });
  });
});

// ============================================================================
// hasSignals TESTS
// ============================================================================

describe('hasSignals', () => {
  test('should return true when stepComplete is present', () => {
    const signals: ConversationSignals = { stepComplete: { stepId: 'step_1' } };
    expect(hasSignals(signals)).toBe(true);
  });

  test('should return true when topicsDiscovered is present', () => {
    const signals: ConversationSignals = {
      topicsDiscovered: { topics: [{ label: 'test', priority: 'high' }] },
    };
    expect(hasSignals(signals)).toBe(true);
  });

  test('should return true when topicExplored is present', () => {
    const signals: ConversationSignals = { topicExplored: { topicId: 'subtopic_1' } };
    expect(hasSignals(signals)).toBe(true);
  });

  test('should return true when topicSkipped is present', () => {
    const signals: ConversationSignals = { topicSkipped: { topicId: 'subtopic_1' } };
    expect(hasSignals(signals)).toBe(true);
  });

  test('should return false for empty signals', () => {
    expect(hasSignals({})).toBe(false);
  });
});

// ============================================================================
// cleanAllSignalMarkers TESTS
// ============================================================================

describe('cleanAllSignalMarkers', () => {
  test('should remove STEP_COMPLETE markers', () => {
    const content = 'Hello STEP_COMPLETE:step_1 World';
    expect(cleanAllSignalMarkers(content)).toBe('Hello  World');
  });

  test('should remove TOPICS_DISCOVERED markers', () => {
    const content = 'Before TOPICS_DISCOVERED:[{"label":"test"}] After';
    expect(cleanAllSignalMarkers(content)).toBe('Before  After');
  });

  test('should remove TOPIC_EXPLORED markers', () => {
    const content = 'Text TOPIC_EXPLORED:subtopic_1 more text';
    expect(cleanAllSignalMarkers(content)).toBe('Text  more text');
  });

  test('should remove TOPIC_SKIPPED markers', () => {
    const content = 'Start TOPIC_SKIPPED:subtopic_2 end';
    expect(cleanAllSignalMarkers(content)).toBe('Start  end');
  });

  test('should remove multiple markers', () => {
    const content = 'TOPICS_DISCOVERED:[{"label":"x"}] Some text STEP_COMPLETE:step_1';
    expect(cleanAllSignalMarkers(content)).toBe('Some text');
  });

  test('should handle markdown-wrapped markers', () => {
    const content = '**STEP_COMPLETE:step_1** Some text';
    expect(cleanAllSignalMarkers(content)).toBe('Some text');
  });
});

// ============================================================================
// formatSubtopicsForPrompt TESTS
// ============================================================================

describe('formatSubtopicsForPrompt', () => {
  test('should return message for null subtopics', () => {
    expect(formatSubtopicsForPrompt(null)).toBe('Aucun sous-sujet découvert dans cette étape.');
  });

  test('should return message for empty array', () => {
    expect(formatSubtopicsForPrompt([])).toBe('Aucun sous-sujet découvert dans cette étape.');
  });

  test('should format pending subtopic correctly', () => {
    const subtopics: DiscoveredSubtopic[] = [{
      id: 'subtopic_1',
      label: 'Canal print',
      status: 'pending',
      priority: 'high',
      discovered_at: '2024-01-20T14:07:00Z',
      explored_at: null,
    }];

    const result = formatSubtopicsForPrompt(subtopics);
    expect(result).toContain('## Sous-sujets découverts dans cette étape:');
    expect(result).toContain('[ ] Canal print (priorité haute)');
  });

  test('should format explored subtopic correctly', () => {
    const subtopics: DiscoveredSubtopic[] = [{
      id: 'subtopic_1',
      label: 'Canal digital',
      status: 'explored',
      priority: 'medium',
      discovered_at: '2024-01-20T14:07:00Z',
      explored_at: '2024-01-20T14:10:00Z',
    }];

    const result = formatSubtopicsForPrompt(subtopics);
    expect(result).toContain('[x] Canal digital');
    expect(result).not.toContain('priorité'); // Medium priority has no label
  });

  test('should format skipped subtopic correctly', () => {
    const subtopics: DiscoveredSubtopic[] = [{
      id: 'subtopic_1',
      label: 'Face-à-face',
      status: 'skipped',
      priority: 'low',
      discovered_at: '2024-01-20T14:07:00Z',
      explored_at: null,
    }];

    const result = formatSubtopicsForPrompt(subtopics);
    expect(result).toContain('[-] Face-à-face (priorité basse)');
  });

  test('should format multiple subtopics', () => {
    const subtopics: DiscoveredSubtopic[] = [
      { id: 'subtopic_1', label: 'Print', status: 'explored', priority: 'high', discovered_at: '', explored_at: '' },
      { id: 'subtopic_2', label: 'Digital', status: 'pending', priority: 'medium', discovered_at: '', explored_at: null },
      { id: 'subtopic_3', label: 'Tel', status: 'skipped', priority: 'low', discovered_at: '', explored_at: null },
    ];

    const result = formatSubtopicsForPrompt(subtopics);
    expect(result).toContain('[x] Print');
    expect(result).toContain('[ ] Digital');
    expect(result).toContain('[-] Tel');
  });
});
