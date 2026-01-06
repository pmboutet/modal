import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminSupabaseClient } from "@/lib/supabaseAdmin";
import { fetchProjectJourneyContext, flattenChallengeTree, buildInsightSummaries, buildExistingAskSummaries, buildAskGeneratorVariables } from "@/lib/projectJourneyLoader";
import { executeAgent } from "@/lib/ai/service";
import { parseErrorMessage } from "@/lib/utils";
import {
  type AiAskGeneratorResponse,
  type AiAskInsightReference,
  type AiAskParticipantSuggestion,
  type AiAskSuggestion,
  type ApiResponse,
  type PersistedAskSuggestions,
  type ProjectChallengeNode,
} from "@/types";

const DEFAULT_AGENT_SLUG = "ask-generator";
const INTERACTION_TYPE = "challenge.ask.generator";

const requestSchema = z
  .object({
    agentSlug: z.string().trim().min(1).optional(),
    maxOutputTokens: z.number().int().positive().max(4096).optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .optional();

const deliveryModes = ["physical", "digital"] as const;
const conversationModes = ["individual_parallel", "collaborative", "group_reporter", "consultant"] as const;
const urgencyLevels = ["low", "medium", "high", "critical"] as const;
const confidenceLevels = ["low", "medium", "high"] as const;

const participantSuggestionSchema = z.object({
  id: z.string().trim().min(1).optional().nullable(),
  name: z.string().trim().min(1),
  role: z.string().trim().min(1).optional().nullable(),
  isSpokesperson: z.boolean().optional().nullable(),
});

const insightReferenceSchema = z.object({
  insightId: z.string().trim().min(1),
  title: z.string().trim().min(1).optional().nullable(),
  reason: z.string().trim().min(1).optional().nullable(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional().nullable(),
});

const askSuggestionSchema = z.object({
  referenceId: z.string().trim().min(1).optional().nullable(),
  title: z.string().trim().min(3),
  askKey: z.string().trim().min(3).max(255).regex(/^[a-zA-Z0-9._-]+$/).optional().nullable(),
  question: z.string().trim().min(5),
  summary: z.string().trim().min(1).optional().nullable(),
  description: z.string().trim().min(1).optional().nullable(),
  objective: z.string().trim().min(1).optional().nullable(),
  recommendedParticipants: z.array(participantSuggestionSchema).optional(),
  relatedInsights: z.array(insightReferenceSchema).optional(),
  followUpActions: z.array(z.string().trim().min(1)).optional(),
  confidence: z.enum(confidenceLevels).optional().nullable(),
  urgency: z.enum(urgencyLevels).optional().nullable(),
  maxParticipants: z.number().int().positive().optional().nullable(),
  allowAutoRegistration: z.boolean().optional().nullable(),
  deliveryMode: z.enum(deliveryModes).optional().nullable(),
  conversationMode: z.enum(conversationModes).optional().nullable(),
  startDate: z.string().trim().min(4).optional().nullable(),
  endDate: z.string().trim().min(4).optional().nullable(),
});

type ParsedSuggestion = z.infer<typeof askSuggestionSchema>;

function sanitizeJsonString(jsonString: string): string {
  // Remove BOM and non-printables
  let s = jsonString.replace(/^\uFEFF/, "").replace(/[\u0000-\u001F]+/g, " ");

  // Strip markdown code fences/backticks
  s = s.replace(/```[a-zA-Z]*[\s\S]*?```/g, (block) => {
    const inner = block.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "");
    return inner;
  });
  s = s.replace(/`([^`\\]*(?:\\.[^`\\]*)*)`/g, '"$1"');

  // Normalize quotes
  s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

  // Remove JS/JSONC comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/(^|[^:])\/\/.*$/gm, "$1");

  // Quote unquoted keys
  s = s.replace(/([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');

  // Convert single-quoted strings to double-quoted strings
  s = s.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, g1) => '"' + g1.replace(/\\?"/g, '\\"') + '"');

  // Remove trailing commas in objects/arrays
  s = s.replace(/,(\s*[}\]])/g, '$1');

  // Convert undefined to null; normalise booleans and null casing
  s = s.replace(/:\s*undefined(\s*[,}\]])/g, ': null$1');
  s = s.replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false');
  s = s.replace(/\bNULL\b/g, 'null');

  // Trim any noise outside first/last braces/brackets
  s = s.replace(/^[^\[{]+/, '').replace(/[^\]}]+$/, '');

  return s;
}

function extractJsonCandidate(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Empty response from agent");
  }

  if (trimmed.startsWith("```")) {
    const lines = trimmed.split(/\r?\n/);
    const startIndex = lines.findIndex(line => line.trim().startsWith("{"));
    const endIndex = lines.reduceRight((acc, line, index) => {
      if (acc !== -1) {
        return acc;
      }
      return line.trim().endsWith("}") ? index : -1;
    }, -1);

    if (startIndex >= 0 && endIndex >= startIndex) {
      return lines.slice(startIndex, endIndex + 1).join("\n");
    }
  }

  const firstBrace = trimmed.indexOf("{");
  if (firstBrace === -1) {
    return trimmed;
  }

  let braceCount = 0;
  let lastBrace = -1;

  for (let index = firstBrace; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character === "{") {
      braceCount += 1;
    } else if (character === "}") {
      braceCount -= 1;
      if (braceCount === 0) {
        lastBrace = index;
        break;
      }
    }
  }

  if (lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  const fallback = trimmed.match(/\{[\s\S]*\}/);
  return fallback ? fallback[0] : trimmed;
}

function quoteUnquotedKeysDeep(s: string): string {
  return s.replace(/([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
}

function normalizeAndRepairJson(raw: string): string[] {
  const base = extractJsonCandidate(raw);
  const attempts: string[] = [];

  // Base and simple sanitization
  attempts.push(base);
  attempts.push(sanitizeJsonString(base));

  // Quote keys, remove trailing commas
  attempts.push(quoteUnquotedKeysDeep(base).replace(/,(\s*[}\]])/g, '$1'));
  attempts.push(quoteUnquotedKeysDeep(sanitizeJsonString(base)));

  // Convert single quotes to double quotes globally
  attempts.push(base.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"'));
  attempts.push(sanitizeJsonString(base).replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"'));

  // Backticks to double-quotes
  attempts.push(base.replace(/`([^`\\]*(?:\\.[^`\\]*)*)`/g, '"$1"'));

  return attempts;
}

function coerceScalar(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const v = value.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  return value;
}

function normalizeSuggestionKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => normalizeSuggestionKeysDeep(item));
  }
  if (value && typeof value === 'object') {
    const mapping: Record<string, string> = {
      reference_id: 'referenceId',
      ask_key: 'askKey',
      recommended_participants: 'recommendedParticipants',
      related_insights: 'relatedInsights',
      follow_up_actions: 'followUpActions',
      is_spokesperson: 'isSpokesperson',
      delivery_mode: 'deliveryMode',
      conversation_mode: 'conversationMode',
      start_date: 'startDate',
      end_date: 'endDate',
      insight_id: 'insightId',
    };

    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input)) {
      const nextKey = (mapping as Record<string, string>)[key as keyof typeof mapping] || key;
      output[nextKey] = normalizeSuggestionKeysDeep(coerceScalar(val));
    }
    return output;
  }
  return coerceScalar(value);
}

function sanitizeEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (typeof value !== 'string') return undefined;
  const lowered = value.trim().toLowerCase();
  const found = allowed.find(v => v === lowered);
  return found as T | undefined;
}

function sanitizeSuggestionDomain(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeSuggestionDomain(item));
  }
  if (value && typeof value === 'object') {
    const v = { ...(value as Record<string, unknown>) };
    // Drop or fix invalid enum values to avoid hard failures
    const dm = sanitizeEnum(v.deliveryMode, deliveryModes);
    if (dm) v.deliveryMode = dm; else delete v.deliveryMode;

    const cm = sanitizeEnum(v.conversationMode, conversationModes);
    if (cm) v.conversationMode = cm; else delete v.conversationMode;

    const urg = sanitizeEnum(v.urgency, urgencyLevels);
    if (urg) v.urgency = urg; else delete v.urgency;

    const conf = sanitizeEnum(v.confidence, confidenceLevels);
    if (conf) v.confidence = conf; else delete v.confidence;

    // Ensure maxParticipants is a positive integer when present
    if (v.maxParticipants != null) {
      const n = typeof v.maxParticipants === 'number' ? v.maxParticipants : Number(v.maxParticipants);
      if (Number.isFinite(n) && n > 0) {
        v.maxParticipants = Math.floor(n);
      } else {
        delete v.maxParticipants;
      }
    }

    // Recurse known arrays
    if (Array.isArray(v.recommendedParticipants)) {
      v.recommendedParticipants = (v.recommendedParticipants as unknown[]).map(item => sanitizeSuggestionDomain(item));
    }
    if (Array.isArray(v.relatedInsights)) {
      v.relatedInsights = (v.relatedInsights as unknown[]).map(item => sanitizeSuggestionDomain(item));
    }

    return v;
  }
  return value;
}

function normaliseSuggestionPayload(payload: unknown): ParsedSuggestion[] {
  if (Array.isArray(payload)) {
    return payload.map(item => askSuggestionSchema.parse(sanitizeSuggestionDomain(normalizeSuggestionKeysDeep(item))));
  }

  if (payload && typeof payload === "object") {
    const container = payload as Record<string, unknown>;
    const possibleKeys = ["suggestions", "asks", "sessions", "data", "items"];

    for (const key of possibleKeys) {
      const value = container[key];
      if (Array.isArray(value)) {
        return value.map(item => askSuggestionSchema.parse(sanitizeSuggestionDomain(normalizeSuggestionKeysDeep(item))));
      }
    }

    return [askSuggestionSchema.parse(sanitizeSuggestionDomain(normalizeSuggestionKeysDeep(container)))];
  }

  throw new Error("Agent response does not contain ASK suggestions");
}

function parseAskSuggestions(rawContent: string): ParsedSuggestion[] {
  const attempts = normalizeAndRepairJson(rawContent);

  let lastError: unknown = null;

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt);
      return normaliseSuggestionPayload(parsed);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? new Error(`Invalid JSON response from agent: ${lastError.message}`)
    : new Error("Invalid JSON response from agent");
}

function mapSuggestionToResponse(payload: ParsedSuggestion): AiAskSuggestion {
  const participants: AiAskParticipantSuggestion[] | undefined = payload.recommendedParticipants?.map(participant => ({
    id: participant.id ?? null,
    name: participant.name,
    role: participant.role ?? null,
    isSpokesperson: participant.isSpokesperson ?? null,
  }));

  const insights: AiAskInsightReference[] | undefined = payload.relatedInsights?.map(reference => ({
    insightId: reference.insightId,
    title: reference.title ?? null,
    reason: reference.reason ?? null,
    priority: reference.priority ?? null,
  }));

  return {
    referenceId: payload.referenceId ?? null,
    title: payload.title,
    askKey: payload.askKey ?? null,
    question: payload.question,
    summary: payload.summary ?? null,
    description: payload.description ?? null,
    objective: payload.objective ?? null,
    recommendedParticipants: participants,
    relatedInsights: insights,
    followUpActions: payload.followUpActions,
    confidence: payload.confidence ?? null,
    urgency: payload.urgency ?? null,
    maxParticipants: payload.maxParticipants ?? null,
    allowAutoRegistration: payload.allowAutoRegistration ?? null,
    deliveryMode: payload.deliveryMode ?? null,
    conversationMode: payload.conversationMode ?? null,
    startDate: payload.startDate ?? null,
    endDate: payload.endDate ?? null,
  } satisfies AiAskSuggestion;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let challengeId: string | null = null;
  const supabase = getAdminSupabaseClient();

  try {
    const resolvedParams = await params;
    challengeId = z.string().uuid().parse(resolvedParams.id);
    const options = requestSchema?.parse(await request.json().catch(() => ({}))) ?? {};

    const { data: challengeRow, error: challengeError } = await supabase
      .from("challenges")
      .select("id, project_id")
      .eq("id", challengeId)
      .maybeSingle();

    if (challengeError) {
      throw challengeError;
    }

    if (!challengeRow) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: "Challenge not found",
      }, { status: 404 });
    }

    const projectId: string = challengeRow.project_id;

    // Set status to "generating" before running the agent
    const generatingPayload: PersistedAskSuggestions = {
      suggestions: [],
      status: "generating",
      lastRunAt: new Date().toISOString(),
      error: null,
    };
    await supabase
      .from("challenges")
      .update({ ai_ask_suggestions: generatingPayload })
      .eq("id", challengeId);

    const context = await fetchProjectJourneyContext(supabase, projectId);
    const { boardData } = context;
    const challenges = flattenChallengeTree(boardData.challenges);
    const targetChallenge = challenges.find(item => item.id === challengeId);

    if (!targetChallenge) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: "Challenge data unavailable",
      }, { status: 404 });
    }

    const insightSummaries = buildInsightSummaries(boardData, challengeId);
    const existingAsks = buildExistingAskSummaries(boardData, challengeId, context.askRows);

    // Use shared function for variable building (DRY)
    const variables = buildAskGeneratorVariables(boardData, targetChallenge, insightSummaries, existingAsks);

    const aiResult = await executeAgent({
      supabase,
      agentSlug: options.agentSlug ?? DEFAULT_AGENT_SLUG,
      askSessionId: null,
      messageId: null,
      interactionType: INTERACTION_TYPE,
      variables,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
    });

    const parsedSuggestions = parseAskSuggestions(aiResult.content);
    const suggestions = parsedSuggestions.map(mapSuggestionToResponse);

    // Persist completed suggestions to database
    const completedPayload: PersistedAskSuggestions = {
      suggestions,
      status: "completed",
      lastRunAt: new Date().toISOString(),
      error: null,
    };
    await supabase
      .from("challenges")
      .update({ ai_ask_suggestions: completedPayload })
      .eq("id", challengeId);

    const payload: AiAskGeneratorResponse = {
      suggestions,
      errors: suggestions.length === 0 ? ["L'agent n'a proposé aucune nouvelle ASK pour ce challenge."] : undefined,
      rawResponse: aiResult.content,
    };

    return NextResponse.json<ApiResponse<AiAskGeneratorResponse>>({
      success: true,
      data: payload,
    });
  } catch (error) {
    const errorMessage = error instanceof z.ZodError
      ? error.errors[0]?.message ?? "Invalid request"
      : parseErrorMessage(error);

    // Persist error status to database if we have a valid challengeId
    if (challengeId) {
      const errorPayload: PersistedAskSuggestions = {
        suggestions: [],
        status: "error",
        lastRunAt: new Date().toISOString(),
        error: errorMessage,
      };
      try {
        await supabase
          .from("challenges")
          .update({ ai_ask_suggestions: errorPayload })
          .eq("id", challengeId);
      } catch {
        // Silently ignore persistence errors to not mask the original error
      }
    }

    const status = error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json<ApiResponse>({
      success: false,
      error: errorMessage,
    }, { status });
  }
}
