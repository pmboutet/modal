/**
 * AI Tools module
 * Provides tool definitions and registry for agentic AI execution
 */

// Types
export type {
  ToolContext,
  ToolDefinition,
  ToolInputSchema,
  ToolCallResult,
  ToolCallRecord,
} from "./types";

// Registry
export {
  TOOL_REGISTRY,
  getToolsForAgent,
  convertToAiToolDefinitions,
  getToolByName,
  getAllToolNames,
  getAllGroupNames,
} from "./registry";

// Graph tools (for direct access if needed)
export {
  findRelatedInsightsTool,
  findInsightsByConceptsTool,
  findInsightClustersTool,
  getClaimNetworkTool,
  findClaimsByObjectiveTool,
  getClaimConflictsTool,
  computeGraphAnalyticsTool,
  GRAPH_TOOLS_LIST,
} from "./graph-tools";
