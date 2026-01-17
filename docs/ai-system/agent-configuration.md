# Agent Configuration System - Implementation Guide

## Overview

The Agent Configuration System replaces hardcoded prompts with dynamic, configurable agent-based prompts. This system allows for flexible AI agent configuration at multiple levels with template variable substitution.

## Architecture

### Database Schema

The system uses three main tables:

1. **`ai_agents`** - Agent definitions with prompts and model configurations
2. **`ai_model_configs`** - Model configurations (Anthropic, OpenAI, etc.)
3. **`ask_sessions`** - ASK sessions with optional agent overrides

### Configuration Priority

The system resolves agent configuration in the following priority order:

1. **Ask Session Override** (`ask_sessions.system_prompt`) - Highest priority
2. **Agent Configuration** (via `ask_sessions.ai_config.agent_id` or `agent_slug`)
3. **Project Level** (`projects.system_prompt`)
4. **Challenge Level** (`challenges.system_prompt`)
5. **Default Fallback** (hardcoded generic prompt)

## Implementation

### Core Files

- **`/src/lib/ai/agent-config.ts`** - Main configuration utility
- **`/src/app/api/ask/[key]/stream-simple/route.ts`** - Updated streaming endpoint
- **`/src/app/api/ask/[key]/stream/route.ts`** - Updated streaming endpoint
- **`/src/app/api/ask/[key]/respond/route.ts`** - Already uses agent execution

### Key Functions

#### `getAgentConfigForAsk(supabase, askSessionId, variables)`

Retrieves the complete agent configuration for an ASK session, including:
- System prompt with variable substitution
- User prompt (if available)
- Model configuration
- Fallback model configuration
- Agent metadata

#### `substitutePromptVariables(template, variables)`

Replaces template variables in prompt strings with actual values.

## Template Variables

The system supports the following template variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `{{ask_question}}` | Main ASK question | "Comment améliorer notre processus?" |
| `{{ask_description}}` | ASK session description | "Optimisation des workflows" |
| `{{participant_name}}` | Current participant name | "Jean Dupont" |
| `{{participant_role}}` | Participant role | "Manager" |
| `{{project_name}}` | Project name | "Digital Transformation" |
| `{{challenge_name}}` | Challenge name | "Process Optimization" |
| `{{previous_messages}}` | Conversation history | "User: Hello\nAgent: Hi there!" |
| `{{delivery_mode}}` | Physical or digital | "digital" |
| `{{audience_scope}}` | Individual or group | "group" |
| `{{response_mode}}` | Collective or simultaneous | "collective" |

## Usage Examples

### 1. Basic Agent Configuration

```typescript
import { getAgentConfigForAsk } from '@/lib/ai/agent-config';

const agentConfig = await getAgentConfigForAsk(
  supabase,
  askSessionId,
  {
    ask_question: "How can we improve our process?",
    ask_description: "We want to optimize our workflows",
    participant_name: "John Doe",
    participant_role: "Manager",
    project_name: "Digital Transformation",
    delivery_mode: "digital",
    audience_scope: "group",
    response_mode: "collective"
  }
);

// Use the configuration
const systemPrompt = agentConfig.systemPrompt;
const modelConfig = agentConfig.modelConfig;
```

### 2. Custom Agent Prompt Template

```sql
-- Create an agent with custom prompt template
INSERT INTO ai_agents (
  id,
  slug,
  name,
  system_prompt,
  user_prompt,
  available_variables,
  model_config_id
) VALUES (
  gen_random_uuid(),
  'facilitator-v2',
  'Advanced Facilitator',
  'Tu es un facilitateur expert pour le projet "{{project_name}}".

Question ASK : {{ask_question}}
Description : {{ask_description}}

Tu converses avec {{participant_name}} (rôle: {{participant_role}}).

Mode de livraison: {{delivery_mode}}
Audience: {{audience_scope}}
Mode de réponse: {{response_mode}}

Ton objectif est de...',
  'Basé sur le contexte fourni, réponds de manière pertinente...',
  ARRAY['ask_question', 'participant_name', 'project_name'],
  (SELECT id FROM ai_model_configs WHERE code = 'anthropic-claude-3-5-sonnet')
);
```

### 3. ASK Session with Agent Override

```sql
-- Configure an ASK session to use a specific agent
UPDATE ask_sessions 
SET ai_config = jsonb_build_object(
  'agent_slug', 'facilitator-v2',
  'custom_variables', jsonb_build_object(
    'delivery_mode', 'digital',
    'audience_scope', 'group'
  )
)
WHERE ask_key = 'your-ask-key';
```

## API Endpoints Updated

### 1. Stream Simple Endpoint
- **Path**: `/api/ask/[key]/stream-simple`
- **Changes**: Now uses `getAgentConfigForAsk()` instead of hardcoded prompts
- **Benefits**: Dynamic agent configuration with variable substitution

### 2. Stream Endpoint
- **Path**: `/api/ask/[key]/stream`
- **Changes**: Integrated agent configuration with proper logging
- **Benefits**: Full agent metadata tracking and fallback support

### 3. Respond Endpoint
- **Path**: `/api/ask/[key]/respond`
- **Status**: Already uses agent execution system
- **Benefits**: Consistent with other endpoints

## Configuration Examples

### 1. Project-Level Configuration

```sql
-- Set a project-specific system prompt
UPDATE projects 
SET system_prompt = 'Tu es un facilitateur spécialisé pour le projet "{{project_name}}".

Contexte du projet : {{ask_description}}
Participants : {{participant_name}} ({{participant_role}})

Ton rôle est d''aider à...'
WHERE id = 'your-project-id';
```

### 2. Challenge-Level Configuration

```sql
-- Set a challenge-specific system prompt
UPDATE challenges 
SET system_prompt = 'Tu es un expert en résolution de défis pour "{{challenge_name}}".

Défi : {{challenge_name}}
Question ASK : {{ask_question}}

Aide les participants à...'
WHERE id = 'your-challenge-id';
```

### 3. Session-Level Override

```sql
-- Override agent configuration for a specific session
UPDATE ask_sessions 
SET system_prompt = 'Prompt personnalisé pour cette session spécifique...'
WHERE ask_key = 'your-ask-key';
```

## Monitoring and Debugging

### Agent Logs

The system automatically logs agent interactions in the `ai_agent_logs` table:

```sql
-- View recent agent interactions
SELECT 
  al.id,
  al.interaction_type,
  al.status,
  al.latency_ms,
  al.created_at,
  aa.name as agent_name,
  amc.name as model_name
FROM ai_agent_logs al
LEFT JOIN ai_agents aa ON al.agent_id = aa.id
LEFT JOIN ai_model_configs amc ON al.model_config_id = amc.id
ORDER BY al.created_at DESC
LIMIT 10;
```

### Debugging Configuration Resolution

```typescript
// Add debugging to see which configuration is being used
const agentConfig = await getAgentConfigForAsk(supabase, askSessionId, variables);
console.log('Agent configuration resolved:', {
  hasAgent: !!agentConfig.agent,
  agentName: agentConfig.agent?.name,
  modelProvider: agentConfig.modelConfig.provider,
  systemPromptLength: agentConfig.systemPrompt.length
});
```

## Migration Guide

### From Hardcoded Prompts

1. **Identify hardcoded prompts** in your codebase
2. **Replace with `getAgentConfigForAsk()`** calls
3. **Configure agents** in the database
4. **Test with different scenarios** (project, challenge, session overrides)

### Database Setup

```sql
-- Ensure required tables exist
-- (These should already be created by your migrations)

-- Create a default model configuration
INSERT INTO ai_model_configs (
  id, code, name, provider, model, api_key_env_var, base_url, is_default
) VALUES (
  gen_random_uuid(),
  'anthropic-claude-3-5-sonnet',
  'Claude 3.5 Sonnet',
  'anthropic',
  'claude-3-5-sonnet-20240620',
  'ANTHROPIC_API_KEY',
  'https://api.anthropic.com/v1',
  true
);

-- Create a default agent
INSERT INTO ai_agents (
  id, slug, name, system_prompt, user_prompt, available_variables, model_config_id
) VALUES (
  gen_random_uuid(),
  'default-facilitator',
  'Default Facilitator',
  'Tu es un facilitateur de conversation expérimenté...',
  'Réponds de manière pertinente...',
  ARRAY['ask_question', 'participant_name'],
  (SELECT id FROM ai_model_configs WHERE code = 'anthropic-claude-3-5-sonnet')
);
```

## Best Practices

1. **Use descriptive agent names** and slugs
2. **Document available variables** in agent descriptions
3. **Test configuration resolution** with different scenarios
4. **Monitor agent logs** for debugging
5. **Use fallback configurations** for reliability
6. **Keep prompts concise** but informative
7. **Use template variables** for dynamic content

## Troubleshooting

### Common Issues

1. **Agent not found**: Check `ai_agents` table and agent slug/ID
2. **Model configuration missing**: Ensure `ai_model_configs` table has default model
3. **Template variables not substituted**: Check variable names match exactly
4. **Database connection issues**: Verify Supabase client configuration

### Debug Steps

1. Check database tables for required data
2. Verify agent configuration resolution
3. Test template variable substitution
4. Monitor agent logs for errors
5. Validate model configuration

## Rapport & Synthesis Agents

The system includes specialized agents for generating structured reports and analyses from project data.

### Agent Categories and Naming Convention

Agents follow a prefix-based naming convention:
- **`ask-*`**: Conversation and insight-related agents (e.g., `ask-conversation-response`, `ask-insight-detection`)
- **`rapport-*`**: Report generation and data synthesis agents (e.g., `rapport-narrative-synthesis`, `rapport-claim-extraction`)
- **`challenge-*`**: Challenge building and revision agents (e.g., `challenge-revision-planner`)

### Rapport Agents

| Slug | Purpose | Input Variables | Output |
|------|---------|-----------------|--------|
| `rapport-narrative-synthesis` | Generate executive summaries and section overviews | `project_name`, `participant_count`, `claim_count`, `community_count`, `problems_summary`, `findings_summary`, `recommendations_summary`, `tensions_summary`, `risks_summary` | JSON with `executive_summary`, `key_takeaways`, `section_overviews` |
| `rapport-claim-extraction` | Extract claims from insights | `content`, `summary`, `type`, `category`, `ask_question`, `project_name`, `challenge_name` | JSON with `claims[]` and `claim_relations[]` |
| `rapport-claim-comparison` | Compare two claims for SUPPORTS/CONTRADICTS/NEUTRAL | `claim1`, `claim2` | JSON with `relation`, `confidence`, `reasoning` |
| `rapport-participant-claims` | Extract claims from all participant insights at once | `project_name`, `project_description`, `challenge_context`, `insights_context`, `insight_count` | JSON with `claims[]`, `entities[]`, `claim_relations[]` |

### Creating Rapport Agents

```sql
-- Example: Create a rapport agent
INSERT INTO ai_agents (
  slug,
  name,
  description,
  system_prompt,
  user_prompt,
  available_variables
) VALUES (
  'rapport-narrative-synthesis',
  'Generateur de Synthese Narrative',
  'Genere le resume executif et les apercus de section pour une synthese projet',
  '$$Tu es un expert en synthese strategique...$$',
  '$$Projet: {{project_name}}...$$',
  ARRAY['project_name', 'participant_count', 'claim_count', ...]
);
```

## Future Enhancements

- **Agent versioning** for prompt evolution
- **A/B testing** for different agent configurations
- **Performance metrics** and optimization
- **Advanced template features** (conditionals, loops)
- **Agent marketplace** for sharing configurations
