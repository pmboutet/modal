import type { SupabaseClient } from '@supabase/supabase-js';
import { executeAgent } from './service';
import type { PromptVariables } from './agent-config';
import { detectStepComplete } from '@/lib/sanitize';
import { captureDbError } from '@/lib/supabaseQuery';

/**
 * Represents a single step in the conversation plan (database record)
 */
export interface ConversationPlanStep {
  id: string; // UUID of the step record
  plan_id: string; // UUID of the parent plan
  step_identifier: string; // e.g., "step_1", "step_2" - used in STEP_COMPLETE:<ID>
  step_order: number; // 1-based index (1, 2, 3, etc.)
  title: string;
  objective: string;
  status: 'pending' | 'active' | 'completed' | 'skipped';
  summary: string | null; // AI-generated summary
  created_at: string;
  activated_at: string | null; // When status changed to 'active'
  completed_at: string | null; // When status changed to 'completed'
  /**
   * Dynamic subtopics discovered during conversation
   * @see DiscoveredSubtopic in conversation-signals.ts for the structure
   */
  discovered_subtopics?: Array<{
    id: string;
    label: string;
    status: 'pending' | 'explored' | 'skipped';
    priority: 'high' | 'medium' | 'low';
    discovered_at: string;
    explored_at: string | null;
    relevant_for_steps?: string[];
  }> | null;
}

/**
 * LEGACY: Old structure for backward compatibility
 * New code should use ConversationPlanStep instead
 */
export interface LegacyConversationPlanStep {
  id: string; // step_identifier (e.g., "step_1")
  title: string;
  objective: string;
  status: 'pending' | 'active' | 'completed' | 'skipped';
  summary?: string | null;
  created_at?: string;
  completed_at?: string | null;
}

/**
 * LEGACY: Old plan_data JSONB structure
 * Kept for backward compatibility during migration
 */
export interface LegacyConversationPlanData {
  steps: LegacyConversationPlanStep[];
}

/**
 * Represents a stored conversation plan in the database
 */
export interface ConversationPlan {
  id: string;
  conversation_thread_id: string;

  // Metadata (extracted from plan_data for performance)
  title: string | null;
  objective: string | null;
  total_steps: number;
  completed_steps: number;
  status: 'active' | 'completed' | 'abandoned';

  // Legacy JSONB structure (for backward compatibility)
  plan_data: LegacyConversationPlanData | null;

  // Current step tracking
  current_step_id: string | null; // step_identifier (e.g., "step_1")

  // Timestamps
  created_at: string;
  updated_at: string;
}

/**
 * Extended plan with steps loaded from normalized table
 */
export interface ConversationPlanWithSteps extends ConversationPlan {
  steps: ConversationPlanStep[]; // Loaded from ask_conversation_plan_steps
}

/**
 * Generate a conversation plan using the AI agent
 * This calls the ask-conversation-plan-generator agent
 */
export async function generateConversationPlan(
  supabase: SupabaseClient,
  askSessionId: string,
  variables: PromptVariables
): Promise<LegacyConversationPlanData> {
  try {
    const agentResult = await executeAgent({
      supabase,
      agentSlug: 'ask-conversation-plan-generator',
      askSessionId,
      interactionType: 'ask.plan.generation',
      variables,
    });

    if (typeof agentResult.content !== 'string' || agentResult.content.trim().length === 0) {
      throw new Error('Plan generator agent did not return valid content');
    }

    // Parse the JSON response from the agent
    let planData: LegacyConversationPlanData;
    try {
      // Try to extract JSON from markdown code blocks if present
      const content = agentResult.content.trim();
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      const jsonString = jsonMatch ? jsonMatch[1] : content;

      planData = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('Failed to parse plan JSON:', parseError);
      throw new Error('Failed to parse plan data from agent response');
    }

    // Validate the plan structure
    if (!planData.steps || !Array.isArray(planData.steps) || planData.steps.length === 0) {
      throw new Error('Invalid plan structure: missing or empty steps array');
    }

    // Ensure first step is active
    if (planData.steps.length > 0) {
      planData.steps[0].status = 'active';
      planData.steps[0].created_at = new Date().toISOString();

      // Set all other steps to pending
      for (let i = 1; i < planData.steps.length; i++) {
        planData.steps[i].status = 'pending';
      }
    }

    return planData;
  } catch (error) {
    // Enhanced error logging to capture full error details for debugging
    let errorDetails: string;
    if (error instanceof Error) {
      errorDetails = error.message;
    } else if (error && typeof error === 'object') {
      // Supabase errors and other API errors are often plain objects
      const errObj = error as Record<string, unknown>;
      errorDetails = JSON.stringify({
        message: errObj.message,
        code: errObj.code,
        details: errObj.details,
        hint: errObj.hint,
        status: errObj.status,
        statusCode: errObj.statusCode,
      });
    } else {
      errorDetails = String(error);
    }
    console.error('Error generating conversation plan:', errorDetails);
    throw error;
  }
}

/**
 * Create and store a new conversation plan for a thread
 * This creates both the plan record and individual step records in normalized tables
 */
export async function createConversationPlan(
  supabase: SupabaseClient,
  conversationThreadId: string,
  planData: LegacyConversationPlanData
): Promise<ConversationPlanWithSteps> {
  console.log('📋 [createConversationPlan] Starting for thread:', conversationThreadId);
  console.log('📋 [createConversationPlan] Steps count:', planData.steps?.length ?? 0);

  const currentStepId = planData.steps.length > 0 ? planData.steps[0].id : null;
  const totalSteps = planData.steps.length;

  // Use RPC function to bypass RLS (SECURITY DEFINER) - returns full plan record as JSONB
  const { data: planRecord, error: planError } = await supabase.rpc('create_conversation_plan', {
    p_conversation_thread_id: conversationThreadId,
    p_plan_data: planData,
    p_current_step_id: currentStepId,
    p_total_steps: totalSteps,
  });

  if (planError || !planRecord) {
    console.error('❌ [createConversationPlan] Failed to create plan record:', planError?.message, planError?.details, planError?.hint);
    throw new Error(`Failed to create conversation plan: ${planError?.message}`);
  }

  console.log('✅ [createConversationPlan] Plan record created:', planRecord.id);

  // Create step records using RPC function - returns full step records as JSONB array
  const stepRecords = planData.steps.map((step, index) => ({
    step_identifier: step.id,
    step_order: index + 1,
    title: step.title,
    objective: step.objective,
    status: step.status,
  }));

  const { data: insertedSteps, error: stepsError } = await supabase.rpc('create_conversation_plan_steps', {
    p_plan_id: planRecord.id,
    p_steps: stepRecords,
  });

  if (stepsError) {
    console.error('❌ [createConversationPlan] Failed to create steps:', stepsError?.message, stepsError?.details, stepsError?.hint);
    throw new Error(`Failed to create plan steps: ${stepsError?.message}`);
  }

  console.log('✅ [createConversationPlan] Steps created:', insertedSteps?.length ?? 0);

  // Sort steps by step_order (RPC returns them in insertion order)
  const sortedSteps = (insertedSteps as ConversationPlanStep[]).sort((a, b) => a.step_order - b.step_order);

  return {
    ...planRecord,
    steps: sortedSteps,
  } as ConversationPlanWithSteps;
}

/**
 * Context required for plan generation
 * Uses the same types as buildConversationAgentVariables for compatibility
 */
export interface PlanGenerationContext {
  askRow: {
    id: string;
    ask_key: string;
    question: string;
    description?: string | null;
    expected_duration_minutes?: number | null;
    system_prompt?: string | null;
    project_id?: string | null;
    challenge_id?: string | null;
  };
  projectData: { id?: string; name?: string | null; system_prompt?: string | null } | null;
  challengeData: { id?: string; name?: string | null; system_prompt?: string | null } | null;
  participantSummaries: Array<{
    name: string;
    role?: string | null;
    description?: string | null;
  }>;
}

/**
 * Ensure a conversation plan exists for the given thread.
 * If no plan exists, generates and creates one.
 * IMPORTANT: Throws error if plan generation fails - plan is REQUIRED.
 *
 * @param supabase - Supabase client (should be admin client for RLS bypass)
 * @param conversationThreadId - The conversation thread ID
 * @param context - Context required for plan generation (ask, project, challenge, participants)
 * @returns The existing or newly created plan
 * @throws Error if plan generation fails
 */
export async function ensureConversationPlanExists(
  supabase: SupabaseClient,
  conversationThreadId: string,
  context: PlanGenerationContext
): Promise<ConversationPlanWithSteps> {
  // Check if plan already exists
  const existingPlan = await getConversationPlanWithSteps(supabase, conversationThreadId);
  if (existingPlan) {
    return existingPlan;
  }

  // Plan doesn't exist - generate one
  console.log('📋 [ensureConversationPlanExists] Generating conversation plan for thread:', conversationThreadId);

  // Import buildConversationAgentVariables to avoid circular dependency
  const { buildConversationAgentVariables } = await import('./conversation-agent');

  const planGenerationVariables = buildConversationAgentVariables({
    ask: context.askRow,
    project: context.projectData,
    challenge: context.challengeData,
    messages: [],
    participants: context.participantSummaries,
    conversationPlan: null,
  });

  const planData = await generateConversationPlan(
    supabase,
    context.askRow.id,
    planGenerationVariables
  );

  // Double-check for plan before creating to prevent race condition
  // Another request might have created the plan while we were generating
  const planAfterGeneration = await getConversationPlanWithSteps(supabase, conversationThreadId);
  if (planAfterGeneration) {
    console.log('⚠️ [ensureConversationPlanExists] Plan already exists (race condition prevented), returning existing');
    return planAfterGeneration;
  }

  try {
    const conversationPlan = await createConversationPlan(
      supabase,
      conversationThreadId,
      planData
    );

    console.log('✅ [ensureConversationPlanExists] Plan created with', planData.steps.length, 'steps');
    return conversationPlan;
  } catch (createError) {
    // Handle duplicate key error - another request created the plan between our check and insert
    const errorMessage = createError instanceof Error ? createError.message : String(createError);
    if (errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint')) {
      console.log('⚠️ [ensureConversationPlanExists] Duplicate key error, fetching existing plan');
      const existingPlan = await getConversationPlanWithSteps(supabase, conversationThreadId);
      if (existingPlan) {
        return existingPlan;
      }
    }
    // Re-throw if it's not a duplicate key error or if we still can't find the plan
    throw createError;
  }
}

/**
 * Get the conversation plan for a thread (without steps)
 */
export async function getConversationPlan(
  supabase: SupabaseClient,
  conversationThreadId: string
): Promise<ConversationPlan | null> {
  const { data, error } = await supabase
    .from('ask_conversation_plans')
    .select('*')
    .eq('conversation_thread_id', conversationThreadId)
    .maybeSingle();

  if (error) {
    captureDbError(error, 'ask_conversation_plans', 'select', { conversationThreadId });
    return null;
  }

  return data as ConversationPlan | null;
}

/**
 * Get the conversation plan with all steps loaded from normalized table
 * Uses RPC to bypass RLS issues in production
 */
export async function getConversationPlanWithSteps(
  supabase: SupabaseClient,
  conversationThreadId: string
): Promise<ConversationPlanWithSteps | null> {
  // Use RPC to bypass RLS
  const { data: result, error: rpcError } = await supabase.rpc('get_conversation_plan_with_steps', {
    p_conversation_thread_id: conversationThreadId,
  });

  if (rpcError) {
    captureDbError(rpcError, 'get_conversation_plan_with_steps', 'rpc', { conversationThreadId });
    return null;
  }

  if (!result) {
    return null;
  }

  const plan = result.plan as ConversationPlan;
  const steps = (result.steps || []) as ConversationPlanStep[];

  // Ensure the legacy plan_data structure stays in sync with normalized steps
  const hasNormalizedSteps = steps.length > 0;

  let planDataWithSyncedSteps: LegacyConversationPlanData;

  if (hasNormalizedSteps) {
    // Sync plan_data.steps from normalized steps (source of truth)
    const legacySteps: LegacyConversationPlanStep[] = steps.map((step) => ({
      id: step.step_identifier,
      title: step.title,
      objective: step.objective,
      status: step.status,
      summary: step.summary,
      created_at: step.created_at,
      completed_at: step.completed_at,
    }));

    planDataWithSyncedSteps = {
      ...(plan.plan_data ?? { steps: [] }),
      steps: legacySteps,
    };
  } else {
    // No normalized steps - preserve original plan_data (pre-migration plans)
    planDataWithSyncedSteps = plan.plan_data ?? { steps: [] };
  }

  return {
    ...plan,
    plan_data: planDataWithSyncedSteps,
    steps: steps,
  } as ConversationPlanWithSteps;
}

/**
 * Get a specific step by its identifier
 */
export async function getPlanStep(
  supabase: SupabaseClient,
  planId: string,
  stepIdentifier: string
): Promise<ConversationPlanStep | null> {
  const { data, error } = await supabase
    .from('ask_conversation_plan_steps')
    .select('*')
    .eq('plan_id', planId)
    .eq('step_identifier', stepIdentifier)
    .maybeSingle();

  if (error) {
    captureDbError(error, 'ask_conversation_plan_steps', 'select', { planId, stepIdentifier });
    return null;
  }

  return data as ConversationPlanStep | null;
}

/**
 * Get the currently active step for a plan
 */
export async function getActiveStep(
  supabase: SupabaseClient,
  planId: string
): Promise<ConversationPlanStep | null> {
  const { data, error } = await supabase
    .from('ask_conversation_plan_steps')
    .select('*')
    .eq('plan_id', planId)
    .eq('status', 'active')
    .order('step_order', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    captureDbError(error, 'ask_conversation_plan_steps', 'select', { planId, status: 'active' });
    return null;
  }

  return data as ConversationPlanStep | null;
}

/**
 * Complete a step and activate the next one
 * This updates both the normalized steps table and the plan's current_step_id
 * If askSessionId is provided, triggers async summary generation after completion
 */
export async function completeStep(
  supabase: SupabaseClient,
  conversationThreadId: string,
  completedStepIdentifier: string,
  stepSummary?: string,
  askSessionId?: string
): Promise<ConversationPlan | null> {
  // Get the plan
  const plan = await getConversationPlan(supabase, conversationThreadId);
  if (!plan) {
    console.error('No plan found for thread:', conversationThreadId);
    return null;
  }

  // Get the step to complete
  const completedStep = await getPlanStep(supabase, plan.id, completedStepIdentifier);
  if (!completedStep) {
    console.error('Step not found:', completedStepIdentifier);
    return null;
  }

  // BUG-025 FIX: Validate that step is actually pending or active, not already completed
  if (completedStep.status === 'completed') {
    console.warn('[completeStep] ⚠️ Step already completed, skipping:', {
      stepIdentifier: completedStepIdentifier,
      currentStatus: completedStep.status,
      planId: plan.id,
    });
    // Return the current plan state instead of null (step is already done)
    return plan;
  }

  if (completedStep.status === 'skipped') {
    console.warn('[completeStep] ⚠️ Cannot complete skipped step:', {
      stepIdentifier: completedStepIdentifier,
      currentStatus: completedStep.status,
      planId: plan.id,
    });
    return null;
  }

  // Mark the step as completed via RPC
  const { error: completeError } = await supabase.rpc('complete_plan_step', {
    p_step_id: completedStep.id,
    p_summary: stepSummary || completedStep.summary,
  });

  if (completeError) {
    console.error('Failed to complete step:', completeError);
    return null;
  }

  // Find the next step by order via RPC
  const { data: nextStepJson } = await supabase.rpc('get_next_plan_step', {
    p_plan_id: plan.id,
    p_current_step_order: completedStep.step_order,
  });

  let nextStepIdentifier: string | null = null;

  // Activate the next step if it exists
  if (nextStepJson) {
    const { error: activateError } = await supabase.rpc('activate_plan_step', {
      p_step_id: (nextStepJson as ConversationPlanStep).id,
    });

    if (!activateError) {
      nextStepIdentifier = (nextStepJson as ConversationPlanStep).step_identifier;
    }
  }

  // Update the plan's current_step_id via RPC
  const { data: updatedPlanJson, error: updateError } = await supabase.rpc('update_plan_current_step', {
    p_plan_id: plan.id,
    p_current_step_id: nextStepIdentifier,
  });

  const updatedPlan = updatedPlanJson as ConversationPlan | null;

  if (updateError) {
    console.error('Failed to update plan:', updateError);
    return null;
  }

  // IMPORTANT: Summary generation is REQUIRED - generate and await result
  if (askSessionId) {
    const stepIdToSummarize = completedStep.id;

    try {
      // Get the ask_session_id from the conversation thread
      const { data: thread } = await supabase
        .from('conversation_threads')
        .select('ask_session_id')
        .eq('id', conversationThreadId)
        .single();

      if (!thread?.ask_session_id) {
        throw new Error('Thread not found or missing ask_session_id');
      }

      // Get the ask_key from the ask_session
      const { data: askSession } = await supabase
        .from('ask_sessions')
        .select('ask_key')
        .eq('id', thread.ask_session_id)
        .single();

      if (!askSession?.ask_key) {
        throw new Error('Ask session not found or missing ask_key');
      }

      // Build absolute URL for the endpoint
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL
        || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
        || 'http://localhost:3000';
      const endpoint = `${baseUrl}/api/ask/${askSession.ask_key}/step-summary`;

      // BUG-025 FIX: Add retry with exponential backoff for network resilience
      // IMPORTANT: Await the summary generation - it must succeed
      console.log('📝 [completeStep] Generating summary for step:', stepIdToSummarize);

      const MAX_RETRIES = 3;
      const BASE_DELAY_MS = 1000;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              stepId: stepIdToSummarize,
              askSessionId: askSessionId,
            }),
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`Summary generation failed: ${errorData.error || response.statusText}`);
          }

          const result = await response.json();
          if (!result.success) {
            throw new Error(`Summary generation failed: ${result.error || 'Unknown error'}`);
          }

          console.log('✅ [completeStep] Summary generated successfully for step:', stepIdToSummarize);
          lastError = null;
          break; // Success - exit retry loop
        } catch (retryError) {
          lastError = retryError instanceof Error ? retryError : new Error(String(retryError));
          if (attempt < MAX_RETRIES) {
            const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1); // Exponential backoff: 1s, 2s, 4s
            console.warn(`⚠️ [completeStep] Summary generation attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${delay}ms:`, lastError.message);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      if (lastError) {
        throw lastError;
      }
    } catch (error) {
      // Summary generation is REQUIRED - log error with detailed context
      // Note: The step is already marked as completed in the database at this point.
      // The error is thrown to notify the caller, but the step completion itself succeeded.
      console.error('❌ [completeStep] CRITICAL: Failed to generate step summary:', {
        stepId: stepIdToSummarize,
        askSessionId,
        conversationThreadId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Rethrow with context for proper error propagation to the client
      throw new Error(`Step ${completedStepIdentifier} completed but summary generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return updatedPlan as ConversationPlan;
}

/**
 * Generate an AI summary for a completed step using messages linked to that step
 */
export async function generateStepSummary(
  supabase: SupabaseClient,
  stepId: string,
  askSessionId: string
): Promise<string | null> {
  // Get the step details
  const { data: step, error: stepError } = await supabase
    .from('ask_conversation_plan_steps')
    .select('*')
    .eq('id', stepId)
    .single();

  if (stepError || !step) {
    console.error('Failed to fetch step for summary:', stepError);
    return null;
  }

  const typedStep = step as ConversationPlanStep;

  // Fetch ALL previous completed steps from the same plan for context
  const { data: previousSteps, error: prevStepsError } = await supabase
    .from('ask_conversation_plan_steps')
    .select('step_identifier, title, summary, step_order')
    .eq('plan_id', typedStep.plan_id)
    .eq('status', 'completed')
    .lt('step_order', typedStep.step_order)
    .order('step_order', { ascending: true });

  if (prevStepsError) {
    console.warn('Failed to fetch previous steps for context:', prevStepsError);
    // Continue without previous context rather than failing
  }

  // Format previous steps summaries for context
  let completedStepsSummary = '';
  if (previousSteps && previousSteps.length > 0) {
    completedStepsSummary = previousSteps
      .filter(s => s.summary && s.summary.trim().length > 0)
      .map(s => `**${s.step_identifier} - ${s.title}:**\n${s.summary}`)
      .join('\n\n');
  }

  // Fetch messages linked to this step
  const { data: messages, error: messagesError } = await supabase
    .from('messages')
    .select('id, sender_type, content, created_at')
    .eq('plan_step_id', stepId)
    .order('created_at', { ascending: true });

  if (messagesError) {
    console.error('Failed to fetch messages for summary:', messagesError);
    return null;
  }

  if (!messages || messages.length === 0) {
    return 'Aucun message échangé lors de cette étape.';
  }

  // Format messages for the agent
  const formattedMessages = messages
    .map((msg) => {
      const sender = msg.sender_type === 'user' ? 'Participant' : 'Assistant IA';
      const timestamp = new Date(msg.created_at).toLocaleString('fr-FR');
      return `[${timestamp}] ${sender}:\n${msg.content}`;
    })
    .join('\n\n---\n\n');

  // Calculate step duration
  const startTime = new Date(typedStep.activated_at || typedStep.created_at);
  const endTime = new Date(typedStep.completed_at || new Date());
  const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);
  const durationFormatted =
    durationMinutes < 60
      ? `${durationMinutes} minutes`
      : `${Math.floor(durationMinutes / 60)}h${durationMinutes % 60}`;

  // Prepare variables for the agent
  const variables: PromptVariables = {
    step_title: typedStep.title,
    step_objective: typedStep.objective,
    step_duration: durationFormatted,
    message_count: String(messages.length),
    step_messages: formattedMessages,
    // Add previous steps context to prevent hallucinations
    completed_steps_summary: completedStepsSummary,
  };

  // Call the summarizer agent - throw errors instead of returning fallback
  const agentResult = await executeAgent({
    supabase,
    agentSlug: 'ask-conversation-step-summarizer',
    askSessionId,
    interactionType: 'ask.step.summary',
    variables,
  });

  if (typeof agentResult.content !== 'string' || agentResult.content.trim().length === 0) {
    throw new Error('Summarizer agent returned empty content');
  }

  return agentResult.content.trim();
}

/**
 * Get the current active step from a plan (LEGACY - uses plan_data)
 * @deprecated Use getActiveStep for new code
 */
export function getCurrentStep(
  plan: ConversationPlan | ConversationPlanWithSteps
): ConversationPlanStep | LegacyConversationPlanStep | null {
  if (!plan.current_step_id) {
    return null;
  }

  // If plan has steps loaded from normalized table, use those
  if ('steps' in plan && Array.isArray(plan.steps)) {
    return plan.steps.find((step) => step.step_identifier === plan.current_step_id) || null;
  }

  // Fallback to legacy plan_data
  if (plan.plan_data?.steps) {
    return plan.plan_data.steps.find((step) => step.id === plan.current_step_id) || null;
  }

  return null;
}

/**
 * Format the plan for use in agent prompts
 */
export function formatPlanForPrompt(plan: ConversationPlan | ConversationPlanWithSteps): string {
  let steps: Array<ConversationPlanStep | LegacyConversationPlanStep>;

  // Use normalized steps if available
  if ('steps' in plan && Array.isArray(plan.steps)) {
    steps = plan.steps;
  } else if (plan.plan_data?.steps) {
    // Fallback to legacy format
    steps = plan.plan_data.steps;
  } else {
    return 'Aucun plan disponible';
  }

  const formattedSteps = steps
    .map((step, index) => {
      const statusEmoji = {
        pending: '⏳',
        active: '▶️',
        completed: '✅',
        skipped: '⏭️',
      }[step.status] || '❓';

      // Get step identifier (normalized vs legacy)
      const stepId = 'step_identifier' in step ? step.step_identifier : step.id;

      return `${index + 1}. ${statusEmoji} ${step.title} (${stepId})
   Objectif: ${step.objective}
   Statut: ${step.status}`;
    })
    .join('\n\n');

  return `Plan de conversation (${steps.length} étapes) :\n\n${formattedSteps}`;
}

/**
 * Format the current step for use in agent prompts
 */
export function formatCurrentStepForPrompt(
  step: ConversationPlanStep | LegacyConversationPlanStep | null
): string {
  if (!step) {
    return 'Aucune étape active';
  }

  // Get step identifier (normalized vs legacy)
  const stepId = 'step_identifier' in step ? step.step_identifier : step.id;

  return `Étape courante: ${step.title} (${stepId})
Objectif: ${step.objective}
Statut: ${step.status}`;
}

/**
 * Format completed steps with summaries for agent prompts
 */
export function formatCompletedStepsForPrompt(
  plan: ConversationPlan | ConversationPlanWithSteps
): string {
  let steps: Array<ConversationPlanStep | LegacyConversationPlanStep>;

  // Use normalized steps if available
  if ('steps' in plan && Array.isArray(plan.steps)) {
    steps = plan.steps;
  } else if (plan.plan_data?.steps) {
    steps = plan.plan_data.steps;
  } else {
    return 'Aucune étape complétée';
  }

  const completedSteps = steps.filter((step) => step.status === 'completed');

  if (completedSteps.length === 0) {
    return 'Aucune étape complétée pour le moment';
  }

  const formatted = completedSteps
    .map((step, index) => {
      const stepId = 'step_identifier' in step ? step.step_identifier : step.id;
      const summary = step.summary || 'Pas de résumé disponible';

      return `${index + 1}. ✅ ${step.title} (${stepId})
   Résumé: ${summary}`;
    })
    .join('\n\n');

  return `Étapes complétées (${completedSteps.length}/${steps.length}) :\n\n${formatted}`;
}

/**
 * Get plan progress as a formatted string
 */
export function formatPlanProgress(plan: ConversationPlan): string {
  const completed = plan.completed_steps;
  const total = plan.total_steps;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return `Progression du plan: ${completed}/${total} étapes (${percentage}%)`;
}

/**
 * Detect if a message contains a step completion marker
 * Supported formats:
 * - STEP_COMPLETE:step_1
 * - STEP_COMPLETE: step_1 (with space)
 * - **STEP_COMPLETE:step_1** (with markdown bold)
 * - **STEP_COMPLETE:** (markdown bold, no step_id - returns 'CURRENT')
 * - STEP_COMPLETE: (no step_id - returns 'CURRENT')
 *
 * Returns:
 * - step_id string if explicitly provided
 * - 'CURRENT' if marker detected but no step_id (use current step)
 * - null if no marker detected
 */
export function detectStepCompletion(content: string): string | null {
  // Use centralized detection from sanitize.ts to stay DRY
  const { hasMarker, stepId } = detectStepComplete(content);

  if (!hasMarker) {
    return null;
  }

  // Return step_id if found, otherwise 'CURRENT' to use the current active step
  return stepId ?? 'CURRENT';
}
