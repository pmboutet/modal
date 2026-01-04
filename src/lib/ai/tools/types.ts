/**
 * Types for AI agent tools
 * Defines interfaces for tool execution context, definitions, and results
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Context passed to tool execution functions
 * Contains database client and scope identifiers
 */
export interface ToolContext {
  supabase: SupabaseClient;
  projectId?: string | null;
  challengeId?: string | null;
  askSessionId?: string | null;
}

/**
 * JSON Schema for tool input parameters
 */
export interface ToolInputSchema {
  type: "object";
  properties: Record<string, {
    type: string;
    description: string;
    enum?: string[];
    items?: { type: string };
    default?: unknown;
  }>;
  required?: string[];
}

/**
 * Definition of a tool that an AI agent can call
 */
export interface ToolDefinition {
  /** Unique tool name (used in tool_use blocks) */
  name: string;
  /** Description for Claude to understand when to use this tool */
  description: string;
  /** JSON Schema defining the expected input */
  input_schema: ToolInputSchema;
  /** Function that executes the tool */
  execute: (context: ToolContext, input: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Result of a tool call to send back to Claude
 */
export interface ToolCallResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * Record of a tool call for logging/debugging
 */
export interface ToolCallRecord {
  name: string;
  input: unknown;
  result: unknown;
  latencyMs: number;
  error?: string;
}
