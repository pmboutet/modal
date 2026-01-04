/**
 * Tool registry for AI agents
 * Provides centralized tool lookup and configuration
 */

import type { ToolDefinition } from "./types";
import type { AiToolDefinition } from "../providers";
import {
  findRelatedInsightsTool,
  findInsightsByConceptsTool,
  findInsightClustersTool,
  getClaimNetworkTool,
  findClaimsByObjectiveTool,
  getClaimConflictsTool,
  computeGraphAnalyticsTool,
} from "./graph-tools";

/**
 * Registry of all available tools indexed by name
 */
export const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  find_related_insights: findRelatedInsightsTool,
  find_insights_by_concepts: findInsightsByConceptsTool,
  find_insight_clusters: findInsightClustersTool,
  get_claim_network: getClaimNetworkTool,
  find_claims_by_objective: findClaimsByObjectiveTool,
  get_claim_conflicts: getClaimConflictsTool,
  compute_graph_analytics: computeGraphAnalyticsTool,
};

/**
 * Special tool groups that can be enabled with a single flag
 */
const TOOL_GROUPS: Record<string, string[]> = {
  graph_rag_all: Object.keys(TOOL_REGISTRY),
  graph_rag_insights: [
    "find_related_insights",
    "find_insights_by_concepts",
    "find_insight_clusters",
  ],
  graph_rag_claims: [
    "get_claim_network",
    "find_claims_by_objective",
    "get_claim_conflicts",
  ],
};

/**
 * Get tools enabled for an agent based on its metadata
 * @param metadata Agent metadata containing enabled_tools array
 * @returns Array of ToolDefinitions the agent can use
 */
export function getToolsForAgent(
  metadata: Record<string, unknown> | null
): ToolDefinition[] {
  if (!metadata) {
    return [];
  }

  const enabledTools = metadata.enabled_tools;
  if (!Array.isArray(enabledTools) || enabledTools.length === 0) {
    return [];
  }

  const toolNames = new Set<string>();

  for (const item of enabledTools) {
    if (typeof item !== "string") continue;

    // Check if it's a group
    if (TOOL_GROUPS[item]) {
      TOOL_GROUPS[item].forEach((name) => toolNames.add(name));
    } else if (TOOL_REGISTRY[item]) {
      toolNames.add(item);
    }
  }

  return Array.from(toolNames)
    .map((name) => TOOL_REGISTRY[name])
    .filter(Boolean);
}

/**
 * Convert internal ToolDefinitions to Anthropic API format
 * @param tools Array of ToolDefinitions
 * @returns Array of AiToolDefinitions for API request
 */
export function convertToAiToolDefinitions(
  tools: ToolDefinition[]
): AiToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema as unknown as Record<string, unknown>,
  }));
}

/**
 * Get a tool by name from the registry
 * @param name Tool name
 * @returns ToolDefinition or undefined if not found
 */
export function getToolByName(name: string): ToolDefinition | undefined {
  return TOOL_REGISTRY[name];
}

/**
 * Get all available tool names
 */
export function getAllToolNames(): string[] {
  return Object.keys(TOOL_REGISTRY);
}

/**
 * Get all available group names
 */
export function getAllGroupNames(): string[] {
  return Object.keys(TOOL_GROUPS);
}
