/**
 * Conversation Signals Module
 *
 * Centralized handling of all conversation signals:
 * - STEP_COMPLETE: Mark a step as completed
 * - TOPICS_DISCOVERED: Agent detected multiple topics to explore
 * - TOPIC_EXPLORED: Agent finished exploring a subtopic
 * - TOPIC_SKIPPED: Agent skipped a subtopic
 *
 * This module provides DRY signal detection and handling across all conversation modes
 * (text, voice, consultant).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { detectStepComplete } from '@/lib/sanitize';
import {
  completeStep,
  getConversationPlanWithSteps,
  getCurrentStep,
  type ConversationPlan,
  type ConversationPlanStep,
  type LegacyConversationPlanStep,
} from './conversation-plan';

/**
 * Helper to get step identifier from either new or legacy step format
 */
function getStepIdentifier(step: ConversationPlanStep | LegacyConversationPlanStep): string {
  // New format has step_identifier, legacy format uses id as the identifier
  return 'step_identifier' in step ? step.step_identifier : step.id;
}

// ============================================================================
// TYPES
// ============================================================================

export type SubtopicPriority = 'high' | 'medium' | 'low';
export type SubtopicStatus = 'pending' | 'explored' | 'skipped';

/**
 * A discovered subtopic within a conversation step
 */
export interface DiscoveredSubtopic {
  id: string;
  label: string;
  status: SubtopicStatus;
  priority: SubtopicPriority;
  discovered_at: string;
  explored_at: string | null;
  relevant_for_steps?: string[];
}

/**
 * Subtopic as received from agent signal (minimal structure)
 */
export interface SubtopicFromSignal {
  label: string;
  priority: SubtopicPriority;
  relevant_for_steps?: string[];
}

/**
 * All possible conversation signals detected from AI response
 */
export interface ConversationSignals {
  stepComplete?: {
    stepId: string;
  };
  topicsDiscovered?: {
    topics: SubtopicFromSignal[];
  };
  topicExplored?: {
    topicId: string;
  };
  topicSkipped?: {
    topicId: string;
  };
}

/**
 * Result of handling conversation signals
 */
export interface SignalHandlingResult {
  planUpdated: boolean;
  stepCompleted: boolean;
  subtopicsAdded: number;
  subtopicsUpdated: number;
}

// ============================================================================
// SIGNAL DETECTION
// ============================================================================

/**
 * Extract JSON array from TOPICS_DISCOVERED signal
 * Handles nested arrays by counting brackets
 */
function extractTopicsJson(content: string): string | null {
  const marker = content.match(/TOPICS_DISCOVERED:\s*/i);
  if (!marker) return null;

  const startIndex = marker.index! + marker[0].length;
  if (content[startIndex] !== '[') return null;

  let depth = 0;
  let endIndex = startIndex;

  for (let i = startIndex; i < content.length; i++) {
    if (content[i] === '[') depth++;
    else if (content[i] === ']') {
      depth--;
      if (depth === 0) {
        endIndex = i;
        break;
      }
    }
  }

  if (depth !== 0) return null;

  return content.slice(startIndex, endIndex + 1);
}

/**
 * Pattern for TOPIC_EXPLORED signal
 * Format: TOPIC_EXPLORED:subtopic_1 or TOPIC_EXPLORED: subtopic_1
 */
const TOPIC_EXPLORED_PATTERN = /TOPIC_EXPLORED:\s*(subtopic_\d+)/i;

/**
 * Pattern for TOPIC_SKIPPED signal
 * Format: TOPIC_SKIPPED:subtopic_1 or TOPIC_SKIPPED: subtopic_1
 */
const TOPIC_SKIPPED_PATTERN = /TOPIC_SKIPPED:\s*(subtopic_\d+)/i;

/**
 * Quick check for any signal presence (for performance)
 */
function hasAnySignal(content: string): boolean {
  return /STEP_COMPLETE:|TOPICS_DISCOVERED:|TOPIC_EXPLORED:|TOPIC_SKIPPED:/i.test(content);
}

/**
 * Detect all conversation signals from AI response content
 *
 * @param content - The AI response content to parse
 * @returns ConversationSignals object with all detected signals
 */
export function detectConversationSignals(content: string): ConversationSignals {
  const signals: ConversationSignals = {};

  // Quick early return if no signals present
  if (!hasAnySignal(content)) {
    return signals;
  }

  // Detect STEP_COMPLETE (using existing centralized function)
  const { hasMarker, stepId } = detectStepComplete(content);
  if (hasMarker) {
    // Use 'CURRENT' as a special value when no specific step ID is provided
    signals.stepComplete = {
      stepId: stepId ?? 'CURRENT',
    };
  }

  // Detect TOPICS_DISCOVERED
  const topicsJson = extractTopicsJson(content);
  if (topicsJson) {
    try {
      const parsedTopics = JSON.parse(topicsJson) as SubtopicFromSignal[];
      if (Array.isArray(parsedTopics) && parsedTopics.length > 0) {
        // Validate and normalize topics
        const validTopics = parsedTopics
          .filter(t => t && typeof t.label === 'string' && t.label.trim())
          .map(t => ({
            label: t.label.trim(),
            priority: (['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium') as SubtopicPriority,
            relevant_for_steps: Array.isArray(t.relevant_for_steps) ? t.relevant_for_steps : undefined,
          }));

        if (validTopics.length > 0) {
          signals.topicsDiscovered = { topics: validTopics };
        }
      }
    } catch {
      // Invalid JSON - ignore the signal
      console.warn('Failed to parse TOPICS_DISCOVERED signal:', topicsJson);
    }
  }

  // Detect TOPIC_EXPLORED
  const exploredMatch = content.match(TOPIC_EXPLORED_PATTERN);
  if (exploredMatch) {
    signals.topicExplored = { topicId: exploredMatch[1] };
  }

  // Detect TOPIC_SKIPPED
  const skippedMatch = content.match(TOPIC_SKIPPED_PATTERN);
  if (skippedMatch) {
    signals.topicSkipped = { topicId: skippedMatch[1] };
  }

  return signals;
}

/**
 * Check if any signals were detected
 */
export function hasSignals(signals: ConversationSignals): boolean {
  return !!(
    signals.stepComplete ||
    signals.topicsDiscovered ||
    signals.topicExplored ||
    signals.topicSkipped
  );
}

// ============================================================================
// SUBTOPIC MANAGEMENT
// ============================================================================

/**
 * Generate a unique subtopic ID
 */
function generateSubtopicId(existingSubtopics: DiscoveredSubtopic[]): string {
  const maxId = existingSubtopics.reduce((max, st) => {
    const match = st.id.match(/subtopic_(\d+)/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  return `subtopic_${maxId + 1}`;
}

/**
 * Add subtopics to a step
 */
export async function addSubtopicsToStep(
  supabase: SupabaseClient,
  stepId: string,
  topics: SubtopicFromSignal[]
): Promise<number> {
  // Fetch current step
  const { data: step, error: fetchError } = await supabase
    .from('ask_conversation_plan_steps')
    .select('id, discovered_subtopics')
    .eq('id', stepId)
    .single();

  if (fetchError || !step) {
    console.error('Failed to fetch step for subtopic addition:', fetchError);
    return 0;
  }

  // Parse existing subtopics
  const existingSubtopics: DiscoveredSubtopic[] = Array.isArray(step.discovered_subtopics)
    ? step.discovered_subtopics
    : [];

  // Filter out duplicates (by label)
  const existingLabels = new Set(existingSubtopics.map(st => st.label.toLowerCase()));
  const newTopics = topics.filter(t => !existingLabels.has(t.label.toLowerCase()));

  if (newTopics.length === 0) {
    return 0;
  }

  // Create new subtopic records
  const now = new Date().toISOString();
  let tempSubtopics = [...existingSubtopics];

  const newSubtopics: DiscoveredSubtopic[] = newTopics.map(topic => {
    const id = generateSubtopicId(tempSubtopics);
    const subtopic: DiscoveredSubtopic = {
      id,
      label: topic.label,
      status: 'pending',
      priority: topic.priority,
      discovered_at: now,
      explored_at: null,
      relevant_for_steps: topic.relevant_for_steps,
    };
    tempSubtopics.push(subtopic);
    return subtopic;
  });

  // Update step with new subtopics
  const updatedSubtopics = [...existingSubtopics, ...newSubtopics];

  const { error: updateError } = await supabase
    .from('ask_conversation_plan_steps')
    .update({ discovered_subtopics: updatedSubtopics })
    .eq('id', stepId);

  if (updateError) {
    console.error('Failed to update step with subtopics:', updateError);
    return 0;
  }

  return newSubtopics.length;
}

/**
 * Update a subtopic's status
 */
export async function updateSubtopicStatus(
  supabase: SupabaseClient,
  conversationThreadId: string,
  subtopicId: string,
  status: 'explored' | 'skipped'
): Promise<boolean> {
  // Find the step containing this subtopic
  const { data: steps, error: fetchError } = await supabase
    .from('ask_conversation_plan_steps')
    .select('id, discovered_subtopics')
    .eq('plan_id', (
      await supabase
        .from('ask_conversation_plans')
        .select('id')
        .eq('conversation_thread_id', conversationThreadId)
        .single()
    ).data?.id);

  if (fetchError || !steps) {
    console.error('Failed to fetch steps for subtopic update:', fetchError);
    return false;
  }

  // Find the step containing the subtopic
  for (const step of steps) {
    const subtopics: DiscoveredSubtopic[] = Array.isArray(step.discovered_subtopics)
      ? step.discovered_subtopics
      : [];

    const subtopicIndex = subtopics.findIndex(st => st.id === subtopicId);

    if (subtopicIndex !== -1) {
      // Update the subtopic
      subtopics[subtopicIndex] = {
        ...subtopics[subtopicIndex],
        status,
        explored_at: status === 'explored' ? new Date().toISOString() : subtopics[subtopicIndex].explored_at,
      };

      const { error: updateError } = await supabase
        .from('ask_conversation_plan_steps')
        .update({ discovered_subtopics: subtopics })
        .eq('id', step.id);

      if (updateError) {
        console.error('Failed to update subtopic status:', updateError);
        return false;
      }

      return true;
    }
  }

  console.warn(`Subtopic ${subtopicId} not found in any step`);
  return false;
}

// ============================================================================
// SUBTOPIC-ONLY SIGNAL HANDLER (for incremental adoption)
// ============================================================================

/**
 * Handle only subtopic-related signals (TOPICS_DISCOVERED, TOPIC_EXPLORED, TOPIC_SKIPPED)
 * This function does NOT handle STEP_COMPLETE - use this for incremental adoption
 * while keeping existing STEP_COMPLETE handling in place.
 *
 * DRY: Delegates to processSubtopicSignals() which is also used by handleConversationSignals()
 *
 * @param supabase - Supabase client (should be admin for RLS bypass)
 * @param conversationThreadId - The conversation thread ID
 * @param aiResponse - The AI response content to check for signals
 * @returns Result indicating what was updated (or null if no subtopic signals found)
 */
export async function handleSubtopicSignals(
  supabase: SupabaseClient,
  conversationThreadId: string,
  aiResponse: string
): Promise<{ subtopicsAdded: number; subtopicsUpdated: number } | null> {
  const signals = detectConversationSignals(aiResponse);

  // Only process if there are subtopic-related signals
  if (!signals.topicsDiscovered && !signals.topicExplored && !signals.topicSkipped) {
    return null;
  }

  // Delegate to shared processing function
  return processSubtopicSignals(supabase, conversationThreadId, signals);
}

/**
 * Internal helper: Process subtopic signals with provided plan context
 * DRY: Single implementation for subtopic handling, used by both handleSubtopicSignals and handleConversationSignals
 */
async function processSubtopicSignalsWithPlan(
  supabase: SupabaseClient,
  conversationThreadId: string,
  signals: ConversationSignals,
  currentStep: ConversationPlanStep | LegacyConversationPlanStep | null
): Promise<{ subtopicsAdded: number; subtopicsUpdated: number }> {
  const result = { subtopicsAdded: 0, subtopicsUpdated: 0 };

  // Handle TOPICS_DISCOVERED
  if (signals.topicsDiscovered?.topics.length && currentStep) {
    const added = await addSubtopicsToStep(
      supabase,
      currentStep.id,
      signals.topicsDiscovered.topics
    );
    result.subtopicsAdded = added;
  }

  // Handle TOPIC_EXPLORED
  if (signals.topicExplored) {
    const updated = await updateSubtopicStatus(
      supabase,
      conversationThreadId,
      signals.topicExplored.topicId,
      'explored'
    );
    if (updated) result.subtopicsUpdated++;
  }

  // Handle TOPIC_SKIPPED
  if (signals.topicSkipped) {
    const updated = await updateSubtopicStatus(
      supabase,
      conversationThreadId,
      signals.topicSkipped.topicId,
      'skipped'
    );
    if (updated) result.subtopicsUpdated++;
  }

  return result;
}

/**
 * Internal helper: Process subtopic signals (fetches plan internally)
 * Used by handleSubtopicSignals for standalone subtopic handling
 */
async function processSubtopicSignals(
  supabase: SupabaseClient,
  conversationThreadId: string,
  signals: ConversationSignals
): Promise<{ subtopicsAdded: number; subtopicsUpdated: number } | null> {
  // Get current plan and step for context
  const plan = await getConversationPlanWithSteps(supabase, conversationThreadId);
  if (!plan) {
    console.warn('[processSubtopicSignals] No conversation plan found');
    return null;
  }

  const currentStep = getCurrentStep(plan);
  return processSubtopicSignalsWithPlan(supabase, conversationThreadId, signals, currentStep);
}

// ============================================================================
// UNIFIED SIGNAL HANDLER (for full refactoring later)
// ============================================================================

/**
 * Handle all conversation signals from an AI response
 *
 * This is the main entry point for processing signals. It:
 * 1. Handles step completion (delegates to completeStep)
 * 2. Handles topic discovery (adds subtopics to current step)
 * 3. Handles topic exploration/skipping (updates subtopic status)
 *
 * @param supabase - Supabase client (should be admin for RLS bypass)
 * @param conversationThreadId - The conversation thread ID
 * @param signals - Detected signals from detectConversationSignals()
 * @param askSessionId - The ASK session ID
 * @param currentStepIdentifier - Optional override for current step (for STEP_COMPLETE:CURRENT)
 * @returns Result indicating what was updated
 */
export async function handleConversationSignals(
  supabase: SupabaseClient,
  conversationThreadId: string,
  signals: ConversationSignals,
  askSessionId: string,
  currentStepIdentifier?: string | null
): Promise<SignalHandlingResult> {
  const result: SignalHandlingResult = {
    planUpdated: false,
    stepCompleted: false,
    subtopicsAdded: 0,
    subtopicsUpdated: 0,
  };

  // Early return if no signals
  if (!hasSignals(signals)) {
    return result;
  }

  // Get current plan and step for context
  const plan = await getConversationPlanWithSteps(supabase, conversationThreadId);
  if (!plan) {
    console.warn('No conversation plan found for signal handling');
    return result;
  }

  const currentStep = getCurrentStep(plan);

  // 1. Handle subtopic signals (TOPICS_DISCOVERED, TOPIC_EXPLORED, TOPIC_SKIPPED)
  // DRY: Use shared helper function
  const subtopicResult = await processSubtopicSignalsWithPlan(
    supabase,
    conversationThreadId,
    signals,
    currentStep
  );
  result.subtopicsAdded = subtopicResult.subtopicsAdded;
  result.subtopicsUpdated = subtopicResult.subtopicsUpdated;
  if (subtopicResult.subtopicsAdded > 0 || subtopicResult.subtopicsUpdated > 0) {
    result.planUpdated = true;
  }

  // 2. Handle STEP_COMPLETE (last, as it changes current step)
  if (signals.stepComplete && currentStep) {
    const currentStepId = getStepIdentifier(currentStep);
    const stepIdToComplete = signals.stepComplete.stepId === 'CURRENT'
      ? (currentStepIdentifier ?? currentStepId)
      : signals.stepComplete.stepId;

    // Validate that we should complete this step
    const shouldComplete = signals.stepComplete.stepId === 'CURRENT' ||
      currentStepId === stepIdToComplete;

    if (shouldComplete) {
      const completedPlan = await completeStep(
        supabase,
        conversationThreadId,
        stepIdToComplete,
        undefined,
        askSessionId
      );

      if (completedPlan) {
        result.stepCompleted = true;
        result.planUpdated = true;
      }
    }
  }

  return result;
}

// ============================================================================
// SIGNAL CLEANING (for display)
// ============================================================================

// Re-export cleaning functions from sanitize.ts to maintain backward compatibility
// for server-side imports. The functions are defined in sanitize.ts to be usable
// both client-side (ChatComponent, PremiumVoiceInterface) and server-side.
export { cleanAllSignalMarkers, cleanTextForTTS } from '@/lib/sanitize';

// ============================================================================
// FORMATTING FOR PROMPTS
// ============================================================================

/**
 * Format discovered subtopics for agent prompt
 */
export function formatSubtopicsForPrompt(subtopics: DiscoveredSubtopic[] | null | undefined): string {
  if (!subtopics || subtopics.length === 0) {
    return 'Aucun sous-sujet découvert dans cette étape.';
  }

  const lines = subtopics.map(st => {
    const statusIcon = st.status === 'explored' ? '[x]' : st.status === 'skipped' ? '[-]' : '[ ]';
    const priorityLabel = st.priority === 'high' ? '(priorité haute)' :
      st.priority === 'low' ? '(priorité basse)' : '';
    return `${statusIcon} ${st.label} ${priorityLabel}`.trim();
  });

  return `## Sous-sujets découverts dans cette étape:\n${lines.join('\n')}`;
}

/**
 * Count pending subtopics across all steps
 */
export function countPendingSubtopics(plan: ConversationPlan & { steps?: ConversationPlanStep[] }): number {
  if (!plan.steps) return 0;

  return plan.steps.reduce((count, step) => {
    const subtopics = step.discovered_subtopics;
    if (!subtopics || !Array.isArray(subtopics)) return count;
    return count + subtopics.filter(st => st.status === 'pending').length;
  }, 0);
}

/**
 * Get all subtopics for a specific step
 */
export function getStepSubtopics(step: ConversationPlanStep): DiscoveredSubtopic[] {
  const subtopics = step.discovered_subtopics;
  if (!subtopics || !Array.isArray(subtopics)) return [];
  // Type assertion is safe here because ConversationPlanStep.discovered_subtopics matches DiscoveredSubtopic
  return subtopics as DiscoveredSubtopic[];
}
