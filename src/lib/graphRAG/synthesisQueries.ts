/**
 * Synthesis query functions for ASK sessions
 *
 * Provides functions to generate actionable synthesis data:
 * - Consensus: Claims supported by multiple participants
 * - Tensions: Claims that contradict each other
 * - Top Recommendations: Most supported recommendation claims
 * - Key Concepts: Most frequent entities
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabaseClient } from "@/lib/supabaseAdmin";

export interface ConsensusClaim {
  statement: string;
  claimIds: string[];
  supportedBy: string[]; // Participant names
  strength: number; // Average evidence strength
}

export interface Tension {
  claim1: {
    id: string;
    statement: string;
    author: string;
  };
  claim2: {
    id: string;
    statement: string;
    author: string;
  };
  type: "CONTRADICTS";
  confidence: number;
}

export interface TopRecommendation {
  id: string;
  statement: string;
  evidenceStrength: number;
  sourceCount: number;
}

export interface KeyConcept {
  name: string;
  frequency: number;
}

export interface SessionSynthesis {
  askSessionId: string;
  consensus: ConsensusClaim[];
  tensions: Tension[];
  topRecommendations: TopRecommendation[];
  keyConcepts: KeyConcept[];
  totalClaims: number;
  totalParticipants: number;
}

/**
 * Get full synthesis for an ASK session
 */
export async function getSessionSynthesis(
  askSessionId: string,
  client?: SupabaseClient
): Promise<SessionSynthesis> {
  const supabase = client || getAdminSupabaseClient();

  // Get project ID for the session
  const { data: session } = await supabase
    .from("ask_sessions")
    .select("project_id")
    .eq("id", askSessionId)
    .single();

  if (!session?.project_id) {
    return emptyResult(askSessionId);
  }

  const projectId = session.project_id;

  // Run queries in parallel
  const [consensus, tensions, topRecommendations, keyConcepts, stats] = await Promise.all([
    getConsensus(askSessionId, projectId, supabase),
    getTensions(askSessionId, projectId, supabase),
    getTopRecommendations(askSessionId, projectId, supabase),
    getKeyConcepts(askSessionId, projectId, supabase),
    getSessionStats(askSessionId, projectId, supabase),
  ]);

  return {
    askSessionId,
    consensus,
    tensions,
    topRecommendations,
    keyConcepts,
    ...stats,
  };
}

/**
 * Get consensus: Claims with SUPPORTS relationships from different participants
 */
async function getConsensus(
  askSessionId: string,
  projectId: string,
  client: SupabaseClient
): Promise<ConsensusClaim[]> {
  // Get all claims for this project/session
  const { data: claims } = await client
    .from("claims")
    .select(`
      id,
      statement,
      evidence_strength,
      source_insight_ids
    `)
    .eq("project_id", projectId);

  if (!claims || claims.length === 0) return [];

  // Get SUPPORTS edges between claims
  const claimIds = claims.map(c => c.id);
  const { data: supportEdges } = await client
    .from("knowledge_graph_edges")
    .select("source_id, target_id, confidence")
    .eq("relationship_type", "SUPPORTS")
    .eq("source_type", "claim")
    .eq("target_type", "claim")
    .or(`source_id.in.(${claimIds.join(",")}),target_id.in.(${claimIds.join(",")})`);

  if (!supportEdges || supportEdges.length === 0) {
    // Fallback: group by semantic similarity (claims with same statement pattern)
    return groupSimilarClaims(claims, client, askSessionId);
  }

  // Build consensus groups
  const consensusGroups = buildConsensusGroups(claims, supportEdges);

  // Get participant names for each group
  const result: ConsensusClaim[] = [];

  for (const group of consensusGroups) {
    if (group.claimIds.length < 2) continue; // Need at least 2 claims for consensus

    // Get unique source insights
    const allInsightIds = new Set<string>();
    for (const claimId of group.claimIds) {
      const claim = claims.find(c => c.id === claimId);
      if (claim?.source_insight_ids) {
        claim.source_insight_ids.forEach((id: string) => allInsightIds.add(id));
      }
    }

    // Get participant names from insights
    const participantNames = await getParticipantNamesFromInsights(
      Array.from(allInsightIds),
      client
    );

    result.push({
      statement: group.representativeStatement,
      claimIds: group.claimIds,
      supportedBy: participantNames,
      strength: group.averageStrength,
    });
  }

  return result.sort((a, b) => b.supportedBy.length - a.supportedBy.length);
}

/**
 * Build consensus groups from SUPPORTS edges
 */
function buildConsensusGroups(
  claims: Array<{ id: string; statement: string; evidence_strength: number }>,
  edges: Array<{ source_id: string; target_id: string; confidence: number }>
): Array<{ claimIds: string[]; representativeStatement: string; averageStrength: number }> {
  // Use Union-Find to group connected claims
  const parent: Record<string, string> = {};

  function find(x: string): string {
    if (!parent[x]) parent[x] = x;
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }

  function union(x: string, y: string) {
    const px = find(x);
    const py = find(y);
    if (px !== py) parent[px] = py;
  }

  // Initialize
  claims.forEach(c => { parent[c.id] = c.id; });

  // Union connected claims
  edges.forEach(e => union(e.source_id, e.target_id));

  // Group by root
  const groups: Record<string, string[]> = {};
  claims.forEach(c => {
    const root = find(c.id);
    if (!groups[root]) groups[root] = [];
    groups[root].push(c.id);
  });

  // Build result
  return Object.values(groups)
    .filter(g => g.length >= 2)
    .map(claimIds => {
      const groupClaims = claimIds.map(id => claims.find(c => c.id === id)!);
      const avgStrength = groupClaims.reduce((sum, c) => sum + (c.evidence_strength || 0.5), 0) / groupClaims.length;
      // Pick the claim with highest evidence strength as representative
      const representative = groupClaims.reduce((best, c) =>
        (c.evidence_strength || 0) > (best.evidence_strength || 0) ? c : best
      );

      return {
        claimIds,
        representativeStatement: representative.statement,
        averageStrength: avgStrength,
      };
    });
}

/**
 * Fallback: Group semantically similar claims when no SUPPORTS edges exist yet
 */
async function groupSimilarClaims(
  claims: Array<{ id: string; statement: string; evidence_strength: number; source_insight_ids: string[] | null }>,
  client: SupabaseClient,
  askSessionId: string
): Promise<ConsensusClaim[]> {
  // Simple grouping: claims with very similar statements (could be enhanced with embeddings)
  // For now, just return claims that appear more than once with different participants
  return [];
}

/**
 * Get tensions: Claims with CONTRADICTS relationships
 */
async function getTensions(
  askSessionId: string,
  projectId: string,
  client: SupabaseClient
): Promise<Tension[]> {
  // Get claims for this project
  const { data: claims } = await client
    .from("claims")
    .select("id, statement, source_insight_ids")
    .eq("project_id", projectId);

  if (!claims || claims.length === 0) return [];

  const claimIds = claims.map(c => c.id);

  // Get CONTRADICTS edges
  const { data: edges } = await client
    .from("knowledge_graph_edges")
    .select("source_id, target_id, confidence")
    .eq("relationship_type", "CONTRADICTS")
    .eq("source_type", "claim")
    .eq("target_type", "claim")
    .or(`source_id.in.(${claimIds.join(",")}),target_id.in.(${claimIds.join(",")})`);

  if (!edges || edges.length === 0) return [];

  const tensions: Tension[] = [];

  for (const edge of edges) {
    const claim1 = claims.find(c => c.id === edge.source_id);
    const claim2 = claims.find(c => c.id === edge.target_id);

    if (!claim1 || !claim2) continue;

    // Get participant names
    const author1 = await getFirstParticipantName(claim1.source_insight_ids || [], client);
    const author2 = await getFirstParticipantName(claim2.source_insight_ids || [], client);

    tensions.push({
      claim1: {
        id: claim1.id,
        statement: claim1.statement,
        author: author1,
      },
      claim2: {
        id: claim2.id,
        statement: claim2.statement,
        author: author2,
      },
      type: "CONTRADICTS",
      confidence: edge.confidence || 0.7,
    });
  }

  return tensions.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Get top recommendations: Claims of type "recommendation" sorted by evidence strength
 */
async function getTopRecommendations(
  askSessionId: string,
  projectId: string,
  client: SupabaseClient
): Promise<TopRecommendation[]> {
  const { data: recommendations } = await client
    .from("claims")
    .select("id, statement, evidence_strength, source_insight_ids")
    .eq("project_id", projectId)
    .eq("claim_type", "recommendation")
    .order("evidence_strength", { ascending: false })
    .limit(10);

  if (!recommendations) return [];

  return recommendations.map(r => ({
    id: r.id,
    statement: r.statement,
    evidenceStrength: r.evidence_strength || 0.5,
    sourceCount: r.source_insight_ids?.length || 1,
  }));
}

/**
 * Get key concepts: Most frequent entities
 */
async function getKeyConcepts(
  askSessionId: string,
  projectId: string,
  client: SupabaseClient
): Promise<KeyConcept[]> {
  // Get claims for this project
  const { data: claims } = await client
    .from("claims")
    .select("id")
    .eq("project_id", projectId);

  if (!claims || claims.length === 0) return [];

  const claimIds = claims.map(c => c.id);

  // Get entities linked to these claims
  const { data: claimEntities } = await client
    .from("claim_entities")
    .select("entity_id")
    .in("claim_id", claimIds);

  if (!claimEntities || claimEntities.length === 0) return [];

  const entityIds = [...new Set(claimEntities.map(ce => ce.entity_id))];

  // Get entity details
  const { data: entities } = await client
    .from("knowledge_entities")
    .select("name, frequency")
    .in("id", entityIds)
    .order("frequency", { ascending: false })
    .limit(20);

  if (!entities) return [];

  return entities.map(e => ({
    name: e.name,
    frequency: e.frequency || 1,
  }));
}

/**
 * Get session statistics
 */
async function getSessionStats(
  askSessionId: string,
  projectId: string,
  client: SupabaseClient
): Promise<{ totalClaims: number; totalParticipants: number }> {
  // Count claims
  const { count: totalClaims } = await client
    .from("claims")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId);

  // Count participants
  const { count: totalParticipants } = await client
    .from("ask_participants")
    .select("*", { count: "exact", head: true })
    .eq("ask_session_id", askSessionId);

  return {
    totalClaims: totalClaims || 0,
    totalParticipants: totalParticipants || 0,
  };
}

/**
 * Helper: Get participant names from insight IDs
 */
async function getParticipantNamesFromInsights(
  insightIds: string[],
  client: SupabaseClient
): Promise<string[]> {
  if (insightIds.length === 0) return [];

  // Get insight authors
  const { data: authors } = await client
    .from("insight_authors")
    .select("participant_id")
    .in("insight_id", insightIds);

  if (!authors || authors.length === 0) return [];

  const participantIds = [...new Set(authors.map(a => a.participant_id))];

  // Get participant names
  const { data: participants } = await client
    .from("ask_participants")
    .select("participant_name, user_id")
    .in("id", participantIds);

  if (!participants) return [];

  // Get user names for those with user_id
  const userIds = participants.filter(p => p.user_id).map(p => p.user_id);
  let userNames: Record<string, string> = {};

  if (userIds.length > 0) {
    const { data: profiles } = await client
      .from("profiles")
      .select("id, full_name, first_name")
      .in("id", userIds);

    if (profiles) {
      profiles.forEach(p => {
        userNames[p.id] = p.full_name || p.first_name || "Participant";
      });
    }
  }

  return participants.map(p =>
    p.user_id && userNames[p.user_id]
      ? userNames[p.user_id]
      : p.participant_name || "Participant"
  );
}

/**
 * Helper: Get first participant name from insight IDs
 */
async function getFirstParticipantName(
  insightIds: string[],
  client: SupabaseClient
): Promise<string> {
  const names = await getParticipantNamesFromInsights(insightIds, client);
  return names[0] || "Participant";
}

/**
 * Empty result helper
 */
function emptyResult(askSessionId: string): SessionSynthesis {
  return {
    askSessionId,
    consensus: [],
    tensions: [],
    topRecommendations: [],
    keyConcepts: [],
    totalClaims: 0,
    totalParticipants: 0,
  };
}
