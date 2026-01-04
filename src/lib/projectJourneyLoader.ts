import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type ProjectAskOverview,
  type ProjectAskParticipant,
  type ProjectChallengeNode,
  type ProjectJourneyBoardData,
  type ProjectMember,
  type ProjectParticipantInsight,
  type ProjectParticipantOption,
  type ProjectParticipantSummary,
} from "@/types";
import { buildParticipantName } from "./ask-session-loader";

const IMPACT_LEVELS: ProjectChallengeNode["impact"][] = ["low", "medium", "high", "critical"];

const COMPLETED_INSIGHT_STATUSES = new Set(["implemented", "archived", "resolved", "closed"]);

const INSIGHT_TYPE_FALLBACK: ProjectParticipantInsight["type"] = "signal";

function normalizeImpact(priority?: string | null): ProjectChallengeNode["impact"] {
  if (!priority) {
    return "medium";
  }

  const normalized = priority.toLowerCase();
  if ((IMPACT_LEVELS as string[]).includes(normalized)) {
    return normalized as ProjectChallengeNode["impact"];
  }

  return "medium";
}

function normalizeInsightType(value?: string | null): ProjectParticipantInsight["type"] {
  if (!value) {
    return INSIGHT_TYPE_FALLBACK;
  }
  const normalized = value.toLowerCase();
  switch (normalized) {
    case "pain":
    case "gain":
    case "signal":
    case "idea":
      return normalized;
    default:
      return INSIGHT_TYPE_FALLBACK;
  }
}

function formatTimeframe(startDate?: string | null, endDate?: string | null): string | null {
  if (!startDate && !endDate) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
  });

  const safeStart = startDate ? new Date(startDate) : null;
  const safeEnd = endDate ? new Date(endDate) : null;

  const startLabel = safeStart && !Number.isNaN(safeStart.getTime()) ? formatter.format(safeStart) : null;
  const endLabel = safeEnd && !Number.isNaN(safeEnd.getTime()) ? formatter.format(safeEnd) : null;

  if (startLabel && endLabel) {
    return `${startLabel} – ${endLabel}`;
  }
  return startLabel ?? endLabel;
}

function initialsFromName(name: string): string {
  if (!name || typeof name !== "string") {
    return "??";
  }
  const parts = name.trim().split(/\s+/);
  if (!parts || parts.length === 0) {
    return "??";
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
}

function wouldCreateCycle(
  childId: string,
  candidateParentId: string,
  actualParentMap: Map<string, string | null>,
): boolean {
  if (childId === candidateParentId) {
    return true;
  }

  let currentId: string | null = candidateParentId;

  while (currentId) {
    if (currentId === childId) {
      return true;
    }

    const nextParentId: string | null = actualParentMap.get(currentId) ?? null;
    if (!nextParentId) {
      break;
    }

    currentId = nextParentId;
  }

  return false;
}

function buildChallengeTree(
  rows: any[],
  relatedInsightMap: Map<string, string[]>,
  ownerMap: Map<string, ProjectParticipantSummary>,
): ProjectChallengeNode[] {
  const nodeMap = new Map<string, ProjectChallengeNode & { children: ProjectChallengeNode[] }>();
  const requestedParentMap = new Map<string, string | null>();
  const actualParentMap = new Map<string, string | null>();
  const skippedCircularParents: string[] = [];

  for (const row of rows) {
    const owners: ProjectParticipantSummary[] = [];
    const assignedId = row.assigned_to ? String(row.assigned_to) : null;
    if (assignedId) {
      const owner = ownerMap.get(assignedId);
      if (owner) {
        owners.push(owner);
      }
    }

    const node: ProjectChallengeNode & { children: ProjectChallengeNode[] } = {
      id: row.id,
      title: row.name || "Untitled Challenge",
      description: row.description ?? "",
      status: row.status ?? "open",
      impact: normalizeImpact(row.priority),
      owners,
      relatedInsightIds: relatedInsightMap.get(row.id) ?? [],
      children: [],
      aiAskSuggestions: row.ai_ask_suggestions ?? null,
    };

    nodeMap.set(node.id, node);
    requestedParentMap.set(node.id, row.parent_challenge_id ?? null);
    actualParentMap.set(node.id, null);
  }

  for (const row of rows) {
    const node = nodeMap.get(row.id);
    if (!node) {
      continue;
    }

    const parentId = requestedParentMap.get(row.id);
    if (!parentId) {
      continue;
    }

    const parentNode = nodeMap.get(parentId);
    if (!parentNode) {
      continue;
    }

    if (wouldCreateCycle(node.id, parentId, actualParentMap)) {
      skippedCircularParents.push(row.id);
      continue;
    }

    parentNode.children = parentNode.children ? [...parentNode.children, node] : [node];
    actualParentMap.set(node.id, parentId);
  }

  if (skippedCircularParents.length > 0) {
    console.warn(
      `Detected circular challenge hierarchy while building journey data. Rendering the affected challenges as roots: ${skippedCircularParents.join(", ")}`,
    );
  }

  const roots: ProjectChallengeNode[] = [];
  nodeMap.forEach(node => {
    if (!actualParentMap.get(node.id)) {
      roots.push(node);
    }
  });

  return roots;
}

function getProfileFromRow(
  row: any,
): { id?: string | null; first_name?: string | null; last_name?: string | null; full_name?: string | null; email?: string | null; role?: string | null; job_title?: string | null; description?: string | null } | null {
  if (row.profiles && typeof row.profiles === "object") {
    return row.profiles;
  }

  if (row.users && typeof row.users === "object") {
    return row.users;
  }

  return null;
}

function resolveParticipantId(row: any): string {
  const userId = row?.user_id ?? getProfileFromRow(row)?.id ?? null;
  if (userId) {
    return String(userId);
  }

  return String(row.id);
}

function buildParticipantSummary(row: any): ProjectParticipantSummary {
  const profile = getProfileFromRow(row);
  // Use centralized buildParticipantName with proper fallback chain:
  // participant_name > full_name > email > participant_email > generated ID
  const name = buildParticipantName(
    row.participant_name || profile?.full_name || null,
    profile?.email || row.participant_email || null,
    resolveParticipantId(row)
  );

  const role = row.role ?? profile?.role ?? undefined;
  // Priority: project-specific > client-specific > global job title
  const jobTitle = row.job_title ?? profile?.job_title ?? undefined;

  return {
    id: resolveParticipantId(row),
    name,
    role,
    jobTitle: jobTitle || undefined,
  };
}

function mapParticipant(row: any): ProjectAskParticipant {
  const summary = buildParticipantSummary(row);
  const participantId = resolveParticipantId(row);
  return {
    id: participantId,
    userId: row.user_id ? String(row.user_id) : null,
    name: summary.name,
    role: summary.role ?? "participant",
    avatarInitials: initialsFromName(summary.name),
    avatarColor: undefined,
    inviteToken: row.invite_token ?? null,
    insights: [],
  };
}

function buildInsight(
  row: any,
  relatedChallenges: string[],
  contributor?: ProjectParticipantSummary,
): ProjectParticipantInsight {
  const title = row.summary?.trim() || row.content?.slice(0, 80) || "Insight";
  return {
    id: row.id,
    title,
    type: normalizeInsightType(row.insight_types?.name || row.insight_type_id),
    description: row.content ?? row.summary ?? "",
    updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
    isCompleted: COMPLETED_INSIGHT_STATUSES.has((row.status ?? "").toLowerCase()),
    relatedChallengeIds: relatedChallenges,
    kpis: [],
    contributors: contributor ? [contributor] : [],
  };
}

export interface ProjectJourneyContext {
  projectRow: any;
  challengeRows: any[];
  askRows: any[];
  insightRows: any[];
  challengeInsightRows: any[];
  ownerRows: any[];
  boardData: ProjectJourneyBoardData;
  ownerMap: Map<string, ProjectParticipantSummary>;
  relatedInsightMap: Map<string, string[]>;
  participantsByAskId: Map<string, ProjectAskParticipant[]>;
  insightsByAskId: Map<string, ProjectParticipantInsight[]>;
  availableUsers: Map<string, ProjectParticipantOption>;
}

export async function fetchProjectJourneyContext(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectJourneyContext> {
  console.log("🧩 Loader: Fetching project journey context", { projectId });

  const [projectResult, challengeResult, askResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, description, status, client_id, client:clients(name), start_date, end_date, system_prompt")
      .eq("id", projectId)
      .single(),
    supabase
      .from("challenges")
      .select(
        "id, name, description, status, priority, category, project_id, parent_challenge_id, assigned_to, due_date, system_prompt, ai_ask_suggestions",
      )
      .eq("project_id", projectId),
    supabase
      .from("ask_sessions")
      .select(
        "id, ask_key, name, question, description, status, start_date, end_date, challenge_id, project_id, conversation_mode",
      )
      .eq("project_id", projectId),
  ]);

  if (projectResult.error) {
    throw projectResult.error;
  }

  const projectRow = projectResult.data;
  if (!projectRow) {
    throw new Error("Project not found");
  }

  if (challengeResult.error) {
    throw challengeResult.error;
  }
  if (askResult.error) {
    throw askResult.error;
  }

  const challengeRows = challengeResult.data ?? [];
  const askRows = askResult.data ?? [];

  console.log("🧩 Loader: Primary entities fetched", {
    projectId,
    challengeCount: challengeRows.length,
    askCount: askRows.length,
  });

  const askIds = askRows.map(row => row.id);
  const challengeIds = challengeRows.map(row => row.id);

  const ownerIds = Array.from(
    new Set(
      challengeRows
        .map((row: any) => row.assigned_to)
        .filter((value: any): value is string => Boolean(value)),
    ),
  );

  const [participantResult, insightResult, challengeInsightResult, ownerResult, memberResult] = await Promise.all([
    askIds.length
      ? supabase
      .from("ask_participants")
      .select(
        "id, ask_session_id, user_id, participant_name, participant_email, role, is_spokesperson, invite_token, profiles(id, full_name, email, role, job_title)",
      )
      .in("ask_session_id", askIds)
      : Promise.resolve({ data: [], error: null }),
    askIds.length
      ? supabase
          .from("insights")
          .select("id, ask_session_id, user_id, content, summary, insight_type_id, status, updated_at, created_at, challenge_id, insight_types(name)")
          .in("ask_session_id", askIds)
      : Promise.resolve({ data: [], error: null }),
    challengeIds.length
      ? supabase
          .from("challenge_insights")
          .select("challenge_id, insight_id")
          .in("challenge_id", challengeIds)
      : Promise.resolve({ data: [], error: null }),
    ownerIds.length
      ? supabase
          .from("profiles")
          .select("id, full_name, email, role, job_title")
          .in("id", ownerIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("project_members")
      .select("user_id, role, job_title, description, profiles(id, first_name, last_name, full_name, email, role, job_title, description)")
      .eq("project_id", projectId),
  ]);
  
  // Also fetch insights that are directly linked to challenges (foundation insights)
  // These insights may not be associated with ASK sessions
  const challengeLinkedInsightIds = (challengeInsightResult.data ?? []).map(row => row.insight_id);
  const directInsightResult = challengeLinkedInsightIds.length
    ? await supabase
        .from("insights")
        .select("id, ask_session_id, user_id, content, summary, insight_type_id, status, updated_at, created_at, challenge_id, insight_types(name)")
        .in("id", challengeLinkedInsightIds)
    : { data: [], error: null };

  if (participantResult.error) {
    throw participantResult.error;
  }
  if (insightResult.error) {
    throw insightResult.error;
  }
  if (challengeInsightResult.error) {
    throw challengeInsightResult.error;
  }
  if (ownerResult.error) {
    throw ownerResult.error;
  }
  if (directInsightResult.error) {
    throw directInsightResult.error;
  }
  if (memberResult.error) {
    throw memberResult.error;
  }

  const participantRows = participantResult.data ?? [];
  const askInsightRows = insightResult.data ?? [];
  const directInsightRows = directInsightResult.data ?? [];
  
  // Merge ASK insights and direct insights, avoiding duplicates
  const insightRowsMap = new Map<string, any>();
  for (const row of askInsightRows) {
    insightRowsMap.set(row.id, row);
  }
  for (const row of directInsightRows) {
    if (!insightRowsMap.has(row.id)) {
      insightRowsMap.set(row.id, row);
    }
  }
  const insightRows = Array.from(insightRowsMap.values());
  
  console.log('📊 projectJourneyLoader: Insights loaded:', {
    fromAskSessions: askInsightRows.length,
    fromDirectLinks: directInsightRows.length,
    total: insightRows.length,
  });
  
  const challengeInsightRows = challengeInsightResult.data ?? [];
  const ownerRows = ownerResult.data ?? [];
  const memberRows = memberResult.data ?? [];

  console.log("🧩 Loader: Related entities fetched", {
    projectId,
    participantCount: participantRows.length,
    insightCount: insightRows.length,
    challengeInsightLinks: challengeInsightRows.length,
    ownerCount: ownerRows.length,
    projectMemberCount: memberRows.length,
  });

  const ownerMap = new Map<string, ProjectParticipantSummary>();
  for (const row of ownerRows) {
    ownerMap.set(row.id, {
      id: row.id,
      name: buildParticipantName(row.full_name, row.email, row.id),
      role: row.role ?? undefined,
      jobTitle: row.job_title ?? undefined,
    });
  }

  const relatedInsightMap = new Map<string, string[]>();
  for (const row of challengeInsightRows) {
    const list = relatedInsightMap.get(row.challenge_id) ?? [];
    if (!list.includes(row.insight_id)) {
      list.push(row.insight_id);
    }
    relatedInsightMap.set(row.challenge_id, list);
  }

  for (const row of insightRows) {
    if (!row.challenge_id || typeof row.challenge_id !== "string") {
      continue;
    }
    const list = relatedInsightMap.get(row.challenge_id) ?? [];
    if (!list.includes(row.id)) {
      list.push(row.id);
    }
    relatedInsightMap.set(row.challenge_id, list);
  }
  
  console.log('🗺️ projectJourneyLoader: relatedInsightMap built:', {
    totalChallenges: relatedInsightMap.size,
    challengesWithInsights: Array.from(relatedInsightMap.entries()).map(([id, insightIds]) => ({
      challengeId: id,
      insightCount: insightIds.length,
      insightIds,
    })),
  });

  const participantsByAskId = new Map<string, ProjectAskParticipant[]>();
  const participantSummaryByUserId = new Map<string, ProjectParticipantSummary>();
  const availableUsers = new Map<string, ProjectParticipantOption>();
  const profileCache = new Map<
    string,
    {
      name: string;
      role?: string | null;
      email?: string | null;
      jobTitle?: string | null;
    }
  >();

  ownerRows.forEach(row => {
    if (!row?.id) {
      return;
    }
    const ownerId = String(row.id);
    profileCache.set(ownerId, {
      name: buildParticipantName(row.full_name, row.email, ownerId),
      role: row.role ?? null,
      email: row.email ?? null,
      jobTitle: row.job_title ?? null,
    });
  });

  const memberUserIds = new Set<string>();
  memberRows.forEach(row => {
    const profile = getProfileFromRow(row);
    const rawUserId = row?.user_id ?? profile?.id ?? null;
    if (!rawUserId) {
      return;
    }

    const userId = String(rawUserId);
    memberUserIds.add(userId);

    if (profile) {
      profileCache.set(userId, {
        name: buildParticipantName(profile.full_name, profile.email, userId),
        role: profile.role ?? row.role ?? null,
        email: profile.email ?? null,
        jobTitle: profile.job_title ?? row.job_title ?? null,
      });
    } else if (!profileCache.has(userId)) {
      profileCache.set(userId, {
        name: buildParticipantName(null, null, userId),
        role: row.role ?? null,
        email: null,
        jobTitle: row.job_title ?? null,
      });
    }
  });

  const participantUserIds = new Set<string>();

  for (const row of participantRows) {
    const participant = mapParticipant(row);
    const list = participantsByAskId.get(row.ask_session_id) ?? [];
    list.push(participant);
    participantsByAskId.set(row.ask_session_id, list);

    if (row.user_id) {
      const userId = String(row.user_id);
      participantUserIds.add(userId);

      const summary = buildParticipantSummary(row);
      participantSummaryByUserId.set(userId, summary);
      if (!profileCache.has(userId)) {
        profileCache.set(userId, {
          name: summary.name,
          role: summary.role ?? row.role ?? null,
          email: row.participant_email ?? null,
          jobTitle: summary.jobTitle ?? null,
        });
      }

      availableUsers.set(userId, {
        id: userId,
        name: summary.name,
        role: summary.role ?? "participant",
        avatarInitials: initialsFromName(summary.name),
        avatarColor: undefined,
      });
    }
  }

  ownerMap.forEach((summary, userId) => {
    const normalizedId = String(userId);
    if (availableUsers.has(normalizedId)) {
      return;
    }
    availableUsers.set(normalizedId, {
      id: normalizedId,
      name: summary.name,
      role: summary.role ?? "owner",
      avatarInitials: initialsFromName(summary.name),
      avatarColor: undefined,
    });
  });

  const combinedUserIdSet = new Set<string>();
  memberUserIds.forEach(id => combinedUserIdSet.add(id));
  participantUserIds.forEach(id => combinedUserIdSet.add(id));

  const profileLookupsNeeded: string[] = [];
  combinedUserIdSet.forEach(userId => {
    if (!profileCache.has(userId)) {
      profileLookupsNeeded.push(userId);
    }
  });

  if (profileLookupsNeeded.length > 0) {
    const { data: profileRows, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, job_title")
      .in("id", profileLookupsNeeded);

    if (profileError) {
      throw profileError;
    }

    (profileRows ?? []).forEach(profileRow => {
      if (!profileRow?.id) {
        return;
      }
      const profileId = String(profileRow.id);
      profileCache.set(profileId, {
        name: buildParticipantName(profileRow.full_name, profileRow.email, profileId),
        role: profileRow.role ?? null,
        email: profileRow.email ?? null,
        jobTitle: profileRow.job_title ?? null,
      });
    });
  }

  memberRows.forEach(row => {
    const profile = getProfileFromRow(row);
    const rawUserId = row.user_id ?? profile?.id ?? null;
    if (!rawUserId) {
      return;
    }

    const userId = String(rawUserId);
    const cachedProfile = profileCache.get(userId);
    const name = cachedProfile?.name ?? buildParticipantName(profile?.full_name, profile?.email, userId);
    const role = cachedProfile?.role ?? row.role ?? profile?.role ?? "member";
    // Priority: project-specific > global job title
    const jobTitle = row.job_title ?? profile?.job_title ?? cachedProfile?.jobTitle ?? undefined;

    if (availableUsers.has(userId)) {
      const existing = availableUsers.get(userId)!;
      const normalizedName = (name || existing.name).trim() || existing.name;
      const summary = participantSummaryByUserId.get(userId);
      availableUsers.set(userId, {
        ...existing,
        name: normalizedName,
        role: role ?? existing.role,
        avatarInitials: initialsFromName(normalizedName),
      });
      // Update participant summary with job title if available
      if (summary) {
        participantSummaryByUserId.set(userId, {
          ...summary,
          jobTitle,
        });
      }
      return;
    }

    const summary = buildParticipantSummary({ ...row, job_title: jobTitle });
    availableUsers.set(userId, {
      id: userId,
      name,
      role,
      avatarInitials: initialsFromName(name),
      avatarColor: undefined,
    });
    participantSummaryByUserId.set(userId, summary);
  });

  console.log("🧩 Loader: Participant options prepared", {
    projectId,
    cachedProfiles: profileCache.size,
    participantOptions: availableUsers.size,
    participantUsersWithAccounts: participantUserIds.size,
    projectMemberUsers: memberUserIds.size,
  });

  const insightsByAskId = new Map<string, ProjectParticipantInsight[]>();
  const orphanInsights: ProjectParticipantInsight[] = [];

  for (const row of insightRows) {
    const contributor = row.user_id ? participantSummaryByUserId.get(String(row.user_id)) : undefined;
    const relatedChallenges = new Set<string>();

    if (row.challenge_id) {
      relatedChallenges.add(row.challenge_id);
    }

    const challengeIdsForInsight = challengeInsightRows
      .filter(item => item.insight_id === row.id)
      .map(item => item.challenge_id);
    challengeIdsForInsight.forEach(id => relatedChallenges.add(id));

    const insight = buildInsight(row, Array.from(relatedChallenges), contributor);
    
    // If insight has an ASK session, add it to that ASK
    if (row.ask_session_id) {
      const list = insightsByAskId.get(row.ask_session_id) ?? [];
      list.push(insight);
      insightsByAskId.set(row.ask_session_id, list);
    } else {
      // If no ASK session, keep it as orphan (foundation insight)
      orphanInsights.push(insight);
    }
  }
  
  console.log('📊 projectJourneyLoader: Insights organization:', {
    insightsWithAsk: Array.from(insightsByAskId.values()).flat().length,
    orphanInsights: orphanInsights.length,
  });

  participantsByAskId.forEach((participants, askId) => {
    const askInsights = insightsByAskId.get(askId) ?? [];

    participants.forEach(participant => {
      const matchingInsights = askInsights.filter(insight =>
        insight.contributors?.some(contributor => contributor.id === participant.id || contributor.name === participant.name),
      );

      participant.insights = matchingInsights.length > 0 ? matchingInsights : askInsights;
    });
  });

  const challengeNodes = buildChallengeTree(challengeRows, relatedInsightMap, ownerMap);

  console.log("🧩 Loader: Challenge tree built", {
    projectId,
    rootChallenges: challengeNodes.length,
  });

  const askOverviews: ProjectAskOverview[] = askRows.map(row => {
    const participants = participantsByAskId.get(row.id) ?? [];
    const askInsights = insightsByAskId.get(row.id) ?? [];

    const primaryChallengeId = row.challenge_id ? String(row.challenge_id) : null;
    const originatingChallengeIds = new Set<string>();
    if (primaryChallengeId) {
      originatingChallengeIds.add(primaryChallengeId);
    }

    const relatedChallengeIds = new Set<string>();
    askInsights.forEach(insight => {
      insight.relatedChallengeIds.forEach(id => relatedChallengeIds.add(id));
    });

    return {
      id: row.id,
      askKey: row.ask_key ?? row.id,
      title: row.name || row.ask_key,
      summary: row.description ?? row.question ?? "",
      status: row.status ?? "active",
      theme: "General",
      dueDate: row.end_date ?? row.start_date ?? new Date().toISOString(),
      conversationMode: row.conversation_mode ?? null,
      originatingChallengeIds: Array.from(originatingChallengeIds),
      primaryChallengeId,
      relatedChallengeIds: Array.from(relatedChallengeIds),
      relatedProjects: [{ id: projectId, name: projectRow.name }],
      participants,
      insights: askInsights,
    };
  });
  
  // Create synthetic ASK session for orphan insights (foundation insights without ASK)
  if (orphanInsights.length > 0) {
    const orphanChallengeIds = new Set<string>();
    orphanInsights.forEach(insight => {
      insight.relatedChallengeIds.forEach(id => orphanChallengeIds.add(id));
    });
    
    // Create a synthetic participant for foundation insights
    const syntheticParticipant: ProjectAskParticipant = {
      id: 'foundation-insights-participant',
      userId: null,
      name: 'Foundation Insights',
      role: 'system',
      avatarInitials: 'FI',
      avatarColor: undefined,
      insights: orphanInsights,
    };
    
    const syntheticAsk: ProjectAskOverview = {
      id: 'foundation-insights-ask',
      askKey: 'foundation-insights',
      title: 'Foundation Insights',
      summary: 'Insights directly linked to challenges without ASK sessions',
      status: 'completed',
      theme: 'Foundation',
      dueDate: new Date().toISOString(),
      originatingChallengeIds: Array.from(orphanChallengeIds),
      primaryChallengeId: null,
      relatedChallengeIds: Array.from(orphanChallengeIds),
      relatedProjects: [{ id: projectId, name: projectRow.name }],
      participants: [syntheticParticipant],
      insights: orphanInsights,
    };
    
    askOverviews.push(syntheticAsk);
    
    console.log('✨ projectJourneyLoader: Created synthetic ASK for orphan insights:', {
      askId: syntheticAsk.id,
      insightCount: orphanInsights.length,
      challengeIds: Array.from(orphanChallengeIds),
    });
  }

  const clientRelation = (projectRow as { client?: any }).client;
  const clientName = Array.isArray(clientRelation)
    ? clientRelation[0]?.name ?? null
    : clientRelation?.name ?? null;

  // Build project members array from memberRows
  const projectMembers: ProjectMember[] = memberRows.map(row => {
    const profile = getProfileFromRow(row);
    return {
      id: String(row.user_id ?? profile?.id ?? ""),
      firstName: profile?.first_name ?? null,
      lastName: profile?.last_name ?? null,
      fullName: profile?.full_name ?? null,
      email: profile?.email ?? null,
      role: row.role ?? profile?.role ?? null,
      jobTitle: row.job_title ?? profile?.job_title ?? null,
      // Priority: project-specific description > global profile description
      description: row.description ?? profile?.description ?? null,
    };
  }).filter(member => member.id !== "").sort((a, b) => {
    const nameA = (a.fullName || a.email || "").toLowerCase();
    const nameB = (b.fullName || b.email || "").toLowerCase();
    return nameA.localeCompare(nameB);
  });

  const boardData: ProjectJourneyBoardData = {
    projectId,
    projectName: projectRow.name,
    clientId: projectRow.client_id ?? null,
    clientName,
    projectGoal: projectRow.description ?? null,
    timeframe: formatTimeframe(projectRow.start_date, projectRow.end_date),
    projectDescription: projectRow.description ?? null,
    projectStatus: projectRow.status ?? null,
    projectStartDate: projectRow.start_date ?? null,
    projectEndDate: projectRow.end_date ?? null,
    projectSystemPrompt: projectRow.system_prompt ?? null,
    asks: askOverviews,
    challenges: challengeNodes,
    availableUsers: Array.from(availableUsers.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    ),
    projectMembers,
  };

  console.log("🧩 Loader: Board data assembled", {
    projectId,
    challengeCount: boardData.challenges.length,
    askCount: boardData.asks.length,
    availableUsers: boardData.availableUsers.length,
  });

  return {
    projectRow,
    challengeRows,
    askRows,
    insightRows,
    challengeInsightRows,
    ownerRows,
    boardData,
    ownerMap,
    relatedInsightMap,
    participantsByAskId,
    insightsByAskId,
    availableUsers,
  };
}

/**
 * Flatten a nested challenge tree into a single array.
 * Used by ask-generator and challenge-builder to find specific challenges.
 */
export function flattenChallengeTree(nodes: ProjectChallengeNode[]): ProjectChallengeNode[] {
  return nodes.flatMap(node => [node, ...(node.children ? flattenChallengeTree(node.children) : [])]);
}

/**
 * Build insight summaries for a specific challenge from the project board data.
 * Used by ask-generator to provide context about existing insights.
 */
export function buildInsightSummaries(boardData: ProjectJourneyBoardData, challengeId: string) {
  const summaries = new Map<string, Record<string, unknown>>();

  boardData.asks.forEach(ask => {
    ask.insights.forEach(insight => {
      if (!insight.relatedChallengeIds.includes(challengeId)) {
        return;
      }

      const existing = summaries.get(insight.id);
      const baseContributors = (insight.contributors ?? []).map(contributor => ({
        id: contributor.id,
        name: contributor.name,
        role: contributor.role ?? null,
      }));

      if (existing) {
        const seen = new Set((existing.contributors as Array<{ id?: string; name?: string }>)?.map(item => item.id ?? item.name));
        const mergedContributors = [...(existing.contributors as Array<{ id?: string; name?: string; role?: string | null }> ?? [])];
        baseContributors.forEach(contributor => {
          const key = contributor.id ?? contributor.name;
          if (key && !seen.has(key)) {
            seen.add(key);
            mergedContributors.push(contributor);
          }
        });
        existing.contributors = mergedContributors;
        summaries.set(insight.id, existing);
        return;
      }

      summaries.set(insight.id, {
        id: insight.id,
        title: insight.title,
        type: insight.type,
        description: insight.description,
        isCompleted: insight.isCompleted,
        askId: ask.id,
        askKey: ask.askKey,
        askTitle: ask.title,
        contributors: baseContributors,
      });
    });
  });

  return Array.from(summaries.values());
}

/**
 * Build all variables needed for ask-generator agent.
 * Used by both production route and test mode to ensure consistency (DRY).
 */
export function buildAskGeneratorVariables(
  boardData: ProjectJourneyBoardData,
  targetChallenge: ProjectChallengeNode,
  insightSummaries: Record<string, unknown>[],
  existingAsks: Record<string, unknown>[],
) {
  const challengeContext = {
    project: {
      id: boardData.projectId,
      name: boardData.projectName,
      goal: boardData.projectGoal,
      status: boardData.projectStatus,
      timeframe: boardData.timeframe,
      description: boardData.projectDescription,
    },
    challenge: {
      id: targetChallenge.id,
      title: targetChallenge.title,
      description: targetChallenge.description,
      status: targetChallenge.status,
      impact: targetChallenge.impact,
      owners: targetChallenge.owners ?? [],
      relatedInsightCount: insightSummaries.length,
      existingAskCount: existingAsks.length,
    },
    insights: insightSummaries,
    existingAsks,
  };

  return {
    // Project variables
    project_name: boardData.projectName,
    project_goal: boardData.projectGoal ?? "",
    project_status: boardData.projectStatus ?? "",
    project_description: boardData.projectDescription ?? "",
    system_prompt_project: boardData.projectSystemPrompt ?? "",
    // Challenge variables (both naming conventions for template compatibility)
    challenge_id: targetChallenge.id,
    challenge_title: targetChallenge.title,
    challenge_name: targetChallenge.title, // Alias for templates using challenge_name
    challenge_description: targetChallenge.description ?? "",
    challenge_status: targetChallenge.status ?? "",
    challenge_impact: targetChallenge.impact ?? "",
    system_prompt_challenge: "",
    // Context JSON
    challenge_context_json: JSON.stringify(challengeContext),
    insights_json: JSON.stringify(insightSummaries),
    existing_asks_json: JSON.stringify(existingAsks),
    // Project members for participant recommendations
    project_members_json: JSON.stringify(boardData.projectMembers.map(m => ({
      id: m.id,
      name: m.fullName ?? m.email ?? 'Inconnu',
      role: m.role,
      jobTitle: m.jobTitle,
      description: m.description,
    }))),
    current_date: new Date().toISOString(),
  };
}

/**
 * Build existing ASK summaries for a specific challenge from the project board data.
 * Used by ask-generator to understand what ASKs already exist for this challenge.
 */
export function buildExistingAskSummaries(
  boardData: ProjectJourneyBoardData,
  challengeId: string,
  askRows: any[],
) {
  const askRowById = new Map<string, any>();
  askRows.forEach(row => {
    if (row?.id) {
      askRowById.set(row.id, row);
    }
  });

  return boardData.asks
    .filter(ask => {
      const directIds = new Set<string>();
      if (ask.primaryChallengeId) {
        directIds.add(ask.primaryChallengeId);
      }
      ask.originatingChallengeIds?.forEach(id => {
        if (id) {
          directIds.add(id);
        }
      });
      return directIds.has(challengeId);
    })
    .map(ask => {
      const raw = askRowById.get(ask.id) ?? {};
      return {
        id: ask.id,
        askKey: ask.askKey,
        title: ask.title,
        status: ask.status,
        summary: ask.summary,
        question: raw.question ?? null,
        description: raw.description ?? null,
        startDate: raw.start_date ?? null,
        endDate: raw.end_date ?? null,
        participants: ask.participants.map(participant => ({
          id: participant.id,
          name: participant.name,
          role: participant.role,
          isSpokesperson: participant.role?.toLowerCase() === "spokesperson",
        })),
        insights: ask.insights
          .filter(insight => insight.relatedChallengeIds.includes(challengeId))
          .map(insight => ({
            id: insight.id,
            title: insight.title,
            type: insight.type,
            isCompleted: insight.isCompleted,
          })),
      } satisfies Record<string, unknown>;
    });
}
