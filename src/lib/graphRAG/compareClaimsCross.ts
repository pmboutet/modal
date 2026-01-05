/**
 * Cross-participant claim comparison service
 *
 * Compares claims from a new participant with existing claims from other participants
 * to identify SUPPORTS and CONTRADICTS relationships.
 *
 * Uses a hybrid approach:
 * 1. Pre-filter by embeddings (cosine similarity > threshold)
 * 2. AI analysis for candidate pairs to determine relationship type
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabaseClient } from "@/lib/supabaseAdmin";
import { executeAgent } from "@/lib/ai/service";

export interface ClaimComparison {
  claim1Id: string;
  claim2Id: string;
  relation: "SUPPORTS" | "CONTRADICTS" | "NEUTRAL";
  confidence: number;
  reasoning: string;
}

interface ClaimForComparison {
  id: string;
  statement: string;
  claim_type: string;
  embedding: number[] | null;
  participantId?: string;
}

const SIMILARITY_THRESHOLD = 0.6; // Pre-filter threshold for embedding similarity
const MAX_CANDIDATES_PER_CLAIM = 10; // Limit AI calls per claim

/**
 * Compare new claims with existing claims from other participants
 * Returns edges to create
 */
export async function compareClaimsCrossParticipants(
  client: SupabaseClient,
  newClaimIds: string[],
  projectId: string,
  currentParticipantId: string
): Promise<{ edgesCreated: number; comparisonsPerformed: number }> {
  if (newClaimIds.length === 0) {
    return { edgesCreated: 0, comparisonsPerformed: 0 };
  }

  console.log(`[Cross-Claim] Comparing ${newClaimIds.length} new claims for participant ${currentParticipantId}`);

  // Step 1: Fetch new claims with embeddings
  const { data: newClaims, error: newError } = await client
    .from("claims")
    .select("id, statement, claim_type, embedding")
    .in("id", newClaimIds);

  if (newError || !newClaims || newClaims.length === 0) {
    console.error("[Cross-Claim] Error fetching new claims:", newError);
    return { edgesCreated: 0, comparisonsPerformed: 0 };
  }

  // Step 2: Fetch existing claims from OTHER participants in the same project
  // We need to find claims that are NOT from the current participant
  const { data: existingClaims, error: existingError } = await client
    .from("claims")
    .select("id, statement, claim_type, embedding, source_insight_ids")
    .eq("project_id", projectId)
    .not("id", "in", `(${newClaimIds.join(",")})`);

  if (existingError) {
    console.error("[Cross-Claim] Error fetching existing claims:", existingError);
    return { edgesCreated: 0, comparisonsPerformed: 0 };
  }

  if (!existingClaims || existingClaims.length === 0) {
    console.log("[Cross-Claim] No existing claims to compare with");
    return { edgesCreated: 0, comparisonsPerformed: 0 };
  }

  console.log(`[Cross-Claim] Found ${existingClaims.length} existing claims to compare with`);

  // Step 3: For each new claim, find candidates by embedding similarity
  let totalComparisons = 0;
  let edgesCreated = 0;

  for (const newClaim of newClaims) {
    if (!newClaim.embedding) {
      console.log(`[Cross-Claim] Skipping claim ${newClaim.id} - no embedding`);
      continue;
    }

    // Find similar existing claims
    const candidates = findSimilarClaims(
      newClaim as ClaimForComparison,
      existingClaims as ClaimForComparison[],
      SIMILARITY_THRESHOLD,
      MAX_CANDIDATES_PER_CLAIM
    );

    if (candidates.length === 0) {
      continue;
    }

    console.log(`[Cross-Claim] Found ${candidates.length} candidates for claim ${newClaim.id.substring(0, 8)}`);

    // Step 4: Use AI to analyze each candidate pair
    for (const candidate of candidates) {
      totalComparisons++;

      const comparison = await analyzeClaimPair(
        client,
        newClaim.statement,
        candidate.claim.statement
      );

      if (comparison.relation !== "NEUTRAL") {
        // Create edge
        const { error: edgeError } = await client
          .from("knowledge_graph_edges")
          .upsert({
            source_id: newClaim.id,
            source_type: "claim",
            target_id: candidate.claim.id,
            target_type: "claim",
            relationship_type: comparison.relation,
            confidence: comparison.confidence,
            similarity_score: candidate.similarity,
            metadata: { reasoning: comparison.reasoning },
          }, {
            onConflict: "source_id,source_type,target_id,target_type,relationship_type"
          });

        if (!edgeError) {
          edgesCreated++;
          console.log(`[Cross-Claim] Created ${comparison.relation} edge between ${newClaim.id.substring(0, 8)} and ${candidate.claim.id.substring(0, 8)}`);
        }
      }
    }
  }

  console.log(`[Cross-Claim] Complete: ${edgesCreated} edges created from ${totalComparisons} comparisons`);

  return { edgesCreated, comparisonsPerformed: totalComparisons };
}

/**
 * Find claims similar to a target claim by embedding similarity
 */
function findSimilarClaims(
  targetClaim: ClaimForComparison,
  candidates: ClaimForComparison[],
  threshold: number,
  maxResults: number
): Array<{ claim: ClaimForComparison; similarity: number }> {
  if (!targetClaim.embedding) {
    return [];
  }

  const results: Array<{ claim: ClaimForComparison; similarity: number }> = [];

  for (const candidate of candidates) {
    if (!candidate.embedding) continue;

    const similarity = cosineSimilarity(targetClaim.embedding, candidate.embedding);

    if (similarity >= threshold) {
      results.push({ claim: candidate, similarity });
    }
  }

  // Sort by similarity descending and limit
  return results
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, maxResults);
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Use AI to analyze relationship between two claims
 */
async function analyzeClaimPair(
  client: SupabaseClient,
  claim1Statement: string,
  claim2Statement: string
): Promise<{ relation: "SUPPORTS" | "CONTRADICTS" | "NEUTRAL"; confidence: number; reasoning: string }> {
  try {
    const result = await executeAgent({
      supabase: client,
      agentSlug: "rapport-claim-comparison",
      interactionType: "rapport.claim.comparison",
      variables: {
        claim1: claim1Statement,
        claim2: claim2Statement,
      },
    });

    if (!result?.content) {
      return { relation: "NEUTRAL", confidence: 0, reasoning: "No response from agent" };
    }

    // Extract JSON from markdown code blocks if present
    let jsonContent = result.content.trim();
    const jsonMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonContent = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonContent);

    const relation = parsed.relation?.toUpperCase();
    if (relation === "SUPPORTS" || relation === "CONTRADICTS") {
      return {
        relation,
        confidence: parsed.confidence || 0.7,
        reasoning: parsed.reasoning || "",
      };
    }

    return {
      relation: "NEUTRAL",
      confidence: parsed.confidence || 0.5,
      reasoning: parsed.reasoning || "",
    };

  } catch (error) {
    console.error("[Cross-Claim] Error analyzing claim pair:", error);
    return { relation: "NEUTRAL", confidence: 0, reasoning: "Error during analysis" };
  }
}

/**
 * Batch comparison for efficiency (optional optimization)
 */
export async function batchCompareClaimsCross(
  client: SupabaseClient,
  projectId: string
): Promise<{ edgesCreated: number; comparisonsPerformed: number }> {
  // Fetch all claims for the project
  const { data: allClaims, error } = await client
    .from("claims")
    .select("id, statement, claim_type, embedding, source_insight_ids")
    .eq("project_id", projectId);

  if (error || !allClaims) {
    console.error("[Cross-Claim] Error fetching claims for batch comparison:", error);
    return { edgesCreated: 0, comparisonsPerformed: 0 };
  }

  console.log(`[Cross-Claim] Batch comparing ${allClaims.length} claims in project ${projectId}`);

  let totalEdges = 0;
  let totalComparisons = 0;

  // Compare each pair (avoiding duplicates)
  for (let i = 0; i < allClaims.length; i++) {
    for (let j = i + 1; j < allClaims.length; j++) {
      const claim1 = allClaims[i];
      const claim2 = allClaims[j];

      if (!claim1.embedding || !claim2.embedding) continue;

      const similarity = cosineSimilarity(claim1.embedding, claim2.embedding);

      if (similarity < SIMILARITY_THRESHOLD) continue;

      totalComparisons++;

      const comparison = await analyzeClaimPair(
        client,
        claim1.statement,
        claim2.statement
      );

      if (comparison.relation !== "NEUTRAL") {
        const { error: edgeError } = await client
          .from("knowledge_graph_edges")
          .upsert({
            source_id: claim1.id,
            source_type: "claim",
            target_id: claim2.id,
            target_type: "claim",
            relationship_type: comparison.relation,
            confidence: comparison.confidence,
            similarity_score: similarity,
            metadata: { reasoning: comparison.reasoning },
          }, {
            onConflict: "source_id,source_type,target_id,target_type,relationship_type"
          });

        if (!edgeError) totalEdges++;
      }
    }
  }

  return { edgesCreated: totalEdges, comparisonsPerformed: totalComparisons };
}
