import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiAgentInteractionStatus, AiAgentLog } from "@/types";

interface AiAgentLogRow {
  id: string;
  agent_id?: string | null;
  model_config_id?: string | null;
  ask_session_id?: string | null;
  message_id?: string | null;
  interaction_type: string;
  request_payload: Record<string, unknown>;
  response_payload?: Record<string, unknown> | null;
  status: string;
  error_message?: string | null;
  latency_ms?: number | null;
  created_at: string;
}

function mapLogRow(row: AiAgentLogRow): AiAgentLog {
  return {
    id: row.id,
    agentId: row.agent_id ?? null,
    modelConfigId: row.model_config_id ?? null,
    askSessionId: row.ask_session_id ?? null,
    messageId: row.message_id ?? null,
    interactionType: row.interaction_type,
    requestPayload: row.request_payload ?? {},
    responsePayload: row.response_payload ?? null,
    status: row.status as AiAgentInteractionStatus,
    errorMessage: row.error_message ?? null,
    latencyMs: row.latency_ms ?? null,
    createdAt: row.created_at,
  };
}

export async function createAgentLog(
  supabase: SupabaseClient,
  payload: {
    agentId?: string | null;
    modelConfigId?: string | null;
    askSessionId?: string | null;
    messageId?: string | null;
    interactionType: string;
    requestPayload: Record<string, unknown>;
  }
): Promise<AiAgentLog> {
  const { data, error } = await supabase
    .from("ai_agent_logs")
    .insert({
      agent_id: payload.agentId ?? null,
      model_config_id: payload.modelConfigId ?? null,
      ask_session_id: payload.askSessionId ?? null,
      message_id: payload.messageId ?? null,
      interaction_type: payload.interactionType,
      request_payload: payload.requestPayload,
      status: "pending",
    })
    .select("*")
    .single<AiAgentLogRow>();

  if (error) {
    throw error;
  }

  return mapLogRow(data);
}

export async function markAgentLogProcessing(
  supabase: SupabaseClient,
  logId: string,
  payload: { modelConfigId?: string | null }
): Promise<void> {
  const { error } = await supabase
    .from("ai_agent_logs")
    .update({
      status: "processing",
      model_config_id: payload.modelConfigId ?? null,
    })
    .eq("id", logId);

  if (error) {
    throw error;
  }
}

export interface ToolCallLogEntry {
  name: string;
  input: unknown;
  result: unknown;
  latencyMs: number;
  error?: string;
}

export async function completeAgentLog(
  supabase: SupabaseClient,
  logId: string,
  payload: {
    responsePayload: Record<string, unknown>;
    latencyMs?: number;
    /** Tool calls to store in dedicated column for easy querying */
    toolCalls?: ToolCallLogEntry[];
  }
): Promise<void> {
  const { error } = await supabase
    .from("ai_agent_logs")
    .update({
      status: "completed",
      response_payload: payload.responsePayload,
      latency_ms: payload.latencyMs ?? null,
      // Store tool_calls in dedicated JSONB column if provided
      tool_calls: payload.toolCalls && payload.toolCalls.length > 0
        ? payload.toolCalls
        : null,
    })
    .eq("id", logId);

  if (error) {
    throw error;
  }
}

export async function failAgentLog(
  supabase: SupabaseClient,
  logId: string,
  errorMessage: string,
): Promise<void> {
  const { error } = await supabase
    .from("ai_agent_logs")
    .update({
      status: "failed",
      error_message: errorMessage,
    })
    .eq("id", logId);

  if (error) {
    throw error;
  }
}

export async function listAgentLogs(
  supabase: SupabaseClient,
  options: { limit?: number }
): Promise<AiAgentLog[]> {
  const { data, error } = await supabase
    .from("ai_agent_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 100);

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapLogRow);
}

// ============================================================================
// Streaming Debug Logs
// ============================================================================

export interface StreamingChunk {
  index: number;
  content: string;
  contentLength: number;
  timestamp: number;
  timeSinceStart: number;
  timeSincePrevious: number;
  raw?: Record<string, unknown>;
}

export interface StreamingStats {
  totalChunks: number;
  totalContentLength: number;
  totalDurationMs: number;
  averageChunkSize: number;
  averageTimeBetweenChunks: number;
  firstChunkLatencyMs: number;
  maxTimeBetweenChunks: number;
  minTimeBetweenChunks: number;
}

export interface StreamingDebugLog {
  logId: string;
  startTime: number;
  chunks: StreamingChunk[];
  stats: StreamingStats | null;
  error?: string;
}

/**
 * Creates a streaming debug logger to track chunk-by-chunk streaming data.
 * Use this for debugging streaming issues.
 */
export function createStreamingDebugLogger(logId: string): {
  logChunk: (content: string, raw?: Record<string, unknown>) => void;
  logError: (error: string) => void;
  finalize: () => StreamingDebugLog;
  getStats: () => StreamingStats | null;
} {
  const startTime = Date.now();
  const chunks: StreamingChunk[] = [];
  let errorMessage: string | undefined;

  return {
    logChunk(content: string, raw?: Record<string, unknown>) {
      const now = Date.now();
      const timeSinceStart = now - startTime;
      const timeSincePrevious = chunks.length > 0
        ? now - chunks[chunks.length - 1].timestamp
        : timeSinceStart;

      chunks.push({
        index: chunks.length,
        content,
        contentLength: content.length,
        timestamp: now,
        timeSinceStart,
        timeSincePrevious,
        raw,
      });
    },

    logError(error: string) {
      errorMessage = error;
    },

    getStats(): StreamingStats | null {
      if (chunks.length === 0) return null;

      const totalContentLength = chunks.reduce((sum, c) => sum + c.contentLength, 0);
      const totalDurationMs = chunks.length > 0
        ? chunks[chunks.length - 1].timeSinceStart
        : 0;
      const timeBetweenChunks = chunks.slice(1).map(c => c.timeSincePrevious);

      return {
        totalChunks: chunks.length,
        totalContentLength,
        totalDurationMs,
        averageChunkSize: totalContentLength / chunks.length,
        averageTimeBetweenChunks: timeBetweenChunks.length > 0
          ? timeBetweenChunks.reduce((a, b) => a + b, 0) / timeBetweenChunks.length
          : 0,
        firstChunkLatencyMs: chunks.length > 0 ? chunks[0].timeSinceStart : 0,
        maxTimeBetweenChunks: timeBetweenChunks.length > 0
          ? Math.max(...timeBetweenChunks)
          : 0,
        minTimeBetweenChunks: timeBetweenChunks.length > 0
          ? Math.min(...timeBetweenChunks)
          : 0,
      };
    },

    finalize(): StreamingDebugLog {
      return {
        logId,
        startTime,
        chunks,
        stats: this.getStats(),
        error: errorMessage,
      };
    },
  };
}

/**
 * Builds the response payload with streaming debug information for completeAgentLog.
 */
export function buildStreamingResponsePayload(
  fullContent: string,
  debugLog: StreamingDebugLog
): Record<string, unknown> {
  return {
    content: fullContent,
    streaming: true,
    streamingDebug: {
      stats: debugLog.stats,
      chunks: debugLog.chunks.map(c => ({
        index: c.index,
        contentLength: c.contentLength,
        timeSinceStart: c.timeSinceStart,
        timeSincePrevious: c.timeSincePrevious,
        // Include first 100 chars of content for debugging
        contentPreview: c.content.slice(0, 100) + (c.content.length > 100 ? '...' : ''),
      })),
      error: debugLog.error,
    },
  };
}
