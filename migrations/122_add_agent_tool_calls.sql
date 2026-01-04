-- Migration: Add tool_calls column to ai_agent_logs for agentic execution tracking
-- This allows us to track which tools were called during an agent execution

BEGIN;

-- Add tool_calls column to store tool execution details
ALTER TABLE public.ai_agent_logs
ADD COLUMN IF NOT EXISTS tool_calls JSONB;

-- Add comment documenting the structure
COMMENT ON COLUMN public.ai_agent_logs.tool_calls IS
'Array of tool calls made during agentic execution. Each entry contains:
- name: Tool name
- input: Input parameters passed to the tool
- result: Tool execution result
- latencyMs: Execution time in milliseconds
- error: Error message if tool failed';

-- Add comment documenting the metadata.enabled_tools structure in ai_agents
COMMENT ON COLUMN public.ai_agents.metadata IS
'Agent configuration metadata including:
- enabled_tools: string[] - List of tool names enabled for this agent
  Valid values: graph_rag_all, graph_rag_insights, graph_rag_claims,
  find_related_insights, find_insights_by_concepts, find_insight_clusters,
  get_claim_network, find_claims_by_objective, get_claim_conflicts, compute_graph_analytics
- tool_config: object - Per-tool configuration overrides';

COMMIT;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
