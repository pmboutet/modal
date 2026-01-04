import { DEFAULT_MAX_OUTPUT_TOKENS } from "./constants";
import type { AiModelConfig } from "@/types";
import { DeepgramVoiceAgent, type DeepgramConfig } from "./deepgram";
import { HybridVoiceAgent, type HybridVoiceAgentConfig } from "./hybrid-voice-agent";
import { SpeechmaticsVoiceAgent, type SpeechmaticsConfig } from "./speechmatics";

export interface AiToolDefinition {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AiProviderRequest {
  systemPrompt: string;
  userPrompt: string;
  /** Optional messages array for multi-turn conversations (used by agentic executor) */
  messages?: Array<{ role: string; content: unknown }>;
  maxOutputTokens?: number;
  temperature?: number;
  tools?: AiToolDefinition[];
}

export interface AiProviderResponse {
  content: string;
  raw: Record<string, unknown>;
}

export interface AiProviderStreamResponse {
  content: string;
  done: boolean;
  raw?: Record<string, unknown>;
}

export interface VoiceAgentResponse extends AiProviderResponse {
  connect(): Promise<void>;
  onMessage(callback: (role: 'user' | 'agent', content: string, timestamp?: string) => void): void;
  onAudio(callback: (audio: Uint8Array) => void): void;
  sendAudio(audioData: ArrayBuffer): void;
  disconnect(): void;
  isConnected(): boolean;
}

export class AiProviderError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AiProviderError";
  }
}

function resolveApiKey(config: AiModelConfig): string {
  console.log('Resolving API key for config:', {
    code: config.code,
    provider: config.provider,
    model: config.model,
    apiKeyEnvVar: config.apiKeyEnvVar,
    availableEnvVars: Object.keys(process.env).filter(key => key.includes('API') || key.includes('KEY'))
  });
  
  const key = process.env[config.apiKeyEnvVar];
  console.log('API key lookup result:', {
    envVar: config.apiKeyEnvVar,
    keyExists: !!key,
    keyLength: key ? key.length : 0,
    keyPrefix: key ? key.substring(0, 10) + '...' : 'undefined'
  });
  
  if (!key) {
    throw new AiProviderError(
      `Missing API key for model ${config.code}. Define environment variable ${config.apiKeyEnvVar}.`
    );
  }
  return key;
}

function normaliseBaseUrl(config: AiModelConfig, fallback: string): string {
  if (config.baseUrl) {
    return config.baseUrl.replace(/\/$/, "");
  }
  return fallback;
}

function resolveAnthropicTokenSettings(
  config: AiModelConfig,
  requestedMaxTokens?: number,
): { maxTokens: number; thinkingBudget?: number } {
  let maxTokens = requestedMaxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  let thinkingBudget: number | undefined;

  if (config.enableThinking) {
    const desiredBudget = Math.max(1024, config.thinkingBudgetTokens ?? 10000);
    thinkingBudget = desiredBudget;

    if (maxTokens <= desiredBudget) {
      // Ensure Anthropic max_tokens is always greater than the thinking budget
      maxTokens = desiredBudget + 1024;
    }
  }

  return { maxTokens, thinkingBudget };
}

async function callAnthropic(
  config: AiModelConfig,
  request: AiProviderRequest,
  abortSignal?: AbortSignal,
): Promise<AiProviderResponse> {
  const apiKey = resolveApiKey(config);
  const baseUrl = normaliseBaseUrl(config, "https://api.anthropic.com/v1");
  const url = `${baseUrl}/messages`;

  const { maxTokens, thinkingBudget } = resolveAnthropicTokenSettings(config, request.maxOutputTokens);

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: maxTokens,
    system: request.systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: request.userPrompt,
          },
        ],
      },
    ],
  };

  if (typeof request.temperature === "number") {
    body.temperature = request.temperature;
  }

  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools;
  }

  // Add thinking mode if enabled
  if (thinkingBudget) {
    body.thinking = {
      type: "enabled",
      budget_tokens: thinkingBudget,
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };

  if (config.additionalHeaders) {
    for (const [key, value] of Object.entries(config.additionalHeaders)) {
      if (typeof value === "string") {
        headers[key] = value;
      }
    }
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: abortSignal,
  });

  const raw = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new AiProviderError(
      `Anthropic API error (${response.status}): ${raw?.error?.message ?? response.statusText}`,
      raw,
    );
  }

  const contentBlocks = Array.isArray((raw as any)?.content) ? (raw as any).content : [];
  const text = contentBlocks
    .map((block: any) => {
      if (!block) return "";
      if (typeof block === "string") return block;
      if (typeof block.text === "string") return block.text;
      if (Array.isArray(block.content)) {
        return block.content
          .map((inner: any) => (typeof inner?.text === "string" ? inner.text : ""))
          .join("");
      }
      return "";
    })
    .join("")
    .trim();

  return {
    content: text,
    raw: raw as Record<string, unknown>,
  };
}

type VertexToolCallState = {
  id?: string;
  name?: string;
  inputChunks: string[];
};

interface VertexStreamResult {
  text: string;
  events: unknown[];
  stopReason?: string;
  toolCalls: Array<{
    id?: string;
    name?: string;
    input: unknown;
    rawInput: string;
  }>;
  usage?: unknown;
}

function parseJsonSafely(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function ensureVertexBaseUrl(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    const trimmedPath = parsed.pathname.replace(/\/$/, "");
    const versionMatch = trimmedPath.match(/^\/(v\d+(beta\d+)?)/i);

    if (versionMatch && versionMatch[1]) {
      parsed.pathname = `/${versionMatch[1]}`;
    } else {
      parsed.pathname = "/v1";
    }

    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    const trimmed = baseUrl.replace(/\/$/, "");
    const fallbackMatch = trimmed.match(/\/(v\d+(beta\d+)?)(?:\/|$)/i);
    if (fallbackMatch && fallbackMatch.index !== undefined) {
      return trimmed.slice(0, fallbackMatch.index + fallbackMatch[0].length).replace(/\/$/, "");
    }
    return `${trimmed}/v1`;
  }
}

function extractFromAdditionalHeaders(
  config: AiModelConfig,
  key: string,
): string | null {
  if (!config.additionalHeaders || typeof config.additionalHeaders !== "object") {
    return null;
  }

  const value = (config.additionalHeaders as Record<string, unknown>)[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return null;
}

function resolveVertexProjectId(
  config: AiModelConfig,
  credentials: Record<string, unknown>,
): string {
  const fromHeaders =
    extractFromAdditionalHeaders(config, "projectId") ??
    extractFromAdditionalHeaders(config, "project_id");

  if (fromHeaders) {
    return fromHeaders;
  }

  const fromCredentials = credentials.project_id;

  if (typeof fromCredentials === "string" && fromCredentials.trim().length > 0) {
    return fromCredentials.trim();
  }

  throw new AiProviderError(
    `Missing Vertex AI project ID for model ${config.code}. Provide projectId in additional headers or ensure the service account JSON includes project_id.`,
  );
}

function parseLocationFromBaseUrl(baseUrl: string | null | undefined): string | null {
  if (!baseUrl) {
    return null;
  }

  try {
    const url = new URL(baseUrl);
    const hostMatch = url.hostname.match(/^([a-z0-9-]+)-aiplatform\.googleapis\.com$/i);
    if (hostMatch && hostMatch[1]) {
      return hostMatch[1];
    }

    const segments = url.pathname.split("/").filter(Boolean);
    const locationIndex = segments.indexOf("locations");
    if (locationIndex >= 0 && segments[locationIndex + 1]) {
      return segments[locationIndex + 1];
    }
  } catch {
    return null;
  }

  return null;
}

function resolveVertexLocation(config: AiModelConfig): string {
  const fromHeaders = extractFromAdditionalHeaders(config, "location");
  if (fromHeaders) {
    return fromHeaders;
  }

  const fromBaseUrl = parseLocationFromBaseUrl(config.baseUrl);
  if (fromBaseUrl) {
    return fromBaseUrl;
  }

  return "us-central1";
}

async function parseVertexStream(response: Response): Promise<VertexStreamResult> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new AiProviderError("Vertex AI streaming response has no body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const events: unknown[] = [];
  const toolState = new Map<number, VertexToolCallState>();
  const toolCalls: VertexStreamResult["toolCalls"] = [];
  let text = "";
  let stopReason: string | undefined;
  let usage: unknown;
  let streamClosed = false;

  const processEvent = (rawEvent: string): void => {
    const normalised = rawEvent.replace(/\r/g, "");
    const lines = normalised.split("\n");
    const dataLines = lines
      .map(line => line.trim())
      .filter(line => line.startsWith("data:"));

    if (dataLines.length === 0) {
      return;
    }

    const payload = dataLines
      .map(line => line.slice("data:".length).trim())
      .join("")
      .trim();

    if (!payload) {
      return;
    }

    if (payload === "[DONE]") {
      streamClosed = true;
      return;
    }

    let parsed: any = null;
    try {
      parsed = JSON.parse(payload);
      events.push(parsed);
    } catch {
      events.push({ type: "unparsed", raw: payload });
      return;
    }

    const type = parsed?.type;

    switch (type) {
      case "content_block_start": {
        const index = parsed?.index;
        if (typeof index === "number" && parsed?.content_block?.type === "tool_use") {
          toolState.set(index, {
            id: parsed.content_block.id,
            name: parsed.content_block.name,
            inputChunks: [],
          });
        }
        break;
      }
      case "content_block_delta": {
        const index = parsed?.index;
        const delta = parsed?.delta;
        if (!delta) {
          break;
        }

        if (delta.type === "text_delta" && typeof delta.text === "string") {
          text += delta.text;
        } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
          if (typeof index === "number") {
            const state = toolState.get(index);
            if (state) {
              state.inputChunks.push(delta.partial_json);
            }
          }
        }
        break;
      }
      case "content_block_stop": {
        const index = parsed?.index;
        if (typeof index === "number") {
          const state = toolState.get(index);
          if (state) {
            const rawInput = state.inputChunks.join("");
            const parsedInput = rawInput ? parseJsonSafely(rawInput) ?? rawInput : {};
            toolCalls.push({
              id: state.id,
              name: state.name,
              input: parsedInput,
              rawInput,
            });
            toolState.delete(index);
          }
        }
        break;
      }
      case "message_delta": {
        if (parsed?.delta?.stop_reason) {
          stopReason = parsed.delta.stop_reason as string;
        }
        if (parsed?.usage) {
          usage = parsed.usage;
        }
        break;
      }
      case "message_stop": {
        if (parsed?.stop_reason) {
          stopReason = parsed.stop_reason as string;
        }
        break;
      }
      case "error": {
        const errorMessage = parsed?.error?.message ?? "Unknown Vertex AI streaming error";
        throw new AiProviderError(errorMessage, parsed);
      }
      default: {
        if (type === "content_block" && typeof parsed?.content?.text === "string") {
          text += parsed.content.text;
        }
        break;
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const eventChunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (eventChunk.trim().length > 0) {
        processEvent(eventChunk);
      }
      if (streamClosed) {
        break;
      }
      boundary = buffer.indexOf("\n\n");
    }

    if (streamClosed) {
      break;
    }
  }

  if (!streamClosed) {
    buffer += decoder.decode();
    const remaining = buffer.trim();
    if (remaining.length > 0) {
      processEvent(remaining);
    }
  }

  return {
    text: text.trim(),
    events,
    stopReason,
    toolCalls,
    usage,
  };
}


async function callMistral(
  config: AiModelConfig,
  request: AiProviderRequest,
  abortSignal?: AbortSignal,
): Promise<AiProviderResponse> {
  const apiKey = resolveApiKey(config);
  const baseUrl = normaliseBaseUrl(config, "https://api.mistral.ai/v1");
  const url = `${baseUrl}/chat/completions`;

  const body = {
    model: config.model,
    temperature: request.temperature ?? 0.2,
    messages: [
      { role: "system", content: request.systemPrompt },
      { role: "user", content: request.userPrompt },
    ],
    max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  } satisfies Record<string, unknown>;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  if (config.additionalHeaders) {
    for (const [key, value] of Object.entries(config.additionalHeaders)) {
      if (typeof value === "string") {
        headers[key] = value;
      }
    }
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: abortSignal,
  });

  const raw = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new AiProviderError(
      `Mistral API error (${response.status}): ${raw?.error?.message ?? response.statusText}`,
      raw,
    );
  }

  const choices = Array.isArray((raw as any)?.choices) ? (raw as any).choices : [];
  const text = choices
    .map((choice: any) => choice?.message?.content ?? "")
    .join("\n")
    .trim();

  return {
    content: text,
    raw: raw as Record<string, unknown>,
  };
}

async function callOpenAiCompatible(
  config: AiModelConfig,
  request: AiProviderRequest,
  abortSignal?: AbortSignal,
): Promise<AiProviderResponse> {
  const apiKey = resolveApiKey(config);
  const baseUrl = normaliseBaseUrl(config, "https://api.openai.com/v1");
  const url = `${baseUrl}/chat/completions`;

  const body = {
    model: config.model,
    messages: [
      { role: "system", content: request.systemPrompt },
      { role: "user", content: request.userPrompt },
    ],
    max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  } satisfies Record<string, unknown>;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  if (config.additionalHeaders) {
    for (const [key, value] of Object.entries(config.additionalHeaders)) {
      if (typeof value === "string") {
        headers[key] = value;
      }
    }
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: abortSignal,
  });

  const raw = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new AiProviderError(
      `OpenAI compatible API error (${response.status}): ${raw?.error?.message ?? response.statusText}`,
      raw,
    );
  }

  const choices = Array.isArray((raw as any)?.choices) ? (raw as any).choices : [];
  const text = choices
    .map((choice: any) => choice?.message?.content ?? "")
    .join("\n")
    .trim();

  return {
    content: text,
    raw: raw as Record<string, unknown>,
  };
}

async function callDeepgramVoiceAgent(
  config: AiModelConfig,
  request: AiProviderRequest,
): Promise<VoiceAgentResponse> {
  const deepgramConfig: DeepgramConfig = {
    systemPrompt: request.systemPrompt,
    sttModel: config.deepgramSttModel || "nova-3",
    ttsModel: config.deepgramTtsModel || "aura-2-thalia-en",
    llmProvider: config.deepgramLlmProvider || "anthropic",
    llmModel: config.deepgramLlmModel,
  };

  const agent = new DeepgramVoiceAgent();

  // Create a VoiceAgentResponse wrapper
  let messageCallback: ((role: 'user' | 'agent', content: string, timestamp?: string) => void) | null = null;
  let audioCallback: ((audio: Uint8Array) => void) | null = null;

  agent.setCallbacks({
    onMessage: (message) => {
      if (messageCallback) {
        messageCallback(message.role, message.content, message.timestamp);
      }
    },
    onError: (error) => {
      console.error('[Deepgram Voice Agent] Error:', error);
    },
    onAudio: (audio) => {
      if (audioCallback) {
        audioCallback(audio);
      }
    },
  });

  // Wrap the agent to implement VoiceAgentResponse
  const response: VoiceAgentResponse = {
    content: "", // Voice agents don't have immediate content
    raw: {},
    async connect() {
      await agent.connect(deepgramConfig);
    },
    onMessage(callback) {
      messageCallback = callback;
    },
    onAudio(callback) {
      audioCallback = callback;
    },
    sendAudio(audioData: ArrayBuffer) {
      // DeepgramVoiceAgent handles audio through startMicrophone()
      // This method is for manual audio sending if needed
      if (agent.isConnected()) {
        // The agent sends audio automatically when microphone is started
        // This could be used for manual audio chunks if needed
      }
    },
    disconnect() {
      agent.disconnect();
    },
    isConnected() {
      return agent.isConnected();
    },
  };

  return response;
}

async function callHybridVoiceAgent(
  config: AiModelConfig,
  request: AiProviderRequest,
): Promise<VoiceAgentResponse> {
  // Note: API keys will be fetched client-side via API endpoints
  // This is because HybridVoiceAgent runs in the browser
  const hybridConfig: HybridVoiceAgentConfig = {
    systemPrompt: request.systemPrompt,
    sttModel: config.deepgramSttModel || "nova-3",
    llmProvider: config.deepgramLlmProvider || "anthropic",
    llmModel: config.deepgramLlmModel,
    // API keys will be fetched client-side via /api/elevenlabs-token and /api/llm-token
    elevenLabsApiKey: undefined, // Will be fetched client-side
    llmApiKey: undefined, // Will be fetched client-side
    elevenLabsVoiceId: config.elevenLabsVoiceId,
    elevenLabsModelId: config.elevenLabsModelId || "eleven_turbo_v2_5",
  };

  const agent = new HybridVoiceAgent();

  // Create a VoiceAgentResponse wrapper
  let messageCallback: ((role: 'user' | 'agent', content: string, timestamp?: string) => void) | null = null;
  let audioCallback: ((audio: Uint8Array) => void) | null = null;

  agent.setCallbacks({
    onMessage: (message) => {
      if (messageCallback) {
        messageCallback(message.role, message.content, message.timestamp);
      }
    },
    onError: (error) => {
      console.error('[Hybrid Voice Agent] Error:', error);
    },
    onAudio: (audio) => {
      if (audioCallback) {
        audioCallback(audio);
      }
    },
  });

  // Wrap the agent to implement VoiceAgentResponse
  const response: VoiceAgentResponse = {
    content: "", // Voice agents don't have immediate content
    raw: {},
    async connect() {
      await agent.connect(hybridConfig);
    },
    onMessage(callback) {
      messageCallback = callback;
    },
    onAudio(callback) {
      audioCallback = callback;
    },
    sendAudio(audioData: ArrayBuffer) {
      // HybridVoiceAgent handles audio through startMicrophone()
      // This method is for manual audio sending if needed
      if (agent.isConnected()) {
        // The agent sends audio automatically when microphone is started
      }
    },
    disconnect() {
      agent.disconnect();
    },
    isConnected() {
      return agent.isConnected();
    },
  };

  return response;
}

async function callSpeechmaticsVoiceAgent(
  config: AiModelConfig,
  request: AiProviderRequest,
): Promise<VoiceAgentResponse> {
  // Note: API keys will be fetched client-side via API endpoints
  // This is because SpeechmaticsVoiceAgent runs in the browser
  const speechmaticsConfig: SpeechmaticsConfig = {
    systemPrompt: request.systemPrompt,
    sttLanguage: config.speechmaticsSttLanguage || "fr",
    sttOperatingPoint: config.speechmaticsSttOperatingPoint || "enhanced",
    sttMaxDelay: config.speechmaticsSttMaxDelay || 2.0,
    sttEnablePartials: config.speechmaticsSttEnablePartials !== false, // Default to true
    llmProvider: config.speechmaticsLlmProvider || "anthropic",
    llmModel: config.speechmaticsLlmModel,
    enableThinking: config.enableThinking ?? false,
    thinkingBudgetTokens: config.thinkingBudgetTokens,
    // API keys will be fetched client-side via /api/speechmatics-token, /api/elevenlabs-token and /api/llm-token
    elevenLabsApiKey: undefined, // Will be fetched client-side
    llmApiKey: undefined, // Will be fetched client-side
    elevenLabsVoiceId: config.elevenLabsVoiceId,
    elevenLabsModelId: config.elevenLabsModelId || "eleven_turbo_v2_5",
    disableElevenLabsTTS: config.disableElevenLabsTTS || false,
  };

  const agent = new SpeechmaticsVoiceAgent();

  // Create a VoiceAgentResponse wrapper
  let messageCallback: ((role: 'user' | 'agent', content: string, timestamp?: string) => void) | null = null;
  let audioCallback: ((audio: Uint8Array) => void) | null = null;

  agent.setCallbacks({
    onMessage: (message) => {
      if (messageCallback) {
        messageCallback(message.role, message.content, message.timestamp);
      }
    },
    onError: (error) => {
      console.error('[Speechmatics Voice Agent] Error:', error);
    },
    onAudio: (audio) => {
      if (audioCallback) {
        audioCallback(audio);
      }
    },
  });

  // Wrap the agent to implement VoiceAgentResponse
  const response: VoiceAgentResponse = {
    content: "", // Voice agents don't have immediate content
    raw: {},
    async connect() {
      await agent.connect(speechmaticsConfig);
    },
    onMessage(callback) {
      messageCallback = callback;
    },
    onAudio(callback) {
      audioCallback = callback;
    },
    sendAudio(audioData: ArrayBuffer) {
      // SpeechmaticsVoiceAgent handles audio through startMicrophone()
      // This method is for manual audio sending if needed
      if (agent.isConnected()) {
        // The agent sends audio automatically when microphone is started
      }
    },
    disconnect() {
      agent.disconnect();
    },
    isConnected() {
      return agent.isConnected();
    },
  };

  return response;
}

export async function callModelProvider(
  config: AiModelConfig,
  request: AiProviderRequest,
  abortSignal?: AbortSignal,
): Promise<AiProviderResponse | VoiceAgentResponse> {
  // Use voiceAgentProvider if available (even if provider is not a voice agent), otherwise use provider
  // If voiceAgentProvider is explicitly undefined (not just missing), don't use it
  const effectiveProvider = (config.voiceAgentProvider !== undefined) 
    ? config.voiceAgentProvider 
    : config.provider;

  switch (effectiveProvider) {
    case "anthropic":
      return callAnthropic(config, request, abortSignal);
    case "mistral":
      return callMistral(config, request, abortSignal);
    case "openai":
    case "custom":
      return callOpenAiCompatible(config, request, abortSignal);
    case "deepgram-voice-agent":
      return callDeepgramVoiceAgent(config, request);
    case "speechmatics-voice-agent":
      return callSpeechmaticsVoiceAgent(config, request);
    case "hybrid-voice-agent":
      return callHybridVoiceAgent(config, request);
    default:
      throw new AiProviderError(`Unsupported AI provider: ${effectiveProvider}`);
  }
}

export async function* callModelProviderStream(
  config: AiModelConfig,
  request: AiProviderRequest,
  abortSignal?: AbortSignal,
): AsyncGenerator<AiProviderStreamResponse, void, unknown> {
  switch (config.provider) {
    case "anthropic":
      yield* callAnthropicStream(config, request, abortSignal);
      break;
    case "mistral":
      yield* callMistralStream(config, request, abortSignal);
      break;
    case "openai":
    case "custom":
      yield* callOpenAiCompatibleStream(config, request, abortSignal);
      break;
    default:
      throw new AiProviderError(`Unsupported AI provider: ${config.provider}`);
  }
}

async function* callAnthropicStream(
  config: AiModelConfig,
  request: AiProviderRequest,
  abortSignal?: AbortSignal,
): AsyncGenerator<AiProviderStreamResponse, void, unknown> {
  const apiKey = resolveApiKey(config);
  const baseUrl = normaliseBaseUrl(config, "https://api.anthropic.com/v1");
  const url = `${baseUrl}/messages`;

  const { maxTokens, thinkingBudget } = resolveAnthropicTokenSettings(config, request.maxOutputTokens);

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: maxTokens,
    system: request.systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: request.userPrompt,
          },
        ],
      },
    ],
    stream: true,
  };

  // Add thinking mode if enabled
  if (thinkingBudget) {
    body.thinking = {
      type: "enabled",
      budget_tokens: thinkingBudget,
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };

  if (config.additionalHeaders) {
    for (const [key, value] of Object.entries(config.additionalHeaders)) {
      if (typeof value === "string") {
        headers[key] = value;
      }
    }
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: abortSignal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new AiProviderError(
      `Anthropic API error (${response.status}): ${errorText}`,
    );
  }

  if (!response.body) {
    throw new AiProviderError("No response body for streaming");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            yield { content: "", done: true };
            return;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              yield { content: parsed.delta.text, done: false, raw: parsed };
            } else if (parsed.type === 'message_stop') {
              yield { content: "", done: true, raw: parsed };
              return;
            }
          } catch (error) {
            // Skip invalid JSON lines
            continue;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function* callMistralStream(
  config: AiModelConfig,
  request: AiProviderRequest,
  abortSignal?: AbortSignal,
): AsyncGenerator<AiProviderStreamResponse, void, unknown> {
  const apiKey = resolveApiKey(config);
  const baseUrl = normaliseBaseUrl(config, "https://api.mistral.ai/v1");
  const url = `${baseUrl}/chat/completions`;

  const body = {
    model: config.model,
    temperature: request.temperature ?? 0.2,
    messages: [
      { role: "system", content: request.systemPrompt },
      { role: "user", content: request.userPrompt },
    ],
    max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    stream: true,
  } satisfies Record<string, unknown>;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  if (config.additionalHeaders) {
    for (const [key, value] of Object.entries(config.additionalHeaders)) {
      if (typeof value === "string") {
        headers[key] = value;
      }
    }
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: abortSignal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new AiProviderError(
      `Mistral API error (${response.status}): ${errorText}`,
    );
  }

  if (!response.body) {
    throw new AiProviderError("No response body for streaming");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            yield { content: "", done: true };
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const choice = parsed.choices?.[0];
            if (choice?.delta?.content) {
              yield { content: choice.delta.content, done: false, raw: parsed };
            }
            if (choice?.finish_reason) {
              yield { content: "", done: true, raw: parsed };
              return;
            }
          } catch (error) {
            // Skip invalid JSON lines
            continue;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function* callOpenAiCompatibleStream(
  config: AiModelConfig,
  request: AiProviderRequest,
  abortSignal?: AbortSignal,
): AsyncGenerator<AiProviderStreamResponse, void, unknown> {
  const apiKey = resolveApiKey(config);
  const baseUrl = normaliseBaseUrl(config, "https://api.openai.com/v1");
  const url = `${baseUrl}/chat/completions`;

  const body = {
    model: config.model,
    messages: [
      { role: "system", content: request.systemPrompt },
      { role: "user", content: request.userPrompt },
    ],
    max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    stream: true,
  } satisfies Record<string, unknown>;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  if (config.additionalHeaders) {
    for (const [key, value] of Object.entries(config.additionalHeaders)) {
      if (typeof value === "string") {
        headers[key] = value;
      }
    }
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: abortSignal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new AiProviderError(
      `OpenAI compatible API error (${response.status}): ${errorText}`,
    );
  }

  if (!response.body) {
    throw new AiProviderError("No response body for streaming");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            yield { content: "", done: true };
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const choice = parsed.choices?.[0];
            if (choice?.delta?.content) {
              yield { content: choice.delta.content, done: false, raw: parsed };
            }
            if (choice?.finish_reason) {
              yield { content: "", done: true, raw: parsed };
              return;
            }
          } catch (error) {
            // Skip invalid JSON lines
            continue;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
