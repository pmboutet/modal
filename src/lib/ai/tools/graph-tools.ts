/**
 * GraphRAG tools for AI agents
 * Wraps existing graphQueries and graphAnalysis functions as callable tools
 */

import type { ToolDefinition } from "./types";

// ============================================================================
// Tool: find_related_insights
// ============================================================================

export const findRelatedInsightsTool: ToolDefinition = {
  name: "find_related_insights",
  description:
    "Find insights related to a given insight by traversing the knowledge graph. " +
    "Uses BFS to discover connected insights via SIMILAR_TO and RELATED_TO edges. " +
    "Useful for discovering patterns and connections across conversations.",
  input_schema: {
    type: "object",
    properties: {
      insight_id: {
        type: "string",
        description: "The UUID of the source insight to find relations for",
      },
      depth: {
        type: "number",
        description: "How many hops to traverse (1-3). Default is 2.",
        default: 2,
      },
      relationship_types: {
        type: "string",
        description:
          "Comma-separated relationship types to follow: SIMILAR_TO, RELATED_TO. Default is both.",
      },
    },
    required: ["insight_id"],
  },
  execute: async (context, input) => {
    // SECURITY: Validate project context is present
    if (!context.projectId) {
      return { error: "project_id is required in context for security isolation" };
    }

    // SECURITY: Validate the insight belongs to the current project
    const { data: insight, error: validationError } = await context.supabase
      .from("insights")
      .select("id, ask_sessions!inner(project_id)")
      .eq("id", input.insight_id as string)
      .eq("ask_sessions.project_id", context.projectId)
      .single();

    if (validationError || !insight) {
      return { error: "Insight not found in this project" };
    }

    const { findRelatedInsights } = await import("@/lib/graphRAG/graphQueries");
    const depth = typeof input.depth === "number" ? input.depth : 2;
    const relationshipTypes = input.relationship_types
      ? (input.relationship_types as string).split(",").map((s) => s.trim())
      : ["SIMILAR_TO", "RELATED_TO"];

    return findRelatedInsights(
      context.supabase,
      input.insight_id as string,
      depth,
      relationshipTypes,
      context.projectId // Pass projectId for additional filtering
    );
  },
};

// ============================================================================
// Tool: find_insights_by_concepts
// ============================================================================

export const findInsightsByConceptsTool: ToolDefinition = {
  name: "find_insights_by_concepts",
  description:
    "Find insights that mention specific concepts, keywords, or themes. " +
    "Searches the knowledge entity graph to discover relevant insights. " +
    "Useful for finding all insights related to a topic across the project.",
  input_schema: {
    type: "object",
    properties: {
      concepts: {
        type: "string",
        description:
          "Comma-separated list of concepts/keywords to search for (e.g., 'customer retention, churn, loyalty')",
      },
    },
    required: ["concepts"],
  },
  execute: async (context, input) => {
    // SECURITY: projectId MUST come from context, never from input
    const projectId = context.projectId;
    if (!projectId) {
      return { error: "project_id is required in context for security isolation" };
    }

    const { findInsightsByConcepts } = await import("@/lib/graphRAG/graphQueries");
    const concepts = (input.concepts as string).split(",").map((s) => s.trim());

    return findInsightsByConcepts(context.supabase, concepts, projectId);
  },
};

// ============================================================================
// Tool: find_insight_clusters
// ============================================================================

export const findInsightClustersTool: ToolDefinition = {
  name: "find_insight_clusters",
  description:
    "Find clusters of related insights using graph community detection. " +
    "Groups insights that are densely connected to each other. " +
    "Useful for identifying themes and patterns in project conversations.",
  input_schema: {
    type: "object",
    properties: {
      project_id: {
        type: "string",
        description:
          "The project ID to analyze. If not provided, uses context project.",
      },
      min_cluster_size: {
        type: "number",
        description: "Minimum number of insights to form a cluster. Default is 3.",
        default: 3,
      },
    },
    required: [],
  },
  execute: async (context, input) => {
    const { findInsightClusters } = await import("@/lib/graphRAG/graphQueries");
    const projectId = (input.project_id as string) || context.projectId;

    if (!projectId) {
      return { error: "project_id is required but not provided" };
    }

    const minClusterSize =
      typeof input.min_cluster_size === "number" ? input.min_cluster_size : 3;

    return findInsightClusters(context.supabase, projectId, minClusterSize);
  },
};

// ============================================================================
// Tool: get_claim_network
// ============================================================================

export const getClaimNetworkTool: ToolDefinition = {
  name: "get_claim_network",
  description:
    "Get a claim with its full context: supporting insights and related claims. " +
    "Shows which insights provide evidence for the claim and which other claims support or contradict it. " +
    "Useful for understanding the evidence structure around a finding or hypothesis.",
  input_schema: {
    type: "object",
    properties: {
      claim_id: {
        type: "string",
        description: "The UUID of the claim to analyze",
      },
    },
    required: ["claim_id"],
  },
  execute: async (context, input) => {
    // SECURITY: Validate project context is present
    if (!context.projectId) {
      return { error: "project_id is required in context for security isolation" };
    }

    // SECURITY: Validate the claim belongs to the current project
    const { data: claim, error: validationError } = await context.supabase
      .from("claims")
      .select("id, project_id")
      .eq("id", input.claim_id as string)
      .eq("project_id", context.projectId)
      .single();

    if (validationError || !claim) {
      return { error: "Claim not found in this project" };
    }

    const { getClaimNetwork } = await import("@/lib/graphRAG/graphQueries");
    return getClaimNetwork(context.supabase, input.claim_id as string);
  },
};

// ============================================================================
// Tool: find_claims_by_objective
// ============================================================================

export const findClaimsByObjectiveTool: ToolDefinition = {
  name: "find_claims_by_objective",
  description:
    "Find claims related to a specific objective or goal using semantic search. " +
    "Uses embeddings to find claims that address the given objective text. " +
    "Useful for discovering what has been learned about a particular challenge.",
  input_schema: {
    type: "object",
    properties: {
      objective: {
        type: "string",
        description:
          "The objective or goal text to search for (e.g., 'improve customer retention')",
      },
      project_id: {
        type: "string",
        description:
          "The project ID to search within. If not provided, uses context project.",
      },
      limit: {
        type: "number",
        description: "Maximum number of claims to return. Default is 10.",
        default: 10,
      },
    },
    required: ["objective"],
  },
  execute: async (context, input) => {
    const { findClaimsByObjective } = await import("@/lib/graphRAG/graphQueries");
    const projectId = (input.project_id as string) || context.projectId;

    if (!projectId) {
      return { error: "project_id is required but not provided" };
    }

    const limit = typeof input.limit === "number" ? input.limit : 10;

    return findClaimsByObjective(
      context.supabase,
      input.objective as string,
      projectId,
      0.75, // threshold
      limit
    );
  },
};

// ============================================================================
// Tool: get_claim_conflicts
// ============================================================================

export const getClaimConflictsTool: ToolDefinition = {
  name: "get_claim_conflicts",
  description:
    "Find all claims that support or contradict each other in a project. " +
    "Returns pairs of claims with their relationship (supports/contradicts). " +
    "Useful for identifying tensions, validations, or areas needing resolution.",
  input_schema: {
    type: "object",
    properties: {
      project_id: {
        type: "string",
        description:
          "The project ID to analyze. If not provided, uses context project.",
      },
    },
    required: [],
  },
  execute: async (context, input) => {
    const { getClaimConflicts } = await import("@/lib/graphRAG/graphQueries");
    const projectId = (input.project_id as string) || context.projectId;

    if (!projectId) {
      return { error: "project_id is required but not provided" };
    }

    return getClaimConflicts(context.supabase, projectId);
  },
};

// ============================================================================
// Tool: compute_graph_analytics
// ============================================================================

export const computeGraphAnalyticsTool: ToolDefinition = {
  name: "compute_graph_analytics",
  description:
    "Compute comprehensive analytics on the project's knowledge graph. " +
    "Includes community detection, centrality metrics (betweenness, PageRank, degree). " +
    "Useful for understanding the structure and key nodes in the knowledge graph.",
  input_schema: {
    type: "object",
    properties: {
      project_id: {
        type: "string",
        description:
          "The project ID to analyze. If not provided, uses context project.",
      },
    },
    required: [],
  },
  execute: async (context, input) => {
    const { computeGraphAnalytics } = await import("@/lib/graphRAG/graphAnalysis");
    const projectId = (input.project_id as string) || context.projectId;

    if (!projectId) {
      return { error: "project_id is required but not provided" };
    }

    return computeGraphAnalytics(context.supabase, projectId);
  },
};

// ============================================================================
// Export all tools
// ============================================================================

export const GRAPH_TOOLS_LIST: ToolDefinition[] = [
  findRelatedInsightsTool,
  findInsightsByConceptsTool,
  findInsightClustersTool,
  getClaimNetworkTool,
  findClaimsByObjectiveTool,
  getClaimConflictsTool,
  computeGraphAnalyticsTool,
];
