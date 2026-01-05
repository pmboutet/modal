/**
 * Narrative Synthesis Service
 * Generates comprehensive Markdown reports from claims, insights, and graph data
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabaseClient } from "@/lib/supabaseAdmin";
import { executeAgent } from "@/lib/ai/service";
import { buildGraphologyGraph, detectCommunities } from "./graphAnalysis";
import type {
  ProjectSynthesis,
  SynthesisMetadata,
  SynthesisItem,
  ThematicGroup,
  Claim,
  ClaimType,
} from "@/types";

// ============================================================================
// TYPES
// ============================================================================

interface ProblemItem {
  id: string;
  content: string;
  type: "pain" | "risk";
  severity: "low" | "medium" | "high" | "critical";
  sourceCount: number;
  sources: string[];
}

interface FindingItem {
  id: string;
  statement: string;
  evidenceStrength: number;
  sourceCount: number;
  sources: string[];
  convergenceCount: number; // Number of other claims that support this one
}

interface SolutionItem {
  id: string;
  recommendation: string;
  evidenceStrength: number;
  supportCount: number;
  sources: string[];
  addressesProblems: string[];
  convergenceCount: number; // Number of other claims that support this one
}

interface TensionItem {
  id: string;
  claim1: { statement: string; author: string };
  claim2: { statement: string; author: string };
  confidence: number;
  subject?: string;
}

interface AISummaryResult {
  executiveSummary: string;
  keyTakeaways: string[];
  sectionOverviews: {
    problemSpace: string;
    findings: string;
    solutions: string;
    tensions: string;
    risks: string;
  };
}

interface SynthesisData {
  projectName: string;
  challengeName?: string;
  problems: ProblemItem[];
  findings: FindingItem[];
  solutions: SolutionItem[];
  tensions: TensionItem[];
  risks: ProblemItem[];
  thematicGroups: ThematicGroup[];
  stats: SynthesisMetadata["stats"];
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Generate a complete narrative synthesis in Markdown format
 */
export async function generateNarrativeSynthesis(
  projectId: string,
  challengeId?: string,
  client?: SupabaseClient
): Promise<{ markdown: string; metadata: SynthesisMetadata }> {
  const supabase = client || getAdminSupabaseClient();

  // 1. Fetch project info
  const { data: project } = await supabase
    .from("projects")
    .select("name, description")
    .eq("id", projectId)
    .single();

  let challengeName: string | undefined;
  if (challengeId) {
    const { data: challenge } = await supabase
      .from("challenges")
      .select("name")
      .eq("id", challengeId)
      .single();
    challengeName = challenge?.name;
  }

  // 2. Fetch and process data
  const [claims, insights, participants] = await Promise.all([
    fetchClaims(supabase, projectId, challengeId),
    fetchInsights(supabase, projectId, challengeId),
    fetchParticipantCount(supabase, projectId),
  ]);

  // 3. Build graph and detect communities
  const graph = await buildGraphologyGraph(supabase, projectId, { includeEntities: true });
  const communities = detectCommunities(graph);

  // 4. Group claims by community
  const thematicGroups = groupClaimsByCommunity(claims, communities, graph);

  // 5. Build convergence map (cross-participant support)
  const convergenceMap = await buildConvergenceMap(supabase, projectId);

  // 6. Build sections (with convergence-boosted evidence strength)
  const problems = buildProblemSpace(insights, claims);
  const findings = buildFindings(claims, convergenceMap);
  const solutions = buildSolutions(claims, convergenceMap);
  const tensions = await buildTensions(supabase, projectId, claims);
  const risks = problems.filter(p => p.type === "risk");

  // 6. Calculate stats
  const consensusCount = await countConsensus(supabase, projectId);
  const stats: SynthesisMetadata["stats"] = {
    totalClaims: claims.length,
    totalInsights: insights.length,
    totalParticipants: participants,
    communitiesDetected: thematicGroups.length,
    consensusRate: claims.length > 0 ? consensusCount / claims.length : 0,
    tensionRate: claims.length > 0 ? tensions.length / claims.length : 0,
  };

  // 7. Generate AI summary
  const synthesisData: SynthesisData = {
    projectName: project?.name || "Projet",
    challengeName,
    problems,
    findings,
    solutions,
    tensions,
    risks,
    thematicGroups,
    stats,
  };

  const aiSummary = await generateAISummary(supabase, synthesisData);

  // 8. Assemble Markdown
  const markdown = assembleMarkdown(synthesisData, aiSummary);

  // 9. Build metadata
  const metadata: SynthesisMetadata = {
    stats,
    sections: {
      problemSpace: problems.length,
      findings: findings.length,
      solutions: solutions.length,
      tensions: tensions.length,
      risks: risks.length,
    },
    thematicGroups: thematicGroups.map(g => ({
      id: g.id,
      name: g.name,
      claimCount: g.claimIds.length,
    })),
  };

  return { markdown, metadata };
}

/**
 * Save synthesis to database (delete + insert due to COALESCE-based unique index)
 */
export async function saveSynthesis(
  projectId: string,
  challengeId: string | null,
  markdown: string,
  metadata: SynthesisMetadata,
  client?: SupabaseClient
): Promise<ProjectSynthesis> {
  const supabase = client || getAdminSupabaseClient();

  // Delete existing synthesis for this scope first (due to COALESCE-based unique index)
  let deleteQuery = supabase
    .from("project_syntheses")
    .delete()
    .eq("project_id", projectId);

  if (challengeId) {
    deleteQuery = deleteQuery.eq("challenge_id", challengeId);
  } else {
    deleteQuery = deleteQuery.is("challenge_id", null);
  }

  await deleteQuery;

  // Insert new synthesis
  const { data, error } = await supabase
    .from("project_syntheses")
    .insert({
      project_id: projectId,
      challenge_id: challengeId,
      markdown_content: markdown,
      metadata,
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to save synthesis: ${error.message}`);
  }

  return mapRowToSynthesis(data);
}

/**
 * Get the latest synthesis for a project/challenge
 */
export async function getLatestSynthesis(
  projectId: string,
  challengeId?: string,
  client?: SupabaseClient
): Promise<ProjectSynthesis | null> {
  const supabase = client || getAdminSupabaseClient();

  let query = supabase
    .from("project_syntheses")
    .select("*")
    .eq("project_id", projectId);

  if (challengeId) {
    query = query.eq("challenge_id", challengeId);
  } else {
    query = query.is("challenge_id", null);
  }

  const { data, error } = await query.single();

  if (error || !data) {
    return null;
  }

  return mapRowToSynthesis(data);
}

// ============================================================================
// DATA FETCHING
// ============================================================================

async function fetchClaims(
  supabase: SupabaseClient,
  projectId: string,
  challengeId?: string
): Promise<Claim[]> {
  let query = supabase
    .from("claims")
    .select("*")
    .eq("project_id", projectId);

  if (challengeId) {
    query = query.eq("challenge_id", challengeId);
  }

  const { data } = await query;
  return (data || []).map(mapRowToClaim);
}

async function fetchInsights(
  supabase: SupabaseClient,
  projectId: string,
  challengeId?: string
): Promise<Array<{ id: string; content: string; type: string; summary?: string }>> {
  // Get ask sessions for this project
  const { data: sessions } = await supabase
    .from("ask_sessions")
    .select("id")
    .eq("project_id", projectId);

  if (!sessions || sessions.length === 0) return [];

  const sessionIds = sessions.map(s => s.id);

  let query = supabase
    .from("insights")
    .select("id, content, summary, insight_types(name)")
    .in("ask_session_id", sessionIds);

  if (challengeId) {
    query = query.eq("challenge_id", challengeId);
  }

  const { data } = await query;
  return (data || []).map((row: any) => ({
    id: row.id,
    content: row.content,
    summary: row.summary,
    type: row.insight_types?.name || "signal",
  }));
}

async function fetchParticipantCount(
  supabase: SupabaseClient,
  projectId: string
): Promise<number> {
  const { data: sessions } = await supabase
    .from("ask_sessions")
    .select("id")
    .eq("project_id", projectId);

  if (!sessions || sessions.length === 0) return 0;

  const { count } = await supabase
    .from("ask_participants")
    .select("*", { count: "exact", head: true })
    .in("ask_session_id", sessions.map(s => s.id));

  return count || 0;
}

async function countConsensus(
  supabase: SupabaseClient,
  projectId: string
): Promise<number> {
  const { data: claims } = await supabase
    .from("claims")
    .select("id")
    .eq("project_id", projectId);

  if (!claims || claims.length === 0) return 0;

  const claimIds = claims.map(c => c.id);

  const { count } = await supabase
    .from("knowledge_graph_edges")
    .select("*", { count: "exact", head: true })
    .eq("relationship_type", "SUPPORTS")
    .eq("source_type", "claim")
    .eq("target_type", "claim")
    .in("source_id", claimIds);

  return count || 0;
}

/**
 * Build a map of claimId -> convergence count (number of SUPPORTS edges pointing to it)
 * This represents how many other participants' claims support each claim
 */
async function buildConvergenceMap(
  supabase: SupabaseClient,
  projectId: string
): Promise<Map<string, number>> {
  const convergenceMap = new Map<string, number>();

  const { data: claims } = await supabase
    .from("claims")
    .select("id")
    .eq("project_id", projectId);

  if (!claims || claims.length === 0) return convergenceMap;

  const claimIds = claims.map(c => c.id);

  // Get all SUPPORTS edges where target is one of our claims
  const { data: edges } = await supabase
    .from("knowledge_graph_edges")
    .select("target_id")
    .eq("relationship_type", "SUPPORTS")
    .eq("source_type", "claim")
    .eq("target_type", "claim")
    .in("target_id", claimIds);

  if (!edges) return convergenceMap;

  // Count how many times each claim is the target of a SUPPORTS edge
  for (const edge of edges) {
    const count = convergenceMap.get(edge.target_id) || 0;
    convergenceMap.set(edge.target_id, count + 1);
  }

  return convergenceMap;
}

// ============================================================================
// SECTION BUILDERS
// ============================================================================

function buildProblemSpace(
  insights: Array<{ id: string; content: string; type: string; summary?: string }>,
  claims: Claim[]
): ProblemItem[] {
  const problems: ProblemItem[] = [];

  // From insights of type "pain" or "risk"
  for (const insight of insights) {
    if (insight.type === "pain" || insight.type === "risk") {
      problems.push({
        id: insight.id,
        content: insight.summary || insight.content.substring(0, 200),
        type: insight.type as "pain" | "risk",
        severity: "medium", // Could be enhanced with sentiment analysis
        sourceCount: 1,
        sources: [insight.id],
      });
    }
  }

  // From claims of type "finding" with negative sentiment (heuristic)
  for (const claim of claims) {
    if (claim.claimType === "finding") {
      const hasNegativeIndicators = /problème|difficulté|manque|absence|insuffisant|frustrat/i.test(
        claim.statement
      );
      if (hasNegativeIndicators) {
        problems.push({
          id: claim.id,
          content: claim.statement,
          type: "pain",
          severity: calculateSeverity(claim.evidenceStrength || 0.5),
          sourceCount: claim.sourceInsightIds?.length || 1,
          sources: claim.sourceInsightIds || [],
        });
      }
    }
  }

  return problems.sort((a, b) => severityOrder(b.severity) - severityOrder(a.severity));
}

function buildFindings(claims: Claim[], convergenceMap: Map<string, number>): FindingItem[] {
  return claims
    .filter(c => c.claimType === "finding")
    .map(c => {
      const convergence = convergenceMap.get(c.id) || 0;
      // Boost evidence strength based on convergence: +10% per supporting claim, capped at 1.0
      const boostedStrength = Math.min(1.0, (c.evidenceStrength || 0.5) + convergence * 0.1);
      return {
        id: c.id,
        statement: c.statement,
        evidenceStrength: boostedStrength,
        sourceCount: c.sourceInsightIds?.length || 1,
        sources: c.sourceInsightIds || [],
        convergenceCount: convergence,
      };
    })
    .sort((a, b) => b.evidenceStrength - a.evidenceStrength);
}

function buildSolutions(claims: Claim[], convergenceMap: Map<string, number>): SolutionItem[] {
  return claims
    .filter(c => c.claimType === "recommendation")
    .map(c => {
      const convergence = convergenceMap.get(c.id) || 0;
      // Boost evidence strength based on convergence: +10% per supporting claim, capped at 1.0
      const boostedStrength = Math.min(1.0, (c.evidenceStrength || 0.5) + convergence * 0.1);
      return {
        id: c.id,
        recommendation: c.statement,
        evidenceStrength: boostedStrength,
        supportCount: c.sourceInsightIds?.length || 1,
        sources: c.sourceInsightIds || [],
        addressesProblems: [], // Would need ADDRESSES edges
        convergenceCount: convergence,
      };
    })
    .sort((a, b) => b.evidenceStrength - a.evidenceStrength);
}

async function buildTensions(
  supabase: SupabaseClient,
  projectId: string,
  claims: Claim[]
): Promise<TensionItem[]> {
  if (claims.length === 0) return [];

  const claimIds = claims.map(c => c.id);
  const claimMap = new Map(claims.map(c => [c.id, c]));

  const { data: edges } = await supabase
    .from("knowledge_graph_edges")
    .select("source_id, target_id, confidence, metadata")
    .eq("relationship_type", "CONTRADICTS")
    .eq("source_type", "claim")
    .eq("target_type", "claim")
    .or(`source_id.in.(${claimIds.join(",")}),target_id.in.(${claimIds.join(",")})`);

  if (!edges) return [];

  const tensions: TensionItem[] = [];
  const seenPairs = new Set<string>();

  for (const edge of edges) {
    const claim1 = claimMap.get(edge.source_id);
    const claim2 = claimMap.get(edge.target_id);
    if (!claim1 || !claim2) continue;

    const pairKey = [edge.source_id, edge.target_id].sort().join("-");
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    tensions.push({
      id: `tension-${tensions.length + 1}`,
      claim1: { statement: claim1.statement, author: "Participant" },
      claim2: { statement: claim2.statement, author: "Participant" },
      confidence: edge.confidence || 0.7,
      subject: edge.metadata?.reasoning || undefined,
    });
  }

  return tensions.sort((a, b) => b.confidence - a.confidence);
}

function groupClaimsByCommunity(
  claims: Claim[],
  communities: Array<{ id: number; nodeIds: string[]; dominantType: string }>,
  graph: any
): ThematicGroup[] {
  const groups: ThematicGroup[] = [];
  const claimIdSet = new Set(claims.map(c => c.id));

  for (const community of communities) {
    const communityClaimIds = community.nodeIds.filter(id => claimIdSet.has(id));
    if (communityClaimIds.length === 0) continue;

    // Find dominant claim type in this community
    const typeCounts: Record<ClaimType, number> = {
      finding: 0,
      hypothesis: 0,
      recommendation: 0,
      observation: 0,
    };

    for (const claimId of communityClaimIds) {
      const claim = claims.find(c => c.id === claimId);
      if (claim) {
        typeCounts[claim.claimType]++;
      }
    }

    const dominantType = (Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
      "finding") as ClaimType;

    // Generate group name from entities in the community
    const entityNames: string[] = [];
    for (const nodeId of community.nodeIds) {
      try {
        const label = graph.getNodeAttribute(nodeId, "label");
        const type = graph.getNodeAttribute(nodeId, "type");
        if (type === "entity" && label) {
          entityNames.push(label);
        }
      } catch {
        // Node may not exist
      }
    }

    const groupName =
      entityNames.slice(0, 3).join(", ") || `Thème ${community.id + 1}`;

    groups.push({
      id: `community-${community.id}`,
      name: groupName,
      description: `${communityClaimIds.length} claims liés`,
      claimIds: communityClaimIds,
      communityId: community.id,
      importanceScore: communityClaimIds.length / claims.length,
      dominantClaimType: dominantType,
    });
  }

  return groups.sort((a, b) => b.importanceScore - a.importanceScore);
}

// ============================================================================
// AI SUMMARY GENERATION
// ============================================================================

async function generateAISummary(
  supabase: SupabaseClient,
  data: SynthesisData
): Promise<AISummaryResult> {
  const defaultResult: AISummaryResult = {
    executiveSummary: "",
    keyTakeaways: [],
    sectionOverviews: {
      problemSpace: "",
      findings: "",
      solutions: "",
      tensions: "",
      risks: "",
    },
  };

  try {
    const variables = {
      project_name: data.projectName,
      challenge_name: data.challengeName || "",
      participant_count: String(data.stats.totalParticipants),
      claim_count: String(data.stats.totalClaims),
      community_count: String(data.stats.communitiesDetected),
      problem_count: String(data.problems.length),
      problems_summary: data.problems
        .slice(0, 10)
        .map(p => `- [${p.severity}] ${p.content}`)
        .join("\n"),
      finding_count: String(data.findings.length),
      findings_summary: data.findings
        .slice(0, 10)
        .map(f => `- (${Math.round(f.evidenceStrength * 100)}%) ${f.statement}`)
        .join("\n"),
      recommendation_count: String(data.solutions.length),
      recommendations_summary: data.solutions
        .slice(0, 10)
        .map(s => `- (${Math.round(s.evidenceStrength * 100)}%) ${s.recommendation}`)
        .join("\n"),
      tension_count: String(data.tensions.length),
      tensions_summary: data.tensions
        .slice(0, 5)
        .map(t => `- "${t.claim1.statement}" VS "${t.claim2.statement}"`)
        .join("\n"),
      risk_count: String(data.risks.length),
      risks_summary: data.risks
        .slice(0, 5)
        .map(r => `- [${r.severity}] ${r.content}`)
        .join("\n"),
    };

    const result = await executeAgent({
      supabase,
      agentSlug: "rapport-narrative-synthesis",
      interactionType: "rapport.narrative.synthesis",
      variables,
    });

    if (!result?.content) {
      return defaultResult;
    }

    // Parse JSON response
    let jsonContent = result.content.trim();
    const jsonMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonContent = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonContent);

    return {
      executiveSummary: parsed.executive_summary || "",
      keyTakeaways: parsed.key_takeaways || [],
      sectionOverviews: {
        problemSpace: parsed.section_overviews?.problem_space || "",
        findings: parsed.section_overviews?.findings || "",
        solutions: parsed.section_overviews?.solutions || "",
        tensions: parsed.section_overviews?.tensions || "",
        risks: parsed.section_overviews?.risks || "",
      },
    };
  } catch (error) {
    console.error("[Narrative Synthesis] AI summary generation failed:", error);
    return defaultResult;
  }
}

// ============================================================================
// MARKDOWN ASSEMBLY
// ============================================================================

function assembleMarkdown(data: SynthesisData, aiSummary: AISummaryResult): string {
  const title = data.challengeName
    ? `Synthèse : ${data.projectName} - ${data.challengeName}`
    : `Synthèse : ${data.projectName}`;

  const date = new Date().toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  let md = `# ${title}\n\n`;
  md += `> Générée le ${date} • ${data.stats.totalParticipants} participants • ${data.stats.totalClaims} claims analysés\n\n`;

  // Executive Summary
  if (aiSummary.executiveSummary) {
    md += `## Résumé exécutif\n\n`;
    md += `${aiSummary.executiveSummary}\n\n`;

    if (aiSummary.keyTakeaways.length > 0) {
      md += `### Points clés\n\n`;
      for (const takeaway of aiSummary.keyTakeaways) {
        md += `- ${takeaway}\n`;
      }
      md += `\n`;
    }
    md += `---\n\n`;
  }

  // 1. Problem Space
  md += `## 1. Espace problème\n\n`;
  if (aiSummary.sectionOverviews.problemSpace) {
    md += `${aiSummary.sectionOverviews.problemSpace}\n\n`;
  }

  if (data.problems.length > 0) {
    for (const problem of data.problems.filter(p => p.type === "pain").slice(0, 15)) {
      const severityEmoji = getSeverityEmoji(problem.severity);
      md += `- ${severityEmoji} ${problem.content} _(${problem.severity}, ${problem.sourceCount} source${problem.sourceCount > 1 ? "s" : ""})_\n`;
    }
    md += `\n`;
  } else {
    md += `_Aucun problème identifié._\n\n`;
  }
  md += `---\n\n`;

  // 2. Key Findings
  md += `## 2. Découvertes clés\n\n`;
  if (aiSummary.sectionOverviews.findings) {
    md += `${aiSummary.sectionOverviews.findings}\n\n`;
  }

  if (data.findings.length > 0) {
    for (const finding of data.findings.slice(0, 15)) {
      const convergenceInfo = finding.convergenceCount > 0
        ? `, 👥 ${finding.convergenceCount + 1} participants`
        : "";
      md += `- ${finding.statement} _(${Math.round(finding.evidenceStrength * 100)}%${convergenceInfo})_\n`;
    }
    md += `\n`;
  } else {
    md += `_Aucune découverte identifiée._\n\n`;
  }
  md += `---\n\n`;

  // 3. Recommended Solutions
  md += `## 3. Solutions recommandées\n\n`;
  if (aiSummary.sectionOverviews.solutions) {
    md += `${aiSummary.sectionOverviews.solutions}\n\n`;
  }

  if (data.solutions.length > 0) {
    md += `| Priorité | Recommandation | Force | Convergence |\n`;
    md += `|----------|----------------|-------|-------------|\n`;
    for (let i = 0; i < Math.min(data.solutions.length, 10); i++) {
      const sol = data.solutions[i];
      const convergenceDisplay = sol.convergenceCount > 0
        ? `👥 ${sol.convergenceCount + 1}`
        : "1";
      md += `| ${i + 1} | ${sol.recommendation} | ${Math.round(sol.evidenceStrength * 100)}% | ${convergenceDisplay} |\n`;
    }
    md += `\n`;
  } else {
    md += `_Aucune recommandation identifiée._\n\n`;
  }
  md += `---\n\n`;

  // 4. Tensions
  md += `## 4. Tensions & arbitrages\n\n`;
  if (aiSummary.sectionOverviews.tensions) {
    md += `${aiSummary.sectionOverviews.tensions}\n\n`;
  }

  if (data.tensions.length > 0) {
    for (let i = 0; i < Math.min(data.tensions.length, 5); i++) {
      const tension = data.tensions[i];
      md += `### Tension ${i + 1}${tension.subject ? ` : ${tension.subject}` : ""}\n\n`;
      md += `| Position A | Position B |\n`;
      md += `|------------|------------|\n`;
      md += `| "${tension.claim1.statement}" | "${tension.claim2.statement}" |\n`;
      md += `| _${tension.claim1.author}_ | _${tension.claim2.author}_ |\n\n`;
      md += `**Confiance** : ${Math.round(tension.confidence * 100)}%\n\n`;
    }
  } else {
    md += `_Aucune tension identifiée._\n\n`;
  }
  md += `---\n\n`;

  // 5. Risks
  md += `## 5. Risques identifiés\n\n`;
  if (aiSummary.sectionOverviews.risks) {
    md += `${aiSummary.sectionOverviews.risks}\n\n`;
  }

  if (data.risks.length > 0) {
    md += `| Sévérité | Risque | Sources |\n`;
    md += `|----------|--------|--------|\n`;
    for (const risk of data.risks.slice(0, 10)) {
      const severityEmoji = getSeverityEmoji(risk.severity);
      md += `| ${severityEmoji} ${risk.severity.charAt(0).toUpperCase() + risk.severity.slice(1)} | ${risk.content} | ${risk.sourceCount} |\n`;
    }
    md += `\n`;
  } else {
    md += `_Aucun risque identifié._\n\n`;
  }
  md += `---\n\n`;

  // Appendix: Statistics
  md += `## Annexe : Statistiques\n\n`;
  md += `- **Claims analysés** : ${data.stats.totalClaims} (findings: ${data.findings.length}, recommendations: ${data.solutions.length})\n`;
  md += `- **Insights sources** : ${data.stats.totalInsights}\n`;
  md += `- **Participants** : ${data.stats.totalParticipants}\n`;
  md += `- **Communautés thématiques** : ${data.stats.communitiesDetected}\n`;
  md += `- **Taux de consensus** : ${Math.round(data.stats.consensusRate * 100)}%\n`;
  md += `- **Taux de tension** : ${Math.round(data.stats.tensionRate * 100)}%\n`;

  return md;
}

// ============================================================================
// HELPERS
// ============================================================================

function mapRowToSynthesis(row: any): ProjectSynthesis {
  return {
    id: row.id,
    projectId: row.project_id,
    challengeId: row.challenge_id,
    markdownContent: row.markdown_content,
    metadata: row.metadata,
    version: row.version,
    generatedAt: row.generated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRowToClaim(row: any): Claim {
  return {
    id: row.id,
    projectId: row.project_id,
    challengeId: row.challenge_id,
    statement: row.statement,
    claimType: row.claim_type,
    evidenceStrength: row.evidence_strength,
    confidence: row.confidence,
    sourceInsightIds: row.source_insight_ids,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function calculateSeverity(evidenceStrength: number): "low" | "medium" | "high" | "critical" {
  if (evidenceStrength >= 0.9) return "critical";
  if (evidenceStrength >= 0.7) return "high";
  if (evidenceStrength >= 0.4) return "medium";
  return "low";
}

function severityOrder(severity: string): number {
  switch (severity) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function getSeverityEmoji(severity: string): string {
  switch (severity) {
    case "critical":
      return "🔴";
    case "high":
      return "🟠";
    case "medium":
      return "🟡";
    case "low":
      return "🟢";
    default:
      return "⚪";
  }
}
