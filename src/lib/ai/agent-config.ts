import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiAgentRecord, AiModelConfig } from '@/types';
import { renderTemplate } from './templates';
import { mapModelRow } from './models';
import { getAdminSupabaseClient } from '@/lib/supabaseAdmin';
import { calculatePacingConfig, formatPacingVariables } from '@/lib/pacing';

interface RelatedPromptHolder {
  id: string;
  name?: string | null;
  system_prompt?: string | null;
}

interface AskSessionWithRelations {
  id: string;
  ask_key: string;
  question: string;
  description?: string | null;
  system_prompt?: string | null;
  ai_config?: Record<string, unknown> | null;
  project_id?: string | null;
  challenge_id?: string | null;
  delivery_mode?: string | null;
  conversation_mode?: string | null;
  expected_duration_minutes?: number | null;
  projects?: RelatedPromptHolder | RelatedPromptHolder[] | null;
  challenges?: RelatedPromptHolder | RelatedPromptHolder[] | null;
}

type ModelRow = Parameters<typeof mapModelRow>[0];

interface AgentQueryRow {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  system_prompt: string;
  user_prompt?: string | null;
  available_variables?: string[] | null;
  metadata?: Record<string, unknown> | null;
  model_config_id?: string | null;
  fallback_model_config_id?: string | null;
  model_config?: ModelRow | null;
  fallback_model_config?: ModelRow | null;
}

export const DEFAULT_CHAT_AGENT_SLUG = 'ask-conversation-response';

function mapAgentRow(row: AgentQueryRow): AiAgentRecord {
  const modelConfig = row.model_config ? mapModelRow(row.model_config) : null;
  const fallbackModelConfig = row.fallback_model_config ? mapModelRow(row.fallback_model_config) : null;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? null,
    modelConfigId: row.model_config_id ?? null,
    fallbackModelConfigId: row.fallback_model_config_id ?? null,
    systemPrompt: row.system_prompt,
    userPrompt: row.user_prompt ?? '',
    availableVariables: Array.isArray(row.available_variables) ? row.available_variables : [],
    metadata: row.metadata ?? null,
    modelConfig,
    fallbackModelConfig,
  };
}

export async function fetchAgentByIdOrSlug(
  supabase: SupabaseClient,
  options: { id?: string | null; slug?: string | null },
  fetchOptions?: { includeModels?: boolean }
): Promise<AiAgentRecord | null> {
  let query = supabase.from('ai_agents').select(`
    *,
    model_config:ai_model_configs!model_config_id(*),
    fallback_model_config:ai_model_configs!fallback_model_config_id(*)
  `);

  if (options.id) {
    query = query.eq('id', options.id);
  }

  if (options.slug) {
    query = query.eq('slug', options.slug);
  }

  const { data, error } = await query.maybeSingle<AgentQueryRow>();

  if (error) {
    console.warn(`Failed to fetch agent (${options.id ?? options.slug ?? 'unknown'}): ${error.message}`);
    return null;
  }

  if (!data) {
    return null;
  }

  return mapAgentRow(data);
}

async function fetchAgentBySlug(
  supabase: SupabaseClient,
  slug: string
): Promise<AiAgentRecord | null> {
  return fetchAgentByIdOrSlug(supabase, { slug });
}

export async function getChatAgentConfig(
  supabase: SupabaseClient,
  variables: PromptVariables = {}
): Promise<AgentConfigResult> {
  const agent = await fetchAgentBySlug(supabase, DEFAULT_CHAT_AGENT_SLUG);

  if (!agent) {
    throw new Error(`Chat agent configuration "${DEFAULT_CHAT_AGENT_SLUG}" not found`);
  }

  const trimmedSystemPrompt = agent.systemPrompt?.trim() ?? '';
  if (!trimmedSystemPrompt) {
    throw new Error(`Chat agent "${DEFAULT_CHAT_AGENT_SLUG}" is missing a system prompt`);
  }

  const trimmedUserPrompt = agent.userPrompt?.trim() ?? '';
  if (!trimmedUserPrompt) {
    throw new Error(`Chat agent "${DEFAULT_CHAT_AGENT_SLUG}" is missing a user prompt`);
  }

  const systemPrompt = substitutePromptVariables(trimmedSystemPrompt, variables);
  const userPrompt = substitutePromptVariables(trimmedUserPrompt, variables);

  const modelConfig = agent.modelConfig ?? await getDefaultModelConfig(supabase);
  const fallbackModelConfig = agent.fallbackModelConfig ?? await getFallbackModelConfig(supabase);

  return {
    systemPrompt,
    userPrompt,
    modelConfig,
    fallbackModelConfig: fallbackModelConfig ?? undefined,
    agent,
  };
}

export interface AgentConfigResult {
  systemPrompt: string;
  userPrompt?: string;
  modelConfig: AiModelConfig;
  fallbackModelConfig?: AiModelConfig;
  agent?: AiAgentRecord;
}

export interface PromptVariables {
  ask_question?: string;
  ask_description?: string;
  participant_name?: string;
  participant_description?: string;
  participant_role?: string;
  project_name?: string;
  project_description?: string;
  challenge_name?: string;
  challenge_description?: string;
  previous_messages?: string;
  delivery_mode?: string;
  conversation_mode?: string;
  system_prompt_ask?: string;
  system_prompt_project?: string;
  system_prompt_challenge?: string;
  participants?: string; // Comma-separated string for templates
  participants_list?: Array<{ name: string; role?: string | null; description?: string | null }>; // Array for Handlebars
  // Pacing variables (static configuration)
  expected_duration_minutes?: string;
  duration_per_step?: string;
  optimal_questions_min?: string;
  optimal_questions_max?: string;
  pacing_level?: string;
  pacing_instructions?: string;
  // Time tracking variables (dynamic, real-time)
  conversation_elapsed_minutes?: string;
  step_elapsed_minutes?: string;
  questions_asked_total?: string;
  questions_asked_in_step?: string;
  time_remaining_minutes?: string;
  is_overtime?: string;
  overtime_minutes?: string;
  step_is_overtime?: string;
  step_overtime_minutes?: string;
  [key: string]: any; // Allow any type for Handlebars flexibility (arrays, objects, etc.)
}

interface AskSessionRow {
  id: string;
  ask_key: string;
  question: string;
  description?: string | null;
  system_prompt?: string | null;
  project_id?: string | null;
  challenge_id?: string | null;
  expected_duration_minutes?: number | null;
}

interface ProjectRow {
  id: string;
  name?: string | null;
  description?: string | null;
  system_prompt?: string | null;
}

interface ChallengeRow {
  id: string;
  name?: string | null;
  description?: string | null;
  system_prompt?: string | null;
}

/**
 * Build standardized variables for chat agent from ASK session data
 * This function retrieves ask, project, and challenge data from the database
 * and constructs variables including system_prompt_* variables
 */
export async function buildChatAgentVariables(
  supabase: SupabaseClient,
  askSessionId: string,
  additionalVariables?: Partial<PromptVariables>,
  totalSteps?: number
): Promise<PromptVariables> {
  // Fetch ASK session
  const { data: askRow, error: askError } = await supabase
    .from('ask_sessions')
    .select('id, ask_key, question, description, system_prompt, project_id, challenge_id, expected_duration_minutes')
    .eq('id', askSessionId)
    .maybeSingle<AskSessionRow>();

  if (askError) {
    throw new Error(`Failed to fetch ASK session: ${askError.message}`);
  }

  if (!askRow) {
    throw new Error('ASK session not found');
  }

  // Fetch project if exists
  let projectData: ProjectRow | null = null;
  if (askRow.project_id) {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, description, system_prompt')
      .eq('id', askRow.project_id)
      .maybeSingle<ProjectRow>();

    if (error) {
      console.warn(`Failed to fetch project: ${error.message}`);
    } else {
      projectData = data ?? null;
    }
  }

  // Fetch challenge if exists
  let challengeData: ChallengeRow | null = null;
  if (askRow.challenge_id) {
    const { data, error } = await supabase
      .from('challenges')
      .select('id, name, description, system_prompt')
      .eq('id', askRow.challenge_id)
      .maybeSingle<ChallengeRow>();

    if (error) {
      console.warn(`Failed to fetch challenge: ${error.message}`);
    } else {
      challengeData = data ?? null;
    }
  }

  // Build pacing variables if duration is configured
  let pacingVariables: Record<string, string> = {};
  const expectedDuration = askRow.expected_duration_minutes ?? 8;
  const stepsCount = totalSteps ?? 5; // Default to 5 steps if not provided

  const pacingConfig = calculatePacingConfig(expectedDuration, stepsCount);
  pacingVariables = formatPacingVariables(pacingConfig);

  // Build base variables
  const variables: PromptVariables = {
    ask_key: askRow.ask_key,
    ask_question: askRow.question,
    ask_description: askRow.description ?? '',
    system_prompt_ask: askRow.system_prompt ?? '',
    system_prompt_project: projectData?.system_prompt ?? '',
    system_prompt_challenge: challengeData?.system_prompt ?? '',
    // Project and challenge context
    project_name: projectData?.name ?? '',
    project_description: projectData?.description ?? '',
    challenge_name: challengeData?.name ?? '',
    challenge_description: challengeData?.description ?? '',
    ...pacingVariables,
    ...additionalVariables,
  };

  return variables;
}

/**
 * Substitute template variables in a prompt string
 */
export function substitutePromptVariables(
  template: string,
  variables: PromptVariables
): string {
  return renderTemplate(template, variables);
}

/**
 * Get default model configuration
 */
export async function getDefaultModelConfig(
  supabase: SupabaseClient
): Promise<AiModelConfig> {
  const { data, error } = await supabase
    .from('ai_model_configs')
    .select('*')
    .eq('is_default', true)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch default model config: ${error.message}`);
  }

  if (!data) {
    // Fallback to a hardcoded default if no default is configured
    return {
      id: crypto.randomUUID(),
      code: 'anthropic-claude-sonnet-4-5',
      name: 'Claude Sonnet 4.5',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKeyEnvVar: 'ANTHROPIC_API_KEY',
      baseUrl: 'https://api.anthropic.com/v1',
      additionalHeaders: {},
      isDefault: true,
      isFallback: false,
    };
  }

  const mappedData = mapModelRow(data);
  return mappedData;
}

/**
 * Get fallback model configuration
 */
export async function getFallbackModelConfig(
  supabase: SupabaseClient
): Promise<AiModelConfig | null> {
  const { data, error } = await supabase
    .from('ai_model_configs')
    .select('*')
    .eq('is_fallback', true)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(`Failed to fetch fallback model config: ${error.message}`);
    return null;
  }

  return data ? mapModelRow(data) : null;
}

/**
 * Retrieve the agent configuration for an ASK session
 * Handles priority resolution and template variable substitution
 */
export async function getAgentConfigForAsk(
  supabase: SupabaseClient,
  askSessionId: string,
  variables?: PromptVariables,
  token?: string | null
): Promise<AgentConfigResult> {
  // When using token, we need admin client for RLS-bypassed access to ai_agents
  const clientForAgents = token ? getAdminSupabaseClient() : supabase;
  // First, get the ASK session with its configuration
  let askSession: AskSessionWithRelations | null = null;
  
  if (token) {
    // Use token-based RPC function that bypasses RLS
    const { data: rpcData, error: rpcError } = await supabase
      .rpc('get_ask_session_by_token', { p_token: token })
      .maybeSingle<{
        ask_session_id: string;
        ask_key: string;
        name: string;
        question: string;
        description: string | null;
        status: string;
        start_date: string;
        end_date: string;
        allow_auto_registration: boolean;
        max_participants: number | null;
        delivery_mode: string;
        conversation_mode: string;
        project_id: string | null;
        challenge_id: string | null;
        created_by: string | null;
        created_at: string;
        updated_at: string;
      }>();
    
    if (rpcError) {
      throw new Error(`Failed to fetch ASK session by token: ${rpcError.message}`);
    }
    
    if (!rpcData) {
      throw new Error('ASK session not found');
    }
    
    // Get project and challenge data via RPC if needed
    let projectData: any = null;
    let challengeData: any = null;
    
    if (rpcData.project_id || rpcData.challenge_id) {
      const { data: contextData } = await supabase
        .rpc('get_ask_context_by_token', { p_token: token })
        .maybeSingle<{
          project_id: string | null;
          project_name: string | null;
          challenge_id: string | null;
          challenge_name: string | null;
        }>();
      
      if (contextData) {
        projectData = contextData.project_name ? {
          id: contextData.project_id,
          name: contextData.project_name,
          system_prompt: null, // Not available via token RPC
        } : null;
        
        challengeData = contextData.challenge_name ? {
          id: contextData.challenge_id,
          name: contextData.challenge_name,
          system_prompt: null, // Not available via token RPC
        } : null;
      }
    }
    
    // Map RPC data to AskSessionWithRelations format
    askSession = {
      id: rpcData.ask_session_id,
      ask_key: rpcData.ask_key,
      question: rpcData.question,
      description: rpcData.description,
      system_prompt: null, // Not returned by token function
      ai_config: null, // Not returned by token function - would need to add if needed
      project_id: rpcData.project_id,
      challenge_id: rpcData.challenge_id,
      delivery_mode: rpcData.delivery_mode,
      conversation_mode: rpcData.conversation_mode,
      expected_duration_minutes: null, // Not returned by token function - will use default
      projects: projectData ? [projectData] : null,
      challenges: challengeData ? [challengeData] : null,
    } as AskSessionWithRelations;
  } else {
    // Standard authenticated access via RLS
    const { data, error: askError } = await supabase
      .from('ask_sessions')
      .select(`
        id,
        ask_key,
        question,
        description,
        system_prompt,
        ai_config,
        project_id,
        challenge_id,
        delivery_mode,
        conversation_mode,
        expected_duration_minutes,
        projects(id, name, system_prompt),
        challenges(id, name, system_prompt)
      `)
      .eq('id', askSessionId)
      .maybeSingle<AskSessionWithRelations>();

    if (askError) {
      throw new Error(`Failed to fetch ASK session: ${askError.message}`);
    }

    if (!data) {
      throw new Error('ASK session not found');
    }
    
    askSession = data;
  }

  // Priority 1: Agent Configuration (si configuré dans ai_config)
  let agent: AiAgentRecord | null = null;
  
  // Check if ai_config contains agent reference
  if (askSession.ai_config && typeof askSession.ai_config === 'object') {
    const aiConfig = askSession.ai_config as any;
    const agentId = aiConfig.agent_id;
    const agentSlug = aiConfig.agent_slug;

    if (agentId || agentSlug) {
      const agentRecord = await fetchAgentByIdOrSlug(clientForAgents, {
        id: agentId ?? null,
        slug: agentSlug ?? null,
      });

      if (agentRecord) {
        agent = agentRecord;
      }
    }
  }

  if (agent) {
    const systemPrompt = substitutePromptVariables(agent.systemPrompt, variables || {});
    const userPrompt = agent.userPrompt ? substitutePromptVariables(agent.userPrompt, variables || {}) : undefined;
    
    return {
      systemPrompt,
      userPrompt,
      modelConfig: agent.modelConfig || await getDefaultModelConfig(clientForAgents),
      fallbackModelConfig: agent.fallbackModelConfig || await getFallbackModelConfig(clientForAgents) || undefined,
      agent,
    };
  }

  const projectFromRelation = Array.isArray(askSession.projects)
    ? askSession.projects[0] ?? null
    : askSession.projects ?? null;

  const challengeFromRelation = Array.isArray(askSession.challenges)
    ? askSession.challenges[0] ?? null
    : askSession.challenges ?? null;

  // NOTE: system_prompt de l'ASK, du projet et du challenge ne remplacent PAS le prompt de l'agent
  // Ils sont fournis comme VARIABLES (system_prompt_ask, system_prompt_project, system_prompt_challenge)
  // qui peuvent être utilisées dans les templates de l'agent via {{system_prompt_ask}}, etc.
  // Ces variables sont déjà dans l'objet `variables` passé en paramètre.
  // L'agent (ou l'agent par défaut) est TOUJOURS utilisé, et les variables sont substituées dans ses prompts.

  // Priority 2: Default chat agent fallback (toujours utilisé si aucun agent configuré)
  return getChatAgentConfig(clientForAgents, variables || {});
}
