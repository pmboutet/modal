/**
 * Generate graph data for a participant after their interview completes
 *
 * This service is triggered when allStepsCompleted = true and:
 * 1. Fetches all insights from the participant
 * 2. Extracts claims with a global view (all insights at once)
 * 3. Compares with existing claims from other participants
 * 4. Creates SUPPORTS/CONTRADICTS edges
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Insight, ExtractedClaim, ClaimRelation } from "@/types";
import { getAdminSupabaseClient } from "@/lib/supabaseAdmin";
import { generateEmbedding } from "@/lib/ai/embeddings";
import { executeAgent } from "@/lib/ai/service";
import { mapInsightRowToInsight, type InsightRow } from "@/lib/insights";

export interface GenerateParticipantGraphResult {
  success: boolean;
  participantId: string;
  claimsCreated: number;
  entitiesCreated: number;
  edgesCreated: number;
  comparisonsPerformed: number;
  error?: string;
}

interface ClaimWithContext {
  id: string;
  statement: string;
  type: string;
  evidenceStrength: number;
  embedding: number[] | null;
  participantId: string;
  projectId: string;
}

/**
 * Main entry point: Generate graph data for a participant
 */
export async function generateParticipantGraph(
  participantId: string,
  askSessionId: string,
  supabase?: SupabaseClient
): Promise<GenerateParticipantGraphResult> {
  const client = supabase || getAdminSupabaseClient();

  console.log(`[Graph Generation] Starting for participant ${participantId} in session ${askSessionId}`);

  try {
    // Step 1: Fetch all insights from this participant
    const insights = await fetchParticipantInsights(client, participantId, askSessionId);

    if (insights.length === 0) {
      console.log(`[Graph Generation] No insights found for participant ${participantId}`);
      return {
        success: true,
        participantId,
        claimsCreated: 0,
        entitiesCreated: 0,
        edgesCreated: 0,
        comparisonsPerformed: 0,
      };
    }

    console.log(`[Graph Generation] Found ${insights.length} insights for participant ${participantId}`);

    // Step 2: Get project context
    const { data: session } = await client
      .from("ask_sessions")
      .select("project_id, question, description, challenge_id")
      .eq("id", askSessionId)
      .single();

    if (!session?.project_id) {
      throw new Error("Could not find project for ask session");
    }

    // Step 3: Extract claims from all insights (global view)
    const { claims, entities, internalRelations } = await extractClaimsFromAllInsights(
      client,
      insights,
      session.project_id,
      session.challenge_id
    );

    console.log(`[Graph Generation] Extracted ${claims.length} claims and ${entities.length} entities`);

    // Step 4: Store claims and entities in database
    const { claimIds, entityIds } = await storeClaimsAndEntities(
      client,
      claims,
      entities,
      insights.map(i => i.id),
      session.project_id,
      session.challenge_id
    );

    // Step 5: Create internal edges (within participant)
    const internalEdgesCreated = await createInternalEdges(
      client,
      claimIds,
      internalRelations,
      insights,
      session.challenge_id
    );

    // Step 6: Compare with existing claims from other participants
    const { edgesCreated: crossEdgesCreated, comparisonsPerformed } = await compareWithExistingClaims(
      client,
      claimIds,
      session.project_id,
      participantId
    );

    console.log(`[Graph Generation] Complete for participant ${participantId}: ${claimIds.length} claims, ${crossEdgesCreated} cross-participant edges`);

    return {
      success: true,
      participantId,
      claimsCreated: claimIds.length,
      entitiesCreated: entityIds.length,
      edgesCreated: internalEdgesCreated + crossEdgesCreated,
      comparisonsPerformed,
    };

  } catch (error) {
    console.error(`[Graph Generation] Error for participant ${participantId}:`, error);
    return {
      success: false,
      participantId,
      claimsCreated: 0,
      entitiesCreated: 0,
      edgesCreated: 0,
      comparisonsPerformed: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Fetch all insights from a participant in a session
 */
async function fetchParticipantInsights(
  client: SupabaseClient,
  participantId: string,
  askSessionId: string
): Promise<Insight[]> {
  // Get insights created by this participant (via insight_authors or user_id)
  const { data: insightRows, error } = await client
    .from("insights")
    .select(`
      *,
      insight_authors!left(participant_id)
    `)
    .eq("ask_session_id", askSessionId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[Graph Generation] Error fetching insights:", error);
    return [];
  }

  // Filter insights that belong to this participant
  const participantInsights = (insightRows || []).filter(row => {
    const authors = row.insight_authors || [];
    return authors.some((a: { participant_id: string }) => a.participant_id === participantId);
  });

  return participantInsights.map(row => mapInsightRowToInsight(row as InsightRow));
}

/**
 * Extract claims from all insights with a global view
 */
async function extractClaimsFromAllInsights(
  client: SupabaseClient,
  insights: Insight[],
  projectId: string,
  challengeId?: string | null
): Promise<{
  claims: ExtractedClaim[];
  entities: string[];
  internalRelations: ClaimRelation[];
}> {
  // Build context
  const { data: project } = await client
    .from("projects")
    .select("name, description")
    .eq("id", projectId)
    .single();

  let challengeContext = "";
  if (challengeId) {
    const { data: challenge } = await client
      .from("challenges")
      .select("name, description")
      .eq("id", challengeId)
      .single();
    if (challenge) {
      challengeContext = `Challenge: ${challenge.name}\n${challenge.description || ""}`;
    }
  }

  // Combine all insights into one context for extraction
  const insightsContext = insights.map((insight, index) => {
    return `[Insight ${index + 1}] (Type: ${insight.type})\n${insight.content}${insight.summary ? `\nSummary: ${insight.summary}` : ""}`;
  }).join("\n\n---\n\n");

  const variables = {
    project_name: project?.name || "",
    project_description: project?.description || "",
    challenge_context: challengeContext,
    insights_context: insightsContext,
    insight_count: String(insights.length),
  };

  // Execute extraction agent with global view
  const result = await executeAgent({
    supabase: client,
    agentSlug: "rapport-participant-claims",
    interactionType: "rapport.participant.claims",
    variables,
  });

  if (!result?.content) {
    console.warn("[Graph Generation] No content from claims extraction agent");
    return { claims: [], entities: [], internalRelations: [] };
  }

  // Parse response
  try {
    const parsed = JSON.parse(result.content);
    return {
      claims: (parsed.claims || []).map((c: any) => ({
        statement: c.statement,
        type: (c.type || "observation") as import("@/types").ClaimType,
        evidenceStrength: c.evidence_strength || 0.5,
        keyEntities: c.key_entities || [],
      })),
      entities: parsed.entities || [],
      internalRelations: (parsed.claim_relations || []).map((r: any) => ({
        fromClaimIndex: r.from_claim,
        toClaimIndex: r.to_claim,
        relation: r.relation,
      })),
    };
  } catch (parseError) {
    console.error("[Graph Generation] Error parsing claims extraction response:", parseError);
    return { claims: [], entities: [], internalRelations: [] };
  }
}

/**
 * Store claims and entities in database
 */
async function storeClaimsAndEntities(
  client: SupabaseClient,
  claims: ExtractedClaim[],
  entities: string[],
  sourceInsightIds: string[],
  projectId: string,
  challengeId?: string | null
): Promise<{ claimIds: string[]; entityIds: string[] }> {
  const claimIds: string[] = [];
  const entityIds: string[] = [];

  // Store claims
  for (const claim of claims) {
    // Generate embedding for claim
    const embedding = await generateEmbedding(claim.statement).catch(() => null);

    const { data: claimRow, error } = await client
      .from("claims")
      .insert({
        project_id: projectId,
        challenge_id: challengeId,
        statement: claim.statement,
        claim_type: claim.type,
        evidence_strength: claim.evidenceStrength,
        source_insight_ids: sourceInsightIds,
        embedding,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[Graph Generation] Error storing claim:", error);
      continue;
    }

    claimIds.push(claimRow.id);

    // Link claim to entities
    for (const entityName of claim.keyEntities || []) {
      const entityId = await findOrCreateEntity(client, entityName);
      if (entityId) {
        entityIds.push(entityId);
        await client.from("claim_entities").upsert({
          claim_id: claimRow.id,
          entity_id: entityId,
          relevance_score: 0.8,
        }, { onConflict: "claim_id,entity_id" });
      }
    }
  }

  // Store additional entities
  for (const entityName of entities) {
    const entityId = await findOrCreateEntity(client, entityName);
    if (entityId) {
      entityIds.push(entityId);
    }
  }

  return { claimIds, entityIds: [...new Set(entityIds)] };
}

/**
 * Find or create an entity
 */
async function findOrCreateEntity(
  client: SupabaseClient,
  name: string
): Promise<string | null> {
  // Normalize name
  const normalizedName = name.toLowerCase().trim();

  // Try to find existing
  const { data: existing } = await client
    .from("knowledge_entities")
    .select("id")
    .eq("name", normalizedName)
    .maybeSingle();

  if (existing) {
    // Increment frequency
    await client.rpc("increment_entity_frequency", { entity_id: existing.id });
    return existing.id;
  }

  // Create new
  const embedding = await generateEmbedding(normalizedName).catch(() => null);

  const { data: created, error } = await client
    .from("knowledge_entities")
    .insert({
      name: normalizedName,
      type: "concept",
      frequency: 1,
      embedding,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[Graph Generation] Error creating entity:", error);
    return null;
  }

  return created.id;
}

/**
 * Create internal edges (EVIDENCE_FOR, ADDRESSES, intra-participant relations)
 */
async function createInternalEdges(
  client: SupabaseClient,
  claimIds: string[],
  internalRelations: ClaimRelation[],
  insights: Insight[],
  challengeId?: string | null
): Promise<number> {
  let edgesCreated = 0;

  // EVIDENCE_FOR: Each insight provides evidence for claims
  for (const insight of insights) {
    for (const claimId of claimIds) {
      const { error } = await client.from("knowledge_graph_edges").upsert({
        source_id: insight.id,
        source_type: "insight",
        target_id: claimId,
        target_type: "claim",
        relationship_type: "EVIDENCE_FOR",
        confidence: 0.9,
      }, { onConflict: "source_id,source_type,target_id,target_type,relationship_type" });

      if (!error) edgesCreated++;
    }
  }

  // ADDRESSES: Claims address challenge
  if (challengeId) {
    for (const claimId of claimIds) {
      const { error } = await client.from("knowledge_graph_edges").upsert({
        source_id: claimId,
        source_type: "claim",
        target_id: challengeId,
        target_type: "challenge",
        relationship_type: "ADDRESSES",
        confidence: 0.8,
      }, { onConflict: "source_id,source_type,target_id,target_type,relationship_type" });

      if (!error) edgesCreated++;
    }
  }

  // Internal relations (from claim extraction)
  for (const relation of internalRelations) {
    const fromClaimId = claimIds[relation.fromClaimIndex];
    const toClaimId = claimIds[relation.toClaimIndex];

    if (!fromClaimId || !toClaimId) continue;

    const relationshipType = relation.relation === "supports"
      ? "SUPPORTS"
      : relation.relation === "contradicts"
        ? "CONTRADICTS"
        : "RELATED_TO";

    const { error } = await client.from("knowledge_graph_edges").upsert({
      source_id: fromClaimId,
      source_type: "claim",
      target_id: toClaimId,
      target_type: "claim",
      relationship_type: relationshipType,
      confidence: 0.7,
    }, { onConflict: "source_id,source_type,target_id,target_type,relationship_type" });

    if (!error) edgesCreated++;
  }

  return edgesCreated;
}

/**
 * Compare new claims with existing claims from other participants
 * Creates SUPPORTS/CONTRADICTS edges
 */
async function compareWithExistingClaims(
  client: SupabaseClient,
  newClaimIds: string[],
  projectId: string,
  currentParticipantId: string
): Promise<{ edgesCreated: number; comparisonsPerformed: number }> {
  const { compareClaimsCrossParticipants } = await import("./compareClaimsCross");
  return compareClaimsCrossParticipants(client, newClaimIds, projectId, currentParticipantId);
}

/**
 * Helper: Increment entity frequency via RPC
 * Fallback if RPC doesn't exist
 */
async function incrementEntityFrequency(client: SupabaseClient, entityId: string): Promise<void> {
  try {
    await client.rpc("increment_entity_frequency", { entity_id: entityId });
  } catch {
    // Fallback: manual increment
    const { data } = await client
      .from("knowledge_entities")
      .select("frequency")
      .eq("id", entityId)
      .single();

    if (data) {
      await client
        .from("knowledge_entities")
        .update({ frequency: (data.frequency || 0) + 1 })
        .eq("id", entityId);
    }
  }
}
