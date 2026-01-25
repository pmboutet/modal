import type { SupabaseClient } from '@supabase/supabase-js';
import type { InsightAuthorRow, InsightRow } from './insights';
import { captureDbError } from './supabaseQuery';

const INSIGHT_COLUMNS_COMMON = 'challenge_id, content, summary, category, status, priority, created_at, updated_at, related_challenge_ids, source_message_id';
const INSIGHT_COLUMNS_COMMON_NO_REL = 'challenge_id, content, summary, category, status, priority, created_at, updated_at, source_message_id';
const INSIGHT_COLUMNS_WITH_ASK_ID = `id, ask_session_id, ask_id, ${INSIGHT_COLUMNS_COMMON}`;
const INSIGHT_COLUMNS_WITH_ASK_ID_NO_REL = `id, ask_session_id, ask_id, ${INSIGHT_COLUMNS_COMMON_NO_REL}`;
const INSIGHT_COLUMNS_LEGACY = `id, ask_session_id, ${INSIGHT_COLUMNS_COMMON}`;
const INSIGHT_COLUMNS_LEGACY_NO_REL = `id, ask_session_id, ${INSIGHT_COLUMNS_COMMON_NO_REL}`;

function isMissingColumnError(error: unknown, column: string): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const message = (error as { message?: string }).message;
  return typeof message === 'string' && message.includes(`column insights.${column} does not exist`);
}

async function hydrateInsightAuthors(
  supabase: SupabaseClient,
  rows: InsightRow[],
): Promise<InsightRow[]> {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const insightIds = rows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  if (insightIds.length === 0) {
    return rows.map((row) => ({ ...row, insight_authors: [] }));
  }

  const { data, error } = await supabase
    .from('insight_authors')
    .select('id, insight_id, user_id, display_name')
    .in('insight_id', insightIds);

  if (error) {
    captureDbError(error, 'insight_authors', 'select', { insightIds });
    throw error;
  }

  const authorsByInsight = insightIds.reduce<Record<string, InsightAuthorRow[]>>((acc, id) => {
    acc[id] = [];
    return acc;
  }, {});

  for (const row of data ?? []) {
    const insightId = typeof row.insight_id === 'string' ? row.insight_id : null;

    if (!insightId) {
      continue;
    }

    if (!authorsByInsight[insightId]) {
      authorsByInsight[insightId] = [];
    }

    authorsByInsight[insightId].push({
      id: row.id,
      insight_id: insightId,
      user_id: row.user_id ?? null,
      display_name: row.display_name ?? null,
    });
  }

  return rows.map((row) => ({
    ...row,
    insight_authors: authorsByInsight[row.id] ?? [],
  }));
}

interface KpiRow {
  id: string;
  insight_id: string;
  name: string;
  description?: string | null;
  metric_data?: Record<string, unknown> | null;
}

async function hydrateInsightKpis(
  supabase: SupabaseClient,
  rows: InsightRow[],
): Promise<InsightRow[]> {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const insightIds = rows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  if (insightIds.length === 0) {
    return rows.map((row) => ({ ...row, kpis: [] }));
  }

  const { data, error } = await supabase
    .from('kpi_estimations')
    .select('id, insight_id, name, description, metric_data')
    .in('insight_id', insightIds);

  if (error) {
    captureDbError(error, 'kpi_estimations', 'select', { insightIds });
    throw error;
  }

  const kpisByInsight = insightIds.reduce<Record<string, Array<Record<string, unknown>>>>((acc, id) => {
    acc[id] = [];
    return acc;
  }, {});

  for (const row of data ?? []) {
    const entry = row as unknown as KpiRow;
    const insightId = entry.insight_id;
    if (!insightId) continue;
    if (!kpisByInsight[insightId]) {
      kpisByInsight[insightId] = [];
    }
    kpisByInsight[insightId].push({
      id: entry.id,
      label: entry.name,
      description: entry.description ?? null,
      value: entry.metric_data ?? undefined,
    });
  }

  return rows.map((row) => ({
    ...row,
    kpis: kpisByInsight[row.id] ?? [],
  }));
}

interface InsightTypeRow {
  id: string;
  name?: string | null;
}

async function attachInsightTypeNames(
  supabase: SupabaseClient,
  rows: InsightRow[],
): Promise<InsightRow[]> {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const typeIds = Array.from(
    new Set(
      rows
        .map((row) => (typeof row.insight_type_id === 'string' ? row.insight_type_id : null))
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  );

  if (typeIds.length === 0) {
    return rows.map((row) => ({
      ...row,
      insight_type_name:
        typeof row.insight_type_name === 'string' && row.insight_type_name.length > 0
          ? row.insight_type_name.trim().toLowerCase()
          : typeof row.type === 'string'
            ? row.type.trim().toLowerCase()
            : null,
    }));
  }

  const { data, error } = await supabase
    .from('insight_types')
    .select('id, name')
    .in('id', typeIds);

  if (error) {
    captureDbError(error, 'insight_types', 'select', { typeIds });
    throw error;
  }

  const namesById = (data ?? []).reduce<Record<string, string>>((acc, row) => {
    const entry = row as InsightTypeRow;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (typeof entry.id === 'string' && entry.id.length > 0 && name.length > 0) {
      acc[entry.id] = name.toLowerCase();
    }
    return acc;
  }, {});

  return rows.map((row) => {
    const explicitName =
      typeof row.insight_type_name === 'string' && row.insight_type_name.length > 0
        ? row.insight_type_name.trim().toLowerCase()
        : null;
    const legacyName =
      typeof row.type === 'string' && row.type.length > 0 ? row.type.trim().toLowerCase() : null;
    const lookupName =
      typeof row.insight_type_id === 'string' && row.insight_type_id.length > 0
        ? namesById[row.insight_type_id] ?? null
        : null;

    return {
      ...row,
      insight_type_name: explicitName ?? legacyName ?? lookupName ?? null,
    } satisfies InsightRow;
  });
}

async function selectInsightRows(
  supabase: SupabaseClient,
  builder: (query: any) => any,
): Promise<InsightRow[]> {
  type ColumnVariant = {
    columns: string;
    missing: string[];
    transform: (rows: InsightRow[]) => InsightRow[];
  };

  const variants: ColumnVariant[] = [
    {
      columns: `${INSIGHT_COLUMNS_WITH_ASK_ID}, insight_type_id`,
      missing: ['ask_id', 'insight_type_id', 'related_challenge_ids'],
      transform: (rows: InsightRow[]) => rows,
    },
    {
      columns: `${INSIGHT_COLUMNS_WITH_ASK_ID_NO_REL}, insight_type_id`,
      missing: ['ask_id', 'insight_type_id'],
      transform: (rows: InsightRow[]) => rows.map((row) => ({ ...row, related_challenge_ids: [] })),
    },
    {
      columns: `${INSIGHT_COLUMNS_LEGACY}, insight_type_id`,
      missing: ['insight_type_id', 'related_challenge_ids'],
      transform: (rows: InsightRow[]) =>
        rows.map((row) => ({
          ...row,
          ask_id: null,
        })),
    },
    {
      columns: `${INSIGHT_COLUMNS_LEGACY_NO_REL}, insight_type_id`,
      missing: ['insight_type_id'],
      transform: (rows: InsightRow[]) =>
        rows.map((row) => ({
          ...row,
          ask_id: null,
          related_challenge_ids: [],
        })),
    },
    {
      columns: `${INSIGHT_COLUMNS_WITH_ASK_ID}, type`,
      missing: ['ask_id', 'type', 'related_challenge_ids'],
      transform: (rows: InsightRow[]) => rows,
    },
    {
      columns: `${INSIGHT_COLUMNS_WITH_ASK_ID_NO_REL}, type`,
      missing: ['ask_id', 'type'],
      transform: (rows: InsightRow[]) => rows.map((row) => ({ ...row, related_challenge_ids: [] })),
    },
    {
      columns: `${INSIGHT_COLUMNS_LEGACY}, type`,
      missing: ['type', 'related_challenge_ids'],
      transform: (rows: InsightRow[]) =>
        rows.map((row) => ({
          ...row,
          ask_id: null,
        })),
    },
    {
      columns: `${INSIGHT_COLUMNS_LEGACY_NO_REL}, type`,
      missing: ['type'],
      transform: (rows: InsightRow[]) =>
        rows.map((row) => ({
          ...row,
          ask_id: null,
          related_challenge_ids: [],
        })),
    },
  ];

  let lastError: unknown;

  for (const variant of variants) {
    let query = supabase
      .from('insights')
      .select(variant.columns);

    query = builder(query);

    const { data, error } = await query;

    if (!error) {
      const rows = (Array.isArray(data) ? data : []) as unknown as InsightRow[];
      const typedRows = variant.transform(rows);
      const withTypes = await attachInsightTypeNames(supabase, typedRows);
      const withAuthors = await hydrateInsightAuthors(supabase, withTypes);
      return hydrateInsightKpis(supabase, withAuthors);
    }

    lastError = error;

    if (!variant.missing.some((column) => isMissingColumnError(error, column))) {
      throw error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return [];
}

export async function fetchInsightsForSession(
  supabase: SupabaseClient,
  askSessionId: string,
): Promise<InsightRow[]> {
  return selectInsightRows(supabase, (query) =>
    query
      .eq('ask_session_id', askSessionId)
      .order('created_at', { ascending: true }),
  );
}

/**
 * Fetch insights for a specific conversation thread with properly resolved types.
 * This replaces the legacy getInsightsForThread which didn't hydrate type names.
 */
export async function fetchInsightsForThread(
  supabase: SupabaseClient,
  conversationThreadId: string,
): Promise<InsightRow[]> {
  return selectInsightRows(supabase, (query) =>
    query
      .eq('conversation_thread_id', conversationThreadId)
      .order('created_at', { ascending: true }),
  );
}

export async function fetchInsightRowById(
  supabase: SupabaseClient,
  insightId: string,
): Promise<InsightRow | null> {
  const rows = await selectInsightRows(supabase, (query) => query.eq('id', insightId).limit(1));
  return rows[0] ?? null;
}

export async function fetchInsightTypeMap(
  supabase: SupabaseClient,
): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from('insight_types')
    .select('id, name');

  if (error) {
    captureDbError(error, 'insight_types', 'select');
    throw error;
  }

  return (data ?? []).reduce<Record<string, string>>((acc, row) => {
    const entry = row as InsightTypeRow;
    const name = typeof entry.name === 'string' ? entry.name.trim().toLowerCase() : '';
    if (name.length > 0 && typeof entry.id === 'string') {
      acc[name] = entry.id;
    }
    return acc;
  }, {});
}

/**
 * Fetch insight types formatted for AI prompt
 */
export async function fetchInsightTypesForPrompt(
  supabase: SupabaseClient,
): Promise<string> {
  const { data, error } = await supabase
    .from('insight_types')
    .select('name')
    .order('name', { ascending: true });

  if (error) {
    captureDbError(error, 'insight_types', 'select');
    throw error;
  }

  const types = (data ?? [])
    .map(row => (row as InsightTypeRow).name)
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    .map(name => name.toLowerCase());

  if (types.length === 0) {
    return 'pain, idea, solution, opportunity, risk, feedback, question';
  }

  return types.join(', ');
}
