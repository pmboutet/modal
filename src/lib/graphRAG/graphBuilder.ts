/**
 * Graph builder service for Graph RAG
 * Creates edges between insights, entities, and challenges based on similarity and relationships
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimRelation } from "@/types";
import { getAdminSupabaseClient } from "@/lib/supabaseAdmin";
import { generateEmbedding } from "@/lib/ai/embeddings";

export type RelationshipType =
  | "SIMILAR_TO"
  | "RELATED_TO"
  | "CONTAINS"
  | "SYNTHESIZES"
  | "MENTIONS"
  | "HAS_TYPE"
  // Claim-related types
  | "SUPPORTS"
  | "CONTRADICTS"
  | "ADDRESSES"
  | "EVIDENCE_FOR";

interface GraphEdge {
  sourceId: string;
  sourceType: string;
  targetId: string;
  targetType: string;
  relationshipType: RelationshipType;
  similarityScore?: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Create or update a graph edge
 */
async function upsertGraphEdge(
  supabase: SupabaseClient,
  edge: GraphEdge
): Promise<void> {
  const { error, data } = await supabase.from("knowledge_graph_edges").upsert(
    {
      source_id: edge.sourceId,
      source_type: edge.sourceType,
      target_id: edge.targetId,
      target_type: edge.targetType,
      relationship_type: edge.relationshipType,
      similarity_score: edge.similarityScore ?? null,
      confidence: edge.confidence ?? null,
      metadata: edge.metadata ?? null,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "source_id,source_type,target_id,target_type,relationship_type",
      ignoreDuplicates: false,
    }
  ).select();

  if (error) {
    // If error is about unique constraint violation, the edge already exists (which is fine)
    if (error.code === '23505' || error.message.includes('unique constraint') || error.message.includes('duplicate key')) {
      console.log(`[Graph RAG] Edge already exists: ${edge.sourceType}:${edge.sourceId} -> ${edge.relationshipType} -> ${edge.targetType}:${edge.targetId}`);
      return;
    }
    console.error(`[Graph RAG] Error upserting graph edge from ${edge.sourceId} to ${edge.targetId}:`, error);
    throw new Error(`Failed to create graph edge: ${error.message}`);
  }
  
  if (data && data.length > 0) {
    console.log(`[Graph RAG] Created/updated edge: ${edge.sourceType}:${edge.sourceId} -> ${edge.relationshipType} -> ${edge.targetType}:${edge.targetId}`);
  }
}

/**
 * Find similar insights using vector similarity
 */
async function findSimilarInsights(
  supabase: SupabaseClient,
  insightId: string,
  embedding: number[],
  threshold: number = 0.75,
  limit: number = 10
): Promise<Array<{ id: string; similarity: number }>> {
  // Supabase accepts number arrays directly for vector types
  const { data, error } = await supabase.rpc("find_similar_insights", {
    query_embedding: embedding, // Pass array directly, Supabase converts to vector
    match_threshold: threshold,
    match_count: limit,
    exclude_id: insightId,
  });

  if (error) {
    console.error("Error finding similar insights:", error);
    // Return empty array on error (function might not exist yet, will be created after migration)
    return [];
  }

  return (data || []).map((item: { id: string; similarity: number }) => ({
    id: item.id,
    similarity: item.similarity,
  }));
}

/**
 * Build similarity edges between insights
 */
export async function buildSimilarityEdges(
  supabase: SupabaseClient,
  insightId: string,
  embedding: number[]
): Promise<void> {
  console.log(`[Graph RAG] Building similarity edges for insight ${insightId}...`);
  const similarInsights = await findSimilarInsights(
    supabase,
    insightId,
    embedding,
    0.75,
    10
  );

  console.log(`[Graph RAG] Found ${similarInsights.length} similar insights for ${insightId}`);

  if (similarInsights.length === 0) {
    return;
  }

  const edges: GraphEdge[] = similarInsights.map((similar) => ({
    sourceId: insightId,
    sourceType: "insight",
    targetId: similar.id,
    targetType: "insight",
    relationshipType: "SIMILAR_TO",
    similarityScore: similar.similarity,
    confidence: similar.similarity, // Use similarity as confidence
  }));

  // Also create reverse edges (bidirectional)
  const reverseEdges: GraphEdge[] = similarInsights.map((similar) => ({
    sourceId: similar.id,
    sourceType: "insight",
    targetId: insightId,
    targetType: "insight",
    relationshipType: "SIMILAR_TO",
    similarityScore: similar.similarity,
    confidence: similar.similarity,
  }));

  // Upsert all edges
  for (const edge of [...edges, ...reverseEdges]) {
    try {
      await upsertGraphEdge(supabase, edge);
    } catch (error) {
      console.error(`Error creating similarity edge for ${insightId}:`, error);
    }
  }
}

/**
 * Build conceptual edges linking insights to entities they mention
 */
export async function buildConceptualEdges(
  supabase: SupabaseClient,
  insightId: string
): Promise<void> {
  console.log(`[Graph RAG] Building conceptual edges for insight ${insightId}...`);
  // Get all entities linked to this insight
  const { data: keywords, error } = await supabase
    .from("insight_keywords")
    .select("entity_id, relevance_score")
    .eq("insight_id", insightId);

  if (error) {
    console.error(`[Graph RAG] Error fetching insight keywords for ${insightId}:`, error);
    return;
  }

  if (!keywords || keywords.length === 0) {
    console.log(`[Graph RAG] No keywords found for insight ${insightId}, skipping conceptual edges`);
    return;
  }

  console.log(`[Graph RAG] Found ${keywords.length} keywords for insight ${insightId}, creating conceptual edges`);

  const edges: GraphEdge[] = keywords.map((kw) => ({
    sourceId: insightId,
    sourceType: "insight",
    targetId: kw.entity_id,
    targetType: "entity",
    relationshipType: "MENTIONS",
    confidence: kw.relevance_score,
  }));

  // Find other insights that mention the same entities (RELATED_TO via common entities)
  const entityIds = keywords.map((kw) => kw.entity_id);

  const { data: relatedInsights } = await supabase
    .from("insight_keywords")
    .select("insight_id")
    .in("entity_id", entityIds)
    .neq("insight_id", insightId);

  if (relatedInsights) {
    const relatedInsightIds = [
      ...new Set(relatedInsights.map((r) => r.insight_id)),
    ];

    for (const relatedId of relatedInsightIds) {
      edges.push({
        sourceId: insightId,
        sourceType: "insight",
        targetId: relatedId,
        targetType: "insight",
        relationshipType: "RELATED_TO",
        confidence: 0.7, // Moderate confidence for entity-based relationships
        metadata: {
          via_entities: entityIds,
        },
      });
    }
  }

  // Upsert all edges
  for (const edge of edges) {
    try {
      await upsertGraphEdge(supabase, edge);
    } catch (error) {
      console.error(`Error creating conceptual edge for ${insightId}:`, error);
    }
  }
}

/**
 * Build edges linking insights to challenges
 */
export async function buildChallengeEdges(
  supabase: SupabaseClient,
  insightId: string
): Promise<void> {
  // Get insight to find related challenges
  const { data: insight, error: insightError } = await supabase
    .from("insights")
    .select("challenge_id, related_challenge_ids")
    .eq("id", insightId)
    .maybeSingle();

  if (insightError) {
    console.error("[Graph RAG] Error fetching insight:", insightError);
    return;
  }

  if (!insight) {
    // Insight doesn't exist (yet) - this is normal, not an error
    return;
  }

  const challengeIds: string[] = [];

  if (insight.challenge_id) {
    challengeIds.push(insight.challenge_id);
  }

  if (Array.isArray(insight.related_challenge_ids)) {
    challengeIds.push(...insight.related_challenge_ids);
  }

  // Also check challenge_insights junction table
  const { data: challengeInsights } = await supabase
    .from("challenge_insights")
    .select("challenge_id")
    .eq("insight_id", insightId);

  if (challengeInsights) {
    for (const ci of challengeInsights) {
      if (!challengeIds.includes(ci.challenge_id)) {
        challengeIds.push(ci.challenge_id);
      }
    }
  }

  const edges: GraphEdge[] = challengeIds.map((challengeId) => ({
    sourceId: insightId,
    sourceType: "insight",
    targetId: challengeId,
    targetType: "challenge",
    relationshipType: "RELATED_TO",
    confidence: 0.8,
  }));

  // Upsert all edges
  for (const edge of edges) {
    try {
      await upsertGraphEdge(supabase, edge);
    } catch (error) {
      console.error(`Error creating challenge edge for ${insightId}:`, error);
    }
  }
}

/**
 * Build edges for claims extracted from an insight
 * Creates: EVIDENCE_FOR (insight -> claim), SUPPORTS/CONTRADICTS (claim <-> claim), ADDRESSES (claim -> challenge)
 */
export async function buildClaimEdges(
  supabase: SupabaseClient,
  insightId: string,
  claimIds: string[],
  relations: ClaimRelation[],
  challengeId?: string | null
): Promise<void> {
  console.log(`[Graph RAG] Building claim edges for insight ${insightId} with ${claimIds.length} claims...`);

  if (claimIds.length === 0) {
    return;
  }

  const edges: GraphEdge[] = [];

  // Create EVIDENCE_FOR edges (insight -> claim)
  for (const claimId of claimIds) {
    edges.push({
      sourceId: insightId,
      sourceType: "insight",
      targetId: claimId,
      targetType: "claim",
      relationshipType: "EVIDENCE_FOR",
      confidence: 0.9,
    });
  }

  // Create ADDRESSES edges (claim -> challenge) if challenge is specified
  if (challengeId) {
    for (const claimId of claimIds) {
      edges.push({
        sourceId: claimId,
        sourceType: "claim",
        targetId: challengeId,
        targetType: "challenge",
        relationshipType: "ADDRESSES",
        confidence: 0.8,
      });
    }
  }

  // Create inter-claim relationship edges (SUPPORTS, CONTRADICTS)
  for (const relation of relations) {
    if (relation.fromClaimIndex < claimIds.length && relation.toClaimIndex < claimIds.length) {
      const relationshipType: RelationshipType =
        relation.relation === "supports" ? "SUPPORTS" :
        relation.relation === "contradicts" ? "CONTRADICTS" :
        "RELATED_TO"; // fallback for 'refines'

      edges.push({
        sourceId: claimIds[relation.fromClaimIndex],
        sourceType: "claim",
        targetId: claimIds[relation.toClaimIndex],
        targetType: "claim",
        relationshipType,
        confidence: 0.7,
      });
    }
  }

  // Upsert all edges
  for (const edge of edges) {
    try {
      await upsertGraphEdge(supabase, edge);
    } catch (error) {
      console.error(`[Graph RAG] Error creating claim edge:`, error);
    }
  }

  console.log(`[Graph RAG] Created ${edges.length} claim edges for insight ${insightId}`);
}

/**
 * Build all graph edges for an insight
 */
export async function buildAllEdgesForInsight(
  insightId: string,
  embedding?: number[],
  supabase?: ReturnType<typeof getAdminSupabaseClient>
): Promise<void> {
  const client = supabase || getAdminSupabaseClient();

  try {
    // Build similarity edges if embedding is provided
    if (embedding) {
      await buildSimilarityEdges(client, insightId, embedding);
    }

    // Build conceptual edges
    await buildConceptualEdges(client, insightId);

    // Build challenge edges
    await buildChallengeEdges(client, insightId);
  } catch (error) {
    console.error(`Error building edges for insight ${insightId}:`, error);
    throw error;
  }
}

/**
 * Delete all graph edges related to an insight (as source or target)
 * Also cleans up insight_keywords relationships and claims
 */
export async function deleteEdgesForInsight(
  insightId: string,
  supabase?: ReturnType<typeof getAdminSupabaseClient>
): Promise<void> {
  const client = supabase || getAdminSupabaseClient();

  console.log(`[Graph RAG] Deleting all edges for insight ${insightId}...`);

  try {
    // Delete edges where insight is the source
    const { error: sourceError } = await client
      .from("knowledge_graph_edges")
      .delete()
      .eq("source_id", insightId)
      .eq("source_type", "insight");

    if (sourceError) {
      console.error(`[Graph RAG] Error deleting source edges for ${insightId}:`, sourceError);
    }

    // Delete edges where insight is the target
    const { error: targetError } = await client
      .from("knowledge_graph_edges")
      .delete()
      .eq("target_id", insightId)
      .eq("target_type", "insight");

    if (targetError) {
      console.error(`[Graph RAG] Error deleting target edges for ${insightId}:`, targetError);
    }

    // Delete insight_keywords relationships
    const { error: keywordsError } = await client
      .from("insight_keywords")
      .delete()
      .eq("insight_id", insightId);

    if (keywordsError) {
      console.error(`[Graph RAG] Error deleting keywords for ${insightId}:`, keywordsError);
    }

    // Delete claims associated with this insight
    const { deleteClaimsForInsight } = await import("@/lib/graphRAG/extractClaims");
    await deleteClaimsForInsight(insightId, client);

    console.log(`[Graph RAG] Successfully deleted all edges, keywords, and claims for insight ${insightId}`);
  } catch (error) {
    console.error(`[Graph RAG] Error in deleteEdgesForInsight for ${insightId}:`, error);
    throw error;
  }
}

// Note: rebuildGraphForInsight was removed as part of the architecture refactor.
// Graph generation now happens post-interview via generateParticipantGraph().

