/**
 * Unit tests for Agent Variables
 * Tests all variables for both text conversation agents and voice/speech agents
 */

import { buildConversationAgentVariables, buildParticipantDetails, ConversationAgentContext, ConversationMessageSummary, ConversationParticipantSummary } from '../conversation-agent';
import { PROMPT_VARIABLES, HANDLEBARS_HELPERS_DOC } from '../constants';
import type { Insight } from '@/types';

// ============================================================================
// MOCK DATA FACTORIES
// ============================================================================

function createMockMessage(overrides: Partial<ConversationMessageSummary> = {}): ConversationMessageSummary {
  return {
    id: 'msg-1',
    senderType: 'user',
    senderName: 'Alice',
    content: 'Hello, this is a test message',
    timestamp: '2024-01-15T10:30:00Z',
    planStepId: null,
    ...overrides,
  };
}

function createMockParticipant(overrides: Partial<ConversationParticipantSummary> = {}): ConversationParticipantSummary {
  return {
    name: 'Alice Martin',
    role: 'Manager',
    description: null,
    ...overrides,
  };
}

function createMockConversationPlan() {
  return {
    id: 'plan-1',
    conversation_thread_id: 'thread-1',
    title: 'Test Plan',
    objective: 'Test Objective',
    total_steps: 3,
    completed_steps: 1,
    status: 'active' as const,
    current_step_id: 'step_2',
    steps: [
      {
        id: 'step-uuid-1',
        plan_id: 'plan-1',
        step_identifier: 'step_1',
        step_order: 1,
        title: 'Introduction',
        objective: 'Get to know participants',
        status: 'completed' as const,
        summary: 'Completed introduction successfully',
        created_at: '2024-01-15T10:00:00Z',
        activated_at: '2024-01-15T10:00:00Z',
        completed_at: '2024-01-15T10:15:00Z',
      },
      {
        id: 'step-uuid-2',
        plan_id: 'plan-1',
        step_identifier: 'step_2',
        step_order: 2,
        title: 'Discussion',
        objective: 'Discuss main topics',
        status: 'active' as const,
        summary: null,
        created_at: '2024-01-15T10:00:00Z',
        activated_at: '2024-01-15T10:15:00Z',
        completed_at: null,
      },
      {
        id: 'step-uuid-3',
        plan_id: 'plan-1',
        step_identifier: 'step_3',
        step_order: 3,
        title: 'Conclusion',
        objective: 'Summarize findings',
        status: 'pending' as const,
        summary: null,
        created_at: '2024-01-15T10:00:00Z',
        activated_at: null,
        completed_at: null,
      },
    ],
    plan_data: null,
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:30:00Z',
  };
}

function createMockInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: 'insight-1',
    type: 'pain',
    content: 'Users find the onboarding process confusing',
    summary: 'Onboarding confusion',
    category: 'UX',
    priority: 'high',
    status: 'active',
    challengeId: 'challenge-1',
    relatedChallengeIds: [],
    sourceMessageId: 'msg-1',
    authorId: 'user-1',
    authorName: 'Alice Martin',
    authors: [{ userId: 'user-1', name: 'Alice Martin' }],
    kpis: [],
    ...overrides,
  };
}

function createMinimalContext(): ConversationAgentContext {
  return {
    ask: {
      ask_key: 'test-ask',
      question: 'What is the meaning of life?',
      description: null,
      system_prompt: null,
    },
    project: null,
    challenge: null,
    messages: [],
    participants: [],
    conversationPlan: null,
  };
}

function createFullContext(): ConversationAgentContext {
  return {
    ask: {
      ask_key: 'ask-2024-onboarding',
      question: 'Comment améliorer notre processus d\'onboarding?',
      description: 'Session de brainstorming pour identifier les points de friction',
      system_prompt: 'Concentrez-vous sur les idées innovantes et réalisables',
    },
    project: {
      system_prompt: 'Ce projet vise à transformer notre expérience utilisateur',
    },
    challenge: {
      system_prompt: 'Challenge: Optimiser le temps d\'onboarding de 30%',
    },
    messages: [
      createMockMessage({
        id: 'msg-1',
        senderType: 'user',
        senderName: 'Alice Martin',
        content: 'Bonjour, je pense que le processus est trop long',
        timestamp: '2024-01-15T10:30:00Z',
        planStepId: 'step-uuid-1',
      }),
      createMockMessage({
        id: 'msg-2',
        senderType: 'ai',
        senderName: null,
        content: 'Merci pour votre retour. Pouvez-vous préciser quelles étapes sont les plus longues?',
        timestamp: '2024-01-15T10:31:00Z',
        planStepId: 'step-uuid-1',
      }),
      createMockMessage({
        id: 'msg-3',
        senderType: 'user',
        senderName: 'Bob Dupont',
        content: 'La vérification des documents prend trop de temps',
        timestamp: '2024-01-15T10:32:00Z',
        planStepId: 'step-uuid-2',
      }),
    ],
    participants: [
      createMockParticipant({ name: 'Alice Martin', role: 'Manager' }),
      createMockParticipant({ name: 'Bob Dupont', role: 'Developer' }),
    ],
    conversationPlan: createMockConversationPlan(),
    insights: [
      createMockInsight({
        id: 'insight-1',
        type: 'pain',
        content: 'Document verification takes too long',
      }),
      createMockInsight({
        id: 'insight-2',
        type: 'idea',
        content: 'Use AI to pre-validate documents',
      }),
    ],
    insightTypes: 'pain,idea,solution',
    latestAiResponse: 'Merci pour votre retour. Pouvez-vous préciser quelles étapes sont les plus longues?',
  };
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Agent Variables', () => {
  // Suppress console logs during tests
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Session Variables (ask_key, ask_question, ask_description)
  // --------------------------------------------------------------------------
  describe('Session Variables', () => {
    test('should include ask_key from context', () => {
      const context = createMinimalContext();
      context.ask.ask_key = 'unique-ask-key-123';

      const variables = buildConversationAgentVariables(context);

      expect(variables.ask_key).toBe('unique-ask-key-123');
    });

    test('should include ask_question from context', () => {
      const context = createMinimalContext();
      context.ask.question = 'How can we improve customer satisfaction?';

      const variables = buildConversationAgentVariables(context);

      expect(variables.ask_question).toBe('How can we improve customer satisfaction?');
    });

    test('should include ask_description when provided', () => {
      const context = createMinimalContext();
      context.ask.description = 'Focus on digital channels';

      const variables = buildConversationAgentVariables(context);

      expect(variables.ask_description).toBe('Focus on digital channels');
    });

    test('should convert null ask_description to empty string', () => {
      const context = createMinimalContext();
      context.ask.description = null;

      const variables = buildConversationAgentVariables(context);

      expect(variables.ask_description).toBe('');
    });

    test('should handle special characters in ask fields', () => {
      const context = createMinimalContext();
      context.ask.question = 'Question avec des accents: éàüö et symboles <>&"\'';
      context.ask.description = 'Description avec\nretour à la ligne';

      const variables = buildConversationAgentVariables(context);

      expect(variables.ask_question).toBe('Question avec des accents: éàüö et symboles <>&"\'');
      expect(variables.ask_description).toBe('Description avec\nretour à la ligne');
    });
  });

  // --------------------------------------------------------------------------
  // System Prompt Variables
  // --------------------------------------------------------------------------
  describe('System Prompt Variables', () => {
    test('should include system_prompt_ask when provided', () => {
      const context = createMinimalContext();
      context.ask.system_prompt = 'Be concise and helpful';

      const variables = buildConversationAgentVariables(context);

      expect(variables.system_prompt_ask).toBe('Be concise and helpful');
    });

    test('should include system_prompt_project when provided', () => {
      const context = createMinimalContext();
      context.project = { system_prompt: 'This project focuses on UX improvement' };

      const variables = buildConversationAgentVariables(context);

      expect(variables.system_prompt_project).toBe('This project focuses on UX improvement');
    });

    test('should include system_prompt_challenge when provided', () => {
      const context = createMinimalContext();
      context.challenge = { system_prompt: 'Challenge: Reduce bounce rate by 20%' };

      const variables = buildConversationAgentVariables(context);

      expect(variables.system_prompt_challenge).toBe('Challenge: Reduce bounce rate by 20%');
    });

    test('should convert null system prompts to empty strings', () => {
      const context = createMinimalContext();
      context.ask.system_prompt = null;
      context.project = { system_prompt: null };
      context.challenge = { system_prompt: null };

      const variables = buildConversationAgentVariables(context);

      expect(variables.system_prompt_ask).toBe('');
      expect(variables.system_prompt_project).toBe('');
      expect(variables.system_prompt_challenge).toBe('');
    });

    test('should handle missing project and challenge objects', () => {
      const context = createMinimalContext();
      context.project = null;
      context.challenge = null;

      const variables = buildConversationAgentVariables(context);

      expect(variables.system_prompt_project).toBe('');
      expect(variables.system_prompt_challenge).toBe('');
    });

    test('should handle all three system prompts together', () => {
      const context = createFullContext();

      const variables = buildConversationAgentVariables(context);

      expect(variables.system_prompt_ask).toBe('Concentrez-vous sur les idées innovantes et réalisables');
      expect(variables.system_prompt_project).toBe('Ce projet vise à transformer notre expérience utilisateur');
      expect(variables.system_prompt_challenge).toBe('Challenge: Optimiser le temps d\'onboarding de 30%');
    });
  });

  // --------------------------------------------------------------------------
  // Participant Variables
  // --------------------------------------------------------------------------
  describe('Participant Variables', () => {
    test('should include participant_name from last user message', () => {
      const context = createMinimalContext();
      context.messages = [
        createMockMessage({ senderType: 'user', senderName: 'Alice', content: 'First message' }),
        createMockMessage({ senderType: 'ai', senderName: null, content: 'AI response' }),
        createMockMessage({ senderType: 'user', senderName: 'Bob', content: 'Last message' }),
      ];

      const variables = buildConversationAgentVariables(context);

      expect(variables.participant_name).toBe('Bob');
    });

    test('should return empty string for participant_name when no user messages', () => {
      const context = createMinimalContext();
      context.messages = [
        createMockMessage({ senderType: 'ai', senderName: null, content: 'AI message' }),
      ];

      const variables = buildConversationAgentVariables(context);

      expect(variables.participant_name).toBe('');
    });

    test('should include participant_description from last user message sender', () => {
      const context = createMinimalContext();
      context.participants = [
        createMockParticipant({ name: 'Alice', role: 'Manager', description: 'Senior PM with 10 years experience' }),
        createMockParticipant({ name: 'Bob', role: 'Developer', description: 'Full-stack developer specializing in React' }),
      ];
      context.messages = [
        createMockMessage({ senderType: 'user', senderName: 'Alice', content: 'First message' }),
        createMockMessage({ senderType: 'ai', senderName: null, content: 'AI response' }),
        createMockMessage({ senderType: 'user', senderName: 'Bob', content: 'Last message' }),
      ];

      const variables = buildConversationAgentVariables(context);

      expect(variables.participant_description).toBe('Full-stack developer specializing in React');
    });

    test('should return empty string for participant_description when participant not found', () => {
      const context = createMinimalContext();
      context.participants = [
        createMockParticipant({ name: 'Alice', description: 'Alice description' }),
      ];
      context.messages = [
        createMockMessage({ senderType: 'user', senderName: 'Unknown', content: 'Message' }),
      ];

      const variables = buildConversationAgentVariables(context);

      expect(variables.participant_description).toBe('');
    });

    test('should return empty string for participant_description when description is null', () => {
      const context = createMinimalContext();
      context.participants = [
        createMockParticipant({ name: 'Alice', description: null }),
      ];
      context.messages = [
        createMockMessage({ senderType: 'user', senderName: 'Alice', content: 'Message' }),
      ];

      const variables = buildConversationAgentVariables(context);

      expect(variables.participant_description).toBe('');
    });

    test('should use first participant as fallback when no user messages', () => {
      const context = createMinimalContext();
      context.participants = [
        createMockParticipant({ name: 'Alice', description: 'Alice description' }),
      ];
      context.messages = [
        createMockMessage({ senderType: 'ai', senderName: null, content: 'AI message' }),
      ];

      const variables = buildConversationAgentVariables(context);

      // BUG FIX: Now uses first participant as fallback when no user messages
      // This is important for initial greeting messages
      expect(variables.participant_description).toBe('Alice description');
      expect(variables.participant_name).toBe('Alice');
    });

    test('should format participants as comma-separated string (legacy format)', () => {
      const context = createMinimalContext();
      context.participants = [
        createMockParticipant({ name: 'Alice Martin', role: 'Manager' }),
        createMockParticipant({ name: 'Bob Dupont', role: 'Developer' }),
      ];

      const variables = buildConversationAgentVariables(context);

      expect(variables.participants).toBe('Alice Martin (Manager), Bob Dupont (Developer)');
    });

    test('should handle participants without roles', () => {
      const context = createMinimalContext();
      context.participants = [
        createMockParticipant({ name: 'Alice', role: null }),
        createMockParticipant({ name: 'Bob', role: undefined }),
      ];

      const variables = buildConversationAgentVariables(context);

      expect(variables.participants).toBe('Alice, Bob');
    });

    test('should include participants_list as array for Handlebars iteration', () => {
      const context = createMinimalContext();
      context.participants = [
        createMockParticipant({ name: 'Alice', role: 'Manager', description: 'PM expert' }),
        createMockParticipant({ name: 'Bob', role: 'Developer', description: null }),
      ];

      const variables = buildConversationAgentVariables(context);

      expect(Array.isArray(variables.participants_list)).toBe(true);
      expect(variables.participants_list).toHaveLength(2);
      expect(variables.participants_list![0]).toEqual({ name: 'Alice', role: 'Manager', description: 'PM expert' });
      expect(variables.participants_list![1]).toEqual({ name: 'Bob', role: 'Developer', description: null });
    });

    test('should handle empty participants list', () => {
      const context = createMinimalContext();
      context.participants = [];

      const variables = buildConversationAgentVariables(context);

      expect(variables.participants).toBe('');
      expect(variables.participants_list).toEqual([]);
    });

    test('should filter out participants with empty names', () => {
      const context = createMinimalContext();
      context.participants = [
        createMockParticipant({ name: 'Alice', role: 'Manager' }),
        createMockParticipant({ name: '', role: 'Developer' }),
        createMockParticipant({ name: '  ', role: 'Designer' }),
        createMockParticipant({ name: 'Bob', role: 'Analyst' }),
      ];

      const variables = buildConversationAgentVariables(context);

      // The participants string should only include valid participants
      expect(variables.participants).toBe('Alice (Manager), Bob (Analyst)');
    });

    test('should include participant_details with name, role, and description', () => {
      const context = createMinimalContext();
      context.participants = [
        createMockParticipant({
          name: 'Alice Martin',
          role: 'Product Manager',
          description: '5 ans d\'expérience en transformation digitale',
        }),
      ];
      context.messages = [
        createMockMessage({ senderType: 'user', senderName: 'Alice Martin', content: 'Hello' }),
      ];

      const variables = buildConversationAgentVariables(context);

      expect(variables.participant_details).toContain('Nom: Alice Martin');
      expect(variables.participant_details).toContain('Rôle: Product Manager');
      expect(variables.participant_details).toContain('Description: 5 ans d\'expérience en transformation digitale');
    });

    test('should include participant_details with only name and role when no description', () => {
      const context = createMinimalContext();
      context.participants = [
        createMockParticipant({
          name: 'Bob Dupont',
          role: 'Developer',
          description: null,
        }),
      ];
      context.messages = [
        createMockMessage({ senderType: 'user', senderName: 'Bob Dupont', content: 'Hello' }),
      ];

      const variables = buildConversationAgentVariables(context);

      expect(variables.participant_details).toContain('Nom: Bob Dupont');
      expect(variables.participant_details).toContain('Rôle: Developer');
      expect(variables.participant_details).not.toContain('Description:');
    });

    test('should include participant_details with only name when no role or description', () => {
      const context = createMinimalContext();
      context.participants = [
        createMockParticipant({
          name: 'Charlie',
          role: null,
          description: null,
        }),
      ];
      context.messages = [
        createMockMessage({ senderType: 'user', senderName: 'Charlie', content: 'Hello' }),
      ];

      const variables = buildConversationAgentVariables(context);

      expect(variables.participant_details).toBe('Nom: Charlie');
    });

    test('should return empty participant_details when participant not found', () => {
      const context = createMinimalContext();
      context.participants = [
        createMockParticipant({ name: 'Alice' }),
      ];
      context.messages = [
        createMockMessage({ senderType: 'user', senderName: 'Unknown', content: 'Hello' }),
      ];

      const variables = buildConversationAgentVariables(context);

      expect(variables.participant_details).toBe('');
    });

    test('should use first participant for participant_details when no user messages', () => {
      const context = createMinimalContext();
      context.participants = [
        createMockParticipant({ name: 'Alice', role: 'Manager', description: 'Expert PM' }),
      ];
      context.messages = [];

      const variables = buildConversationAgentVariables(context);

      // BUG FIX: Now uses first participant as fallback when no user messages
      // This is important for initial greeting messages
      expect(variables.participant_details).toContain('Nom: Alice');
      expect(variables.participant_details).toContain('Rôle: Manager');
      expect(variables.participant_details).toContain('Description: Expert PM');
    });

    test('should use currentParticipantName as fallback when explicitly provided', () => {
      const context = createMinimalContext();
      context.participants = [
        createMockParticipant({ name: 'Alice', role: 'Manager', description: 'Alice expert' }),
        createMockParticipant({ name: 'Bob', role: 'Developer', description: 'Bob expert' }),
      ];
      context.currentParticipantName = 'Bob'; // Explicitly set
      context.messages = []; // No messages

      const variables = buildConversationAgentVariables(context);

      // BUG FIX: Should use Bob (from currentParticipantName) instead of Alice (first participant)
      expect(variables.participant_name).toBe('Bob');
      expect(variables.participant_description).toBe('Bob expert');
      expect(variables.participant_details).toContain('Nom: Bob');
      expect(variables.participant_details).toContain('Rôle: Developer');
    });

    test('should prioritize lastUserMessage over currentParticipantName', () => {
      const context = createMinimalContext();
      context.participants = [
        createMockParticipant({ name: 'Alice', role: 'Manager', description: 'Alice expert' }),
        createMockParticipant({ name: 'Bob', role: 'Developer', description: 'Bob expert' }),
      ];
      context.currentParticipantName = 'Alice'; // Set explicitly
      context.messages = [
        createMockMessage({ senderType: 'user', senderName: 'Bob', content: 'Hello' }), // Bob sent the last message
      ];

      const variables = buildConversationAgentVariables(context);

      // Should use Bob (from lastUserMessage) instead of Alice (from currentParticipantName)
      expect(variables.participant_name).toBe('Bob');
      expect(variables.participant_description).toBe('Bob expert');
    });
  });

  // --------------------------------------------------------------------------
  // Message Variables
  // --------------------------------------------------------------------------
  describe('Message Variables', () => {
    test('should include message_history as formatted text', () => {
      const context = createMinimalContext();
      context.messages = [
        createMockMessage({ senderType: 'user', senderName: 'Alice', content: 'Hello' }),
        createMockMessage({ senderType: 'ai', senderName: null, content: 'Hi there!' }),
      ];

      const variables = buildConversationAgentVariables(context);

      expect(variables.message_history).toBe('Alice: Hello\nAgent: Hi there!');
    });

    test('should include messages_json as valid JSON string', () => {
      const context = createMinimalContext();
      context.messages = [
        createMockMessage({
          id: 'msg-1',
          senderType: 'user',
          senderName: 'Alice',
          content: 'Test message',
          timestamp: '2024-01-15T10:00:00Z',
        }),
      ];

      const variables = buildConversationAgentVariables(context);

      expect(() => JSON.parse(variables.messages_json as string)).not.toThrow();

      const parsed = JSON.parse(variables.messages_json as string);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('msg-1');
      expect(parsed[0].senderType).toBe('user');
      expect(parsed[0].content).toBe('Test message');
    });

    test('should include latest_user_message', () => {
      const context = createMinimalContext();
      context.messages = [
        createMockMessage({ senderType: 'user', content: 'First question' }),
        createMockMessage({ senderType: 'ai', content: 'Response' }),
        createMockMessage({ senderType: 'user', content: 'Follow-up question' }),
      ];

      const variables = buildConversationAgentVariables(context);

      expect(variables.latest_user_message).toBe('Follow-up question');
    });

    test('should return empty string for latest_user_message when no messages', () => {
      const context = createMinimalContext();
      context.messages = [];

      const variables = buildConversationAgentVariables(context);

      expect(variables.latest_user_message).toBe('');
    });

    test('should handle messages with special characters', () => {
      const context = createMinimalContext();
      context.messages = [
        createMockMessage({
          content: 'Message with "quotes" and <tags> and émojis 🎉'
        }),
      ];

      const variables = buildConversationAgentVariables(context);

      expect(variables.message_history).toContain('quotes');
      expect(variables.message_history).toContain('<tags>');
      expect(variables.message_history).toContain('🎉');
    });

    test('should use "Participant" as fallback sender name', () => {
      const context = createMinimalContext();
      context.messages = [
        createMockMessage({ senderType: 'user', senderName: null, content: 'Hello' }),
      ];

      const variables = buildConversationAgentVariables(context);

      expect(variables.message_history).toBe('Participant: Hello');
    });

    test('should use "Agent" for AI messages in message_history', () => {
      const context = createMinimalContext();
      context.messages = [
        createMockMessage({ senderType: 'ai', senderName: null, content: 'AI response' }),
      ];

      const variables = buildConversationAgentVariables(context);

      expect(variables.message_history).toBe('Agent: AI response');
    });
  });

  // --------------------------------------------------------------------------
  // Conversation Plan Variables
  // --------------------------------------------------------------------------
  describe('Conversation Plan Variables', () => {
    test('should include conversation_plan formatted text when plan exists', () => {
      const context = createFullContext();

      const variables = buildConversationAgentVariables(context);

      expect(variables.conversation_plan).toBeDefined();
      expect(typeof variables.conversation_plan).toBe('string');
      expect((variables.conversation_plan as string).length).toBeGreaterThan(0);
    });

    test('should include current_step formatted text', () => {
      const context = createFullContext();

      const variables = buildConversationAgentVariables(context);

      expect(variables.current_step).toBeDefined();
      expect(typeof variables.current_step).toBe('string');
    });

    test('should include current_step_id', () => {
      const context = createFullContext();

      const variables = buildConversationAgentVariables(context);

      expect(variables.current_step_id).toBe('step_2');
    });

    test('should include completed_steps_summary', () => {
      const context = createFullContext();

      const variables = buildConversationAgentVariables(context);

      expect(variables.completed_steps_summary).toBeDefined();
      expect(typeof variables.completed_steps_summary).toBe('string');
    });

    test('should provide default message when no plan exists', () => {
      const context = createMinimalContext();
      context.conversationPlan = null;

      const variables = buildConversationAgentVariables(context);

      expect(variables.completed_steps_summary).toBe('Aucune étape complétée pour le moment');
    });

    test('should include plan_progress', () => {
      const context = createFullContext();

      const variables = buildConversationAgentVariables(context);

      expect(variables.plan_progress).toBeDefined();
      expect(typeof variables.plan_progress).toBe('string');
    });

    test('should include step_messages filtered by current step', () => {
      const context = createFullContext();
      // Add messages for step_2 (current step)
      context.messages = [
        createMockMessage({
          id: 'msg-1',
          content: 'Step 1 message',
          planStepId: 'step-uuid-1'
        }),
        createMockMessage({
          id: 'msg-2',
          content: 'Step 2 message 1',
          planStepId: 'step-uuid-2'
        }),
        createMockMessage({
          id: 'msg-3',
          content: 'Step 2 message 2',
          planStepId: 'step-uuid-2'
        }),
      ];

      const variables = buildConversationAgentVariables(context);

      expect(variables.step_messages).toBeDefined();
      expect(typeof variables.step_messages).toBe('string');
      // Should contain messages from step 2, not step 1
      expect(variables.step_messages).toContain('Step 2 message 1');
      expect(variables.step_messages).toContain('Step 2 message 2');
    });

    test('should include step_messages_json as valid JSON', () => {
      const context = createFullContext();
      context.messages = [
        createMockMessage({
          id: 'msg-1',
          content: 'Step 2 message',
          planStepId: 'step-uuid-2' // Matches current step
        }),
      ];

      const variables = buildConversationAgentVariables(context);

      expect(() => JSON.parse(variables.step_messages_json as string)).not.toThrow();
    });

    test('should return all messages as step_messages when no plan exists', () => {
      const context = createMinimalContext();
      context.messages = [
        createMockMessage({ content: 'Message 1' }),
        createMockMessage({ content: 'Message 2' }),
      ];

      const variables = buildConversationAgentVariables(context);

      expect(variables.step_messages).toContain('Message 1');
      expect(variables.step_messages).toContain('Message 2');
    });

    test('should handle empty plan with no steps', () => {
      const context = createMinimalContext();
      context.conversationPlan = {
        ...createMockConversationPlan(),
        steps: [],
        current_step_id: null,
        total_steps: 0,
        completed_steps: 0,
      };

      const variables = buildConversationAgentVariables(context);

      expect(variables.current_step_id).toBe('');
    });
  });

  // --------------------------------------------------------------------------
  // Insight Variables
  // --------------------------------------------------------------------------
  describe('Insight Variables', () => {
    test('should include existing_insights_json when insights provided', () => {
      const context = createMinimalContext();
      context.insights = [
        createMockInsight({ id: 'insight-1', type: 'pain', content: 'Pain point 1' }),
        createMockInsight({ id: 'insight-2', type: 'idea', content: 'Idea 1' }),
      ];

      const variables = buildConversationAgentVariables(context);

      expect(variables.existing_insights_json).toBeDefined();
      expect(() => JSON.parse(variables.existing_insights_json as string)).not.toThrow();

      const parsed = JSON.parse(variables.existing_insights_json as string);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].type).toBe('pain');
    });

    test('should return empty array JSON when no insights', () => {
      const context = createMinimalContext();
      context.insights = [];

      const variables = buildConversationAgentVariables(context);

      expect(variables.existing_insights_json).toBe('[]');
    });

    test('should include insight_types when provided', () => {
      const context = createMinimalContext();
      context.insightTypes = 'pain,idea,solution,opportunity';

      const variables = buildConversationAgentVariables(context);

      expect(variables.insight_types).toBe('pain,idea,solution,opportunity');
    });

    test('should provide default insight_types when not specified', () => {
      const context = createMinimalContext();
      context.insightTypes = undefined;

      const variables = buildConversationAgentVariables(context);

      // Should not include insight_types if not in context
      expect(variables.insight_types).toBeUndefined();
    });

    test('should include insight_types default value when empty string is provided', () => {
      const context = createMinimalContext();
      // Set insightTypes to empty string to trigger the default via nullish coalescing
      context.insightTypes = '';

      const variables = buildConversationAgentVariables(context);

      // When insightTypes is truthy (even empty string), it should be used as-is
      // The ?? operator only applies to null/undefined, so empty string is kept
      expect(variables.insight_types).toBe('');
    });

    test('should serialize insight authors correctly', () => {
      const context = createMinimalContext();
      context.insights = [
        createMockInsight({
          id: 'insight-1',
          authors: [
            { userId: 'user-1', name: 'Alice' },
            { userId: 'user-2', name: 'Bob' },
          ],
        }),
      ];

      const variables = buildConversationAgentVariables(context);
      const parsed = JSON.parse(variables.existing_insights_json as string);

      expect(parsed[0].authors).toHaveLength(2);
      expect(parsed[0].authors[0].name).toBe('Alice');
    });

    test('should serialize insight KPIs correctly', () => {
      const context = createMinimalContext();
      context.insights = [
        createMockInsight({
          id: 'insight-1',
          kpis: [
            { label: 'Time Saved', description: 'Hours per week', value: '10' },
          ],
        }),
      ];

      const variables = buildConversationAgentVariables(context);
      const parsed = JSON.parse(variables.existing_insights_json as string);

      expect(parsed[0].kpi_estimations).toBeDefined();
      expect(parsed[0].kpi_estimations[0].name).toBe('Time Saved');
    });
  });

  // --------------------------------------------------------------------------
  // Latest AI Response Variable
  // --------------------------------------------------------------------------
  describe('Latest AI Response Variable', () => {
    test('should include latest_ai_response when provided', () => {
      const context = createMinimalContext();
      context.latestAiResponse = 'This is the AI response';

      const variables = buildConversationAgentVariables(context);

      expect(variables.latest_ai_response).toBe('This is the AI response');
    });

    test('should not include latest_ai_response when not in context', () => {
      const context = createMinimalContext();
      // Don't set latestAiResponse

      const variables = buildConversationAgentVariables(context);

      expect(variables.latest_ai_response).toBeUndefined();
    });

    test('should convert null latestAiResponse to empty string', () => {
      const context = createMinimalContext();
      context.latestAiResponse = null as any;

      const variables = buildConversationAgentVariables(context);

      expect(variables.latest_ai_response).toBe('');
    });
  });

  // --------------------------------------------------------------------------
  // Full Context Integration
  // --------------------------------------------------------------------------
  describe('Full Context Integration', () => {
    test('should build all variables with full context', () => {
      const context = createFullContext();

      const variables = buildConversationAgentVariables(context);

      // Session variables
      expect(variables.ask_key).toBe('ask-2024-onboarding');
      expect(variables.ask_question).toContain('onboarding');
      expect(variables.ask_description).toContain('brainstorming');

      // System prompts
      expect(variables.system_prompt_ask).toContain('innovantes');
      expect(variables.system_prompt_project).toContain('expérience utilisateur');
      expect(variables.system_prompt_challenge).toContain('Optimiser');

      // Participants
      expect(variables.participants).toContain('Alice Martin');
      expect(variables.participants).toContain('Bob Dupont');

      // Messages
      expect(variables.message_history).toBeDefined();
      expect(variables.messages_json).toBeDefined();

      // Plan
      expect(variables.conversation_plan).toBeDefined();
      expect(variables.current_step_id).toBe('step_2');

      // Insights
      expect(variables.existing_insights_json).toBeDefined();
      expect(variables.insight_types).toBe('pain,idea,solution');
    });

    test('should handle minimal context gracefully', () => {
      const context = createMinimalContext();

      const variables = buildConversationAgentVariables(context);

      // Should not throw and should have basic properties
      expect(variables.ask_key).toBe('test-ask');
      expect(variables.ask_question).toBe('What is the meaning of life?');
      expect(variables.ask_description).toBe('');
      expect(variables.participants).toBe('');
      expect(variables.message_history).toBe('');
    });
  });
});

// ============================================================================
// PROMPT_VARIABLES CONSTANTS TESTS
// ============================================================================

describe('PROMPT_VARIABLES Constants', () => {
  test('should have all required session variables', () => {
    const sessionVars = PROMPT_VARIABLES.filter(v => v.category === 'session');
    const keys = sessionVars.map(v => v.key);

    expect(keys).toContain('ask_key');
    expect(keys).toContain('ask_question');
    expect(keys).toContain('ask_description');
  });

  test('should have all required context variables', () => {
    const contextVars = PROMPT_VARIABLES.filter(v => v.category === 'context');
    const keys = contextVars.map(v => v.key);

    expect(keys).toContain('system_prompt_project');
    expect(keys).toContain('system_prompt_challenge');
    expect(keys).toContain('system_prompt_ask');
  });

  test('should have all required conversation variables', () => {
    const conversationVars = PROMPT_VARIABLES.filter(v => v.category === 'conversation');
    const keys = conversationVars.map(v => v.key);

    expect(keys).toContain('message_history');
    expect(keys).toContain('messages_json');
    expect(keys).toContain('latest_user_message');
    expect(keys).toContain('latest_ai_response');
    expect(keys).toContain('conversation_plan');
    expect(keys).toContain('current_step');
    expect(keys).toContain('current_step_id');
    expect(keys).toContain('completed_steps_summary');
    expect(keys).toContain('plan_progress');
  });

  test('should have all required participant variables', () => {
    const participantVars = PROMPT_VARIABLES.filter(v => v.category === 'participants');
    const keys = participantVars.map(v => v.key);

    expect(keys).toContain('participant_name');
    expect(keys).toContain('participant_description');
    expect(keys).toContain('participant_details');
    expect(keys).toContain('participants');
    expect(keys).toContain('participants_list');
  });

  test('should have all required insight variables', () => {
    const insightVars = PROMPT_VARIABLES.filter(v => v.category === 'insights');
    const keys = insightVars.map(v => v.key);

    expect(keys).toContain('existing_insights_json');
    expect(keys).toContain('insight_types');
  });

  test('should have all required project variables', () => {
    const projectVars = PROMPT_VARIABLES.filter(v => v.category === 'project');
    const keys = projectVars.map(v => v.key);

    expect(keys).toContain('project_name');
    expect(keys).toContain('project_goal');
    expect(keys).toContain('project_status');
  });

  test('should have all required challenge variables', () => {
    const challengeVars = PROMPT_VARIABLES.filter(v => v.category === 'challenge');
    const keys = challengeVars.map(v => v.key);

    expect(keys).toContain('challenge_id');
    expect(keys).toContain('challenge_title');
    expect(keys).toContain('challenge_description');
    expect(keys).toContain('challenge_status');
    expect(keys).toContain('challenge_impact');
  });

  test('should have proper type definitions for all variables', () => {
    const validTypes = ['string', 'array'];

    PROMPT_VARIABLES.forEach(variable => {
      expect(validTypes).toContain(variable.type);
      expect(variable.key).toBeTruthy();
      expect(variable.label).toBeTruthy();
      expect(variable.description).toBeTruthy();
    });
  });

  test('should have unique keys for all variables', () => {
    const keys = PROMPT_VARIABLES.map(v => v.key);
    const uniqueKeys = new Set(keys);

    expect(uniqueKeys.size).toBe(keys.length);
  });

  test('should have examples for key variables', () => {
    const criticalVars = ['ask_key', 'ask_question', 'message_history', 'participant_name'];

    criticalVars.forEach(key => {
      const variable = PROMPT_VARIABLES.find(v => v.key === key);
      expect(variable?.example).toBeDefined();
    });
  });
});

// ============================================================================
// HANDLEBARS_HELPERS_DOC TESTS
// ============================================================================

describe('HANDLEBARS_HELPERS_DOC', () => {
  test('should document all standard helpers', () => {
    const helperNames = HANDLEBARS_HELPERS_DOC.map(h => h.name);

    expect(helperNames).toContain('if');
    expect(helperNames).toContain('else');
    expect(helperNames).toContain('unless');
    expect(helperNames).toContain('each');
  });

  test('should document all custom helpers', () => {
    const helperNames = HANDLEBARS_HELPERS_DOC.map(h => h.name);

    expect(helperNames).toContain('default');
    expect(helperNames).toContain('length');
    expect(helperNames).toContain('notEmpty');
    expect(helperNames).toContain('jsonParse');
    expect(helperNames).toContain('formatDate');
    expect(helperNames).toContain('truncate');
  });

  test('should have syntax and description for all helpers', () => {
    HANDLEBARS_HELPERS_DOC.forEach(helper => {
      expect(helper.syntax).toBeTruthy();
      expect(helper.description).toBeTruthy();
      expect(helper.example).toBeTruthy();
    });
  });
});

// ============================================================================
// VOICE AGENT VARIABLES TESTS
// ============================================================================

describe('Voice Agent Variables', () => {
  // Voice agents use the same buildConversationAgentVariables function
  // but may have specific use cases

  test('should handle voice agent context with real-time updates', () => {
    const context = createMinimalContext();
    context.messages = [
      createMockMessage({
        senderType: 'user',
        senderName: 'Voice User',
        content: 'Bonjour, ceci est un message vocal',
        timestamp: new Date().toISOString(), // Real-time timestamp
      }),
    ];

    const variables = buildConversationAgentVariables(context);

    expect(variables.latest_user_message).toBe('Bonjour, ceci est un message vocal');
    expect(variables.participant_name).toBe('Voice User');
  });

  test('should handle rapid message updates in voice context', () => {
    const context = createMinimalContext();
    const now = Date.now();

    // Simulate rapid voice messages (every 500ms)
    context.messages = [
      createMockMessage({
        id: 'msg-1',
        content: 'Premier',
        timestamp: new Date(now - 1500).toISOString(),
      }),
      createMockMessage({
        id: 'msg-2',
        content: 'Deuxième',
        timestamp: new Date(now - 1000).toISOString(),
      }),
      createMockMessage({
        id: 'msg-3',
        content: 'Troisième',
        timestamp: new Date(now - 500).toISOString(),
      }),
      createMockMessage({
        id: 'msg-4',
        content: 'Quatrième',
        timestamp: new Date(now).toISOString(),
      }),
    ];

    const variables = buildConversationAgentVariables(context);

    // All messages should be captured
    const parsed = JSON.parse(variables.messages_json as string);
    expect(parsed).toHaveLength(4);
    expect(variables.latest_user_message).toBe('Quatrième');
  });

  test('should handle mixed text and voice agent responses', () => {
    const context = createMinimalContext();
    context.messages = [
      createMockMessage({
        senderType: 'user',
        content: '[Texte tapé] Question écrite',
      }),
      createMockMessage({
        senderType: 'ai',
        content: 'Réponse de l\'agent',
      }),
      createMockMessage({
        senderType: 'user',
        content: '[Voice] Question vocale transcrite',
      }),
    ];

    const variables = buildConversationAgentVariables(context);

    expect(variables.message_history).toContain('Question écrite');
    expect(variables.message_history).toContain('Question vocale transcrite');
    expect(variables.latest_user_message).toBe('[Voice] Question vocale transcrite');
  });

  test('should preserve unicode and special characters from voice transcription', () => {
    const context = createMinimalContext();
    context.messages = [
      createMockMessage({
        content: 'Café avec des émojis 🎤🎵 et accents àéïöü',
      }),
    ];

    const variables = buildConversationAgentVariables(context);

    expect(variables.latest_user_message).toContain('Café');
    expect(variables.latest_user_message).toContain('🎤🎵');
    expect(variables.latest_user_message).toContain('àéïöü');
  });

  test('should handle empty voice transcription gracefully', () => {
    const context = createMinimalContext();
    context.messages = [
      createMockMessage({
        senderType: 'user',
        content: '', // Empty transcription
      }),
    ];

    const variables = buildConversationAgentVariables(context);

    expect(variables.latest_user_message).toBe('');
  });
});

// ============================================================================
// PACING AND TIME TRACKING VARIABLES
// ============================================================================

describe('Pacing Variables', () => {
  test('should include expected_duration_minutes', () => {
    const context = createMinimalContext();
    context.ask.expected_duration_minutes = 12;

    const variables = buildConversationAgentVariables(context);

    expect(variables.expected_duration_minutes).toBe('12');
  });

  test('should default expected_duration_minutes to 8 when not set', () => {
    const context = createMinimalContext();
    context.ask.expected_duration_minutes = undefined;

    const variables = buildConversationAgentVariables(context);

    expect(variables.expected_duration_minutes).toBe('8');
  });

  test('should include duration_per_step calculated from total steps', () => {
    const context = createFullContext();
    context.ask.expected_duration_minutes = 15;
    // createFullContext has 3 steps in the plan

    const variables = buildConversationAgentVariables(context);

    expect(variables.duration_per_step).toBeDefined();
    // 15 min / 3 steps = 5 min per step
    expect(parseFloat(variables.duration_per_step as string)).toBeCloseTo(5, 1);
  });

  test('should include pacing_level based on duration', () => {
    const context = createMinimalContext();

    // Test intensive (1-7 min)
    context.ask.expected_duration_minutes = 5;
    let variables = buildConversationAgentVariables(context);
    expect(variables.pacing_level).toBe('intensive');

    // Test standard (8-15 min)
    context.ask.expected_duration_minutes = 12;
    variables = buildConversationAgentVariables(context);
    expect(variables.pacing_level).toBe('standard');

    // Test deep (16+ min)
    context.ask.expected_duration_minutes = 20;
    variables = buildConversationAgentVariables(context);
    expect(variables.pacing_level).toBe('deep');
  });

  test('should include optimal_questions_min and optimal_questions_max', () => {
    const context = createMinimalContext();
    context.ask.expected_duration_minutes = 12;

    const variables = buildConversationAgentVariables(context);

    expect(variables.optimal_questions_min).toBeDefined();
    expect(variables.optimal_questions_max).toBeDefined();
    expect(parseInt(variables.optimal_questions_min as string)).toBeGreaterThan(0);
    expect(parseInt(variables.optimal_questions_max as string)).toBeGreaterThanOrEqual(
      parseInt(variables.optimal_questions_min as string)
    );
  });
});

describe('Time Tracking Variables (Real Timer from DB)', () => {
  // Time tracking now uses real elapsed seconds from DB (participant timer)
  // instead of estimating from messages

  test('should use real elapsedActiveSeconds for conversation_elapsed_minutes', () => {
    const context = createMinimalContext();
    context.elapsedActiveSeconds = 270; // 4.5 minutes in seconds
    context.messages = [
      createMockMessage({ senderType: 'ai', content: 'Question 1?' }),
      createMockMessage({ senderType: 'user', content: 'Answer 1' }),
    ];

    const variables = buildConversationAgentVariables(context);

    expect(variables.conversation_elapsed_minutes).toBeDefined();
    const elapsed = parseFloat(variables.conversation_elapsed_minutes as string);
    expect(elapsed).toBe(4.5);
  });

  test('should include questions_asked_total counting AI messages', () => {
    const context = createMinimalContext();
    context.messages = [
      createMockMessage({ senderType: 'ai', content: 'Question 1?' }),
      createMockMessage({ senderType: 'user', content: 'Answer 1' }),
      createMockMessage({ senderType: 'ai', content: 'Question 2?' }),
      createMockMessage({ senderType: 'user', content: 'Answer 2' }),
      createMockMessage({ senderType: 'ai', content: 'Question 3?' }),
    ];

    const variables = buildConversationAgentVariables(context);

    expect(variables.questions_asked_total).toBe('3');
  });

  test('should include time_remaining_minutes based on real elapsed time', () => {
    const context = createMinimalContext();
    context.ask.expected_duration_minutes = 10;
    context.elapsedActiveSeconds = 135; // 2.25 minutes

    const variables = buildConversationAgentVariables(context);

    expect(variables.time_remaining_minutes).toBeDefined();
    const remaining = parseFloat(variables.time_remaining_minutes as string);
    // 10 min - 2.3 min = 7.7 min remaining
    expect(remaining).toBeGreaterThanOrEqual(7.7);
    expect(remaining).toBeLessThanOrEqual(7.8);
  });

  test('should set is_overtime to true when real elapsed time exceeds duration', () => {
    const context = createMinimalContext();
    context.ask.expected_duration_minutes = 2;
    context.elapsedActiveSeconds = 180; // 3 minutes > 2 min expected

    const variables = buildConversationAgentVariables(context);

    expect(variables.is_overtime).toBe('true');
    expect(parseFloat(variables.overtime_minutes as string)).toBe(1); // 3 - 2 = 1
  });

  test('should set is_overtime to false when within expected duration', () => {
    const context = createMinimalContext();
    context.ask.expected_duration_minutes = 30;
    context.elapsedActiveSeconds = 90; // 1.5 min, well under 30 min

    const variables = buildConversationAgentVariables(context);

    expect(variables.is_overtime).toBe('false');
    expect(variables.overtime_minutes).toBe('0');
  });

  test('should use real stepElapsedActiveSeconds for step_elapsed_minutes', () => {
    const context = createFullContext();
    context.stepElapsedActiveSeconds = 135; // 2.25 minutes for current step

    const variables = buildConversationAgentVariables(context);

    expect(variables.step_elapsed_minutes).toBeDefined();
    const stepElapsed = parseFloat(variables.step_elapsed_minutes as string);
    expect(stepElapsed).toBeCloseTo(2.3, 1);
  });

  test('should include questions_asked_in_step for current step', () => {
    const context = createFullContext();
    context.messages = [
      // Messages from previous step
      createMockMessage({ senderType: 'ai', planStepId: 'step-uuid-1' }),
      createMockMessage({ senderType: 'ai', planStepId: 'step-uuid-1' }),
      // Messages from current step (step_2)
      createMockMessage({ senderType: 'ai', planStepId: 'step-uuid-2' }),
      createMockMessage({ senderType: 'user', planStepId: 'step-uuid-2' }),
      createMockMessage({ senderType: 'ai', planStepId: 'step-uuid-2' }),
    ];

    const variables = buildConversationAgentVariables(context);

    // Should count 2 AI messages in step_2
    expect(variables.questions_asked_in_step).toBe('2');
  });

  test('should set step_is_overtime correctly based on real step elapsed time', () => {
    const context = createFullContext();
    context.ask.expected_duration_minutes = 3; // 3 min / 3 steps = 1 min per step
    context.stepElapsedActiveSeconds = 135; // 2.25 min > 1 min budget

    const variables = buildConversationAgentVariables(context);

    expect(variables.step_is_overtime).toBe('true');
    expect(parseFloat(variables.step_overtime_minutes as string)).toBeGreaterThan(0);
  });

  test('should handle zero elapsed seconds for time tracking', () => {
    const context = createMinimalContext();
    context.messages = [];
    context.elapsedActiveSeconds = 0;

    const variables = buildConversationAgentVariables(context);

    expect(variables.conversation_elapsed_minutes).toBe('0');
    expect(variables.questions_asked_total).toBe('0');
    expect(variables.is_overtime).toBe('false');
  });

  test('should use real elapsed time (ignoring message count)', () => {
    const context = createMinimalContext();
    context.elapsedActiveSeconds = 90; // 1.5 minutes
    // Messages don't affect elapsed time anymore
    context.messages = [
      createMockMessage({ senderType: 'user', content: 'Hello' }),
    ];

    const variables = buildConversationAgentVariables(context);

    expect(variables.conversation_elapsed_minutes).toBe('1.5');
    expect(variables.questions_asked_total).toBe('0');
  });

  test('should default to 0 when elapsedActiveSeconds not provided', () => {
    const context = createMinimalContext();
    // elapsedActiveSeconds not set (undefined)
    context.messages = [
      createMockMessage({ senderType: 'ai', content: 'Question' }),
      createMockMessage({ senderType: 'user', content: 'Answer' }),
    ];

    const variables = buildConversationAgentVariables(context);

    // Should default to 0, not estimate from messages
    expect(variables.conversation_elapsed_minutes).toBe('0');
    expect(variables.questions_asked_total).toBe('1');
  });
});

// ============================================================================
// buildParticipantDetails FUNCTION TESTS
// ============================================================================

describe('buildParticipantDetails', () => {
  test('should return formatted string with name, role, and description', () => {
    const participant = {
      name: 'Alice Martin',
      role: 'Product Manager',
      description: 'Expert en transformation digitale',
    };

    const result = buildParticipantDetails(participant);

    expect(result).toBe('Nom: Alice Martin\nRôle: Product Manager\nDescription: Expert en transformation digitale');
  });

  test('should return formatted string with name and role when no description', () => {
    const participant = {
      name: 'Bob Dupont',
      role: 'Developer',
      description: null,
    };

    const result = buildParticipantDetails(participant);

    expect(result).toBe('Nom: Bob Dupont\nRôle: Developer');
  });

  test('should return formatted string with name only when no role or description', () => {
    const participant = {
      name: 'Charlie',
      role: null,
      description: null,
    };

    const result = buildParticipantDetails(participant);

    expect(result).toBe('Nom: Charlie');
  });

  test('should return empty string when name is empty', () => {
    const participant = {
      name: '',
      role: 'Manager',
      description: 'Some description',
    };

    const result = buildParticipantDetails(participant);

    expect(result).toBe('');
  });

  test('should return empty string when name is whitespace only', () => {
    const participant = {
      name: '   ',
      role: 'Manager',
      description: 'Some description',
    };

    const result = buildParticipantDetails(participant);

    expect(result).toBe('');
  });

  test('should trim whitespace from name, role, and description', () => {
    const participant = {
      name: '  Alice Martin  ',
      role: '  Product Manager  ',
      description: '  Expert PM  ',
    };

    const result = buildParticipantDetails(participant);

    expect(result).toBe('Nom: Alice Martin\nRôle: Product Manager\nDescription: Expert PM');
  });

  test('should skip empty role', () => {
    const participant = {
      name: 'Alice',
      role: '   ',
      description: 'Expert PM',
    };

    const result = buildParticipantDetails(participant);

    expect(result).toBe('Nom: Alice\nDescription: Expert PM');
  });

  test('should skip empty description', () => {
    const participant = {
      name: 'Alice',
      role: 'Manager',
      description: '   ',
    };

    const result = buildParticipantDetails(participant);

    expect(result).toBe('Nom: Alice\nRôle: Manager');
  });

  test('should handle undefined role and description', () => {
    const participant = {
      name: 'Alice',
      role: undefined,
      description: undefined,
    };

    const result = buildParticipantDetails(participant);

    expect(result).toBe('Nom: Alice');
  });
});

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should handle very long messages', () => {
    const context = createMinimalContext();
    const longContent = 'A'.repeat(10000);
    context.messages = [
      createMockMessage({ content: longContent }),
    ];

    const variables = buildConversationAgentVariables(context);

    expect(variables.latest_user_message).toBe(longContent);
    expect(variables.message_history).toContain(longContent);
  });

  test('should handle messages with newlines and tabs', () => {
    const context = createMinimalContext();
    context.messages = [
      createMockMessage({
        content: 'Line 1\nLine 2\n\tTabbed line\n\n\nMultiple newlines',
      }),
    ];

    const variables = buildConversationAgentVariables(context);

    expect(variables.latest_user_message).toContain('Line 1\nLine 2');
    expect(variables.latest_user_message).toContain('\t');
  });

  test('should handle JSON-like content in messages', () => {
    const context = createMinimalContext();
    context.messages = [
      createMockMessage({
        content: '{"key": "value", "array": [1, 2, 3]}',
      }),
    ];

    const variables = buildConversationAgentVariables(context);

    expect(variables.latest_user_message).toBe('{"key": "value", "array": [1, 2, 3]}');
    // Should not break JSON parsing
    expect(() => JSON.parse(variables.messages_json as string)).not.toThrow();
  });

  test('should handle HTML-like content in messages', () => {
    const context = createMinimalContext();
    context.messages = [
      createMockMessage({
        content: '<script>alert("test")</script> <div>Content</div>',
      }),
    ];

    const variables = buildConversationAgentVariables(context);

    // HTML should be preserved as-is (template rendering handles escaping)
    expect(variables.latest_user_message).toContain('<script>');
    expect(variables.latest_user_message).toContain('<div>');
  });

  test('should handle undefined senderName gracefully', () => {
    const context = createMinimalContext();
    context.messages = [
      {
        id: 'msg-1',
        senderType: 'user',
        senderName: undefined as any,
        content: 'Test',
        timestamp: '2024-01-15T10:00:00Z',
      },
    ];

    const variables = buildConversationAgentVariables(context);

    expect(variables.message_history).toBe('Participant: Test');
    expect(variables.participant_name).toBe('');
  });

  test('should handle conversation plan with malformed step data', () => {
    const context = createFullContext();
    // Create plan with minimal step data
    context.conversationPlan = {
      ...createMockConversationPlan(),
      steps: [
        {
          id: 'step-1',
          plan_id: 'plan-1',
          step_identifier: 'step_1',
          step_order: 1,
          title: 'Test Step',
          objective: '', // Empty objective
          status: 'active',
          summary: null,
          created_at: '2024-01-15T10:00:00Z',
          activated_at: null,
          completed_at: null,
        },
      ],
    };

    // Should not throw
    const variables = buildConversationAgentVariables(context);

    expect(variables.conversation_plan).toBeDefined();
  });

  test('should handle very large number of participants', () => {
    const context = createMinimalContext();
    context.participants = Array.from({ length: 100 }, (_, i) =>
      createMockParticipant({ name: `Participant ${i + 1}`, role: `Role ${i + 1}` })
    );

    const variables = buildConversationAgentVariables(context);

    expect(variables.participants_list).toHaveLength(100);
    expect(variables.participants).toContain('Participant 1');
    expect(variables.participants).toContain('Participant 100');
  });

  test('should handle insights with missing optional fields', () => {
    const context = createMinimalContext();
    context.insights = [
      {
        id: 'insight-1',
        type: 'pain',
        content: 'Minimal insight',
        status: 'active',
        // All other fields missing/undefined
      } as Insight,
    ];

    const variables = buildConversationAgentVariables(context);
    const parsed = JSON.parse(variables.existing_insights_json as string);

    expect(parsed[0].id).toBe('insight-1');
    expect(parsed[0].type).toBe('pain');
    expect(parsed[0].content).toBe('Minimal insight');
  });
});
