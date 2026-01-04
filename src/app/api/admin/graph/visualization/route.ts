import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabaseClient } from "@/lib/supabaseAdmin";
import {
  buildGraphologyGraph,
  detectCommunities,
  computeCentrality,
  getNodeAnalyticsMap,
} from "@/lib/graphRAG/graphAnalysis";
import type { ApiResponse } from "@/types";

type GraphNodeType = "insight" | "entity" | "challenge" | "synthesis" | "claim" | string;

// Semantic similarity threshold for entity deduplication
// 0.80 threshold captures variants like "google slide" ↔ "generation automatique google slide" (0.811)
const SEMANTIC_SIMILARITY_THRESHOLD = 0.80;

/**
 * Compute cosine similarity between two embedding vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Entity with embedding for semantic deduplication
 */
interface EntityWithEmbedding {
  id: string;
  name: string;
  type: string | null;
  description: string | null;
  frequency: number | null;
  embedding: number[] | null;
}

/**
 * Apply basic stemming to a single word (French/English)
 * Only applies to words longer than 4 chars to avoid over-stemming short words
 */
function stemWord(word: string): string {
  // Don't stem short words like "sous", "plus", "tous"
  if (word.length <= 4) return word;

  return word
    .replace(/tions$/, "")  // "transcriptions" → "transcrip" (check first, more specific)
    .replace(/tion$/, "")   // "transcription" → "transcrip"
    .replace(/ments$/, "")  // "développements" → "développe"
    .replace(/ment$/, "")   // "développement" → "développe"
    .replace(/s$/, "");     // plurals: "utilisateurs" → "utilisateur"
}

/**
 * Normalize entity name for deduplication in visualization
 * Applies stemming to each word individually for better matching
 */
function normalizeEntityNameForVisualization(name: string): string {
  let normalized = name
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")  // Remove accents
    .replace(/^(l'|la |le |les |un |une |des |du |de la |de l')/i, "")  // French articles
    .replace(/ (de la |de l'|du |des |d')/g, " ")
    .replace(/^(the |a |an )/i, "")  // English articles
    .replace(/\s+/g, " ")
    .trim();

  // Apply stemming to each word individually
  // This handles cases like "transcriptions post-it" vs "transcription post-it"
  const words = normalized.split(/[\s-]+/);
  const stemmedWords = words.map(stemWord).filter(w => w.length > 0);
  normalized = stemmedWords.join(" ");

  if (!normalized) {
    normalized = name.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  return normalized;
}

interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  subtitle?: string;
  meta?: Record<string, unknown>;
  // Analytics fields (optional, only when includeAnalytics=true)
  community?: number;
  betweenness?: number;
  pageRank?: number;
  degree?: number;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relationshipType: string;
  label?: string;
  weight?: number;
  confidence?: number | null;
}

interface GraphVisualizationResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    insights: number;
    entities: number;
    challenges: number;
    syntheses: number;
    claims: number;
    insightTypes: number;
    edges: number;
  };
}

function formatInsightLabel(row: { summary?: string | null; content?: string | null }): string {
  const source = row.summary?.trim() || row.content?.trim() || "Insight";
  return source.length > 120 ? `${source.slice(0, 117)}...` : source;
}

function relationshipLabel(type: string): string {
  switch (type) {
    case "SIMILAR_TO":
      return "Similarité";
    case "RELATED_TO":
      return "Connexe";
    case "MENTIONS":
      return "Mention";
    case "SYNTHESIZES":
      return "Synthèse";
    case "CONTAINS":
      return "Contient";
    case "HAS_TYPE":
      return "Type";
    // Claim-related relationships
    case "SUPPORTS":
      return "Soutient";
    case "CONTRADICTS":
      return "Contredit";
    case "ADDRESSES":
      return "Adresse";
    case "EVIDENCE_FOR":
      return "Preuve";
    default:
      return type;
  }
}

// French labels for insight types
const INSIGHT_TYPE_LABELS: Record<string, string> = {
  pain: "Pain Point",
  gain: "Gain",
  opportunity: "Opportunité",
  risk: "Risque",
  signal: "Signal",
  idea: "Idée",
};

/**
 * Get all child challenge IDs recursively for a given challenge
 */
async function getChallengeWithChildren(
  supabase: ReturnType<typeof getAdminSupabaseClient>,
  challengeId: string
): Promise<string[]> {
  const allChallengeIds = new Set<string>([challengeId]);

  // Fetch all challenges and build hierarchy locally (more efficient than recursive queries)
  const { data: allChallenges, error } = await supabase
    .from("challenges")
    .select("id, parent_challenge_id");

  if (error || !allChallenges) {
    return [challengeId];
  }

  // Build parent-to-children map
  const childrenMap = new Map<string, string[]>();
  for (const challenge of allChallenges) {
    if (challenge.parent_challenge_id) {
      if (!childrenMap.has(challenge.parent_challenge_id)) {
        childrenMap.set(challenge.parent_challenge_id, []);
      }
      childrenMap.get(challenge.parent_challenge_id)!.push(challenge.id);
    }
  }

  // BFS to find all descendants
  const queue = [challengeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = childrenMap.get(current) || [];
    for (const child of children) {
      if (!allChallengeIds.has(child)) {
        allChallengeIds.add(child);
        queue.push(child);
      }
    }
  }

  return Array.from(allChallengeIds);
}

/**
 * Handle concepts-only mode: returns only entity nodes with co-occurrence edges
 */
async function handleConceptsMode(
  supabase: ReturnType<typeof getAdminSupabaseClient>,
  options: {
    projectId: string | null;
    clientId: string | null;
    challengeId: string | null;
    limit: number;
    includeAnalytics: boolean;
  }
): Promise<NextResponse> {
  const { projectId, clientId, challengeId, limit, includeAnalytics } = options;

  // Get ask session IDs based on filters
  let askSessionIds: string[] = [];
  let filterChallengeIds: string[] = [];

  if (challengeId) {
    filterChallengeIds = await getChallengeWithChildren(supabase, challengeId);
  }

  if (projectId) {
    let projectQuery = supabase.from("ask_sessions").select("id").eq("project_id", projectId);
    if (filterChallengeIds.length > 0) {
      projectQuery = projectQuery.in("challenge_id", filterChallengeIds);
    }
    const { data: askSessions } = await projectQuery;
    askSessionIds = (askSessions || []).map((s) => s.id);
  } else if (clientId) {
    const { data: projects } = await supabase.from("projects").select("id").eq("client_id", clientId);
    if (projects && projects.length > 0) {
      let askQuery = supabase.from("ask_sessions").select("id").in("project_id", projects.map((p) => p.id));
      if (filterChallengeIds.length > 0) {
        askQuery = askQuery.in("challenge_id", filterChallengeIds);
      }
      const { data: askSessions } = await askQuery;
      askSessionIds = (askSessions || []).map((s) => s.id);
    }
  }

  if (askSessionIds.length === 0 && (projectId || clientId)) {
    return NextResponse.json<ApiResponse<GraphVisualizationResponse>>({
      success: true,
      data: { nodes: [], edges: [], stats: { insights: 0, entities: 0, challenges: 0, syntheses: 0, claims: 0, insightTypes: 0, edges: 0 } },
      message: "Aucun ASK trouvé",
    });
  }

  // Get insights for these ask sessions
  let insightQuery = supabase.from("insights").select("id").limit(limit);
  if (askSessionIds.length > 0) {
    insightQuery = insightQuery.in("ask_session_id", askSessionIds);
  }
  if (filterChallengeIds.length > 0) {
    insightQuery = insightQuery.in("challenge_id", filterChallengeIds);
  }

  const { data: insights } = await insightQuery;
  const insightIds = (insights || []).map((i) => i.id);

  if (insightIds.length === 0) {
    return NextResponse.json<ApiResponse<GraphVisualizationResponse>>({
      success: true,
      data: { nodes: [], edges: [], stats: { insights: 0, entities: 0, challenges: 0, syntheses: 0, claims: 0, insightTypes: 0, edges: 0 } },
      message: "Aucun insight trouvé",
    });
  }

  // Get all insight_keywords for these insights
  const { data: insightKeywords } = await supabase
    .from("insight_keywords")
    .select("insight_id, entity_id, relevance_score")
    .in("insight_id", insightIds);

  if (!insightKeywords || insightKeywords.length === 0) {
    return NextResponse.json<ApiResponse<GraphVisualizationResponse>>({
      success: true,
      data: { nodes: [], edges: [], stats: { insights: insightIds.length, entities: 0, challenges: 0, syntheses: 0, claims: 0, insightTypes: 0, edges: 0 } },
      message: "Aucune entité extraite",
    });
  }

  // Get unique entity IDs
  const entityIds = [...new Set(insightKeywords.map((ik) => ik.entity_id))];

  // Fetch entities WITH embeddings for semantic deduplication
  const { data: entitiesRaw } = await supabase
    .from("knowledge_entities")
    .select("id, name, type, description, frequency, embedding")
    .in("id", entityIds);

  if (!entitiesRaw || entitiesRaw.length === 0) {
    return NextResponse.json<ApiResponse<GraphVisualizationResponse>>({
      success: true,
      data: { nodes: [], edges: [], stats: { insights: insightIds.length, entities: 0, challenges: 0, syntheses: 0, claims: 0, insightTypes: 0, edges: 0 } },
    });
  }

  // Cast entities to proper type
  // Note: Supabase returns vector columns as strings like "[-0.03,0.05,...]"
  // We need to parse them into actual number arrays
  const entities: EntityWithEmbedding[] = entitiesRaw.map(e => {
    let embedding: number[] | null = null;
    if (e.embedding) {
      if (typeof e.embedding === "string") {
        try {
          embedding = JSON.parse(e.embedding);
        } catch {
          console.warn(`Failed to parse embedding for entity ${e.id}`);
        }
      } else if (Array.isArray(e.embedding)) {
        embedding = e.embedding as number[];
      }
    }
    return {
      id: e.id,
      name: e.name,
      type: e.type,
      description: e.description,
      frequency: e.frequency,
      embedding,
    };
  });

  // === SEMANTIC DEDUPLICATION ===
  // Step 1: Use Union-Find to cluster semantically similar entities
  const parent = new Map<string, string>();
  const rank = new Map<string, number>();

  function find(id: string): string {
    if (!parent.has(id)) {
      parent.set(id, id);
      rank.set(id, 0);
    }
    if (parent.get(id) !== id) {
      parent.set(id, find(parent.get(id)!));
    }
    return parent.get(id)!;
  }

  function union(a: string, b: string): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;

    const rankA = rank.get(rootA) || 0;
    const rankB = rank.get(rootB) || 0;

    if (rankA < rankB) {
      parent.set(rootA, rootB);
    } else if (rankA > rankB) {
      parent.set(rootB, rootA);
    } else {
      parent.set(rootB, rootA);
      rank.set(rootA, rankA + 1);
    }
  }

  // Step 2: CROSS-TYPE lexical normalization (merge "google slide" keyword + feature)
  const normalizedGroups = new Map<string, string[]>();
  for (const entity of entities) {
    const normalized = normalizeEntityNameForVisualization(entity.name || "");
    if (!normalizedGroups.has(normalized)) {
      normalizedGroups.set(normalized, []);
    }
    normalizedGroups.get(normalized)!.push(entity.id);
  }

  // Merge lexically identical entities (regardless of type)
  for (const [, ids] of normalizedGroups) {
    for (let i = 1; i < ids.length; i++) {
      union(ids[0], ids[i]);
    }
  }

  // Step 3: Semantic similarity WITHIN same type only (to avoid merging different concepts)
  const entitiesByType = new Map<string, EntityWithEmbedding[]>();
  for (const entity of entities) {
    const type = entity.type || "unknown";
    if (!entitiesByType.has(type)) {
      entitiesByType.set(type, []);
    }
    entitiesByType.get(type)!.push(entity);
  }

  for (const [, typeEntities] of entitiesByType) {
    const entitiesWithEmbeddings = typeEntities.filter(e => e.embedding && e.embedding.length > 0);

    // Only compare pairs if we have a reasonable number (avoid O(n²) explosion)
    if (entitiesWithEmbeddings.length > 1 && entitiesWithEmbeddings.length <= 500) {
      for (let i = 0; i < entitiesWithEmbeddings.length; i++) {
        for (let j = i + 1; j < entitiesWithEmbeddings.length; j++) {
          const a = entitiesWithEmbeddings[i];
          const b = entitiesWithEmbeddings[j];

          // Skip if already in same cluster
          if (find(a.id) === find(b.id)) continue;

          const similarity = cosineSimilarity(a.embedding!, b.embedding!);
          if (similarity >= SEMANTIC_SIMILARITY_THRESHOLD) {
            union(a.id, b.id);
          }
        }
      }
    }
  }

  // Step 4: Cross-type semantic similarity (merge "google slide" feature with "generation google slide" concept)
  // This allows semantically similar entities to merge even if they have different types
  const allEntitiesWithEmbeddings = entities.filter(e => e.embedding && e.embedding.length > 0);
  if (allEntitiesWithEmbeddings.length > 1 && allEntitiesWithEmbeddings.length <= 500) {
    for (let i = 0; i < allEntitiesWithEmbeddings.length; i++) {
      for (let j = i + 1; j < allEntitiesWithEmbeddings.length; j++) {
        const a = allEntitiesWithEmbeddings[i];
        const b = allEntitiesWithEmbeddings[j];

        // Skip if same type (already handled in step 3)
        if (a.type === b.type) continue;

        // Skip if already in same cluster
        if (find(a.id) === find(b.id)) continue;

        const similarity = cosineSimilarity(a.embedding!, b.embedding!);
        if (similarity >= SEMANTIC_SIMILARITY_THRESHOLD) {
          union(a.id, b.id);
        }
      }
    }
  }

  // Step 5: Build clusters from Union-Find
  const clusters = new Map<string, EntityWithEmbedding[]>();
  for (const entity of entities) {
    const root = find(entity.id);
    if (!clusters.has(root)) {
      clusters.set(root, []);
    }
    clusters.get(root)!.push(entity);
  }

  // Step 5: Build entity ID mapping and nodes from clusters
  const entityIdMapping = new Map<string, string>();
  const nodes: GraphNode[] = [];

  for (const [, cluster] of clusters) {
    if (cluster.length === 0) continue;

    // Sort by frequency to pick the best canonical entity
    cluster.sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
    const canonical = cluster[0];

    // Map all entities in cluster to canonical
    for (const entity of cluster) {
      entityIdMapping.set(entity.id, canonical.id);
    }

    const totalFrequency = cluster.reduce((sum, e) => sum + (e.frequency || 0), 0);

    nodes.push({
      id: canonical.id,
      type: "entity",
      label: canonical.name || "Entité",
      subtitle: canonical.type || undefined,
      meta: {
        description: canonical.description,
        frequency: totalFrequency,
        mergedCount: cluster.length > 1 ? cluster.length : undefined,
        mergedNames: cluster.length > 1 ? cluster.map(e => e.name).join(", ") : undefined,
      },
    });
  }

  // Build co-occurrence map: insight_id -> [entity_ids]
  const insightToEntities = new Map<string, string[]>();
  for (const ik of insightKeywords) {
    const canonicalEntityId = entityIdMapping.get(ik.entity_id) || ik.entity_id;
    if (!insightToEntities.has(ik.insight_id)) {
      insightToEntities.set(ik.insight_id, []);
    }
    const entityList = insightToEntities.get(ik.insight_id)!;
    if (!entityList.includes(canonicalEntityId)) {
      entityList.push(canonicalEntityId);
    }
  }

  // Compute co-occurrence edges
  const coOccurrenceCount = new Map<string, number>();
  for (const [, entityList] of insightToEntities) {
    // Create edges between all pairs of entities in the same insight
    for (let i = 0; i < entityList.length; i++) {
      for (let j = i + 1; j < entityList.length; j++) {
        const [a, b] = [entityList[i], entityList[j]].sort();
        const key = `${a}:${b}`;
        coOccurrenceCount.set(key, (coOccurrenceCount.get(key) || 0) + 1);
      }
    }
  }

  // Create edges from co-occurrence
  const edges: GraphEdge[] = [];
  let edgeIndex = 0;
  for (const [key, count] of coOccurrenceCount) {
    const [source, target] = key.split(":");
    edges.push({
      id: `cooccur-${edgeIndex++}`,
      source,
      target,
      relationshipType: "CO_OCCURS",
      label: `${count} insight${count > 1 ? "s" : ""}`,
      weight: count,
      confidence: null,
    });
  }

  // Optionally compute analytics
  let enrichedNodes = nodes;
  if (includeAnalytics && projectId) {
    try {
      const graph = await buildGraphologyGraph(supabase, projectId, { includeEntities: true });
      const communities = detectCommunities(graph);
      const centrality = computeCentrality(graph);
      const nodeAnalyticsMap = getNodeAnalyticsMap(communities, centrality);

      enrichedNodes = nodes.map((node) => {
        const analytics = nodeAnalyticsMap.get(node.id);
        if (analytics) {
          return {
            ...node,
            community: analytics.community,
            betweenness: analytics.betweenness,
            pageRank: analytics.pageRank,
            degree: analytics.degree,
          };
        }
        return node;
      });
    } catch (e) {
      console.warn("Failed to compute analytics for concepts mode:", e);
    }
  }

  return NextResponse.json<ApiResponse<GraphVisualizationResponse>>({
    success: true,
    data: {
      nodes: enrichedNodes,
      edges,
      stats: {
        insights: insightIds.length,
        entities: nodes.length,
        challenges: 0,
        syntheses: 0,
        claims: 0,
        insightTypes: 0,
        edges: edges.length,
      },
    },
  });
}

export async function GET(request: NextRequest) {
  const supabase = getAdminSupabaseClient();
  const searchParams = request.nextUrl.searchParams;
  const projectId = searchParams.get("projectId");
  const clientId = searchParams.get("clientId");
  const challengeId = searchParams.get("challengeId");
  const limit = Math.min(parseInt(searchParams.get("limit") || "500", 10), 1000);
  const includeAnalytics = searchParams.get("includeAnalytics") === "true";
  const mode = searchParams.get("mode") || "full"; // "full" | "concepts"

  try {
    // If mode=concepts, use the concepts-only visualization
    if (mode === "concepts") {
      return handleConceptsMode(supabase, { projectId, clientId, challengeId, limit, includeAnalytics });
    }
    // Build the base query for insights (using insight_type_id with join to insight_types)
    let insightQuery = supabase
      .from("insights")
      .select("id, summary, content, created_at, ask_session_id, challenge_id, insight_type_id, insight_types(name)")
      .order("created_at", { ascending: false })
      .limit(limit);

    // Get relevant ASK session IDs based on filters
    let askSessionIds: string[] = [];
    let filterChallengeIds: string[] = [];

    // Apply challenge filter (includes children)
    if (challengeId) {
      filterChallengeIds = await getChallengeWithChildren(supabase, challengeId);
    }

    // Apply project/client filter to get relevant ask sessions
    if (projectId) {
      let projectQuery = supabase.from("ask_sessions").select("id").eq("project_id", projectId);

      // If we have challenge filter, also filter by challenge
      if (filterChallengeIds.length > 0) {
        projectQuery = projectQuery.in("challenge_id", filterChallengeIds);
      }

      const { data: askSessions, error: askError } = await projectQuery;

      if (askError) {
        throw askError;
      }

      if (!askSessions || askSessions.length === 0) {
        return NextResponse.json<ApiResponse<GraphVisualizationResponse>>({
          success: true,
          data: { nodes: [], edges: [], stats: { insights: 0, entities: 0, challenges: 0, syntheses: 0, claims: 0, insightTypes: 0, edges: 0 } },
          message: "Aucun ASK trouvé pour ce projet",
        });
      }

      askSessionIds = askSessions.map((session) => session.id);
    } else if (clientId) {
      // Filter by client: get all projects for this client, then their ask sessions
      const { data: projects, error: projectError } = await supabase
        .from("projects")
        .select("id")
        .eq("client_id", clientId);

      if (projectError) {
        throw projectError;
      }

      if (!projects || projects.length === 0) {
        return NextResponse.json<ApiResponse<GraphVisualizationResponse>>({
          success: true,
          data: { nodes: [], edges: [], stats: { insights: 0, entities: 0, challenges: 0, syntheses: 0, claims: 0, insightTypes: 0, edges: 0 } },
          message: "Aucun projet trouvé pour ce client",
        });
      }

      const projectIds = projects.map((p) => p.id);
      let askQuery = supabase.from("ask_sessions").select("id").in("project_id", projectIds);

      if (filterChallengeIds.length > 0) {
        askQuery = askQuery.in("challenge_id", filterChallengeIds);
      }

      const { data: askSessions, error: askError } = await askQuery;

      if (askError) {
        throw askError;
      }

      askSessionIds = (askSessions || []).map((session) => session.id);
    }

    // Apply ask session filter if we have IDs
    if (askSessionIds.length > 0) {
      insightQuery = insightQuery.in("ask_session_id", askSessionIds);
    }

    // Also filter insights by challenge_id if challenge filter is set
    if (filterChallengeIds.length > 0) {
      insightQuery = insightQuery.in("challenge_id", filterChallengeIds);
    }

    const { data: insights, error: insightError } = await insightQuery;
    if (insightError) {
      throw insightError;
    }

    const insightIds = insights?.map((insight) => insight.id) ?? [];
    const nodes: Map<string, GraphNode> = new Map();
    const nodeTypes: Map<string, GraphNodeType> = new Map();

    // Track insight types used and create HAS_TYPE edges
    const insightTypesUsed = new Set<string>();
    const hasTypeEdges: GraphEdge[] = [];

    for (const insight of insights ?? []) {
      // Determine the insight type from the joined insight_types table (default to 'idea' if not set)
      // Supabase returns the joined data as an object for single relations (insight_type_id -> insight_types)
      const insightTypesData = insight.insight_types as unknown as { name: string } | { name: string }[] | null;
      const typeName = Array.isArray(insightTypesData)
        ? insightTypesData[0]?.name
        : insightTypesData?.name;
      const insightType = typeName?.toLowerCase() || "idea";
      const validTypes = ["pain", "gain", "opportunity", "risk", "signal", "idea"];
      const resolvedType = validTypes.includes(insightType) ? insightType : "idea";

      nodes.set(insight.id, {
        id: insight.id,
        type: "insight",
        label: formatInsightLabel(insight),
        subtitle: INSIGHT_TYPE_LABELS[resolvedType] || resolvedType,
        meta: {
          createdAt: insight.created_at,
          challengeId: insight.challenge_id,
          insightType: resolvedType,
        },
      });
      nodeTypes.set(insight.id, "insight");

      // Track the insight type and create HAS_TYPE edge
      insightTypesUsed.add(resolvedType);
      hasTypeEdges.push({
        id: `has-type-${insight.id}-${resolvedType}`,
        source: insight.id,
        target: `insight-type-${resolvedType}`,
        relationshipType: "HAS_TYPE",
        label: relationshipLabel("HAS_TYPE"),
        weight: 1,
        confidence: 1,
      });
    }

    // Create insight_type nodes for each type used
    for (const typeName of insightTypesUsed) {
      const typeNodeId = `insight-type-${typeName}`;
      nodes.set(typeNodeId, {
        id: typeNodeId,
        type: "insight_type",
        label: INSIGHT_TYPE_LABELS[typeName] || typeName,
        subtitle: `Type d'insight`,
        meta: {
          insightTypeName: typeName,
        },
      });
      nodeTypes.set(typeNodeId, "insight_type");
    }

    if (insightIds.length === 0) {
      return NextResponse.json<ApiResponse<GraphVisualizationResponse>>({
        success: true,
        data: {
          nodes: Array.from(nodes.values()),
          edges: [],
          stats: { insights: 0, entities: 0, challenges: 0, syntheses: 0, claims: 0, insightTypes: 0, edges: 0 },
        },
      });
    }

    // Fetch edges touching these insights - get edges where either source or target is one of our insights
    const { data: sourceEdges, error: sourceError } = await supabase
      .from("knowledge_graph_edges")
      .select("source_id, source_type, target_id, target_type, relationship_type, similarity_score, confidence, metadata")
      .eq("source_type", "insight")
      .in("source_id", insightIds)
      .limit(limit * 2);

    if (sourceError) {
      throw sourceError;
    }

    const { data: targetEdges, error: targetError } = await supabase
      .from("knowledge_graph_edges")
      .select("source_id, source_type, target_id, target_type, relationship_type, similarity_score, confidence, metadata")
      .eq("target_type", "insight")
      .in("target_id", insightIds)
      .limit(limit * 2);

    if (targetError) {
      throw targetError;
    }

    // Combine and deduplicate edges
    const edgeMap = new Map<string, any>();
    for (const edge of [...(sourceEdges ?? []), ...(targetEdges ?? [])]) {
      const key = `${edge.source_id}-${edge.target_id}-${edge.relationship_type}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, edge);
      }
    }
    const edgeData = Array.from(edgeMap.values());

    const edges: GraphEdge[] = [];
    const entityIds = new Set<string>();
    const challengeIds = new Set<string>();
    const synthesisIds = new Set<string>();
    const claimIds = new Set<string>();

    for (const [index, edge] of (edgeData ?? []).entries()) {
      const edgeId = `edge-${index}-${edge.source_id}-${edge.target_id}-${edge.relationship_type}`;
      edges.push({
        id: edgeId,
        source: edge.source_id,
        target: edge.target_id,
        relationshipType: edge.relationship_type,
        label: relationshipLabel(edge.relationship_type),
        weight: edge.similarity_score ?? edge.confidence ?? undefined,
        confidence: edge.confidence ?? null,
      });

      nodeTypes.set(edge.source_id, edge.source_type);
      nodeTypes.set(edge.target_id, edge.target_type);

      if (edge.source_type === "entity") {
        entityIds.add(edge.source_id);
      } else if (edge.source_type === "challenge") {
        challengeIds.add(edge.source_id);
      } else if (edge.source_type === "synthesis") {
        synthesisIds.add(edge.source_id);
      } else if (edge.source_type === "claim") {
        claimIds.add(edge.source_id);
      }

      if (edge.target_type === "entity") {
        entityIds.add(edge.target_id);
      } else if (edge.target_type === "challenge") {
        challengeIds.add(edge.target_id);
      } else if (edge.target_type === "synthesis") {
        synthesisIds.add(edge.target_id);
      } else if (edge.target_type === "claim") {
        claimIds.add(edge.target_id);
      }
    }

    // Entities - with deduplication by normalized name
    const entityIdMapping = new Map<string, string>();

    if (entityIds.size > 0) {
      const { data: entities, error: entityError } = await supabase
        .from("knowledge_entities")
        .select("id, name, type, description, frequency")
        .in("id", Array.from(entityIds));

      if (entityError) {
        throw entityError;
      }

      // Group entities by normalized name to find duplicates
      const normalizedNameToEntities = new Map<string, typeof entities>();
      for (const entity of entities ?? []) {
        const normalizedName = normalizeEntityNameForVisualization(entity.name || "");
        const key = `${normalizedName}:${entity.type}`;

        if (!normalizedNameToEntities.has(key)) {
          normalizedNameToEntities.set(key, []);
        }
        normalizedNameToEntities.get(key)!.push(entity);
      }

      // For each group, select the canonical entity (highest frequency or first)
      for (const [, entityGroup] of normalizedNameToEntities) {
        if (!entityGroup || entityGroup.length === 0) continue;

        entityGroup.sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
        const canonicalEntity = entityGroup[0];

        for (const entity of entityGroup) {
          entityIdMapping.set(entity.id, canonicalEntity.id);
        }

        const totalFrequency = entityGroup.reduce((sum, e) => sum + (e.frequency || 0), 0);

        nodes.set(canonicalEntity.id, {
          id: canonicalEntity.id,
          type: "entity",
          label: canonicalEntity.name || "Entité",
          subtitle: canonicalEntity.type || undefined,
          meta: {
            description: canonicalEntity.description,
            frequency: totalFrequency,
            mergedCount: entityGroup.length > 1 ? entityGroup.length : undefined,
          },
        });
        nodeTypes.set(canonicalEntity.id, "entity");
      }
    }

    // Update edges to use canonical entity IDs
    const deduplicatedEdges: GraphEdge[] = [];
    const seenEdgeKeys = new Set<string>();

    for (const edge of edges) {
      const remappedSource = entityIdMapping.get(edge.source) || edge.source;
      const remappedTarget = entityIdMapping.get(edge.target) || edge.target;

      if (remappedSource === remappedTarget) continue;

      const edgeKey = `${remappedSource}-${remappedTarget}-${edge.relationshipType}`;
      if (seenEdgeKeys.has(edgeKey)) continue;
      seenEdgeKeys.add(edgeKey);

      deduplicatedEdges.push({
        ...edge,
        source: remappedSource,
        target: remappedTarget,
      });
    }

    // Challenges
    if (challengeIds.size > 0) {
      const { data: challenges, error: challengeError } = await supabase
        .from("challenges")
        .select("id, name, status, priority")
        .in("id", Array.from(challengeIds));

      if (challengeError) {
        throw challengeError;
      }

      for (const challenge of challenges ?? []) {
        nodes.set(challenge.id, {
          id: challenge.id,
          type: "challenge",
          label: challenge.name || "Challenge",
          subtitle: challenge.status || undefined,
          meta: {
            priority: challenge.priority,
          },
        });
        nodeTypes.set(challenge.id, "challenge");
      }
    }

    // Syntheses
    if (synthesisIds.size > 0) {
      const { data: syntheses, error: synthesisError } = await supabase
        .from("insight_syntheses")
        .select("id, synthesized_text, project_id")
        .in("id", Array.from(synthesisIds));

      if (synthesisError) {
        throw synthesisError;
      }

      for (const synthesis of syntheses ?? []) {
        const label = synthesis.synthesized_text?.trim() || "Synthèse";
        nodes.set(synthesis.id, {
          id: synthesis.id,
          type: "synthesis",
          label: label.length > 120 ? `${label.slice(0, 117)}...` : label,
          subtitle: synthesis.project_id ? `Projet ${synthesis.project_id.slice(0, 4)}…` : undefined,
        });
        nodeTypes.set(synthesis.id, "synthesis");
      }
    }

    // Claims
    if (claimIds.size > 0) {
      const { data: claims, error: claimError } = await supabase
        .from("claims")
        .select("id, statement, claim_type, evidence_strength")
        .in("id", Array.from(claimIds));

      if (claimError) {
        throw claimError;
      }

      // Claim type labels in French
      const CLAIM_TYPE_LABELS: Record<string, string> = {
        finding: "Constat",
        hypothesis: "Hypothèse",
        recommendation: "Recommandation",
        observation: "Observation",
      };

      for (const claim of claims ?? []) {
        const label = claim.statement?.trim() || "Claim";
        nodes.set(claim.id, {
          id: claim.id,
          type: "claim",
          label: label.length > 120 ? `${label.slice(0, 117)}...` : label,
          subtitle: CLAIM_TYPE_LABELS[claim.claim_type] || claim.claim_type,
          meta: {
            claimType: claim.claim_type,
            evidenceStrength: claim.evidence_strength,
          },
        });
        nodeTypes.set(claim.id, "claim");
      }
    }

    // Collect orphan node IDs (nodes referenced by edges but not yet loaded)
    const orphanInsightIds = new Set<string>();
    const orphanEntityIds = new Set<string>();
    const orphanChallengeIds = new Set<string>();
    const orphanSynthesisIds = new Set<string>();
    const orphanClaimIds = new Set<string>();

    for (const edge of deduplicatedEdges) {
      for (const nodeId of [edge.source, edge.target]) {
        if (!nodes.has(nodeId)) {
          const type = nodeTypes.get(nodeId) || "entity";
          switch (type) {
            case "insight":
              orphanInsightIds.add(nodeId);
              break;
            case "entity":
              orphanEntityIds.add(nodeId);
              break;
            case "challenge":
              orphanChallengeIds.add(nodeId);
              break;
            case "synthesis":
              orphanSynthesisIds.add(nodeId);
              break;
            case "claim":
              orphanClaimIds.add(nodeId);
              break;
          }
        }
      }
    }

    // Fetch orphan insights
    if (orphanInsightIds.size > 0) {
      const { data: orphanInsights } = await supabase
        .from("insights")
        .select("id, summary, content, created_at, challenge_id, insight_type_id, insight_types(name)")
        .in("id", Array.from(orphanInsightIds));

      for (const insight of orphanInsights ?? []) {
        const insightTypesData = insight.insight_types as unknown as { name: string } | { name: string }[] | null;
        const typeName = Array.isArray(insightTypesData)
          ? insightTypesData[0]?.name
          : insightTypesData?.name;
        const insightType = typeName?.toLowerCase() || "idea";
        const validTypes = ["pain", "gain", "opportunity", "risk", "signal", "idea"];
        const resolvedType = validTypes.includes(insightType) ? insightType : "idea";

        nodes.set(insight.id, {
          id: insight.id,
          type: "insight",
          label: formatInsightLabel(insight),
          subtitle: INSIGHT_TYPE_LABELS[resolvedType] || resolvedType,
          meta: {
            createdAt: insight.created_at,
            challengeId: insight.challenge_id,
            insightType: resolvedType,
            isOrphan: true, // Mark as loaded from edge reference
          },
        });
        nodeTypes.set(insight.id, "insight");
      }
    }

    // Fetch orphan entities
    if (orphanEntityIds.size > 0) {
      const { data: orphanEntities } = await supabase
        .from("knowledge_entities")
        .select("id, name, type, description, frequency")
        .in("id", Array.from(orphanEntityIds));

      for (const entity of orphanEntities ?? []) {
        // Check if this entity should be mapped to a canonical one
        const canonicalId = entityIdMapping.get(entity.id);
        if (canonicalId && nodes.has(canonicalId)) {
          continue; // Already have canonical version
        }

        nodes.set(entity.id, {
          id: entity.id,
          type: "entity",
          label: entity.name || "Entité",
          subtitle: entity.type || undefined,
          meta: {
            description: entity.description,
            frequency: entity.frequency,
            isOrphan: true,
          },
        });
        nodeTypes.set(entity.id, "entity");
      }
    }

    // Fetch orphan challenges
    if (orphanChallengeIds.size > 0) {
      const { data: orphanChallenges } = await supabase
        .from("challenges")
        .select("id, name, status, priority")
        .in("id", Array.from(orphanChallengeIds));

      for (const challenge of orphanChallenges ?? []) {
        nodes.set(challenge.id, {
          id: challenge.id,
          type: "challenge",
          label: challenge.name || "Challenge",
          subtitle: challenge.status || undefined,
          meta: {
            priority: challenge.priority,
            isOrphan: true,
          },
        });
        nodeTypes.set(challenge.id, "challenge");
      }
    }

    // Fetch orphan syntheses
    if (orphanSynthesisIds.size > 0) {
      const { data: orphanSyntheses } = await supabase
        .from("insight_syntheses")
        .select("id, synthesized_text, project_id")
        .in("id", Array.from(orphanSynthesisIds));

      for (const synthesis of orphanSyntheses ?? []) {
        const label = synthesis.synthesized_text?.trim() || "Synthèse";
        nodes.set(synthesis.id, {
          id: synthesis.id,
          type: "synthesis",
          label: label.length > 120 ? `${label.slice(0, 117)}...` : label,
          subtitle: synthesis.project_id ? `Projet ${synthesis.project_id.slice(0, 4)}…` : undefined,
          meta: { isOrphan: true },
        });
        nodeTypes.set(synthesis.id, "synthesis");
      }
    }

    // Fetch orphan claims
    if (orphanClaimIds.size > 0) {
      const { data: orphanClaims } = await supabase
        .from("claims")
        .select("id, statement, claim_type, evidence_strength")
        .in("id", Array.from(orphanClaimIds));

      const CLAIM_TYPE_LABELS_ORPHAN: Record<string, string> = {
        finding: "Constat",
        hypothesis: "Hypothèse",
        recommendation: "Recommandation",
        observation: "Observation",
      };

      for (const claim of orphanClaims ?? []) {
        const label = claim.statement?.trim() || "Claim";
        nodes.set(claim.id, {
          id: claim.id,
          type: "claim",
          label: label.length > 120 ? `${label.slice(0, 117)}...` : label,
          subtitle: CLAIM_TYPE_LABELS_ORPHAN[claim.claim_type] || claim.claim_type,
          meta: {
            claimType: claim.claim_type,
            evidenceStrength: claim.evidence_strength,
            isOrphan: true,
          },
        });
        nodeTypes.set(claim.id, "claim");
      }
    }

    // Final fallback: create placeholder for any still-missing nodes (shouldn't happen but safety net)
    for (const edge of deduplicatedEdges) {
      for (const nodeId of [edge.source, edge.target]) {
        if (!nodes.has(nodeId)) {
          const type = nodeTypes.get(nodeId) || "entity";
          nodes.set(nodeId, {
            id: nodeId,
            type,
            label: `${type} ${nodeId.slice(0, 6)}…`,
            meta: { isMissing: true },
          });
        }
      }
    }

    // Count unique entities after deduplication
    const uniqueEntityIds = new Set<string>();
    entityIdMapping.forEach((canonicalId) => uniqueEntityIds.add(canonicalId));

    // Combine deduplicated edges with HAS_TYPE edges
    const allEdges = [...deduplicatedEdges, ...hasTypeEdges];

    // Optionally compute and add analytics (community detection, centrality)
    let enrichedNodes = Array.from(nodes.values());

    if (includeAnalytics && projectId) {
      try {
        // Build Graphology graph and compute analytics
        const graph = await buildGraphologyGraph(supabase, projectId, {
          includeEntities: true,
        });

        const communities = detectCommunities(graph);
        const centrality = computeCentrality(graph);
        const nodeAnalyticsMap = getNodeAnalyticsMap(communities, centrality);

        // Enrich nodes with analytics data
        enrichedNodes = enrichedNodes.map((node) => {
          const analytics = nodeAnalyticsMap.get(node.id);
          if (analytics) {
            return {
              ...node,
              community: analytics.community,
              betweenness: analytics.betweenness,
              pageRank: analytics.pageRank,
              degree: analytics.degree,
            };
          }
          return node;
        });
      } catch (analyticsError) {
        console.warn("Failed to compute graph analytics:", analyticsError);
        // Continue without analytics - don't fail the whole request
      }
    }

    return NextResponse.json<ApiResponse<GraphVisualizationResponse>>({
      success: true,
      data: {
        nodes: enrichedNodes,
        edges: allEdges,
        stats: {
          insights: (insights ?? []).length,
          entities: uniqueEntityIds.size,
          challenges: Array.from(challengeIds).length,
          syntheses: Array.from(synthesisIds).length,
          claims: claimIds.size,
          insightTypes: insightTypesUsed.size,
          edges: allEdges.length,
        },
      },
    });
  } catch (error) {
    console.error("Error building graph visualization response:", error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
