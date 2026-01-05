/**
 * Claim extraction service for Graph RAG
 * Extracts claims (findings, hypotheses, recommendations, observations) from insights
 * Replaces entity extraction with a more actionable claims-based approach
 */

import type { Insight, ExtractedClaim, ClaimRelation, ClaimExtractionResult, ClaimType } from "@/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { executeAgent } from "@/lib/ai/service";
import { getAdminSupabaseClient } from "@/lib/supabaseAdmin";

/**
 * Variables for claim extraction agent
 */
export interface ClaimExtractionVariables {
  // Insight context
  content: string;
  summary: string;
  type: string;
  category: string;
  // ASK context
  ask_question: string;
  ask_description: string;
  // Project context
  project_name: string;
  project_description: string;
  // Challenge context
  challenge_name: string;
  challenge_description: string;
}

/**
 * Build variables for claim extraction agent
 */
export async function buildClaimExtractionVariables(
  supabase: SupabaseClient,
  insight: {
    content: string;
    summary?: string | null;
    type: string;
    category?: string | null;
    askSessionId: string;
    challengeId?: string | null;
  }
): Promise<ClaimExtractionVariables> {
  // Fetch ASK session context with project_id
  const { data: askSession } = await supabase
    .from("ask_sessions")
    .select("question, description, project_id")
    .eq("id", insight.askSessionId)
    .maybeSingle();

  // Fetch challenge context if available (includes project_id as fallback)
  let challengeData: { name: string; description: string; project_id?: string | null } | null = null;
  if (insight.challengeId) {
    const { data: challenge } = await supabase
      .from("challenges")
      .select("name, description, project_id")
      .eq("id", insight.challengeId)
      .maybeSingle();
    challengeData = challenge;
  }

  // Fetch project context (from ASK session or challenge)
  let projectData: { name: string; description: string } | null = null;
  const projectId = askSession?.project_id || challengeData?.project_id;
  if (projectId) {
    const { data: project } = await supabase
      .from("projects")
      .select("name, description")
      .eq("id", projectId)
      .maybeSingle();
    projectData = project;
  }

  return {
    content: insight.content,
    summary: insight.summary || "",
    type: insight.type,
    category: insight.category || "",
    ask_question: askSession?.question || "",
    ask_description: askSession?.description || "",
    project_name: projectData?.name || "",
    project_description: projectData?.description || "",
    challenge_name: challengeData?.name || "",
    challenge_description: challengeData?.description || "",
  };
}

/**
 * Raw response from AI agent
 */
interface RawClaimExtractionResponse {
  claims: Array<{
    statement: string;
    type: string;
    evidence_strength: number;
    addresses_objective?: string;
    key_entities: string[];
  }>;
  claim_relations?: Array<{
    from_claim: number;
    to_claim: number;
    relation: string;
  }>;
}

/**
 * Parse AI response and extract claims
 */
function parseClaimExtractionResponse(response: string): ClaimExtractionResult {
  try {
    // Remove markdown code blocks if present
    let jsonStr = response.trim();
    if (jsonStr.startsWith("```json")) {
      jsonStr = jsonStr.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(jsonStr) as RawClaimExtractionResponse;

    // Validate and transform claims
    const validClaimTypes: ClaimType[] = ['finding', 'hypothesis', 'recommendation', 'observation'];
    const claims: ExtractedClaim[] = (parsed.claims || [])
      .filter(c => c.statement && typeof c.statement === 'string')
      .map(c => ({
        statement: c.statement.trim(),
        type: validClaimTypes.includes(c.type as ClaimType) ? c.type as ClaimType : 'observation',
        evidenceStrength: typeof c.evidence_strength === 'number'
          ? Math.max(0, Math.min(1, c.evidence_strength))
          : 0.5,
        addressesObjective: c.addresses_objective || undefined,
        keyEntities: Array.isArray(c.key_entities)
          ? c.key_entities.filter(e => typeof e === 'string' && e.trim().length > 0)
          : [],
      }));

    // Validate and transform relations
    const validRelations = ['supports', 'contradicts', 'refines'];
    const relations: ClaimRelation[] = (parsed.claim_relations || [])
      .filter(r =>
        typeof r.from_claim === 'number' &&
        typeof r.to_claim === 'number' &&
        r.from_claim >= 0 && r.from_claim < claims.length &&
        r.to_claim >= 0 && r.to_claim < claims.length &&
        validRelations.includes(r.relation)
      )
      .map(r => ({
        fromClaimIndex: r.from_claim,
        toClaimIndex: r.to_claim,
        relation: r.relation as 'supports' | 'contradicts' | 'refines',
      }));

    return { claims, relations };
  } catch (error) {
    console.error("[Graph RAG] Error parsing claim extraction response:", error);
    console.error("[Graph RAG] Response was:", response);
    return { claims: [], relations: [] };
  }
}

/**
 * Normalize entity name for deduplication
 * Same logic as extractEntities.ts for consistency
 */
function normalizeEntityName(name: string): string {
  let normalized = name
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/^(l'|la |le |les |un |une |des |du |de la |de l')/i, "")
    .replace(/ (de la |de l'|du |des |d')/g, " ")
    .replace(/^(the |a |an )/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    normalized = name.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  return normalized;
}

/**
 * Find or create a knowledge entity
 */
async function findOrCreateEntity(
  supabase: SupabaseClient,
  name: string
): Promise<string> {
  const normalizedName = normalizeEntityName(name);

  // Try to find existing entity
  const { data: existing, error: findError } = await supabase
    .from("knowledge_entities")
    .select("id, frequency")
    .eq("name", normalizedName)
    .maybeSingle();

  if (findError && findError.code !== "PGRST116") {
    console.error("[Graph RAG] Error finding entity:", findError);
  }

  if (existing) {
    // Update frequency
    await supabase
      .from("knowledge_entities")
      .update({
        frequency: (existing.frequency || 1) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    return existing.id;
  }

  // Create new entity with type 'concept' (claims extract concepts, not keywords/themes)
  const { data: created, error: createError } = await supabase
    .from("knowledge_entities")
    .insert({
      name: normalizedName,
      type: "concept",
      frequency: 1,
    })
    .select("id")
    .single();

  if (createError || !created) {
    throw new Error(`Failed to create knowledge entity: ${createError?.message ?? "Unknown error"}`);
  }

  return created.id;
}

/**
 * Store a claim in the database
 */
async function storeClaim(
  supabase: SupabaseClient,
  claim: ExtractedClaim,
  projectId: string,
  challengeId: string | null,
  sourceInsightId: string
): Promise<string> {
  const { data, error } = await supabase
    .from("claims")
    .insert({
      project_id: projectId,
      challenge_id: challengeId,
      statement: claim.statement,
      claim_type: claim.type,
      evidence_strength: claim.evidenceStrength,
      confidence: claim.evidenceStrength, // Use evidence strength as initial confidence
      source_insight_ids: [sourceInsightId],
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to store claim: ${error?.message ?? "Unknown error"}`);
  }

  return data.id;
}

/**
 * Link claim to its key entities
 */
async function linkClaimToEntities(
  supabase: SupabaseClient,
  claimId: string,
  entityIds: string[],
  relevanceScore: number = 0.8
): Promise<void> {
  if (entityIds.length === 0) return;

  const rows = entityIds.map(entityId => ({
    claim_id: claimId,
    entity_id: entityId,
    relevance_score: relevanceScore,
  }));

  const { error } = await supabase
    .from("claim_entities")
    .upsert(rows, { onConflict: "claim_id,entity_id" });

  if (error) {
    console.error(`[Graph RAG] Error linking claim ${claimId} to entities:`, error);
  }
}

/**
 * Extract claims from an insight using AI
 */
export async function extractClaimsFromInsight(
  insight: Insight
): Promise<{
  claimIds: string[];
  entityIds: string[];
  claims: ExtractedClaim[];
  relations: ClaimRelation[];
}> {
  const supabase = getAdminSupabaseClient();

  try {
    console.log(`[Graph RAG] Extracting claims from insight ${insight.id}...`);

    // Build variables for AI agent
    const variables = await buildClaimExtractionVariables(supabase, {
      content: insight.content,
      summary: insight.summary,
      type: insight.type,
      category: insight.category,
      askSessionId: insight.askSessionId,
      challengeId: insight.challengeId,
    });

    console.log(`[Graph RAG] Claim extraction context: ASK="${variables.ask_question?.substring(0, 50)}..."`);

    // Call AI agent
    const result = await executeAgent({
      supabase,
      agentSlug: "rapport-claim-extraction",
      interactionType: "rapport.claim.extraction",
      variables: variables as unknown as Record<string, string | null | undefined>,
    });

    console.log(`[Graph RAG] AI response received, length: ${result.content?.length || 0}`);

    // Parse response
    const { claims, relations } = parseClaimExtractionResponse(result.content);
    console.log(`[Graph RAG] Parsed ${claims.length} claims with ${relations.length} relations`);

    if (claims.length === 0) {
      return { claimIds: [], entityIds: [], claims: [], relations: [] };
    }

    // Get project ID from insight via ask_sessions
    const { data: insightData } = await supabase
      .from("insights")
      .select("ask_sessions(project_id)")
      .eq("id", insight.id)
      .single();

    if (!insightData) {
      throw new Error(`Insight ${insight.id} not found in database`);
    }

    // Handle join result (can be object or array)
    const askSession = Array.isArray(insightData.ask_sessions)
      ? insightData.ask_sessions[0]
      : insightData.ask_sessions;
    const projectId = (askSession as { project_id: string })?.project_id;

    if (!projectId) {
      throw new Error(`No project_id found for insight ${insight.id}`);
    }
    const claimIds: string[] = [];
    const allEntityIds: string[] = [];

    // Store claims and their entities
    for (const claim of claims) {
      try {
        // Store claim
        const claimId = await storeClaim(
          supabase,
          claim,
          projectId,
          insight.challengeId || null,
          insight.id
        );
        claimIds.push(claimId);

        // Process key entities
        const entityIds: string[] = [];
        for (const entityName of claim.keyEntities) {
          try {
            const entityId = await findOrCreateEntity(supabase, entityName);
            entityIds.push(entityId);
            if (!allEntityIds.includes(entityId)) {
              allEntityIds.push(entityId);
            }
          } catch (error) {
            console.error(`[Graph RAG] Error processing entity "${entityName}":`, error);
          }
        }

        // Link claim to entities
        await linkClaimToEntities(supabase, claimId, entityIds, claim.evidenceStrength);
      } catch (error) {
        console.error(`[Graph RAG] Error storing claim "${claim.statement.substring(0, 50)}...":`, error);
      }
    }

    console.log(`[Graph RAG] Stored ${claimIds.length} claims and ${allEntityIds.length} entities for insight ${insight.id}`);

    return {
      claimIds,
      entityIds: allEntityIds,
      claims,
      relations,
    };
  } catch (error) {
    console.error(`[Graph RAG] Error extracting claims from insight ${insight.id}:`, error);
    return { claimIds: [], entityIds: [], claims: [], relations: [] };
  }
}

/**
 * Delete claims associated with an insight
 */
export async function deleteClaimsForInsight(
  insightId: string,
  supabase?: SupabaseClient
): Promise<void> {
  const client = supabase || getAdminSupabaseClient();

  console.log(`[Graph RAG] Deleting claims for insight ${insightId}...`);

  // Find claims that have this insight as their only source
  const { data: claims, error: fetchError } = await client
    .from("claims")
    .select("id, source_insight_ids")
    .contains("source_insight_ids", [insightId]);

  if (fetchError) {
    console.error(`[Graph RAG] Error fetching claims for insight ${insightId}:`, fetchError);
    return;
  }

  if (!claims || claims.length === 0) {
    console.log(`[Graph RAG] No claims found for insight ${insightId}`);
    return;
  }

  for (const claim of claims) {
    const sourceIds = claim.source_insight_ids as string[];

    if (sourceIds.length === 1) {
      // This insight is the only source, delete the claim
      const { error } = await client
        .from("claims")
        .delete()
        .eq("id", claim.id);

      if (error) {
        console.error(`[Graph RAG] Error deleting claim ${claim.id}:`, error);
      }
    } else {
      // Remove this insight from the sources array
      const newSourceIds = sourceIds.filter(id => id !== insightId);
      const { error } = await client
        .from("claims")
        .update({ source_insight_ids: newSourceIds })
        .eq("id", claim.id);

      if (error) {
        console.error(`[Graph RAG] Error updating claim ${claim.id}:`, error);
      }
    }
  }

  console.log(`[Graph RAG] Processed ${claims.length} claims for insight ${insightId}`);
}

/**
 * Generate embeddings for claims
 */
export async function generateClaimEmbeddings(
  supabase: SupabaseClient,
  claimIds: string[]
): Promise<void> {
  if (claimIds.length === 0) return;

  // Fetch claims without embeddings
  const { data: claims, error: fetchError } = await supabase
    .from("claims")
    .select("id, statement")
    .in("id", claimIds)
    .is("embedding", null);

  if (fetchError) {
    console.error("[Graph RAG] Error fetching claims for embedding:", fetchError);
    return;
  }

  if (!claims || claims.length === 0) return;

  // Import generateEmbedding dynamically
  const { generateEmbedding } = await import("@/lib/ai/embeddings");

  for (const claim of claims) {
    try {
      const embedding = await generateEmbedding(claim.statement);

      const { error: updateError } = await supabase
        .from("claims")
        .update({
          embedding,
          updated_at: new Date().toISOString(),
        })
        .eq("id", claim.id);

      if (updateError) {
        console.error(`[Graph RAG] Error storing embedding for claim ${claim.id}:`, updateError);
      }
    } catch (error) {
      console.error(`[Graph RAG] Error generating embedding for claim ${claim.id}:`, error);
    }
  }
}
