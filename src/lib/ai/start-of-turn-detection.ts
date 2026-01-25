/**
 * Start-of-Turn Detection
 *
 * Uses LLM to validate if detected speech is:
 * 1. A genuine start of user speech (not noise/background)
 * 2. Not an echo of what the assistant is currently saying
 *
 * Similar to end-of-turn detection but validates the START of user interruption
 */

import { devLog, devWarn, devError } from '@/lib/utils';

export interface StartOfTurnMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StartOfTurnDetectorConfig {
  enabled: boolean;
  provider: "openai" | "anthropic";
  model: string;
  apiKey?: string;
  requestTimeoutMs: number;
}

export interface StartOfTurnValidationResult {
  isValidStart: boolean;
  isEcho: boolean;
  confidence: number;
  reason?: string;
}

export interface StartOfTurnDetector {
  validateStartOfTurn(
    userTranscript: string,
    currentAssistantSpeech: string,
    conversationHistory: StartOfTurnMessage[]
  ): Promise<StartOfTurnValidationResult>;
}

class LLMStartOfTurnDetector implements StartOfTurnDetector {
  constructor(private readonly config: StartOfTurnDetectorConfig) {}

  async validateStartOfTurn(
    userTranscript: string,
    currentAssistantSpeech: string,
    conversationHistory: StartOfTurnMessage[]
  ): Promise<StartOfTurnValidationResult> {
    if (!this.config.enabled) {
      return {
        isValidStart: true,
        isEcho: false,
        confidence: 0.5,
        reason: "Detector disabled",
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const timestamp = new Date().toISOString().split('T')[1].replace('Z', '');
      devLog(`[${timestamp}] [StartOfTurn] 📤 Validating start of turn`, {
        userTranscript: userTranscript.substring(0, 50),
        assistantSpeech: currentAssistantSpeech.substring(0, 50),
        provider: this.config.provider,
      });

      const result = this.config.provider === "anthropic"
        ? await this.validateWithAnthropic(userTranscript, currentAssistantSpeech, conversationHistory, controller.signal)
        : await this.validateWithOpenAI(userTranscript, currentAssistantSpeech, conversationHistory, controller.signal);

      const ts = new Date().toISOString().split('T')[1].replace('Z', '');
      devLog(`[${ts}] [StartOfTurn] 📥 Validation result`, {
        isValidStart: result.isValidStart,
        isEcho: result.isEcho,
        confidence: result.confidence,
        reason: result.reason,
      });

      return result;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        devWarn("[StartOfTurn] Validation timeout - assuming valid start");
        return {
          isValidStart: true,
          isEcho: false,
          confidence: 0.5,
          reason: "Timeout - assuming valid",
        };
      }
      devError("[StartOfTurn] Validation error - assuming valid start", error);
      return {
        isValidStart: true,
        isEcho: false,
        confidence: 0.5,
        reason: "Error - assuming valid",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async validateWithAnthropic(
    userTranscript: string,
    currentAssistantSpeech: string,
    conversationHistory: StartOfTurnMessage[],
    signal: AbortSignal
  ): Promise<StartOfTurnValidationResult> {
    // Call our secure API endpoint instead of calling Anthropic directly
    const response = await fetch("/api/start-of-turn", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userTranscript,
        currentAssistantSpeech,
        conversationHistory,
        provider: "anthropic",
        model: this.config.model,
      }),
      signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Start-of-turn API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    return await response.json();
  }

  private async validateWithOpenAI(
    userTranscript: string,
    currentAssistantSpeech: string,
    conversationHistory: StartOfTurnMessage[],
    signal: AbortSignal
  ): Promise<StartOfTurnValidationResult> {
    // Call our secure API endpoint instead of calling OpenAI directly
    const response = await fetch("/api/start-of-turn", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userTranscript,
        currentAssistantSpeech,
        conversationHistory,
        provider: "openai",
        model: this.config.model,
      }),
      signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Start-of-turn API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    return await response.json();
  }
}

export function createStartOfTurnDetector(
  config: StartOfTurnDetectorConfig
): StartOfTurnDetector | null {
  if (!config.enabled) {
    return null;
  }
  return new LLMStartOfTurnDetector(config);
}

/**
 * Resolve configuration from environment variables with sensible defaults
 *
 * Default configuration:
 * - Enabled: true
 * - Provider: anthropic (Claude Haiku is faster and cheaper than GPT-4o-mini for this task)
 * - Model: claude-3-5-haiku-latest
 * - Timeout: 800ms (fast response needed for real-time barge-in)
 * - API key: Falls back to ANTHROPIC_API_KEY from environment (server-side only)
 */
export function resolveStartOfTurnDetectorConfig(): StartOfTurnDetectorConfig {
  // Provider selection with default to Anthropic (better for low-latency tasks)
  const provider = (
    process.env.NEXT_PUBLIC_START_OF_TURN_PROVIDER ||
    process.env.START_OF_TURN_PROVIDER ||
    "anthropic"  // Default: Anthropic Claude Haiku (faster, cheaper)
  ).toLowerCase() as "openai" | "anthropic";

  // Enabled by default - can be disabled via env var
  const enabled = (
    process.env.NEXT_PUBLIC_START_OF_TURN_ENABLED ||
    process.env.START_OF_TURN_ENABLED ||
    "true"
  ).toLowerCase() === "true";

  // Model selection with provider-specific defaults
  const model =
    process.env.NEXT_PUBLIC_START_OF_TURN_MODEL ||
    process.env.START_OF_TURN_MODEL ||
    (provider === "anthropic" ? "claude-3-5-haiku-latest" : "gpt-4o-mini");

  // API key resolution - not needed for client-side (using API proxy)
  // This is only here for backwards compatibility but shouldn't be used
  const apiKey =
    process.env.NEXT_PUBLIC_START_OF_TURN_API_KEY ||
    process.env.START_OF_TURN_API_KEY ||
    undefined;  // Server-side API route handles API keys

  // Timeout for AI validation request (800ms is good balance between accuracy and UX)
  const requestTimeoutMs = parseInt(
    process.env.NEXT_PUBLIC_START_OF_TURN_TIMEOUT_MS ||
    process.env.START_OF_TURN_TIMEOUT_MS ||
    "800",  // Default: 800ms timeout
    10
  );

  return {
    enabled,
    provider,
    model,
    apiKey,
    requestTimeoutMs,
  };
}
