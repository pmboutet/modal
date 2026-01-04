/**
 * Agentic executor for AI agents with tool use
 * Implements a multi-turn execution loop where agents can call tools
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiAgentRecord, AiModelConfig } from "@/types";
import type { ToolContext, ToolDefinition, ToolCallRecord } from "./tools/types";
import { TOOL_REGISTRY, getToolsForAgent, convertToAiToolDefinitions } from "./tools";
import type { AiProviderResponse, AiToolDefinition } from "./providers";

const MAX_TOOL_ITERATIONS = 10;

// ============================================================================
// Types
// ============================================================================

export interface AgenticExecutorOptions {
  supabase: SupabaseClient;
  agent: AiAgentRecord;
  modelConfig: AiModelConfig;
  systemPrompt: string;
  userPrompt: string;
  toolContext: ToolContext;
  maxOutputTokens?: number;
  temperature?: number;
  /** Callback when a tool is called */
  onToolCall?: (toolName: string, input: unknown) => void;
  /** Callback when a tool returns */
  onToolResult?: (toolName: string, result: unknown, error?: string) => void;
}

export interface AgenticExecutorResult {
  /** Final text content from the agent */
  content: string;
  /** Raw API response from the last call */
  raw: Record<string, unknown>;
  /** Captured thinking content (if extended thinking was enabled) */
  thinking?: string;
  /** All tool calls made during execution */
  toolCalls: ToolCallRecord[];
  /** Number of API iterations (1 = no tool use, 2+ = tool use involved) */
  iterations: number;
}

// ============================================================================
// Message types for multi-turn conversation
// ============================================================================

interface TextContentBlock {
  type: "text";
  text: string;
}

interface ToolUseContentBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultContentBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

interface ThinkingContentBlock {
  type: "thinking";
  thinking: string;
}

type ContentBlock = TextContentBlock | ToolUseContentBlock | ToolResultContentBlock | ThinkingContentBlock;

interface Message {
  role: "user" | "assistant";
  content: ContentBlock[] | string;
}

// ============================================================================
// Internal API caller for multi-turn messages
// ============================================================================

async function callAnthropicWithMessages(
  config: AiModelConfig,
  systemPrompt: string,
  messages: Message[],
  tools: AiToolDefinition[],
  maxOutputTokens?: number,
  temperature?: number
): Promise<AiProviderResponse> {
  const apiKey = process.env[config.apiKeyEnvVar];
  if (!apiKey) {
    throw new Error(`Missing API key for model ${config.code}`);
  }

  const baseUrl = config.baseUrl?.replace(/\/$/, "") || "https://api.anthropic.com/v1";
  const url = `${baseUrl}/messages`;

  // Determine max tokens (default 4096 if not specified)
  let maxTokens = maxOutputTokens ?? 4096;

  // If thinking mode is enabled, max_tokens must be greater than budget_tokens
  // max_tokens is the TOTAL limit (thinking + output), so we need:
  // max_tokens > thinkingBudgetTokens to leave room for actual output
  const thinkingBudget = config.thinkingBudgetTokens ?? 0;
  if (thinkingBudget > 0 && maxTokens <= thinkingBudget) {
    // Ensure at least 1024 tokens for actual output
    maxTokens = thinkingBudget + 1024;
  }

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  };

  if (typeof temperature === "number") {
    body.temperature = temperature;
  }

  if (tools.length > 0) {
    body.tools = tools;
  }

  // Add thinking mode if configured
  if (thinkingBudget > 0) {
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
  });

  const raw = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `Anthropic API error (${response.status}): ${(raw as any)?.error?.message ?? response.statusText}`
    );
  }

  // Extract text content from response
  const contentBlocks = Array.isArray((raw as any)?.content) ? (raw as any).content : [];
  const text = contentBlocks
    .filter((block: any) => block?.type === "text")
    .map((block: any) => block.text || "")
    .join("")
    .trim();

  return {
    content: text,
    raw: raw as Record<string, unknown>,
  };
}

// ============================================================================
// Main executor
// ============================================================================

/**
 * Execute an agentic loop with tool use support
 * The agent can call tools multiple times until it produces a final response
 */
export async function executeAgenticLoop(
  options: AgenticExecutorOptions
): Promise<AgenticExecutorResult> {
  const tools = getToolsForAgent(options.agent.metadata as Record<string, unknown> | null);
  const aiTools = convertToAiToolDefinitions(tools);

  console.log(`🔧 Agentic execution for ${options.agent.slug}:`, {
    enabledTools: (options.agent.metadata as Record<string, unknown> | null)?.enabled_tools,
    toolsResolved: tools.map(t => t.name),
    aiToolsCount: aiTools.length,
    hasToolContext: !!options.toolContext?.projectId,
  });

  // Build initial message
  const messages: Message[] = [
    {
      role: "user",
      content: options.userPrompt,
    },
  ];

  const allToolCalls: ToolCallRecord[] = [];
  let thinkingContent = "";
  let iterations = 0;
  let lastResponse: AiProviderResponse | null = null;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    // Call Claude
    const response = await callAnthropicWithMessages(
      options.modelConfig,
      options.systemPrompt,
      messages,
      aiTools,
      options.maxOutputTokens,
      options.temperature
    );

    lastResponse = response;

    // Parse the response content blocks
    const rawContent = (response.raw as any)?.content ?? [];
    const stopReason = (response.raw as any)?.stop_reason;

    // Extract thinking if present
    const thinkingBlocks = rawContent.filter((b: any) => b?.type === "thinking");
    for (const block of thinkingBlocks) {
      if (block.thinking) {
        thinkingContent += (thinkingContent ? "\n\n" : "") + block.thinking;
      }
    }

    // Check for tool_use blocks
    const toolUseBlocks = rawContent.filter((b: any) => b?.type === "tool_use");

    // If no tool calls, we're done
    if (toolUseBlocks.length === 0 || stopReason !== "tool_use") {
      break;
    }

    // Execute each tool call
    const toolResults: ToolResultContentBlock[] = [];

    for (const block of toolUseBlocks) {
      const toolName = block.name as string;
      const toolInput = block.input as Record<string, unknown>;
      const toolId = block.id as string;

      options.onToolCall?.(toolName, toolInput);

      const tool = TOOL_REGISTRY[toolName];
      if (!tool) {
        const errorResult: ToolResultContentBlock = {
          type: "tool_result",
          tool_use_id: toolId,
          content: JSON.stringify({ error: `Unknown tool: ${toolName}` }),
          is_error: true,
        };
        toolResults.push(errorResult);

        allToolCalls.push({
          name: toolName,
          input: toolInput,
          result: null,
          latencyMs: 0,
          error: `Unknown tool: ${toolName}`,
        });

        options.onToolResult?.(toolName, null, `Unknown tool: ${toolName}`);
        continue;
      }

      const start = Date.now();
      try {
        const result = await tool.execute(options.toolContext, toolInput);
        const latencyMs = Date.now() - start;

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolId,
          content: JSON.stringify(result),
        });

        allToolCalls.push({
          name: toolName,
          input: toolInput,
          result,
          latencyMs,
        });

        options.onToolResult?.(toolName, result);
      } catch (error) {
        const latencyMs = Date.now() - start;
        const errorMessage = error instanceof Error ? error.message : String(error);

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolId,
          content: JSON.stringify({ error: errorMessage }),
          is_error: true,
        });

        allToolCalls.push({
          name: toolName,
          input: toolInput,
          result: null,
          latencyMs,
          error: errorMessage,
        });

        options.onToolResult?.(toolName, null, errorMessage);
      }
    }

    // Add assistant response and tool results to messages
    messages.push({
      role: "assistant",
      content: rawContent,
    });

    messages.push({
      role: "user",
      content: toolResults,
    });
  }

  return {
    content: lastResponse?.content ?? "",
    raw: lastResponse?.raw ?? {},
    thinking: thinkingContent || undefined,
    toolCalls: allToolCalls,
    iterations,
  };
}

/**
 * Check if an agent has tools enabled
 */
export function agentHasTools(
  metadata: Record<string, unknown> | null
): boolean {
  if (!metadata) return false;
  const enabledTools = metadata.enabled_tools;
  return Array.isArray(enabledTools) && enabledTools.length > 0;
}
