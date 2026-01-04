# GraphRAG Tools for AI Agents

This module provides tools that AI agents can use to query the knowledge graph during their reasoning process via Claude's `tool_use` API.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   AI Agent      │────>│ Agentic Executor │────>│  Tool Registry  │
│  (Claude API)   │<────│  (multi-turn)    │<────│  (graph-tools)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                         │
                                                         v
                                                 ┌─────────────────┐
                                                 │  graphQueries   │
                                                 │  graphAnalysis  │
                                                 └─────────────────┘
```

## Available Tools

### Insight Tools

| Tool | Description | Required Params |
|------|-------------|-----------------|
| `find_related_insights` | Traverse knowledge graph to find connected insights via BFS | `insight_id` |
| `find_insights_by_concepts` | Search insights by keywords/concepts | `concepts` (comma-separated) |
| `find_insight_clusters` | Group insights using community detection | - |

### Claim Tools

| Tool | Description | Required Params |
|------|-------------|-----------------|
| `get_claim_network` | Get claim with supporting insights & related claims | `claim_id` |
| `find_claims_by_objective` | Semantic search for claims by objective text | `objective` |
| `get_claim_conflicts` | Find supporting/contradicting claim pairs | - |

### Analytics

| Tool | Description | Required Params |
|------|-------------|-----------------|
| `compute_graph_analytics` | Full graph analytics (communities, centrality, PageRank) | - |

## Tool Groups

Agents can enable multiple tools using groups:

- `graph_rag_all`: All 7 tools
- `graph_rag_insights`: 3 insight tools (`find_related_insights`, `find_insights_by_concepts`, `find_insight_clusters`)
- `graph_rag_claims`: 3 claim tools (`get_claim_network`, `find_claims_by_objective`, `get_claim_conflicts`)

## Enabling Tools on an Agent

Set the `enabled_tools` array in the agent's metadata:

```sql
-- Enable all graph tools
UPDATE ai_agents
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'),
  '{enabled_tools}',
  '["graph_rag_all"]'
)
WHERE slug = 'my-agent';

-- Enable specific tools
UPDATE ai_agents
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'),
  '{enabled_tools}',
  '["find_insight_clusters", "compute_graph_analytics"]'
)
WHERE slug = 'my-agent';
```

## Security

All tools enforce strict project isolation:

1. **Context-based projectId**: The `projectId` ALWAYS comes from the execution context, never from user input
2. **Ownership validation**: Tools validate that requested resources (insights, claims) belong to the current project
3. **Filtered traversal**: Graph traversal only returns nodes within the project scope

### Security Validation Examples

```typescript
// find_related_insights validates insight ownership:
const { data: insight } = await context.supabase
  .from("insights")
  .select("id, ask_sessions!inner(project_id)")
  .eq("id", input.insight_id)
  .eq("ask_sessions.project_id", context.projectId)
  .single();

if (!insight) {
  return { error: "Insight not found in this project" };
}

// get_claim_network validates claim ownership:
const { data: claim } = await context.supabase
  .from("claims")
  .select("id, project_id")
  .eq("id", input.claim_id)
  .eq("project_id", context.projectId)
  .single();

if (!claim) {
  return { error: "Claim not found in this project" };
}
```

## Extended Thinking Mode

When using a model with `thinkingBudgetTokens` configured:
- The agent's reasoning is captured in `result.thinking`
- This can be displayed to users for transparency
- If thinking is not enabled, `result.thinking` is `undefined`

## Adding New Tools

1. Define the tool in [graph-tools.ts](graph-tools.ts):

```typescript
export const myNewTool: ToolDefinition = {
  name: "my_new_tool",
  description: "Description for Claude to understand when to use this tool",
  input_schema: {
    type: "object",
    properties: {
      param1: { type: "string", description: "..." },
    },
    required: ["param1"],
  },
  execute: async (context, input) => {
    // SECURITY: Always validate projectId
    if (!context.projectId) {
      return { error: "project_id is required in context" };
    }
    // ... implementation
  },
};
```

2. Register in [registry.ts](registry.ts):

```typescript
export const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  // ... existing tools
  my_new_tool: myNewTool,
};
```

3. Optionally add to a group:

```typescript
const TOOL_GROUPS: Record<string, string[]> = {
  // ... existing groups
  my_new_group: ["my_new_tool", "other_tool"],
};
```

## Logging

Tool calls are logged to `ai_agent_logs.tool_calls` with:
- `name`: Tool name
- `input`: Input parameters
- `result`: Tool output
- `latencyMs`: Execution time
- `error`: Error message (if failed)

## Files

| File | Description |
|------|-------------|
| [types.ts](types.ts) | `ToolContext`, `ToolDefinition`, `ToolCallRecord` interfaces |
| [graph-tools.ts](graph-tools.ts) | Tool definitions wrapping graphRAG functions |
| [registry.ts](registry.ts) | Tool registry, groups, and lookup functions |
| [index.ts](index.ts) | Barrel exports |
