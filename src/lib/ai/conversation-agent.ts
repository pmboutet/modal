import type { PromptVariables } from './agent-config';
import type { ConversationPlan } from './conversation-plan';
import type { Insight } from '@/types';
import {
  calculatePacingConfig,
  formatPacingVariables,
  calculateTimeTrackingStats,
  formatTimeTrackingVariables
} from '@/lib/pacing';

export interface ConversationParticipantSummary {
  name: string;
  role?: string | null;
  description?: string | null;
  jobTitle?: string | null;
}

export interface ConversationMessageSummary {
  id: string;
  senderType: string;
  senderName?: string | null;
  content: string;
  timestamp: string;
  planStepId?: string | null; // Optional: link to conversation plan step
}

export interface ConversationAgentContext {
  ask: {
    ask_key: string;
    question: string;
    description?: string | null;
    system_prompt?: string | null;
    expected_duration_minutes?: number | null;
    conversation_mode?: string | null;
  };
  project?: {
    name?: string | null;
    description?: string | null;
    system_prompt?: string | null;
  } | null;
  challenge?: {
    name?: string | null;
    description?: string | null;
    system_prompt?: string | null;
  } | null;
  messages: ConversationMessageSummary[];
  participants: ConversationParticipantSummary[];
  /** Name of the current participant (for filtering in individual mode) */
  currentParticipantName?: string | null;
  conversationPlan?: ConversationPlan | null;
  /** Real elapsed active time in seconds (from participant timer in DB) */
  elapsedActiveSeconds?: number;
  /** Real elapsed active time for current step in seconds (from step timer in DB) */
  stepElapsedActiveSeconds?: number;
  // Optional: for insight detection and other specialized use cases
  insights?: Insight[];
  insightTypes?: string;
  latestAiResponse?: string;
}

/**
 * Filter participants based on conversation mode.
 * - individual_parallel: only the current participant (isolated conversations)
 * - collaborative, group_reporter, consultant: all participants visible
 *
 * @param participants - All participants in the session
 * @param conversationMode - The conversation mode of the ASK
 * @param currentParticipantName - Name of the current participant (for filtering in individual mode)
 * @returns Filtered list of active participants
 */
export function filterActiveParticipants(
  participants: ConversationParticipantSummary[],
  conversationMode?: string | null,
  currentParticipantName?: string | null
): ConversationParticipantSummary[] {
  // In individual_parallel mode, only show the current participant
  if (conversationMode === 'individual_parallel' && currentParticipantName) {
    const currentParticipant = participants.find(
      p => p.name?.toLowerCase().trim() === currentParticipantName.toLowerCase().trim()
    );
    return currentParticipant ? [currentParticipant] : [];
  }

  // In other modes (collaborative, group_reporter, consultant), show all participants
  return participants;
}

function buildParticipantsSummary(participants: ConversationParticipantSummary[]): string {
  return participants
    .map(participant => {
      const baseName = participant.name?.trim();
      if (!baseName) {
        return null;
      }
      return participant.role
        ? `${baseName} (${participant.role})`
        : baseName;
    })
    .filter((value): value is string => Boolean(value))
    .join(', ');
}

/**
 * Build a detailed participant string with name, role, jobTitle, and description
 */
export function buildParticipantDetails(participant: ConversationParticipantSummary): string {
  const parts: string[] = [];

  // Name is required
  const name = participant.name?.trim();
  if (!name) {
    return '';
  }
  parts.push(`Nom: ${name}`);

  // Add role if present
  if (participant.role?.trim()) {
    parts.push(`Rôle: ${participant.role.trim()}`);
  }

  // Add job title if present
  if (participant.jobTitle?.trim()) {
    parts.push(`Poste: ${participant.jobTitle.trim()}`);
  }

  // Add description if present
  if (participant.description?.trim()) {
    parts.push(`Description: ${participant.description.trim()}`);
  }

  return parts.join('\n');
}

/**
 * Helper function to format message history as text (legacy format)
 */
function formatMessageHistory(messages: ConversationMessageSummary[]): string {
  return messages
    .map(message => {
      const senderLabel = message.senderType === 'ai' ? 'Agent' : (message.senderName || 'Participant');
      return `${senderLabel}: ${message.content}`;
    })
    .join('\n');
}

/**
 * Helper function to format step messages for prompt
 * Filters messages by the current active step's plan_step_id
 */
function formatStepMessages(
  messages: ConversationMessageSummary[],
  currentStepId: string | null,
  planSteps?: Array<{ id: string; step_identifier: string }> | null
): string {
  if (!currentStepId || !planSteps || planSteps.length === 0) {
    // No plan or no current step - return all messages as fallback
    return formatMessageHistory(messages);
  }

  // Find the step record that matches the current step identifier
  const currentStepRecord = planSteps.find(step => step.step_identifier === currentStepId);
  if (!currentStepRecord) {
    return formatMessageHistory(messages);
  }

  // Filter messages that belong to this step
  const stepMessages = messages.filter(msg => msg.planStepId === currentStepRecord.id);

  if (stepMessages.length === 0) {
    return 'Aucun message pour cette étape.';
  }

  return stepMessages
    .map(message => {
      const senderLabel = message.senderType === 'ai' ? 'Agent' : (message.senderName || 'Participant');
      const timestamp = new Date(message.timestamp).toLocaleString('fr-FR');
      return `[${timestamp}] ${senderLabel}:\n${message.content}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Helper function to serialize insights for prompt (complete version)
 */
function serialiseInsightsForPrompt(insights?: Insight[]): string {
  if (!insights || insights.length === 0) {
    return '[]';
  }

  const payload = insights.map((insight) => {
    const authors = (insight.authors ?? []).map((author) => ({
      userId: author.userId ?? null,
      name: author.name ?? null,
    }));

    const kpiEstimations = (insight.kpis ?? []).map((kpi) => ({
      name: kpi.label,
      description: kpi.description ?? null,
      metric_data: kpi.value ?? null,
    }));

    const entry: Record<string, unknown> = {
      id: insight.id,
      type: insight.type,
      content: insight.content,
      summary: insight.summary ?? null,
      category: insight.category ?? null,
      priority: insight.priority ?? null,
      status: insight.status,
      challengeId: insight.challengeId ?? null,
      relatedChallengeIds: insight.relatedChallengeIds ?? [],
      sourceMessageId: insight.sourceMessageId ?? null,
    };

    if (insight.authorId) {
      entry.authorId = insight.authorId;
    }

    if (insight.authorName) {
      entry.authorName = insight.authorName;
    }

    if (authors.length > 0) {
      entry.authors = authors;
    }

    if (kpiEstimations.length > 0) {
      entry.kpi_estimations = kpiEstimations;
    }

    return entry;
  });

  return JSON.stringify(payload);
}

/**
 * Unified function to build variables for AI agents
 * Supports both conversation agents and insight detection agents
 * 
 * @param context - Complete context with ask, messages, participants, and optional features
 * @returns PromptVariables object ready for Handlebars compilation
 */
export function buildConversationAgentVariables(context: ConversationAgentContext): PromptVariables {
  // Filter participants based on conversation mode
  // In individual_parallel mode, only show the current participant
  const activeParticipants = filterActiveParticipants(
    context.participants,
    context.ask.conversation_mode,
    context.currentParticipantName
  );

  const participantsSummary = buildParticipantsSummary(activeParticipants);

  const conversationMessagesPayload = context.messages.map(message => ({
    id: message.id,
    senderType: message.senderType,
    senderName: message.senderName ?? (message.senderType === 'ai' ? 'Agent' : 'Participant'),
    content: message.content,
    timestamp: message.timestamp,
  }));

  // Find the last user message
  const lastUserMessage = [...context.messages].reverse().find(message => message.senderType === 'user');

  // Add conversation plan variables if plan is available
  // Default values when no plan exists - these should never show as empty in the prompt
  let conversationPlanFormatted = '';
  let currentStepFormatted = 'Aucune étape active';
  let currentStepId = '';
  // Default value: always provide a message, even if no plan exists
  let completedStepsSummaryFormatted = 'Aucune étape complétée pour le moment';
  let planProgressFormatted = '';
  let stepMessagesFormatted = '';
  let stepMessagesJson = '[]';
  let planSteps: Array<{ id: string; step_identifier: string }> | null = null;
  // Last step and completion flags
  let isLastStep = false;
  let allStepsCompleted = false;

  if (context.conversationPlan) {
    const {
      formatPlanForPrompt,
      formatCurrentStepForPrompt,
      formatCompletedStepsForPrompt,
      formatPlanProgress,
      getCurrentStep
    } = require('./conversation-plan');

    conversationPlanFormatted = formatPlanForPrompt(context.conversationPlan);

    // Try to get current step from current_step_id
    let currentStep = getCurrentStep(context.conversationPlan);

    // Fallback: if no current step but plan has steps, find first active or pending step
    // Check both normalized steps and legacy plan_data.steps
    const normalizedSteps = 'steps' in context.conversationPlan && Array.isArray(context.conversationPlan.steps)
      ? context.conversationPlan.steps
      : [];
    const legacySteps = context.conversationPlan.plan_data?.steps ?? [];
    const availableSteps = normalizedSteps.length > 0 ? normalizedSteps : legacySteps;

    if (!currentStep && availableSteps.length > 0) {
      // First try to find active step
      currentStep = availableSteps.find((s: any) => s.status === 'active') ?? null;
      // If no active, find first pending step
      if (!currentStep) {
        currentStep = availableSteps.find((s: any) => s.status === 'pending') ?? null;
      }
      // If still no step (all completed or skipped), use the last step
      if (!currentStep) {
        currentStep = availableSteps[availableSteps.length - 1];
      }
    }

    currentStepFormatted = formatCurrentStepForPrompt(currentStep);
    // Use current_step_id from plan, or derive from the found currentStep
    currentStepId = context.conversationPlan.current_step_id
      || (currentStep && 'step_identifier' in currentStep ? currentStep.step_identifier : (currentStep as any)?.id ?? '');
    // This will always return a non-empty string (either "Aucune étape complétée pour le moment" or the formatted list)
    completedStepsSummaryFormatted = formatCompletedStepsForPrompt(context.conversationPlan);
    planProgressFormatted = formatPlanProgress(context.conversationPlan);

    // Handle both normalized and legacy structures
    const stepsCount = 'steps' in context.conversationPlan && Array.isArray(context.conversationPlan.steps)
      ? context.conversationPlan.steps.length
      : context.conversationPlan.plan_data?.steps.length || 0;

    // Determine if this is the last step and if all steps are completed
    const currentStepOrder = currentStep && 'step_order' in currentStep
      ? (currentStep as any).step_order
      : availableSteps.findIndex((s: any) => {
          const stepId = 'step_identifier' in s ? s.step_identifier : s.id;
          return stepId === currentStepId;
        }) + 1;
    isLastStep = currentStepOrder === stepsCount;
    allStepsCompleted = availableSteps.every((s: any) => s.status === 'completed' || s.status === 'skipped');

    // Get plan steps for step_messages filtering
    if ('steps' in context.conversationPlan && Array.isArray(context.conversationPlan.steps)) {
      planSteps = context.conversationPlan.steps.map((step: any) => ({
        id: step.id,
        step_identifier: step.step_identifier,
      }));
    }

    // Format step_messages (only messages from the current step)
    stepMessagesFormatted = formatStepMessages(context.messages, currentStepId, planSteps);

    // Create JSON version of step messages for current step
    if (currentStepId && planSteps) {
      const currentStepRecord = planSteps.find(step => step.step_identifier === currentStepId);
      if (currentStepRecord) {
        const stepMessages = context.messages.filter(msg => msg.planStepId === currentStepRecord.id);
        stepMessagesJson = JSON.stringify(stepMessages.map(msg => ({
          id: msg.id,
          senderType: msg.senderType,
          senderName: msg.senderName ?? (msg.senderType === 'ai' ? 'Agent' : 'Participant'),
          content: msg.content,
          timestamp: msg.timestamp,
        })));
      }
    }

  } else {
    // Fallback: use all messages as step_messages when no plan exists
    stepMessagesFormatted = formatMessageHistory(context.messages);
    stepMessagesJson = JSON.stringify(conversationMessagesPayload);
  }

  // Calculate pacing variables
  const expectedDurationMinutes = context.ask.expected_duration_minutes ?? 8;
  const totalSteps = context.conversationPlan
    ? ('steps' in context.conversationPlan && Array.isArray(context.conversationPlan.steps)
        ? context.conversationPlan.steps.length
        : context.conversationPlan.plan_data?.steps.length || 5)
    : 5;

  const pacingConfig = calculatePacingConfig(expectedDurationMinutes, totalSteps);
  const pacingVariables = formatPacingVariables(pacingConfig);

  // Calculate time tracking variables using real elapsed times from DB
  // Get the current step record ID for question counting
  let currentStepRecordId: string | null = null;

  if (currentStepId && planSteps) {
    const currentStepRecord = planSteps.find(step => step.step_identifier === currentStepId);
    if (currentStepRecord) {
      currentStepRecordId = currentStepRecord.id;
    }
  }

  const messagesForTimeTracking = context.messages.map(m => ({
    senderType: m.senderType,
    timestamp: m.timestamp,
    planStepId: m.planStepId ?? null,
  }));

  // Use real elapsed seconds from context (from DB), default to 0 if not provided
  const timeTrackingStats = calculateTimeTrackingStats(
    messagesForTimeTracking,
    expectedDurationMinutes,
    pacingConfig.durationPerStep,
    context.elapsedActiveSeconds ?? 0,
    context.stepElapsedActiveSeconds ?? 0,
    currentStepRecordId,
  );
  const timeTrackingVariables = formatTimeTrackingVariables(timeTrackingStats);

  // Find the participant who sent the last message to get their description
  const lastUserParticipant = lastUserMessage?.senderName
    ? context.participants.find(p => p.name === lastUserMessage.senderName)
    : null;

  // Build participant_details with full info (name, role, description)
  const participantDetails = lastUserParticipant
    ? buildParticipantDetails(lastUserParticipant)
    : '';

  // Build base variables
  const variables: PromptVariables = {
    ask_key: context.ask.ask_key,
    ask_question: context.ask.question,
    ask_description: context.ask.description ?? '',
    // Participants (dual format for backward compatibility)
    // Uses activeParticipants (filtered by conversation_mode)
    participants: participantsSummary,
    participants_list: activeParticipants,
    participant_name: lastUserMessage?.senderName ?? '',
    participant_description: lastUserParticipant?.description ?? '',
    participant_job_title: lastUserParticipant?.jobTitle ?? '',
    participant_details: participantDetails,
    // Messages (modern JSON format)
    messages_json: JSON.stringify(conversationMessagesPayload),
    // Internal: messages as array for Handlebars helpers (recentMessages)
    messages_array: conversationMessagesPayload,
    latest_user_message: lastUserMessage?.content ?? '',
    // System prompts
    system_prompt_ask: context.ask.system_prompt ?? '',
    system_prompt_project: context.project?.system_prompt ?? '',
    system_prompt_challenge: context.challenge?.system_prompt ?? '',
    // Project and challenge context
    project_name: context.project?.name ?? '',
    project_description: context.project?.description ?? '',
    challenge_name: context.challenge?.name ?? '',
    challenge_description: context.challenge?.description ?? '',
    // Conversation plan variables
    conversation_plan: conversationPlanFormatted,
    current_step: currentStepFormatted,
    current_step_id: currentStepId,
    completed_steps_summary: completedStepsSummaryFormatted,
    plan_progress: planProgressFormatted,
    // Last step and completion flags
    is_last_step: isLastStep ? 'true' : 'false',
    all_steps_completed: allStepsCompleted ? 'true' : 'false',
    // Step-specific messages (filtered by current step's plan_step_id)
    step_messages: stepMessagesFormatted,
    step_messages_json: stepMessagesJson,
    // Pacing variables (static configuration)
    ...pacingVariables,
    // Time tracking variables (dynamic, real-time)
    ...timeTrackingVariables,
  };

  // Add legacy message_history for backward compatibility
  variables.message_history = formatMessageHistory(context.messages);

  // Add optional variables for insight detection
  if (context.latestAiResponse !== undefined) {
    variables.latest_ai_response = context.latestAiResponse ?? '';
  }

  if (context.insights !== undefined) {
    variables.existing_insights_json = serialiseInsightsForPrompt(context.insights);
  }

  if (context.insightTypes !== undefined) {
    variables.insight_types = context.insightTypes ?? 'pain, idea, solution, opportunity, risk, feedback, question';
  }

  return variables;
}

