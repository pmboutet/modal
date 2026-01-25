import { devLog, devWarn, devError } from '@/lib/utils';
import type {
  SemanticTurnDetectorConfig,
  SemanticTurnFallbackMode,
} from "./turn-detection-config";

export type SemanticTurnMessage = {
  role: "user" | "assistant";
  content: string;
};

export type SemanticTurnTrigger = "end_of_utterance" | "silence_timeout" | "semantic_grace" | "utterance_debounce";

export type SemanticTurnDecision = "dispatch" | "hold" | "fallback" | "skipped";

export interface SemanticTurnTelemetryEvent {
  trigger: SemanticTurnTrigger;
  probability: number | null;
  threshold?: number;
  decision: SemanticTurnDecision;
  reason?: string;
  pendingChars?: number;
  pendingWords?: number;
  holdMs?: number;
  timestamp: string;
}

export interface SemanticTurnDetector {
  getSemanticEotProb(messages: SemanticTurnMessage[]): Promise<number | null>;
}

class HttpSemanticTurnDetector implements SemanticTurnDetector {
  constructor(private readonly config: SemanticTurnDetectorConfig) {}

  async getSemanticEotProb(messages: SemanticTurnMessage[]): Promise<number | null> {
    if (!this.config.enabled || !messages.length) {
      return null;
    }

    const prompt = formatMessagesAsChatML(messages.slice(-this.config.contextMessages));

    // Check if using local API endpoint (our secure proxy)
    const isLocalEndpoint = this.config.baseUrl.includes('/api/semantic-turn');
    const url = isLocalEndpoint
      ? this.config.baseUrl
      : new URL("/v1/completions", this.config.baseUrl).toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      devLog('[TurnDetection] 📤 Calling semantic model', {
        provider: this.config.provider,
        model: this.config.model,
        baseUrl: this.config.baseUrl,
        isLocalEndpoint,
        contextMessages: messages.length,
      });

      const response = await fetch(url, {
        method: "POST",
        headers: this.buildHeaders(isLocalEndpoint),
        body: JSON.stringify({
          model: this.config.model,
          prompt,
          max_tokens: 1,
          temperature: 0,
          logprobs: this.config.topLogprobs,
          stream: false,
        }),
        signal: controller.signal,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        devWarn("[TurnDetection] API error", {
          status: response.status,
          payload,
        });
        return null;
      }

      const logprobMap = extractTopLogprobs(payload);
      const probability = calculateTrackedProbability(logprobMap, this.config.trackedTokens);
      devLog('[TurnDetection] 📥 Semantic model response', {
        provider: this.config.provider,
        model: this.config.model,
        probability,
        trackedTokens: this.config.trackedTokens,
      });
      return probability;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        devWarn("[TurnDetection] Request aborted (timeout)", {
          timeout: this.config.requestTimeoutMs,
        });
        return null;
      }
      devError("[TurnDetection] Failed to compute probability", error);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildHeaders(isLocalEndpoint: boolean = false): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    // Only add Authorization header if not using local endpoint (local endpoint handles auth server-side)
    if (!isLocalEndpoint && this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }
}

export function createSemanticTurnDetector(
  config: SemanticTurnDetectorConfig,
): SemanticTurnDetector | null {
  if (!config.enabled) {
    return null;
  }
  return new HttpSemanticTurnDetector(config);
}

export function formatMessagesAsChatML(messages: SemanticTurnMessage[]): string {
  const formatted = messages
    .map(message => {
      const role = message.role === "assistant" ? "assistant" : "user";
      const content = (message.content || "").trim();
      return `<|im_start|>${role}\n${content}\n<|im_end|>`;
    })
    .join("\n");

  return `${formatted}\n<|im_start|>assistant\n`.trimStart();
}

export function extractTopLogprobs(payload: any): Record<string, number> | null {
  const choice = payload?.choices?.[0];
  if (!choice) {
    return null;
  }

  const logprobs = choice.logprobs;
  if (!logprobs) {
    return null;
  }

  if (Array.isArray(logprobs.top_logprobs) && logprobs.top_logprobs[0]) {
    return normalizeLogprobMap(logprobs.top_logprobs[0]);
  }

  if (Array.isArray(logprobs.content) && logprobs.content[0]?.top_logprobs) {
    return normalizeLogprobMap(logprobs.content[0].top_logprobs);
  }

  if (Array.isArray(logprobs.tokens) && Array.isArray(logprobs.token_logprobs)) {
    const firstLogprob = logprobs.token_logprobs[0];
    const firstToken = logprobs.tokens[0];
    if (typeof firstToken === "string" && typeof firstLogprob === "number") {
      return { [firstToken]: firstLogprob };
    }
  }

  return null;
}

export function normalizeLogprobMap(
  input: Record<string, number> | Record<string, string>,
): Record<string, number> {
  return Object.entries(input).reduce<Record<string, number>>((acc, [token, value]) => {
    const logprob = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(logprob)) {
      acc[token] = logprob;
    }
    return acc;
  }, {});
}

export function calculateTrackedProbability(
  topLogprobs: Record<string, number> | null,
  trackedTokens: string[],
): number | null {
  if (!topLogprobs) {
    return null;
  }

  const probability = trackedTokens.reduce((sum, token) => {
    const value = topLogprobs[token];
    if (typeof value === "number") {
      return sum + Math.exp(value);
    }
    return sum;
  }, 0);

  return Math.max(0, Math.min(1, probability));
}

export interface SemanticTurnDecisionOptions {
  detector: SemanticTurnDetector;
  threshold: number;
  gracePeriodMs: number;
  maxHoldMs: number;
  fallbackMode: SemanticTurnFallbackMode;
  maxContextMessages: number;
}
