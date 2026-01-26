import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/nextjs';
import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse, Insight, Message } from '@/types';
import { getAdminSupabaseClient } from '@/lib/supabaseAdmin';

// Extend timeout for LLM calls (chat response + insight detection)
export const maxDuration = 60;
import { createServerSupabaseClient, getCurrentUser } from '@/lib/supabaseServer';
import { isValidAskKey, parseErrorMessage } from '@/lib/utils';
import { getAskSessionByKey, getOrCreateConversationThread, getMessagesForThread, shouldUseSharedThread } from '@/lib/asks';
import { normaliseMessageMetadata } from '@/lib/messages';
import { executeAgent, fetchAgentBySlug, type AgentExecutionResult } from '@/lib/ai';
import { INSIGHT_TYPES, mapInsightRowToInsight, type InsightRow } from '@/lib/insights';
import { fetchInsightRowById, fetchInsightsForSession, fetchInsightsForThread, fetchInsightTypeMap, fetchInsightTypesForPrompt } from '@/lib/insightQueries';
import { detectStepCompletion, completeStep, getConversationPlanWithSteps, getActiveStep, getCurrentStep, ensureConversationPlanExists } from '@/lib/ai/conversation-plan';
import { handleSubtopicSignals, cleanAllSignalMarkers } from '@/lib/ai/conversation-signals';
import { buildConversationAgentVariables } from '@/lib/ai/conversation-agent';
import {
  buildParticipantDisplayName,
  buildMessageSenderName,
  fetchElapsedTime,
  insertAiMessage,
  type AskSessionRow,
  type UserRow,
  type ParticipantRow,
  type ProjectRow,
  type ChallengeRow,
  type MessageRow,
} from '@/lib/conversation-context';

const CHAT_AGENT_SLUG = 'ask-conversation-response';
const INSIGHT_AGENT_SLUG = 'ask-insight-detection';
const CHAT_INTERACTION_TYPE = 'ask.chat.response';
const INSIGHT_INTERACTION_TYPE = 'ask.insight.detection';

function parseAgentJsonSafely(rawText: string): unknown | null {
  const attempts: string[] = [];
  const trimmed = rawText.trim();
  if (!trimmed) {
    return null;
  }

  attempts.push(trimmed);

  // Try to extract JSON from code fences (```json ... ``` or ``` ... ```)
  // Handle both single-line and multi-line code blocks
  let jsonStr = trimmed;
  if (jsonStr.startsWith("```json")) {
    jsonStr = jsonStr.replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
    attempts.push(jsonStr.trim());
  } else if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```\s*/i, "").replace(/\s*```$/i, "");
    attempts.push(jsonStr.trim());
  }

  // Also try regex-based extraction (more flexible for nested structures)
  const codeFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeFenceMatch && codeFenceMatch[1]) {
    const extracted = codeFenceMatch[1].trim();
    if (!attempts.includes(extracted)) {
      attempts.push(extracted);
    }
    // Also try to extract JSON from the extracted content
    const bracketCandidate = extractBracketedJson(extracted);
    if (bracketCandidate && !attempts.includes(bracketCandidate)) {
      attempts.push(bracketCandidate);
    }
  }

  // Try to extract JSON from the original text
  const bracketCandidate = extractBracketedJson(trimmed);
  if (bracketCandidate && !attempts.includes(bracketCandidate)) {
    attempts.push(bracketCandidate);
  }

  // Try to find any JSON object in the text (more permissive)
  const jsonObjectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch && !attempts.includes(jsonObjectMatch[0])) {
    attempts.push(jsonObjectMatch[0]);
  }

  for (const candidate of attempts) {
    const parsed = safeJsonParse(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function extractBracketedJson(value: string): string | null {
  const candidates: Array<{ start: number; opener: string; closer: string }> = [];

  const pushCandidate = (char: '[' | '{') => {
    const index = value.indexOf(char);
    if (index !== -1) {
      candidates.push({
        start: index,
        opener: char,
        closer: char === '{' ? '}' : ']',
      });
    }
  };

  pushCandidate('[');
  pushCandidate('{');

  for (const candidate of candidates) {
    const end = findMatchingBracket(value, candidate.start, candidate.opener, candidate.closer);
    if (end !== -1) {
      return value.slice(candidate.start, end + 1).trim();
    }
  }

  return null;
}

function findMatchingBracket(value: string, start: number, opener: string, closer: string): number {
  let depth = 0;
  let inString: false | '"' | '\'' = false;
  let isEscaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (char === '\\') {
        isEscaped = true;
        continue;
      }

      if (char === inString) {
        inString = false;
      }

      continue;
    }

    if (char === '"' || char === '\'') {
      inString = char;
      continue;
    }

    if (char === opener) {
      depth += 1;
    } else if (char === closer) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function safeJsonParse(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractTextFromRawResponse(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const record = raw as Record<string, unknown>;

  // Handle Anthropic API response structure: { content: [{ type: "text", text: "..." }] }
  if (Array.isArray(record.content)) {
    const text = record.content
      .map(block => {
        if (!block) return '';
        if (typeof block === 'string') return block;
        const entry = block as Record<string, unknown>;
        // Anthropic uses { type: "text", text: "..." }
        if (typeof entry.text === 'string') {
          return entry.text;
        }
        if (Array.isArray(entry.content)) {
          return entry.content
            .map(inner => {
              if (!inner) return '';
              if (typeof inner === 'string') return inner;
              if (typeof (inner as any).text === 'string') return (inner as any).text;
              return '';
            })
            .join('');
        }
        return '';
      })
      .join('')
      .trim();

    if (text.length > 0) {
      return text;
    }
  }

  // Handle simple string content
  if (typeof record.content === 'string' && record.content.trim().length > 0) {
    return record.content.trim();
  }

  // Handle OpenAI-style choices structure
  const choices = Array.isArray((record as any).choices) ? (record as any).choices : [];
  for (const choice of choices) {
    const message = choice?.message;
    if (message && typeof message.content === 'string' && message.content.trim().length > 0) {
      return message.content.trim();
    }
  }

  return null;
}

interface InsightJobRow {
  id: string;
  ask_session_id: string;
  status: string;
  attempts: number;
  started_at?: string | null;
}

type IncomingInsight = {
  id?: string;
  askSessionId?: string;
  content?: string;
  summary?: string;
  type?: string;
  category?: string;
  status?: string;
  priority?: string;
  challengeId?: string | null;
  authorId?: string | null;
  authorName?: string | null;
  relatedChallengeIds?: string[];
  kpis?: Array<Record<string, unknown>>;
  sourceMessageId?: string | null;
  authors?: unknown;
  action?: string;
  mergedIntoId?: string | null;
  duplicateOfId?: string | null;
};

type NormalisedIncomingAuthor = {
  userId: string | null;
  name: string | null;
};

type NormalisedIncomingInsight = IncomingInsight & {
  authors: NormalisedIncomingAuthor[];
  authorsProvided: boolean;
};

// buildParticipantDisplayName imported from @/lib/conversation-context

function normaliseInsightTypeName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

function resolveInsightTypeId(
  typeName: string | null,
  typeMap: Record<string, string>,
): string {
  const normalised = typeName ? typeName.trim().toLowerCase() : null;

  if (normalised && typeMap[normalised]) {
    return typeMap[normalised];
  }

  if (typeMap.idea) {
    return typeMap.idea;
  }

  const [fallbackId] = Object.values(typeMap);
  if (fallbackId) {
    return fallbackId;
  }

  throw new Error('No insight types configured');
}

async function replaceInsightAuthors(
  supabase: ReturnType<typeof getAdminSupabaseClient>,
  insightId: string,
  authors: NormalisedIncomingAuthor[],
  currentUserId?: string | null,
) {
  const { error: deleteError } = await supabase
    .from('insight_authors')
    .delete()
    .eq('insight_id', insightId);

  if (deleteError) {
    throw deleteError;
  }

  // Filtrer les auteurs valides : doivent avoir un user_id qui correspond à un profil existant
  const validUserIds = new Set<string>();
  
  // Récupérer tous les user_ids uniques des auteurs
  const authorUserIds = authors
    .map(a => a.userId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  // Vérifier que ces user_ids correspondent à des profils existants et actifs
  if (authorUserIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id')
      .in('id', authorUserIds)
      .eq('is_active', true);

    if (profilesError) {
      throw profilesError;
    }

    (profiles ?? []).forEach(profile => {
      validUserIds.add(profile.id);
    });
  }

  // Si un currentUserId est fourni, l'ajouter aux IDs valides
  if (currentUserId && typeof currentUserId === 'string') {
    const { data: currentUserProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', currentUserId)
      .eq('is_active', true)
      .single();

    if (currentUserProfile) {
      validUserIds.add(currentUserId);
    }
  }

  type InsightAuthorInsert = {
    insight_id: string;
    user_id: string | null;
    display_name: string | null;
  };

  const rows = authors.reduce<InsightAuthorInsert[]>((acc, author) => {
    const userId = typeof author.userId === 'string' && author.userId ? author.userId : null;
    
    // Ne garder que les auteurs avec un user_id valide qui correspond à un profil
    if (!userId || !validUserIds.has(userId)) {
      return acc;
    }

    // Récupérer le nom du profil pour l'afficher
    // On ne stocke pas le display_name car on veut toujours utiliser le nom du profil
    acc.push({
      insight_id: insightId,
      user_id: userId,
      display_name: null, // Toujours null, on récupère le nom depuis le profil
    });

    return acc;
  }, []);

  // Si aucun auteur valide mais qu'on a un currentUserId, l'utiliser comme auteur par défaut
  if (rows.length === 0 && currentUserId && validUserIds.has(currentUserId)) {
    rows.push({
      insight_id: insightId,
      user_id: currentUserId,
      display_name: null,
    });
  }

  if (rows.length === 0) {
    return;
  }

  const { error: insertError } = await supabase
    .from('insight_authors')
    .insert(rows);

  if (insertError) {
    throw insertError;
  }
}

function normaliseIncomingKpis(kpis: unknown, fallback: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (!Array.isArray(kpis)) {
    return fallback;
  }

  return kpis.map((kpi, index) => {
    const raw = typeof kpi === 'object' && kpi !== null ? (kpi as Record<string, unknown>) : {};
    const providedId = typeof raw.id === 'string' && raw.id.trim().length > 0 ? raw.id : undefined;

    return {
      id: providedId ?? randomUUID(),
      label: typeof raw.label === 'string' && raw.label.trim().length > 0 ? raw.label : `KPI ${index + 1}`,
      value: raw.value ?? null,
      description: typeof raw.description === 'string' && raw.description.trim().length > 0 ? raw.description : null,
    } satisfies Record<string, unknown>;
  });
}

function parseIncomingAuthor(value: unknown, currentUserId?: string | null): NormalisedIncomingAuthor | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

  const getString = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const raw = record[key];
      if (typeof raw === 'string' && raw.trim().length > 0) {
        return raw;
      }
    }
    return undefined;
  };

  const userId = getString('userId', 'user_id', 'authorId', 'author_id');
  let name = getString('name', 'authorName', 'author_name', 'displayName', 'display_name');

  // Rejeter les noms qui indiquent "vous" ou des agents
  const normalizedName = name?.toLowerCase().trim() ?? '';
  const isVous = normalizedName === 'vous' || normalizedName === 'you' || normalizedName === 'yourself';
  const isAgent = normalizedName === 'agent' || normalizedName === 'ai' || normalizedName === 'assistant' || 
                  normalizedName.includes('agent') || normalizedName.includes('ai');

  // Si c'est "vous" ou un agent, utiliser l'ID de l'utilisateur connecté
  if ((isVous || isAgent) && currentUserId) {
    return {
      userId: currentUserId,
      name: null, // Ne pas stocker "vous" ou "Agent" comme nom
    };
  }

  // Si c'est un agent sans ID utilisateur, rejeter
  if (isAgent && !currentUserId) {
    return null;
  }

  // Si c'est "vous" sans ID utilisateur, rejeter
  if (isVous && !currentUserId) {
    return null;
  }

  if (!userId && !name) {
    return null;
  }

  return {
    userId: userId ?? null,
    name: name ?? null,
  };
}

function normaliseIncomingInsights(value: unknown, currentUserId?: string | null): { types: Insight['type'][]; items: NormalisedIncomingInsight[] } {
  const envelope = (typeof value === 'object' && value !== null && !Array.isArray(value))
    ? (value as Record<string, unknown>)
    : {};

  const rawTypes = Array.isArray(envelope.types) ? envelope.types : [];
  const types = rawTypes
    .map(type => (typeof type === 'string' ? type.trim() : ''))
    .filter((type): type is Insight['type'] => INSIGHT_TYPES.includes(type as Insight['type']));

  const rawItems = (() => {
    if (Array.isArray(value)) {
      return value;
    }
    if (Array.isArray(envelope.items)) {
      return envelope.items;
    }
    if (Array.isArray(envelope.insights)) {
      return envelope.insights;
    }
    return [];
  })();

  const items: NormalisedIncomingInsight[] = rawItems.map((item) => {
    const record = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};

    const getString = (key: string): string | undefined => {
      const value = record[key];
      return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
    };

    const relatedChallengeIds = (() => {
      const candidate = record.relatedChallengeIds ?? record.related_challenge_ids;
      if (!Array.isArray(candidate)) {
        return undefined;
      }
      return candidate.map((id) => String(id));
    })();

    const kpis = record.kpis;

    const fallbackAuthorId = getString('authorId') ?? getString('author_id');
    const fallbackAuthorName = getString('authorName') ?? getString('author_name');

    const rawAuthors = record.authors;
    let authorsProvided = false;
    const authors: NormalisedIncomingAuthor[] = [];

    if (Array.isArray(rawAuthors)) {
      authorsProvided = true;
      for (const entry of rawAuthors) {
        const parsed = parseIncomingAuthor(entry, currentUserId);
        if (parsed) {
          authors.push(parsed);
        }
      }
    } else if (rawAuthors) {
      const parsed = parseIncomingAuthor(rawAuthors, currentUserId);
      if (parsed) {
        authorsProvided = true;
        authors.push(parsed);
      }
    }

    if (!authorsProvided && (fallbackAuthorId || fallbackAuthorName)) {
      // Vérifier si le nom de fallback est "vous" ou un agent
      const normalizedFallbackName = fallbackAuthorName?.toLowerCase().trim() ?? '';
      const isVous = normalizedFallbackName === 'vous' || normalizedFallbackName === 'you' || normalizedFallbackName === 'yourself';
      const isAgent = normalizedFallbackName === 'agent' || normalizedFallbackName === 'ai' || normalizedFallbackName === 'assistant' || 
                      normalizedFallbackName.includes('agent') || normalizedFallbackName.includes('ai');

      if ((isVous || isAgent) && currentUserId) {
        authorsProvided = true;
        authors.push({
          userId: currentUserId,
          name: null,
        });
      } else if (!isAgent && !isVous) {
        authorsProvided = true;
        authors.push({
          userId: fallbackAuthorId ?? null,
          name: fallbackAuthorName ?? null,
        });
      }
    }

    const primaryAuthor = authors[0] ?? null;

    const actionValue = getString('action');

    return {
      id: getString('id'),
      askSessionId: getString('askSessionId') ?? getString('ask_session_id'),
      content: getString('content'),
      summary: getString('summary'),
      type: getString('type'),
      category: getString('category'),
      status: getString('status'),
      priority: getString('priority'),
      challengeId: getString('challengeId') ?? getString('challenge_id') ?? null,
      authorId: fallbackAuthorId ?? primaryAuthor?.userId ?? null,
      authorName: fallbackAuthorName ?? primaryAuthor?.name ?? null,
      relatedChallengeIds,
      kpis: Array.isArray(kpis) ? (kpis as Array<Record<string, unknown>>) : undefined,
      sourceMessageId: getString('sourceMessageId') ?? getString('source_message_id') ?? null,
      authors,
      authorsProvided,
      action: actionValue ? actionValue.toLowerCase() : undefined,
      mergedIntoId: getString('mergedIntoId') ?? getString('merged_into_id') ?? getString('mergeTargetId') ?? null,
      duplicateOfId: getString('duplicateOfId') ?? getString('duplicate_of_id') ?? null,
    } satisfies NormalisedIncomingInsight;
  });

  return {
    types: types.length > 0 ? types : INSIGHT_TYPES,
    items,
  };
}

function sanitiseJsonString(raw: string): string {
  let trimmed = raw.trim();

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch && typeof fencedMatch[1] === 'string') {
    const candidate = fencedMatch[1].trim();
    const bracketed = extractBracketedJson(candidate);
    return bracketed ?? candidate;
  }

  const bracketed = extractBracketedJson(trimmed);
  if (bracketed) {
    return bracketed;
  }

  if (trimmed.startsWith('```')) {
    trimmed = trimmed.replace(/^```(?:json)?\s*/i, '');
  }
  if (trimmed.endsWith('```')) {
    trimmed = trimmed.slice(0, -3);
  }

  return trimmed.trim();
}

/**
 * Process embeddings for an insight (for future semantic search)
 * Note: Graph edges and claims are generated post-interview via generateParticipantGraph()
 */
async function processInsightEmbeddings(
  supabase: ReturnType<typeof getAdminSupabaseClient>,
  insightId: string,
  insightRow: InsightRow,
): Promise<void> {
  try {
    const { generateEmbedding } = await import('@/lib/ai/embeddings');
    const { mapInsightRowToInsight } = await import('@/lib/insights');

    const insight = mapInsightRowToInsight(insightRow);

    // Generate embeddings for future semantic search
    const [contentEmbedding, summaryEmbedding] = await Promise.all([
      insight.content ? generateEmbedding(insight.content).catch((err) => {
        console.error(`Error generating content embedding for insight ${insightId}:`, err);
        return null;
      }) : Promise.resolve(null),
      insight.summary ? generateEmbedding(insight.summary).catch((err) => {
        console.error(`Error generating summary embedding for insight ${insightId}:`, err);
        return null;
      }) : Promise.resolve(null),
    ]);

    // Update insights with embeddings
    const embeddingUpdate: Record<string, unknown> = {
      embedding_updated_at: new Date().toISOString(),
    };
    if (contentEmbedding) {
      embeddingUpdate.content_embedding = contentEmbedding;
    }
    if (summaryEmbedding) {
      embeddingUpdate.summary_embedding = summaryEmbedding;
    }

    if (contentEmbedding || summaryEmbedding) {
      await supabase
        .from('insights')
        .update(embeddingUpdate)
        .eq('id', insightId);
    }

  } catch (error) {
    console.error(`Error in processInsightEmbeddings for ${insightId}:`, error);
    // Don't throw - we don't want to block insight persistence if embedding fails
  }
}

async function persistInsights(
  supabase: ReturnType<typeof getAdminSupabaseClient>,
  askSessionId: string,
  incomingInsights: NormalisedIncomingInsight[],
  insightRows: InsightRow[],
  currentUserId?: string | null,
  conversationThreadId?: string | null,
  planStepId?: string | null,
  fallbackChallengeId?: string | null,
  fallbackMessageId?: string | null,
) {
  if (incomingInsights.length === 0) {
    return;
  }

  const insightTypeMap = await fetchInsightTypeMap(supabase);
  if (Object.keys(insightTypeMap).length === 0) {
    throw new Error('No insight types configured');
  }

  const existingMap = insightRows.reduce<Record<string, InsightRow>>((acc, row) => {
    acc[row.id] = row;
    return acc;
  }, {});

  const normaliseKey = (value?: string | null): string => {
    if (typeof value !== 'string') {
      return '';
    }
    return value.replace(/\s+/g, ' ').trim().toLowerCase();
  };

  // BUG-013 FIX: Content/summary deduplication must be scoped to the same thread
  // Build composite keys that include thread context to prevent cross-thread matches
  const buildThreadScopedKey = (baseKey: string, threadId: string | null | undefined): string => {
    // Include thread ID in the key to ensure deduplication is thread-scoped
    // Use 'no-thread' as a marker for insights without thread assignment
    const threadMarker = threadId ?? 'no-thread';
    return `${threadMarker}::${baseKey}`;
  };

  const contentIndex = new Map<string, InsightRow>();
  const summaryIndex = new Map<string, InsightRow>();

  const indexRow = (row: InsightRow | null | undefined) => {
    if (!row) return;
    const rowThreadId = (row as any).conversation_thread_id ?? null;
    const contentKey = normaliseKey(row.content ?? null);
    if (contentKey) {
      // BUG-013 FIX: Use thread-scoped key for deduplication
      contentIndex.set(buildThreadScopedKey(contentKey, rowThreadId), row);
    }
    const summaryKey = normaliseKey(row.summary ?? null);
    if (summaryKey) {
      // BUG-013 FIX: Use thread-scoped key for deduplication
      summaryIndex.set(buildThreadScopedKey(summaryKey, rowThreadId), row);
    }
  };

  const removeFromIndex = (row: InsightRow | null | undefined) => {
    if (!row) return;
    const rowThreadId = (row as any).conversation_thread_id ?? null;
    const contentKey = normaliseKey(row.content ?? null);
    if (contentKey) contentIndex.delete(buildThreadScopedKey(contentKey, rowThreadId));
    const summaryKey = normaliseKey(row.summary ?? null);
    if (summaryKey) summaryIndex.delete(buildThreadScopedKey(summaryKey, rowThreadId));
  };

  Object.values(existingMap).forEach(indexRow);

  const processedKeys = new Set<string>();

  for (const incoming of incomingInsights) {
    const nowIso = new Date().toISOString();
    // BUG-013 FIX: Include thread ID in the deduplication key to prevent cross-thread matches
    // BUG-036 FIX: Include type FIRST in the deduplication key so that insights with
    // identical content but different types (e.g., "idea" vs "question") are not treated
    // as duplicates. Order: type -> thread -> content -> summary
    const dedupeKey = [
      incoming.type ?? '',
      conversationThreadId ?? 'no-thread',
      normaliseKey(incoming.content),
      normaliseKey(incoming.summary),
    ].join('|');

    if (dedupeKey.trim().length > 0) {
      if (processedKeys.has(dedupeKey)) {
        continue;
      }
      processedKeys.add(dedupeKey);
    }

    let existing = incoming.id ? existingMap[incoming.id] : undefined;

    if (!existing && incoming.duplicateOfId && existingMap[incoming.duplicateOfId]) {
      existing = existingMap[incoming.duplicateOfId];
    }

    // BUG-013 FIX: Use thread-scoped keys for content/summary matching
    if (!existing) {
      const contentMatch = contentIndex.get(buildThreadScopedKey(normaliseKey(incoming.content), conversationThreadId));
      const summaryMatch = summaryIndex.get(buildThreadScopedKey(normaliseKey(incoming.summary), conversationThreadId));
      existing = contentMatch ?? summaryMatch ?? undefined;
    }

    const desiredId = incoming.id ?? randomUUID();
    const normalisedKpis = normaliseIncomingKpis(incoming.kpis, []);
    const providedType = normaliseInsightTypeName(incoming.type);
    const action = incoming.action ?? '';
    const targetRow = existing ?? null;

    if (action === 'delete' || action === 'remove' || action === 'obsolete') {
      if (targetRow) {
        // Clean up graph edges before deleting the insight
        const { deleteEdgesForInsight } = await import('@/lib/graphRAG/graphBuilder');
        await deleteEdgesForInsight(targetRow.id, supabase);

        await supabase.from('kpi_estimations').delete().eq('insight_id', targetRow.id);
        await supabase.from('insight_authors').delete().eq('insight_id', targetRow.id);
        await supabase.from('insights').delete().eq('id', targetRow.id);
        delete existingMap[targetRow.id];
        removeFromIndex(targetRow);
      }
      continue;
    }

    if (action === 'merge' && targetRow) {
      const mergeSummaryNote = incoming.summary ?? targetRow.summary ?? '';
      const mergedNote = incoming.mergedIntoId
        ? `${mergeSummaryNote}${mergeSummaryNote ? '\n\n' : ''}[Fusion] Fusionné avec l'insight ${incoming.mergedIntoId}`
        : mergeSummaryNote;

      const updatePayload = {
        ask_session_id: targetRow.ask_session_id,
        user_id: currentUserId ?? null,
        content: incoming.content ?? targetRow.content ?? '',
        summary: mergedNote,
        insight_type_id: targetRow.insight_type_id,
        category: incoming.category ?? targetRow.category ?? null,
        status: 'archived' as Insight['status'],
        priority: incoming.priority ?? targetRow.priority ?? null,
        challenge_id: incoming.challengeId ?? targetRow.challenge_id ?? fallbackChallengeId ?? null,
        related_challenge_ids: incoming.relatedChallengeIds ?? targetRow.related_challenge_ids ?? [],
        source_message_id: incoming.sourceMessageId ?? targetRow.source_message_id ?? fallbackMessageId ?? null,
        conversation_thread_id: conversationThreadId ?? targetRow.conversation_thread_id ?? null,
        plan_step_id: planStepId ?? null,
        updated_at: nowIso,
      } satisfies Record<string, unknown>;

      const { error: mergeUpdateErr } = await supabase
        .from('insights')
        .update(updatePayload)
        .eq('id', targetRow.id);

      if (mergeUpdateErr) {
        throw mergeUpdateErr;
      }

      await supabase.from('kpi_estimations').delete().eq('insight_id', targetRow.id);
      if (incoming.authorsProvided) {
        await replaceInsightAuthors(supabase, targetRow.id, incoming.authors, currentUserId);
      }

      const mergedRow = await fetchInsightRowById(supabase, targetRow.id);
      if (mergedRow) {
        existingMap[targetRow.id] = mergedRow;
        removeFromIndex(targetRow);
        indexRow(mergedRow);
      }
      continue;
    }

    if (existing) {
      const existingInsight = mapInsightRowToInsight(existing);
      const desiredTypeName = providedType ?? existingInsight.type ?? 'idea';
      const desiredTypeId = resolveInsightTypeId(desiredTypeName, insightTypeMap);

      const updatePayload = {
        ask_session_id: existing.ask_session_id,
        user_id: currentUserId ?? null,
        content: incoming.content ?? existing.content ?? '',
        summary: incoming.summary ?? existing.summary ?? null,
        insight_type_id: desiredTypeId,
        category: incoming.category ?? existing.category ?? null,
        status: (incoming.status as Insight['status']) ?? (existing.status as Insight['status']) ?? 'new',
        priority: incoming.priority ?? existing.priority ?? null,
        challenge_id: incoming.challengeId ?? existing.challenge_id ?? fallbackChallengeId ?? null,
        related_challenge_ids: incoming.relatedChallengeIds ?? existing.related_challenge_ids ?? [],
        source_message_id: incoming.sourceMessageId ?? existing.source_message_id ?? fallbackMessageId ?? null,
        conversation_thread_id: conversationThreadId ?? existing.conversation_thread_id ?? null,
        plan_step_id: planStepId ?? null,
        updated_at: nowIso,
      };

      const { error: updateError } = await supabase
        .from('insights')
        .update(updatePayload)
        .eq('id', existing.id);

      if (updateError) {
        throw updateError;
      }

      await supabase.from('kpi_estimations').delete().eq('insight_id', existing.id);
      const kpiRowsUpdate = normalisedKpis.map((k) => ({
        insight_id: existing.id,
        name: typeof (k as any)?.label === 'string' ? (k as any).label : 'KPI',
        description: typeof (k as any)?.description === 'string' ? (k as any).description : null,
        metric_data: (k as any)?.value ?? null,
      }));
      if (kpiRowsUpdate.length > 0) {
        const { error: kpiUpdateErr } = await supabase.from('kpi_estimations').insert(kpiRowsUpdate);
        if (kpiUpdateErr) throw kpiUpdateErr;
      }

      if (incoming.authorsProvided) {
        await replaceInsightAuthors(supabase, existing.id, incoming.authors, currentUserId);
      }

      const updatedRow = await fetchInsightRowById(supabase, existing.id);
      if (updatedRow) {
        existingMap[existing.id] = updatedRow;
        removeFromIndex(existing);
        indexRow(updatedRow);
        
        // Generate embeddings for future semantic search (async, don't block)
        processInsightEmbeddings(supabase, existing.id, updatedRow).catch((error) => {
          console.error(`Error processing embeddings for updated insight ${existing.id}:`, error);
        });
      }
    } else {
      const desiredTypeName = providedType ?? 'idea';
      const desiredTypeId = resolveInsightTypeId(desiredTypeName, insightTypeMap);

      const insertPayload = {
        id: desiredId,
        ask_session_id: askSessionId,
        user_id: currentUserId ?? null,
        content: incoming.content ?? '',
        summary: incoming.summary ?? null,
        insight_type_id: desiredTypeId,
        category: incoming.category ?? null,
        status: (incoming.status as Insight['status']) ?? 'new',
        priority: incoming.priority ?? null,
        challenge_id: incoming.challengeId ?? fallbackChallengeId ?? null,
        related_challenge_ids: incoming.relatedChallengeIds ?? [],
        source_message_id: incoming.sourceMessageId ?? fallbackMessageId ?? null,
        conversation_thread_id: conversationThreadId ?? null,
        plan_step_id: planStepId ?? null,
        created_at: nowIso,
        updated_at: nowIso,
      };

      const { error: createdError } = await supabase
        .from('insights')
        .insert(insertPayload);

      if (createdError) {
        throw createdError;
      }

      const kpiRowsInsert = normalisedKpis.map((k) => ({
        insight_id: desiredId,
        name: typeof (k as any)?.label === 'string' ? (k as any).label : 'KPI',
        description: typeof (k as any)?.description === 'string' ? (k as any).description : null,
        metric_data: (k as any)?.value ?? null,
      }));
      if (kpiRowsInsert.length > 0) {
        const { error: kpiInsertErr } = await supabase.from('kpi_estimations').insert(kpiRowsInsert);
        if (kpiInsertErr) throw kpiInsertErr;
      }

      if (incoming.authorsProvided) {
        await replaceInsightAuthors(supabase, desiredId, incoming.authors, currentUserId);
      }

      const createdRow = await fetchInsightRowById(supabase, desiredId);
      if (createdRow) {
        existingMap[createdRow.id] = createdRow;
        indexRow(createdRow);
        
        // Generate embeddings for future semantic search (async, don't block)
        processInsightEmbeddings(supabase, desiredId, createdRow).catch((error) => {
          console.error(`Error processing embeddings for new insight ${desiredId}:`, error);
        });
      }
    }
  }
}

// Maximum time a job can run before being considered stuck (30 seconds)
// Average latency is ~5s, so 30s gives plenty of margin
const JOB_TIMEOUT_MS = 30 * 1000;

// Cooldown period after a job completes to prevent rapid successive detections
// If multiple messages arrive in succession, we only want to detect once
const JOB_COOLDOWN_MS = 10 * 1000;

async function findActiveInsightJob(
  supabase: ReturnType<typeof getAdminSupabaseClient>,
  askSessionId: string,
): Promise<InsightJobRow | null> {
  const { data, error } = await supabase
    .from('ai_insight_jobs')
    .select('id, ask_session_id, status, attempts, started_at')
    .eq('ask_session_id', askSessionId)
    .in('status', ['pending', 'processing'])
    .limit(1)
    .maybeSingle<InsightJobRow>();

  if (error) {
    throw error;
  }

  // Auto-expire stuck jobs that have been running for too long
  if (data && data.started_at) {
    const startedAt = new Date(data.started_at).getTime();
    const now = Date.now();
    if (now - startedAt > JOB_TIMEOUT_MS) {
      console.warn(`[Insight Job] Auto-expiring stuck job ${data.id} (started ${Math.round((now - startedAt) / 1000)}s ago)`);
      await supabase
        .from('ai_insight_jobs')
        .update({
          status: 'failed',
          last_error: 'Job timed out after 5 minutes',
          finished_at: new Date().toISOString(),
        })
        .eq('id', data.id);
      return null; // Allow a new job to be created
    }
  }

  return data ?? null;
}

/**
 * Check if a job was recently completed for this session.
 * This prevents rapid successive detections when multiple messages arrive quickly.
 * Returns true if we should skip creating a new job (cooldown active).
 */
async function isInsightJobInCooldown(
  supabase: ReturnType<typeof getAdminSupabaseClient>,
  askSessionId: string,
): Promise<boolean> {
  const cooldownThreshold = new Date(Date.now() - JOB_COOLDOWN_MS).toISOString();

  const { data, error } = await supabase
    .from('ai_insight_jobs')
    .select('id, finished_at')
    .eq('ask_session_id', askSessionId)
    .eq('status', 'completed')
    .gte('finished_at', cooldownThreshold)
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // Don't fail if we can't check cooldown, just allow the job
    console.warn('[Insight Job] Error checking cooldown:', error);
    return false;
  }

  if (data) {
    console.log(`[Insight Job] Cooldown active - job ${data.id} completed recently`);
    return true;
  }

  return false;
}

async function createInsightJob(
  supabase: ReturnType<typeof getAdminSupabaseClient>,
  payload: { askSessionId: string; messageId?: string | null; agentId?: string | null }
): Promise<InsightJobRow> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('ai_insight_jobs')
    .insert({
      ask_session_id: payload.askSessionId,
      message_id: payload.messageId ?? null,
      agent_id: payload.agentId ?? null,
      status: 'processing',
      attempts: 1,
      started_at: nowIso,
      updated_at: nowIso,
    })
    .select('id, ask_session_id, status, attempts, started_at')
    .single<InsightJobRow>();

  if (error) {
    throw error;
  }

  return data;
}

async function completeInsightJob(
  supabase: ReturnType<typeof getAdminSupabaseClient>,
  jobId: string,
  payload: { modelConfigId?: string | null }
) {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from('ai_insight_jobs')
    .update({
      status: 'completed',
      finished_at: nowIso,
      updated_at: nowIso,
      model_config_id: payload.modelConfigId ?? null,
    })
    .eq('id', jobId);

  if (error) {
    throw error;
  }
}

async function failInsightJob(
  supabase: ReturnType<typeof getAdminSupabaseClient>,
  jobId: string,
  payload: { error: string; attempts?: number; modelConfigId?: string | null }
) {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from('ai_insight_jobs')
    .update({
      status: 'failed',
      last_error: payload.error,
      finished_at: nowIso,
      updated_at: nowIso,
      attempts: payload.attempts ?? 1,
      model_config_id: payload.modelConfigId ?? null,
    })
    .eq('id', jobId);

  if (error) {
    throw error;
  }
}

function resolveInsightAgentPayload(result: AgentExecutionResult): unknown | null {
  const candidates = new Set<string>();

  const addCandidate = (value: string | null | undefined) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    candidates.add(trimmed);
  };

  // Try to extract JSON from content
  addCandidate(typeof result.content === 'string' ? result.content : null);
  if (typeof result.content === 'string') {
    addCandidate(sanitiseJsonString(result.content));
    // Also try to extract JSON that might be embedded in text (look for any JSON object, not just insights)
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      addCandidate(jsonMatch[0]);
    }
  }
  
  // Extract text from raw response (this handles Anthropic's content array structure)
  const extractedText = extractTextFromRawResponse(result.raw);
  if (extractedText) {
    addCandidate(extractedText);
    addCandidate(sanitiseJsonString(extractedText));
    // Try to extract JSON from extracted text
    const jsonMatch = extractedText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      addCandidate(jsonMatch[0]);
    }
  }

  const candidateList = Array.from(candidates);
  for (let i = 0; i < candidateList.length; i += 1) {
    const parsed = parseAgentJsonSafely(candidateList[i]);
    if (parsed !== null) {
      // Verify that the parsed result has the expected structure
      if (typeof parsed === 'object' && parsed !== null) {
        const obj = parsed as Record<string, unknown>;
        // Accept if it has insights, items, or is an array (for direct array of insights)
        if ('insights' in obj || 'items' in obj || Array.isArray(parsed)) {
          return parsed;
        }
        // Also accept if it looks like a valid insight structure (has content or summary)
        if ('content' in obj || 'summary' in obj) {
          // Wrap single insight in an array
          return { insights: [parsed] };
        }
      }
    }
  }

  // Try to extract from raw response object directly
  if (result.raw && typeof result.raw === 'object') {
    const rawRecord = result.raw as Record<string, unknown>;
    if ('insights' in rawRecord || 'items' in rawRecord) {
      return rawRecord;
    }
    // Some providers might nest the content differently
    if ('content' in rawRecord && typeof rawRecord.content === 'object') {
      const contentObj = rawRecord.content as Record<string, unknown>;
      if ('insights' in contentObj || 'items' in contentObj) {
        return contentObj;
      }
    }
  }

  return null;
}

async function triggerInsightDetection(
  supabase: ReturnType<typeof getAdminSupabaseClient>,
  options: {
    askSessionId: string;
    messageId?: string | null;
    variables: Record<string, string | null | undefined>;
    conversationThreadId?: string | null;
    challengeId?: string | null;
    projectId?: string | null;
  },
  existingInsights: InsightRow[],
  currentUserId?: string | null,
): Promise<Insight[]> {
  const activeJob = await findActiveInsightJob(supabase, options.askSessionId);
  if (activeJob) {
    return existingInsights.map(mapInsightRowToInsight);
  }

  // Check if a job was recently completed (cooldown period)
  // This prevents rapid successive detections when multiple messages arrive quickly
  const inCooldown = await isInsightJobInCooldown(supabase, options.askSessionId);
  if (inCooldown) {
    return existingInsights.map(mapInsightRowToInsight);
  }

  const insightAgent = await fetchAgentBySlug(supabase, INSIGHT_AGENT_SLUG, { includeModels: true });
  if (!insightAgent) {
    throw new Error('Insight detection agent is not configured');
  }

  let job: InsightJobRow;
  try {
    job = await createInsightJob(supabase, {
      askSessionId: options.askSessionId,
      messageId: options.messageId ?? null,
      agentId: insightAgent.id,
    });
  } catch (error: unknown) {
    // BUG-023 FIX: Use PostgreSQL error code for robust duplicate detection
    // PostgreSQL error code 23505 = unique_violation (covers all unique constraint errors)
    // This is more reliable than string matching on error messages which can change
    // or be localized in different PostgreSQL configurations
    const pgErrorCode = error && typeof error === 'object' && 'code' in error
      ? (error as { code: unknown }).code
      : null;
    const isDuplicateKeyError = pgErrorCode === '23505';

    if (isDuplicateKeyError) {
      // Another request created the job between our check and insert (race condition).
      // Re-check for an active job and return existing insights if found.
      const retryActiveJob = await findActiveInsightJob(supabase, options.askSessionId);
      if (retryActiveJob) {
        return existingInsights.map(mapInsightRowToInsight);
      }
      // If still no active job after a 23505 error, the job may have completed
      // or been cleaned up - allow this request to continue by rethrowing
    }
    throw error;
  }

  try {
    const result = await executeAgent({
      supabase,
      agentSlug: INSIGHT_AGENT_SLUG,
      askSessionId: options.askSessionId,
      messageId: options.messageId ?? null,
      interactionType: INSIGHT_INTERACTION_TYPE,
      variables: options.variables,
      toolContext: {
        projectId: options.projectId,
        challengeId: options.challengeId,
      },
    });

    // Check if this is a voice agent response (which shouldn't happen for insight detection)
    if ('voiceAgent' in result && result.voiceAgent) {
      throw new Error('Insight detection agent returned a voice agent response, which is not supported. The agent should return text/JSON.');
    }

    // Verify that we have the required fields
    if (!result.content && !result.raw) {
      console.error('❌ Agent execution returned empty result:', {
        hasContent: !!result.content,
        hasRaw: !!result.raw,
        hasVoiceAgent: 'voiceAgent' in result,
        logId: result.logId,
        agentId: result.agent?.id,
        modelConfigId: result.modelConfig?.id
      });
      
      // Try to get the log from database to see what happened and potentially recover the response
      const { data: logData, error: logError } = await supabase
        .from('ai_agent_logs')
        .select('status, error_message, response_payload, request_payload')
        .eq('id', result.logId)
        .single();
      
      if (logError) {
        console.error('Error fetching agent log:', logError);
        throw new Error(`Insight detection agent returned empty response and could not fetch log details (logId: ${result.logId}).`);
      }
      
      console.error('Agent log details:', {
        status: logData?.status,
        errorMessage: logData?.error_message,
        hasResponsePayload: !!logData?.response_payload,
        responsePayloadType: logData?.response_payload ? typeof logData.response_payload : 'none'
      });
      
      // If the log has a response payload but result doesn't, try to extract it
      if (logData?.response_payload && typeof logData.response_payload === 'object') {
        const responsePayload = logData.response_payload as Record<string, unknown>;
        console.log('Attempting to recover response from log payload:', {
          keys: Object.keys(responsePayload),
          hasContent: 'content' in responsePayload
        });
        
        // Try to extract content from the response payload
        const extractedContent = extractTextFromRawResponse(responsePayload);
        if (extractedContent) {
          console.log('✅ Recovered content from log payload, length:', extractedContent.length);
          // Update result with recovered content
          (result as any).content = extractedContent;
          (result as any).raw = responsePayload;
        } else {
          throw new Error(`Insight detection agent returned empty response. Log status: ${logData.status}, error: ${logData.error_message || 'none'}. Check logs for details (logId: ${result.logId}).`);
        }
      } else if (logData?.status === 'failed') {
        throw new Error(`Insight detection agent execution failed: ${logData.error_message || 'Unknown error'}. Check logs for details (logId: ${result.logId}).`);
      } else {
        throw new Error(`Insight detection agent returned empty response. Log status: ${logData.status}. Check logs for details (logId: ${result.logId}).`);
      }
    }

    await supabase
      .from('ai_insight_jobs')
      .update({ model_config_id: result.modelConfig.id })
      .eq('id', job.id);

    let parsedPayload: unknown;
    let parsingFailed = false;

    const payload = resolveInsightAgentPayload(result);
    if (payload && typeof payload === 'object') {
      const payloadObj = payload as Record<string, unknown>;
      const hasInsights = 'insights' in payloadObj;
      const hasItems = 'items' in payloadObj;
      const isArray = Array.isArray(payload);

      // Check if the payload has the wrong structure (keywords/concepts/themes instead of insights)
      if (!hasInsights && !hasItems && !isArray && ('keywords' in payloadObj || 'concepts' in payloadObj || 'themes' in payloadObj)) {
        console.error('Agent returned entity extraction format instead of insights format');
        // Return empty insights since we can't convert entity extraction to insights
        parsedPayload = { insights: [] };
        parsingFailed = true;
      } else {
        parsedPayload = payload;
      }
    } else {
      // If payload is null or invalid
      parsingFailed = true;
      console.error('Insight agent returned invalid JSON payload');

      // Return an empty insights structure instead of throwing
      // This allows the function to continue without throwing, which is important
      // for voice messages where insight detection is non-blocking
      parsedPayload = { insights: [] };
    }

    const insightsSource = (typeof parsedPayload === 'object' && parsedPayload !== null && 'insights' in parsedPayload)
      ? (parsedPayload as Record<string, unknown>).insights
      : parsedPayload;

    const incoming = normaliseIncomingInsights(insightsSource, currentUserId);

    // If parsing failed, continue processing
    // This allows the system to continue even if the agent response format is unexpected
    if (parsingFailed) {
      // Don't persist insights if parsing failed, as we can't trust the data
      // But still mark job as completed to avoid blocking future detections
      // This is important for voice messages and non-critical insight detection
      await completeInsightJob(supabase, job.id, {
        modelConfigId: result.modelConfig.id,
      });
    } else {
      // Only persist insights if parsing succeeded
      // Get the currently active plan step to link insights
      let planStepId: string | null = null;
      if (options.conversationThreadId) {
        try {
          const plan = await getConversationPlanWithSteps(supabase, options.conversationThreadId);
          if (plan) {
            const activeStep = await getActiveStep(supabase, plan.id);
            if (activeStep) {
              planStepId = activeStep.id;
            }
          }
        } catch (error) {
          console.warn('⚠️ Failed to get active step for insight linking:', error);
          // Continue without linking to step
        }
      }

      await persistInsights(supabase, options.askSessionId, incoming.items, existingInsights, currentUserId, options.conversationThreadId, planStepId, options.challengeId ?? null, options.messageId ?? null);
      await completeInsightJob(supabase, job.id, { modelConfigId: result.modelConfig.id });
    }

    // Get refreshed insights filtered by thread if thread is provided
    // Using centralized functions that properly hydrate type names
    const refreshedInsights = options.conversationThreadId
      ? await fetchInsightsForThread(supabase, options.conversationThreadId)
      : await fetchInsightsForSession(supabase, options.askSessionId);

    const mappedInsights = refreshedInsights.map(mapInsightRowToInsight);

    return mappedInsights;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error during insight detection';
    await failInsightJob(supabase, job.id, {
      error: message,
      attempts: job.attempts,
    });
    throw error;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    const body = await request.json().catch(() => ({}));
    const typedBody = body as {
      detectInsights?: boolean;
      askSessionId?: string;
      mode?: string;
      message?: string;
      metadata?: { voiceGenerated?: boolean; voiceTranscribed?: boolean };
    };
    const { detectInsights, askSessionId, mode, message: messageContent, metadata } = typedBody;
    const detectInsightsOnly = detectInsights === true;
    const isVoiceMessage = metadata?.voiceGenerated === true || metadata?.voiceTranscribed === true;

    if (!key || !isValidAskKey(key)) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Invalid ASK key format'
      }, { status: 400 });
    }

    const modeValue = typeof mode === 'string' ? mode : undefined;
    const insightsOnly = modeValue === 'insights-only';

    const supabase = getAdminSupabaseClient();
    
    // Récupérer l'utilisateur connecté pour les auteurs d'insights
    let currentUserId: string | null = null;
    try {
      const serverSupabase = await createServerSupabaseClient();
      const user = await getCurrentUser();
      if (user) {
        // Récupérer le profil pour obtenir l'ID du profil (pas l'auth_id)
        const { data: profile } = await serverSupabase
          .from('profiles')
          .select('id')
          .eq('auth_id', user.id)
          .eq('is_active', true)
          .single();
        
        if (profile) {
          currentUserId = profile.id;
        }
      }
    } catch (error) {
      // Si on ne peut pas récupérer l'utilisateur, on continue sans (pour les sessions anonymes)
      console.warn('Could not retrieve current user for insight authors:', error);
    }

    const { row: askRow, error: askError } = await getAskSessionByKey<AskSessionRow & { conversation_mode?: string | null }>(
      supabase,
      key,
      'id, ask_key, question, description, status, system_prompt, project_id, challenge_id, conversation_mode, expected_duration_minutes'
    );

    if (askError) {
      throw askError;
    }

    if (!askRow) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'ASK introuvable pour la clé fournie'
      }, { status: 404 });
    }

    // In consultant mode, AI doesn't respond automatically - only saves messages and detects insights
    const isConsultantMode = askRow.conversation_mode === 'consultant';

    if (detectInsightsOnly) {
      if (typeof askSessionId !== 'string') {
        return NextResponse.json<ApiResponse>({
          success: false,
          error: 'ASK session identifier is required for insight detection',
        }, { status: 400 });
      }

      if (askSessionId !== askRow.id) {
        return NextResponse.json<ApiResponse>({
          success: false,
          error: 'ASK session mismatch',
        }, { status: 400 });
      }
    }

    const { data: participantRows, error: participantError } = await supabase
      .from('ask_participants')
      .select('*')
      .eq('ask_session_id', askRow.id)
      .order('joined_at', { ascending: true });

    if (participantError) {
      throw participantError;
    }

    const participantUserIds = (participantRows ?? [])
      .map(row => row.user_id)
      .filter((value): value is string => Boolean(value));

    let usersById: Record<string, UserRow> = {};

    if (participantUserIds.length > 0) {
      const { data: userRows, error: userError } = await supabase
        .from('profiles')
        .select('id, email, full_name, first_name, last_name, description')
        .in('id', participantUserIds);

      if (userError) {
        throw userError;
      }

      usersById = (userRows ?? []).reduce<Record<string, UserRow>>((acc, user) => {
        acc[user.id] = user;
        return acc;
      }, {});
    }

    const participants = (participantRows ?? []).map((row, index) => {
      const user = row.user_id ? usersById[row.user_id] ?? null : null;
      return {
        id: row.id,
        name: buildParticipantDisplayName(row, user, index),
        email: row.participant_email ?? user?.email ?? null,
        role: row.role ?? null,
        description: user?.description ?? null,
        isSpokesperson: Boolean(row.is_spokesperson),
        isActive: true,
      };
    });

    // Get conversation thread for AI response
    // BUG FIX: For individual_parallel mode, AI must respond in the SAME thread as the user message.
    // We find the last user message's thread instead of using resolveThreadUserId() which
    // picks the first participant (may be different from the user who sent the message).
    const askConfig = {
      conversation_mode: askRow.conversation_mode ?? null,
    };

    let conversationThread: { id: string; is_shared: boolean } | null = null;

    // BUG-042 FIX: Use currentUserId directly to find the thread for THIS user
    // Don't use getLastUserMessageThread - it returns another user's thread in individual_parallel mode
    const { thread, error: threadError } = await getOrCreateConversationThread(
      supabase,
      askRow.id,
      currentUserId ?? null,
      askConfig
    );

    if (threadError) {
      throw threadError;
    }

    conversationThread = thread;

    // Get messages for the thread (or all messages if no thread for backward compatibility)
    let messageRows: MessageRow[] = [];
    if (conversationThread) {
      const { messages: threadMessages, error: threadMessagesError } = await getMessagesForThread(
        supabase,
        conversationThread.id
      );
      
      if (threadMessagesError) {
        throw threadMessagesError;
      }
      
      messageRows = threadMessages as MessageRow[];
    } else {
      // Fallback: get all messages for backward compatibility
      const { data, error: messageError } = await supabase
        .from('messages')
        .select('id, ask_session_id, user_id, sender_type, content, message_type, metadata, created_at, conversation_thread_id')
        .eq('ask_session_id', askRow.id)
        .order('created_at', { ascending: true });

      if (messageError) {
        throw messageError;
      }
      
      messageRows = (data ?? []) as MessageRow[];
    }

    const messageUserIds = (messageRows ?? [])
      .map(row => row.user_id)
      .filter((value): value is string => Boolean(value));

    const additionalUserIds = messageUserIds.filter(id => !usersById[id]);

    if (additionalUserIds.length > 0) {
      const { data: extraUsers, error: extraUsersError } = await supabase
        .from('profiles')
        .select('id, email, full_name, first_name, last_name, description')
        .in('id', additionalUserIds);

      if (extraUsersError) {
        throw extraUsersError;
      }

      (extraUsers ?? []).forEach(user => {
        usersById[user.id] = user;
      });
    }

    const messages: Message[] = (messageRows ?? []).map((row, index) => {
      const metadata = normaliseMessageMetadata(row.metadata);
      const user = row.user_id ? usersById[row.user_id] ?? null : null;

      return {
        id: row.id,
        askKey: askRow.ask_key,
        askSessionId: row.ask_session_id,
        conversationThreadId: (row as any).conversation_thread_id ?? null,
        content: row.content,
        type: (row.message_type as Message['type']) ?? 'text',
        senderType: (row.sender_type as Message['senderType']) ?? 'user',
        senderId: row.user_id ?? null,
        senderName: buildMessageSenderName(row, user, index),
        timestamp: row.created_at ?? new Date().toISOString(),
        metadata: metadata,
      };
    });

    // Get insights for the thread (or all insights if no thread for backward compatibility)
    // BUG-012 FIX: In individual_parallel mode without a thread, return empty insights
    // to prevent cross-thread data exposure
    // Using centralized functions that properly hydrate type names
    let insightRows: InsightRow[];
    if (conversationThread) {
      insightRows = await fetchInsightsForThread(supabase, conversationThread.id);
    } else if (!shouldUseSharedThread(askConfig)) {
      // BUG-012 FIX: Individual mode requires a thread - don't fall back to session-wide insights
      console.warn('[respond] Individual parallel mode without thread - returning empty insights for isolation');
      insightRows = [];
    } else {
      // Shared mode fallback: get all insights for backward compatibility
      insightRows = await fetchInsightsForSession(supabase, askRow.id);
    }
    
    // BUG-031 FIX: Only override conversationThreadId in shared modes
    // In individual_parallel mode, preserve the original thread ID to maintain isolation
    const existingInsights = insightRows.map(mapInsightRowToInsight).map(insight => {
      if (shouldUseSharedThread(askConfig)) {
        // In shared modes, use the current thread ID for consistency
        return {
          ...insight,
          conversationThreadId: conversationThread?.id ?? null,
        };
      } else {
        // In individual_parallel mode, preserve the original thread ID
        return {
          ...insight,
          conversationThreadId: (insight as any).conversationThreadId ?? null,
        };
      }
    });

    // Fetch insight types for prompt
    const insightTypes = await fetchInsightTypesForPrompt(supabase);

    let projectData: ProjectRow | null = null;
    if (askRow.project_id) {
      const { data, error } = await supabase
        .from('projects')
        .select('id, name, system_prompt')
        .eq('id', askRow.project_id)
        .maybeSingle<ProjectRow>();

      if (error) {
        throw error;
      }

      projectData = data ?? null;
    }

    let challengeData: ChallengeRow | null = null;
    if (askRow.challenge_id) {
      const { data, error } = await supabase
        .from('challenges')
        .select('id, name, system_prompt')
        .eq('id', askRow.challenge_id)
        .maybeSingle<ChallengeRow>();

      if (error) {
        throw error;
      }

      challengeData = data ?? null;
    }

    const participantSummaries = participants.map(p => ({ name: p.name, role: p.role ?? null, description: p.description ?? null }));

    // Ensure conversation plan exists (creates if missing) - same as stream/route.ts
    let conversationPlan = null;
    if (conversationThread) {
      try {
        conversationPlan = await ensureConversationPlanExists(
          supabase,
          conversationThread.id,
          {
            askRow,
            projectData,
            challengeData,
            participantSummaries,
          }
        );
      } catch (planError) {
        // Enhanced error logging to capture full error details
        let errorMsg: string;
        if (planError instanceof Error) {
          errorMsg = planError.message;
        } else if (planError && typeof planError === 'object') {
          const errObj = planError as Record<string, unknown>;
          errorMsg = JSON.stringify({
            message: errObj.message,
            code: errObj.code,
            details: errObj.details,
            hint: errObj.hint,
          });
        } else {
          errorMsg = String(planError);
        }
        console.error('[respond] Failed to ensure conversation plan:', errorMsg);
        // Fallback to just retrieving
        conversationPlan = await getConversationPlanWithSteps(supabase, conversationThread.id);
      }
    }

    // Find the current participant (same as stream/route.ts for DRY)
    // Used to filter participants in individual_parallel mode
    const currentParticipant = currentUserId
      ? participants.find(p => {
          const participantRow = (participantRows ?? []).find(r => r.id === p.id);
          return participantRow?.user_id === currentUserId;
        })
      : null;

    // BUG-SECTION-H FIX: Insight attribution based on conversation mode
    // - @consultant: Attribute to message author, NOT the consultant (is_spokesperson)
    // - @group (collaborative): Attribute to whoever posted the message (brought it to debate)
    // - @groupRapporteur (group_reporter): Attribute to speaker (diarization if voice, else message author)
    // - @individual_parallel: Attribute to current user (default)
    const conversationMode = askRow.conversation_mode;
    // BUG-042 FIX: Simplified insight attribution - always use currentUserId
    // The complex lastUserUserId logic was causing bugs and is no longer needed
    const insightAuthorFallbackId: string | null = currentUserId;

    // Fetch elapsed times using centralized helper (DRY)
    // BUG FIX: Pass adminClient to bypass RLS for step timer reading
    // Without this, participants can't read step elapsed_active_seconds
    const { elapsedActiveSeconds, stepElapsedActiveSeconds } = await fetchElapsedTime({
      supabase,
      askSessionId: askRow.id,
      profileId: currentUserId,
      conversationPlan,
      participantRows: participantRows ?? [],
      adminClient: getAdminSupabaseClient(),
    });

    if (detectInsightsOnly) {
      try {
        const lastAiMessage = [...messages].reverse().find(message => message.senderType === 'ai');

        const conversationMessages = messages.map(m => ({
          id: m.id,
          senderType: m.senderType,
          senderName: m.senderName ?? 'Participant',
          content: m.content,
          timestamp: m.timestamp,
        }));

        // BUG-028 FIX: In consultant mode, set latestAiResponse to empty string since
        // there's no AI response being generated - this prevents any potential leakage
        // of previous AI responses in the detection variables
        const latestAiResponseForDetection = isConsultantMode ? '' : (lastAiMessage?.content ?? '');

        const detectionVariables = buildConversationAgentVariables({
          ask: askRow,
          project: projectData,
          challenge: challengeData,
          messages: conversationMessages,
          participants: participantSummaries,
          currentParticipantName: currentParticipant?.name ?? null,
          conversationPlan,
          elapsedActiveSeconds,
          stepElapsedActiveSeconds,
          insights: existingInsights,
          latestAiResponse: latestAiResponseForDetection,
          insightTypes,
        });

        const refreshedInsights = await triggerInsightDetection(
          supabase,
          {
            askSessionId: askRow.id,
            messageId: lastAiMessage?.id ?? null,
            variables: detectionVariables,
            conversationThreadId: conversationThread?.id ?? null,
            challengeId: askRow.challenge_id ?? null,
            projectId: askRow.project_id ?? null,
          },
          insightRows,
          insightAuthorFallbackId, // BUG-SECTION-H FIX: Use message author, not consultant
        );

        return NextResponse.json<ApiResponse<{ insights: Insight[] }>>({
          success: true,
          data: { insights: refreshedInsights },
        });
      } catch (error) {
        console.error('Insight detection failed:', parseErrorMessage(error));
        return NextResponse.json<ApiResponse>({
          success: false,
          error: 'Failed to detect insights'
        }, { status: 500 });
      }
    }

    let message: Message | undefined;
    let latestAiResponse = '';
    let detectionMessageId: string | null = null;
    let updatedConversationPlan: typeof conversationPlan = null; // Track if plan was updated after step completion

    if (!insightsOnly) {
      // If this is a voice-generated message, just persist it without calling executeAgent
      // The voice agent already handled the response via executeAgent
      // BUG-011 FIX: Skip voice message handling in consultant mode - AI doesn't respond in that mode
      // so there's no AI message to persist
      if (isVoiceMessage && messageContent && !isConsultantMode) {
        // Find the last user message to link as parent
        const lastUserMessage = [...messages].reverse().find(msg => msg.senderType === 'user');
        const parentMessageId = lastUserMessage?.id ?? null;

        // Get the currently active plan step to link this voice message
        let voicePlanStepId: string | null = null;
        if (conversationPlan) {
          try {
            const activeStep = await getActiveStep(supabase, conversationPlan.id);
            if (activeStep) {
              voicePlanStepId = activeStep.id;
            }
          } catch (error) {
            console.warn('⚠️ Failed to get active step for voice message linking:', error);
          }
        }

        // Clean signal markers from content before storing
        // Keep raw content for signal detection but store cleaned content
        const rawVoiceContent = messageContent;
        const cleanedVoiceContent = cleanAllSignalMarkers(messageContent);

        // FIX: Detect step completion BEFORE building message response
        // This ensures completedStepId is included in metadata so UI can display the green card
        const voiceDetectedStepId = conversationThread ? detectStepCompletion(rawVoiceContent) : null;

        // Insert AI message via RPC wrapper to bypass RLS
        // Pass voicePlanStepId to link message to current step
        const inserted = await insertAiMessage(
          supabase,
          askRow.id,
          conversationThread?.id ?? null,
          cleanedVoiceContent,
          'Agent',
          voicePlanStepId
        );

        if (inserted) {
          // Build metadata with completedStepId if a step was completed
          const baseVoiceMetadata = normaliseMessageMetadata(inserted.metadata);
          const voiceMessageMetadata = voiceDetectedStepId
            ? { ...baseVoiceMetadata, completedStepId: voiceDetectedStepId }
            : baseVoiceMetadata;

          message = {
            id: inserted.id,
            askKey: askRow.ask_key,
            askSessionId: inserted.ask_session_id,
            content: inserted.content,
            type: (inserted.message_type as Message['type']) ?? 'text',
            senderType: 'ai',
            senderId: inserted.user_id ?? null,
            senderName: 'Agent',
            timestamp: inserted.created_at ?? new Date().toISOString(),
            metadata: voiceMessageMetadata,
          };
          messages.push(message);
          detectionMessageId = message.id;
          // Use raw content for signal detection, cleaned content is already stored
          latestAiResponse = rawVoiceContent;

          // Check for step completion markers in voice messages (same logic as text mode)
          console.log('[respond] 🎤 Voice message STEP_COMPLETE check:', {
            hasConversationThread: !!conversationThread,
            threadId: conversationThread?.id,
            contentPreview: latestAiResponse.substring(0, 200),
            contentLength: latestAiResponse.length,
            containsStepComplete: latestAiResponse.includes('STEP_COMPLETE'),
          });

          if (conversationThread && voiceDetectedStepId) {
            const detectedStepId = voiceDetectedStepId;
            console.log('[respond] 🎤 Voice message detectStepCompletion result:', detectedStepId);
            try {
              const plan = await getConversationPlanWithSteps(supabase, conversationThread.id);
              if (plan) {
                const currentStep = getCurrentStep(plan);

                // Support both normalized and legacy step structures
                const currentStepIdentifier = currentStep && 'step_identifier' in currentStep
                  ? currentStep.step_identifier
                  : currentStep?.id;

                // If 'CURRENT' was returned, use the current step identifier
                // Otherwise validate that detected ID matches current step
                const stepIdToComplete = detectedStepId === 'CURRENT'
                  ? currentStepIdentifier
                  : detectedStepId;

                // BUG-024 FIX: Add explicit logging when step ID doesn't match current step
                if (detectedStepId !== 'CURRENT' && currentStepIdentifier !== detectedStepId) {
                  console.warn('[respond] ⚠️ Voice STEP_COMPLETE marker detected but step ID mismatch:', {
                    detectedStepId,
                    currentStepIdentifier,
                    planId: plan.id,
                    threadId: conversationThread.id,
                  });
                }

                if (currentStep && (detectedStepId === 'CURRENT' || currentStepIdentifier === detectedStepId)) {
                  // Complete the step (summary will be generated asynchronously)
                  // Use admin client for RLS bypass
                  const adminSupabase = getAdminSupabaseClient();
                  await completeStep(
                    adminSupabase,
                    conversationThread.id,
                    stepIdToComplete!,
                    undefined, // No pre-generated summary - let the async agent generate it
                    askRow.id // Pass askSessionId to trigger async summary generation
                  );
                  console.log('[respond] ✅ Voice message step completed:', stepIdToComplete);

                  // Fetch the updated plan to return to the client
                  updatedConversationPlan = await getConversationPlanWithSteps(adminSupabase, conversationThread.id);
                }
              }
            } catch (planError) {
              console.error('[respond] ⚠️ Failed to update conversation plan for voice message:', planError);
              // Don't fail the request if plan update fails
            }
          }

          // Handle subtopic signals (TOPICS_DISCOVERED, TOPIC_EXPLORED, TOPIC_SKIPPED)
          // Note: This runs for all voice messages, not just step completions
          if (conversationThread) {
            try {
              const adminSupabase = getAdminSupabaseClient();
              const subtopicResult = await handleSubtopicSignals(
                adminSupabase,
                conversationThread.id,
                latestAiResponse
              );
              if (subtopicResult) {
                console.log('[respond] 🎤 Voice subtopic signals handled:', subtopicResult);
              }
            } catch (subtopicError) {
              console.error('[respond] ⚠️ Failed to handle subtopic signals for voice message:', subtopicError);
              // Don't fail the request if subtopic handling fails
            }
          }
        }
      } else if (!isConsultantMode) {
        // Regular text mode: call executeAgent (skip in consultant mode - AI doesn't respond)
        // Use buildConversationAgentVariables for the agent call to include plan
        const conversationMessages = messages.map(m => ({
          id: m.id,
          senderType: m.senderType,
          senderName: m.senderName ?? 'Participant',
          content: m.content,
          timestamp: m.timestamp,
        }));

        const agentVariables = buildConversationAgentVariables({
          ask: askRow,
          project: projectData,
          challenge: challengeData,
          messages: conversationMessages,
          participants: participantSummaries,
          currentParticipantName: currentParticipant?.name ?? null,
          conversationPlan,
          elapsedActiveSeconds,
          stepElapsedActiveSeconds,
        });

        const aiResult = await executeAgent({
          supabase,
          agentSlug: CHAT_AGENT_SLUG,
          askSessionId: askRow.id,
          interactionType: CHAT_INTERACTION_TYPE,
          variables: agentVariables,
          toolContext: {
            projectId: askRow.project_id,
            challengeId: askRow.challenge_id,
          },
        });

        if (typeof aiResult.content === 'string' && aiResult.content.trim().length > 0) {
        // Keep raw content for signal detection, store cleaned content
        latestAiResponse = aiResult.content.trim();
        const cleanedTextContent = cleanAllSignalMarkers(latestAiResponse);
        const aiMetadata = { senderName: 'Agent' } satisfies Record<string, unknown>;

        // Trouver le dernier message utilisateur pour le lier comme parent
        const lastUserMessage = [...messages].reverse().find(msg => msg.senderType === 'user');
        const parentMessageId = lastUserMessage?.id ?? null;

        // Get the currently active plan step to link this message
        let planStepId: string | null = null;
        if (conversationThread) {
          try {
            const plan = await getConversationPlanWithSteps(supabase, conversationThread.id);
            if (plan) {
              const activeStep = await getActiveStep(supabase, plan.id);
              if (activeStep) {
                planStepId = activeStep.id;
              }
            }
          } catch (error) {
            console.warn('⚠️ Failed to get active step for message linking:', error);
            // Continue without linking to step
          }
        }

        // FIX: Detect step completion BEFORE building message response
        // This ensures completedStepId is included in metadata so UI can display the green card
        const textDetectedStepId = conversationThread ? detectStepCompletion(latestAiResponse) : null;

        // Insert AI message via RPC wrapper to bypass RLS
        // Pass planStepId to link message to current step
        // Store cleaned content (without signal markers)
        const inserted = await insertAiMessage(
          supabase,
          askRow.id,
          conversationThread?.id ?? null,
          cleanedTextContent,
          'Agent',
          planStepId
        );

        if (!inserted) {
          throw new Error('Unable to store AI response');
        }

        // Build metadata with completedStepId if a step was completed
        const baseTextMetadata = normaliseMessageMetadata(inserted.metadata);
        const textMessageMetadata = textDetectedStepId
          ? { ...baseTextMetadata, completedStepId: textDetectedStepId }
          : baseTextMetadata;

        message = {
          id: inserted.id,
          askKey: askRow.ask_key,
          askSessionId: inserted.ask_session_id,
          content: inserted.content,
          type: (inserted.message_type as Message['type']) ?? 'text',
          senderType: 'ai',
          senderId: inserted.user_id ?? null,
          senderName: 'Agent',
          timestamp: inserted.created_at ?? new Date().toISOString(),
          metadata: textMessageMetadata,
        };

        messages.push(message);
        detectionMessageId = message.id;

        // Process step completion if detected
        if (conversationThread && textDetectedStepId) {
          const detectedStepId = textDetectedStepId;
          try {
            const plan = await getConversationPlanWithSteps(supabase, conversationThread.id);
            if (plan) {
              const currentStep = getCurrentStep(plan);

              // Support both normalized and legacy step structures
              const currentStepIdentifier = currentStep && 'step_identifier' in currentStep
                ? currentStep.step_identifier
                : currentStep?.id;

              // If 'CURRENT' was returned, use the current step identifier
              // Otherwise validate that detected ID matches current step
              const stepIdToComplete = detectedStepId === 'CURRENT'
                ? currentStepIdentifier
                : detectedStepId;

              // BUG-024 FIX: Add explicit logging when step ID doesn't match current step
              if (detectedStepId !== 'CURRENT' && currentStepIdentifier !== detectedStepId) {
                console.warn('[respond] ⚠️ STEP_COMPLETE marker detected but step ID mismatch:', {
                  detectedStepId,
                  currentStepIdentifier,
                  planId: plan.id,
                  threadId: conversationThread.id,
                });
              }

              if (currentStep && (detectedStepId === 'CURRENT' || currentStepIdentifier === detectedStepId)) {
                // Complete the step (summary will be generated asynchronously)
                // Use admin client for RLS bypass
                const adminSupabase = getAdminSupabaseClient();
                await completeStep(
                  adminSupabase,
                  conversationThread.id,
                  stepIdToComplete!,
                  undefined, // No pre-generated summary - let the async agent generate it
                  askRow.id // Pass askSessionId to trigger async summary generation
                );
              }
            }
          } catch (planError) {
            console.error('Failed to update conversation plan:', planError);
            // Don't fail the request if plan update fails
          }
        }

        // Handle subtopic signals (TOPICS_DISCOVERED, TOPIC_EXPLORED, TOPIC_SKIPPED)
        // Note: This runs for all messages, not just step completions
        if (conversationThread) {
          try {
            const adminSupabase = getAdminSupabaseClient();
            const subtopicResult = await handleSubtopicSignals(
              adminSupabase,
              conversationThread.id,
              latestAiResponse
            );
            if (subtopicResult) {
              console.log('[respond] 📝 Text subtopic signals handled:', subtopicResult);
            }
          } catch (subtopicError) {
            console.error('[respond] ⚠️ Failed to handle subtopic signals:', subtopicError);
            // Don't fail the request if subtopic handling fails
          }
        }
        }
      }
    } else {
      const latestAiMessage = [...messages].reverse().find(msg => msg.senderType === 'ai');
      if (latestAiMessage) {
        // BUG-014 FIX: In consultant mode, use empty string since AI doesn't generate responses
        // This prevents stale AI responses from being used in insight detection
        latestAiResponse = isConsultantMode ? '' : latestAiMessage.content;
        detectionMessageId = latestAiMessage.id;
      }
    }

    const conversationMessages = messages.map(m => ({
      id: m.id,
      senderType: m.senderType,
      senderName: m.senderName ?? 'Participant',
      content: m.content,
      timestamp: m.timestamp,
    }));

    const detectionVariables = buildConversationAgentVariables({
      ask: askRow,
      project: projectData,
      challenge: challengeData,
      messages: conversationMessages,
      participants: participantSummaries,
      currentParticipantName: currentParticipant?.name ?? null,
      conversationPlan,
      elapsedActiveSeconds,
      stepElapsedActiveSeconds,
      insights: existingInsights,
      latestAiResponse,
      insightTypes,
    });

    let refreshedInsights: Insight[] = existingInsights;

    // Only trigger insight detection if we have a valid message ID
    // For voice messages, insight detection is optional and shouldn't fail the request
    if (detectionMessageId) {
      try {
        refreshedInsights = await triggerInsightDetection(
          supabase,
          {
            askSessionId: askRow.id,
            messageId: detectionMessageId,
            variables: detectionVariables,
            conversationThreadId: conversationThread?.id ?? null,
            challengeId: askRow.challenge_id ?? null,
            projectId: askRow.project_id ?? null,
          },
          insightRows,
          insightAuthorFallbackId, // BUG-SECTION-H FIX: Use message author, not consultant
        );
      } catch (error) {
        // For voice messages, don't fail the entire request if insight detection fails
        // Just log the error and continue with existing insights
        console.error('Insight detection failed (non-blocking for voice messages):', parseErrorMessage(error));
        if (!isVoiceMessage) {
          // Only throw for non-voice messages to maintain existing behavior
          throw error;
        }
      }
    }

    return NextResponse.json<ApiResponse<{ message?: Message; insights: Insight[]; conversationPlan?: typeof updatedConversationPlan }>>({
      success: true,
      data: {
        message,
        insights: refreshedInsights,
        // Include updated conversation plan if a step was completed (for voice mode step completion)
        ...(updatedConversationPlan ? { conversationPlan: updatedConversationPlan } : {}),
      },
    });
  } catch (error) {
    console.error('Error executing AI response pipeline:', error);
    Sentry.captureException(error, {
      tags: { route: 'ask/[key]/respond', method: 'POST' },
    });
    return NextResponse.json<ApiResponse>({
      success: false,
      error: parseErrorMessage(error)
    }, { status: 500 });
  }
}
