/**
 * Graph queries service for Graph RAG
 * Provides functions to traverse and query the knowledge graph
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Claim, ClaimType } from "@/types";
import { getAdminSupabaseClient } from "@/lib/supabaseAdmin";

export interface RelatedInsight {
  id: string;
  path: string[]; // Path of IDs from source to target
  relationshipTypes: string[];
  similarityScore?: number;
}

export interface InsightCluster {
  id: string;
  insightIds: string[];
  size: number;
  averageSimilarity: number;
}

/**
 * Find related insights by traversing the graph (BFS)
 * @param supabase Supabase client
 * @param insightId Source insight ID
 * @param depth Number of hops to traverse (default 2)
 * @param relationshipTypes Types of relationships to follow
 * @param projectId Optional project ID to filter results (security isolation)
 */
export async function findRelatedInsights(
  supabase: SupabaseClient,
  insightId: string,
  depth: number = 2,
  relationshipTypes: string[] = ["SIMILAR_TO", "RELATED_TO"],
  projectId?: string
): Promise<RelatedInsight[]> {
  const results: RelatedInsight[] = [];
  const visited = new Set<string>();
  const queue: Array<{ id: string; path: string[]; relationshipTypes: string[] }> = [
    { id: insightId, path: [insightId], relationshipTypes: [] },
  ];

  visited.add(insightId);

  // Get valid insight IDs for the project (for security filtering)
  let validInsightIds: Set<string> | null = null;
  if (projectId) {
    const { data: askSessions } = await supabase
      .from("ask_sessions")
      .select("id")
      .eq("project_id", projectId);

    if (askSessions && askSessions.length > 0) {
      const askSessionIds = askSessions.map((s) => s.id);
      const { data: projectInsights } = await supabase
        .from("insights")
        .select("id")
        .in("ask_session_id", askSessionIds);

      if (projectInsights) {
        validInsightIds = new Set(projectInsights.map((i) => i.id));
      }
    }

    // If no valid insights found for project, return empty
    if (!validInsightIds || validInsightIds.size === 0) {
      return [];
    }
  }

  let currentDepth = 0;

  while (queue.length > 0 && currentDepth < depth) {
    const levelSize = queue.length;

    for (let i = 0; i < levelSize; i++) {
      const current = queue.shift()!;

      // Find outgoing edges
      const { data: edges } = await supabase
        .from("knowledge_graph_edges")
        .select("target_id, target_type, relationship_type, similarity_score")
        .eq("source_id", current.id)
        .eq("source_type", "insight")
        .in("relationship_type", relationshipTypes);

      if (!edges) {
        continue;
      }

      for (const edge of edges) {
        if (edge.target_type !== "insight") {
          continue;
        }

        // SECURITY: Skip if insight is not in the project scope
        if (validInsightIds && !validInsightIds.has(edge.target_id)) {
          continue;
        }

        if (!visited.has(edge.target_id)) {
          visited.add(edge.target_id);

          const newPath = [...current.path, edge.target_id];
          const newRelationshipTypes = [
            ...current.relationshipTypes,
            edge.relationship_type,
          ];

          results.push({
            id: edge.target_id,
            path: newPath,
            relationshipTypes: newRelationshipTypes,
            similarityScore: edge.similarity_score || undefined,
          });

          if (currentDepth < depth - 1) {
            queue.push({
              id: edge.target_id,
              path: newPath,
              relationshipTypes: newRelationshipTypes,
            });
          }
        }
      }
    }

    currentDepth++;
  }

  return results;
}

/**
 * Find insights by concepts/keywords
 */
export async function findInsightsByConcepts(
  supabase: SupabaseClient,
  concepts: string[],
  projectId?: string
): Promise<string[]> {
  if (concepts.length === 0) {
    return [];
  }

  // Normalize concept names
  const normalizedConcepts = concepts.map((c) =>
    c.toLowerCase().trim().replace(/\s+/g, " ")
  );

  // Find entities matching concepts
  const { data: entities } = await supabase
    .from("knowledge_entities")
    .select("id")
    .in("name", normalizedConcepts);

  if (!entities || entities.length === 0) {
    return [];
  }

  const entityIds = entities.map((e) => e.id);

  // Find insights linked to these entities
  let query = supabase
    .from("insight_keywords")
    .select("insight_id")
    .in("entity_id", entityIds);

  // Filter by project if specified
  if (projectId) {
    // Get project's ask sessions
    const { data: askSessions } = await supabase
      .from("ask_sessions")
      .select("id")
      .eq("project_id", projectId);

    if (askSessions && askSessions.length > 0) {
      const askSessionIds = askSessions.map((s) => s.id);

      // Get insights from these sessions
      const { data: projectInsights } = await supabase
        .from("insights")
        .select("id")
        .in("ask_session_id", askSessionIds);

      if (projectInsights && projectInsights.length > 0) {
        const projectInsightIds = projectInsights.map((i) => i.id);
        query = query.in("insight_id", projectInsightIds);
      } else {
        return [];
      }
    } else {
      return [];
    }
  }

  const { data: keywords } = await query;

  if (!keywords) {
    return [];
  }

  // Get unique insight IDs
  const insightIds = [...new Set(keywords.map((k) => k.insight_id))];
  return insightIds;
}

/**
 * Find insight clusters using graph community detection
 * @param supabase Supabase client
 * @param projectIdOrInsightIds Either a projectId (string) or an array of insight IDs
 * @param minClusterSize Minimum cluster size
 */
export async function findInsightClusters(
  supabase: SupabaseClient,
  projectIdOrInsightIds: string | string[],
  minClusterSize: number = 3
): Promise<InsightCluster[]> {
  let insightIds: string[];

  // If projectId is provided, get insights for that project
  if (typeof projectIdOrInsightIds === "string") {
    const projectId = projectIdOrInsightIds;
    // Get project's insights
    const { data: askSessions } = await supabase
      .from("ask_sessions")
      .select("id")
      .eq("project_id", projectId);

    if (!askSessions || askSessions.length === 0) {
      return [];
    }

    const askSessionIds = askSessions.map((s) => s.id);

    const { data: insights } = await supabase
      .from("insights")
      .select("id")
      .in("ask_session_id", askSessionIds);

    if (!insights || insights.length < minClusterSize) {
      return [];
    }

    insightIds = insights.map((i) => i.id);
  } else {
    // Use provided insight IDs directly
    insightIds = projectIdOrInsightIds;
    if (insightIds.length < minClusterSize) {
      return [];
    }
  }

  // Get all edges between these insights
  const { data: edges } = await supabase
    .from("knowledge_graph_edges")
    .select("source_id, target_id, similarity_score")
    .in("source_id", insightIds)
    .in("target_id", insightIds)
    .eq("source_type", "insight")
    .eq("target_type", "insight")
    .in("relationship_type", ["SIMILAR_TO", "RELATED_TO"]);

  if (!edges || edges.length === 0) {
    return [];
  }

  // Simple clustering: find connected components
  const clusters: Map<string, Set<string>> = new Map();
  const processed = new Set<string>();

  for (const edge of edges) {
    if (!clusters.has(edge.source_id) && !clusters.has(edge.target_id)) {
      // New cluster
      const cluster = new Set([edge.source_id, edge.target_id]);
      clusters.set(edge.source_id, cluster);
      processed.add(edge.source_id);
      processed.add(edge.target_id);
    } else if (clusters.has(edge.source_id) && !clusters.has(edge.target_id)) {
      // Add to existing cluster
      const cluster = clusters.get(edge.source_id)!;
      cluster.add(edge.target_id);
      clusters.set(edge.target_id, cluster);
      processed.add(edge.target_id);
    } else if (!clusters.has(edge.source_id) && clusters.has(edge.target_id)) {
      // Add to existing cluster
      const cluster = clusters.get(edge.target_id)!;
      cluster.add(edge.source_id);
      clusters.set(edge.source_id, cluster);
      processed.add(edge.source_id);
    }
    // If both already in clusters, merge if different
    else {
      const sourceCluster = clusters.get(edge.source_id)!;
      const targetCluster = clusters.get(edge.target_id)!;
      if (sourceCluster !== targetCluster) {
        // Merge clusters
        for (const id of targetCluster) {
          sourceCluster.add(id);
          clusters.set(id, sourceCluster);
        }
      }
    }
  }

  // Convert to result format
  const resultClusters: InsightCluster[] = [];
  const uniqueClusters = new Set(clusters.values());

  for (const cluster of uniqueClusters) {
    if (cluster.size >= minClusterSize) {
      // Calculate average similarity
      let totalSimilarity = 0;
      let similarityCount = 0;

      const clusterIds = Array.from(cluster);
      for (const edge of edges) {
        if (clusterIds.includes(edge.source_id) && clusterIds.includes(edge.target_id)) {
          if (edge.similarity_score) {
            totalSimilarity += edge.similarity_score;
            similarityCount++;
          }
        }
      }

      const avgSimilarity =
        similarityCount > 0 ? totalSimilarity / similarityCount : 0;

      resultClusters.push({
        id: clusterIds[0], // Use first ID as cluster identifier
        insightIds: clusterIds,
        size: cluster.size,
        averageSimilarity: avgSimilarity,
      });
    }
  }

  return resultClusters;
}

/**
 * Get syntheses that include a specific insight
 */
export async function getSynthesisForInsight(
  supabase: SupabaseClient,
  insightId: string
): Promise<Array<{ id: string; synthesizedText: string }>> {
  // Find edges where synthesis SYNTHESIZES this insight
  const { data: edges } = await supabase
    .from("knowledge_graph_edges")
    .select("source_id, source_type")
    .eq("target_id", insightId)
    .eq("target_type", "insight")
    .eq("source_type", "synthesis")
    .eq("relationship_type", "SYNTHESIZES");

  if (!edges || edges.length === 0) {
    return [];
  }

  const synthesisIds = edges.map((e) => e.source_id);

  // Get synthesis details
  const { data: syntheses } = await supabase
    .from("insight_syntheses")
    .select("id, synthesized_text")
    .in("id", synthesisIds);

  if (!syntheses) {
    return [];
  }

  return syntheses.map((s) => ({
    id: s.id,
    synthesizedText: s.synthesized_text,
  }));
}

// ============================================================================
// Claim-related queries
// ============================================================================

export interface ClaimWithRelations {
  claim: Claim;
  supportingInsights: Array<{ id: string; content: string }>;
  relatedClaims: Array<{ claim: Claim; relation: 'supports' | 'contradicts' | 'refines' }>;
}

/**
 * Map database row to Claim type
 */
function mapRowToClaim(row: Record<string, unknown>): Claim {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    challengeId: row.challenge_id as string | null,
    statement: row.statement as string,
    claimType: row.claim_type as ClaimType,
    evidenceStrength: row.evidence_strength as number | null,
    confidence: row.confidence as number | null,
    sourceInsightIds: (row.source_insight_ids as string[]) || [],
    embedding: row.embedding as number[] | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Find claims for a specific challenge (objective)
 */
export async function findClaimsByChallenge(
  supabase: SupabaseClient,
  challengeId: string
): Promise<Claim[]> {
  const { data, error } = await supabase
    .from("claims")
    .select("*")
    .eq("challenge_id", challengeId)
    .order("evidence_strength", { ascending: false });

  if (error) {
    console.error("[Graph RAG] Error finding claims by challenge:", error);
    return [];
  }

  return (data || []).map(mapRowToClaim);
}

/**
 * Find claims for a project, optionally filtered by type
 */
export async function findClaimsByProject(
  supabase: SupabaseClient,
  projectId: string,
  claimType?: ClaimType
): Promise<Claim[]> {
  let query = supabase
    .from("claims")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (claimType) {
    query = query.eq("claim_type", claimType);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[Graph RAG] Error finding claims by project:", error);
    return [];
  }

  return (data || []).map(mapRowToClaim);
}

/**
 * Get a claim with its supporting insights and related claims
 */
export async function getClaimNetwork(
  supabase: SupabaseClient,
  claimId: string
): Promise<ClaimWithRelations | null> {
  // Get the claim
  const { data: claimData, error: claimError } = await supabase
    .from("claims")
    .select("*")
    .eq("id", claimId)
    .maybeSingle();

  if (claimError || !claimData) {
    console.error("[Graph RAG] Error fetching claim:", claimError);
    return null;
  }

  const claim = mapRowToClaim(claimData);

  // Get supporting insights (via EVIDENCE_FOR edges)
  const { data: insightEdges } = await supabase
    .from("knowledge_graph_edges")
    .select("source_id")
    .eq("target_id", claimId)
    .eq("target_type", "claim")
    .eq("source_type", "insight")
    .eq("relationship_type", "EVIDENCE_FOR");

  const supportingInsights: Array<{ id: string; content: string }> = [];

  if (insightEdges && insightEdges.length > 0) {
    const insightIds = insightEdges.map(e => e.source_id);
    const { data: insights } = await supabase
      .from("insights")
      .select("id, content")
      .in("id", insightIds);

    if (insights) {
      supportingInsights.push(...insights.map(i => ({ id: i.id, content: i.content })));
    }
  }

  // Get related claims (SUPPORTS/CONTRADICTS edges)
  const relatedClaims: Array<{ claim: Claim; relation: 'supports' | 'contradicts' | 'refines' }> = [];

  // Claims that this claim supports or contradicts
  const { data: outgoingEdges } = await supabase
    .from("knowledge_graph_edges")
    .select("target_id, relationship_type")
    .eq("source_id", claimId)
    .eq("source_type", "claim")
    .eq("target_type", "claim")
    .in("relationship_type", ["SUPPORTS", "CONTRADICTS"]);

  // Claims that support or contradict this claim
  const { data: incomingEdges } = await supabase
    .from("knowledge_graph_edges")
    .select("source_id, relationship_type")
    .eq("target_id", claimId)
    .eq("target_type", "claim")
    .eq("source_type", "claim")
    .in("relationship_type", ["SUPPORTS", "CONTRADICTS"]);

  const relatedClaimIds = new Set<string>();
  const claimRelationMap = new Map<string, 'supports' | 'contradicts' | 'refines'>();

  if (outgoingEdges) {
    for (const edge of outgoingEdges) {
      relatedClaimIds.add(edge.target_id);
      claimRelationMap.set(
        edge.target_id,
        edge.relationship_type === "SUPPORTS" ? "supports" : "contradicts"
      );
    }
  }

  if (incomingEdges) {
    for (const edge of incomingEdges) {
      relatedClaimIds.add(edge.source_id);
      // For incoming edges, the relation is reversed in semantics
      claimRelationMap.set(
        edge.source_id,
        edge.relationship_type === "SUPPORTS" ? "supports" : "contradicts"
      );
    }
  }

  if (relatedClaimIds.size > 0) {
    const { data: claims } = await supabase
      .from("claims")
      .select("*")
      .in("id", Array.from(relatedClaimIds));

    if (claims) {
      for (const c of claims) {
        const mappedClaim = mapRowToClaim(c);
        relatedClaims.push({
          claim: mappedClaim,
          relation: claimRelationMap.get(c.id) || "refines",
        });
      }
    }
  }

  return {
    claim,
    supportingInsights,
    relatedClaims,
  };
}

/**
 * Find claims that address a specific objective text (semantic search)
 */
export async function findClaimsByObjective(
  supabase: SupabaseClient,
  objectiveText: string,
  projectId: string,
  threshold: number = 0.75,
  limit: number = 10
): Promise<Claim[]> {
  // Generate embedding for the objective
  const { generateEmbedding } = await import("@/lib/ai/embeddings");
  const embedding = await generateEmbedding(objectiveText);

  // Use the find_similar_claims RPC function
  const { data, error } = await supabase.rpc("find_similar_claims", {
    p_embedding: embedding,
    p_project_id: projectId,
    p_threshold: threshold,
    p_limit: limit,
  });

  if (error) {
    console.error("[Graph RAG] Error finding claims by objective:", error);
    return [];
  }

  // Get full claim data
  if (!data || data.length === 0) {
    return [];
  }

  const claimIds = data.map((d: { id: string }) => d.id);

  const { data: claims } = await supabase
    .from("claims")
    .select("*")
    .in("id", claimIds);

  return (claims || []).map(mapRowToClaim);
}

/**
 * Get all claims that support or contradict each other in a project
 */
export async function getClaimConflicts(
  supabase: SupabaseClient,
  projectId: string
): Promise<Array<{ claim1: Claim; claim2: Claim; relation: 'supports' | 'contradicts' }>> {
  // Get all claims for the project
  const { data: claims } = await supabase
    .from("claims")
    .select("*")
    .eq("project_id", projectId);

  if (!claims || claims.length === 0) {
    return [];
  }

  const claimIds = claims.map(c => c.id);
  const claimMap = new Map(claims.map(c => [c.id, mapRowToClaim(c)]));

  // Get all CONTRADICTS and SUPPORTS edges between claims
  const { data: edges } = await supabase
    .from("knowledge_graph_edges")
    .select("source_id, target_id, relationship_type")
    .in("source_id", claimIds)
    .in("target_id", claimIds)
    .eq("source_type", "claim")
    .eq("target_type", "claim")
    .in("relationship_type", ["SUPPORTS", "CONTRADICTS"]);

  if (!edges) {
    return [];
  }

  return edges.map(edge => ({
    claim1: claimMap.get(edge.source_id)!,
    claim2: claimMap.get(edge.target_id)!,
    relation: edge.relationship_type === "SUPPORTS" ? "supports" as const : "contradicts" as const,
  })).filter(r => r.claim1 && r.claim2);
}

