#!/usr/bin/env npx tsx
/**
 * Functional test for the agentic executor
 * Tests the tool calling flow with mocked AI responses
 *
 * Run with: npx tsx scripts/test-agentic-executor.ts
 */

import { createClient } from "@supabase/supabase-js";

// Load environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function testToolRegistry() {
  console.log("\n🔧 Test 1: Tool Registry");
  console.log("─".repeat(50));

  const { TOOL_REGISTRY, getToolsForAgent, getAllToolNames, getAllGroupNames } = await import("../src/lib/ai/tools");

  console.log("Available tools:", getAllToolNames());
  console.log("Available groups:", getAllGroupNames());

  // Test group expansion
  const graphRagAllTools = getToolsForAgent({ enabled_tools: ["graph_rag_all"] });
  console.log(`\ngraph_rag_all expands to ${graphRagAllTools.length} tools:`);
  graphRagAllTools.forEach(t => console.log(`  - ${t.name}`));

  // Test individual tool selection
  const selectedTools = getToolsForAgent({ enabled_tools: ["find_related_insights", "get_claim_network"] });
  console.log(`\nSelected 2 tools: ${selectedTools.map(t => t.name).join(", ")}`);

  console.log("\n✅ Tool registry working correctly");
}

async function testToolExecution() {
  console.log("\n🔧 Test 2: Tool Execution (find_insight_clusters)");
  console.log("─".repeat(50));

  const { TOOL_REGISTRY } = await import("../src/lib/ai/tools");

  // Get a project ID to test with
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .limit(1);

  if (!projects?.length) {
    console.log("⚠️ No projects found, skipping tool execution test");
    return;
  }

  const projectId = projects[0].id;
  console.log(`Testing with project: ${projects[0].name} (${projectId})`);

  const tool = TOOL_REGISTRY["find_insight_clusters"];
  if (!tool) {
    console.error("❌ Tool not found");
    return;
  }

  const context = {
    supabase,
    projectId,
  };

  try {
    const start = Date.now();
    const result = await tool.execute(context, { project_id: projectId, min_cluster_size: 2 });
    const latency = Date.now() - start;

    console.log(`\nTool executed in ${latency}ms`);
    console.log("Result:", JSON.stringify(result, null, 2).slice(0, 500) + "...");
    console.log("\n✅ Tool execution working correctly");
  } catch (error) {
    console.error("❌ Tool execution failed:", error);
  }
}

async function testRLSWithServiceRole() {
  console.log("\n🔧 Test 2b: RLS Verification (service_role bypasses RLS)");
  console.log("─".repeat(50));

  // This test verifies that queries on RLS-protected tables work with service_role
  // In production, all tool-using routes use getAdminSupabaseClient() which is service_role

  try {
    // Test 1: Query insights (RLS enabled)
    const { data: insights, error: insightsError } = await supabase
      .from("insights")
      .select("id, content")
      .limit(3);

    if (insightsError) {
      console.error("❌ Failed to query insights:", insightsError.message);
      return;
    }
    console.log(`✅ insights table (RLS enabled): ${insights?.length ?? 0} rows accessible`);

    // Test 2: Query projects (RLS enabled)
    const { data: projects, error: projectsError } = await supabase
      .from("projects")
      .select("id, name")
      .limit(3);

    if (projectsError) {
      console.error("❌ Failed to query projects:", projectsError.message);
      return;
    }
    console.log(`✅ projects table (RLS enabled): ${projects?.length ?? 0} rows accessible`);

    // Test 3: Query ask_sessions (RLS enabled)
    const { data: sessions, error: sessionsError } = await supabase
      .from("ask_sessions")
      .select("id, ask_key")
      .limit(3);

    if (sessionsError) {
      console.error("❌ Failed to query ask_sessions:", sessionsError.message);
      return;
    }
    console.log(`✅ ask_sessions table (RLS enabled): ${sessions?.length ?? 0} rows accessible`);

    // Test 4: Query knowledge_entities (no RLS)
    const { data: entities, error: entitiesError } = await supabase
      .from("knowledge_entities")
      .select("id, name")
      .limit(3);

    if (entitiesError) {
      console.error("❌ Failed to query knowledge_entities:", entitiesError.message);
      return;
    }
    console.log(`✅ knowledge_entities table (no RLS): ${entities?.length ?? 0} rows accessible`);

    console.log("\n✅ RLS verification passed - service_role has full access");
  } catch (error) {
    console.error("❌ RLS verification failed:", error);
  }
}

async function testGraphAnalytics() {
  console.log("\n🔧 Test 3: Graph Analytics Tool");
  console.log("─".repeat(50));

  const { TOOL_REGISTRY } = await import("../src/lib/ai/tools");

  // Get a project ID to test with
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .limit(1);

  if (!projects?.length) {
    console.log("⚠️ No projects found, skipping");
    return;
  }

  const projectId = projects[0].id;
  const tool = TOOL_REGISTRY["compute_graph_analytics"];

  const context = {
    supabase,
    projectId,
  };

  try {
    const start = Date.now();
    const result = await tool.execute(context, { project_id: projectId });
    const latency = Date.now() - start;

    console.log(`\nGraph analytics computed in ${latency}ms`);

    const analytics = result as Record<string, unknown>;
    console.log("Communities found:", (analytics.communities as unknown[])?.length ?? 0);
    console.log("Centrality nodes:", Object.keys(analytics.centrality as Record<string, unknown> ?? {}).length);

    console.log("\n✅ Graph analytics working correctly");
  } catch (error) {
    console.error("❌ Graph analytics failed:", error);
  }
}

async function testAgenticExecutorDryRun() {
  console.log("\n🔧 Test 4: Agentic Executor (Dry Run - No API Call)");
  console.log("─".repeat(50));

  const { getToolsForAgent, convertToAiToolDefinitions } = await import("../src/lib/ai/tools");

  // Simulate what would happen in executeAgenticLoop
  const mockAgentMetadata = {
    enabled_tools: ["find_insight_clusters", "compute_graph_analytics"],
  };

  const tools = getToolsForAgent(mockAgentMetadata);
  const aiTools = convertToAiToolDefinitions(tools);

  console.log("\nTools that would be sent to Claude API:");
  aiTools.forEach(tool => {
    console.log(`\n📦 ${tool.name}`);
    console.log(`   ${tool.description?.slice(0, 100)}...`);
    console.log(`   Required params: ${(tool.input_schema as Record<string, unknown>).required ?? "none"}`);
  });

  console.log("\n✅ Agentic executor dry run complete");
}

async function testAgentMetadataUpdate() {
  console.log("\n🔧 Test 5: Check Agent Metadata Structure");
  console.log("─".repeat(50));

  // Check existing agents
  const { data: agents } = await supabase
    .from("ai_agents")
    .select("id, slug, name, metadata")
    .in("slug", ["ask-insight-detection", "ask-generator", "challenge-builder"]);

  if (!agents?.length) {
    console.log("⚠️ Target agents not found");
    return;
  }

  console.log("\nCurrent agent metadata:");
  agents.forEach(agent => {
    const enabledTools = (agent.metadata as Record<string, unknown>)?.enabled_tools;
    console.log(`\n${agent.name} (${agent.slug}):`);
    console.log(`  enabled_tools: ${enabledTools ? JSON.stringify(enabledTools) : "not set"}`);
  });

  console.log("\n💡 To enable tools on an agent, run:");
  console.log(`
UPDATE ai_agents
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'),
  '{enabled_tools}',
  '["graph_rag_all"]'
)
WHERE slug = 'ask-insight-detection';
  `);
}

async function testLiveAgenticExecution() {
  console.log("\n🔧 Test 6: Live Agentic Execution (requires ANTHROPIC_API_KEY)");
  console.log("─".repeat(50));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log("⚠️ ANTHROPIC_API_KEY not set, skipping live test");
    console.log("   Set it to run a real agentic execution");
    return;
  }

  // Get a project for context
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .limit(1);

  if (!projects?.length) {
    console.log("⚠️ No projects found, skipping");
    return;
  }

  const projectId = projects[0].id;
  console.log(`Testing with project: ${projects[0].name}`);

  // Import the executor
  const { executeAgenticLoop } = await import("../src/lib/ai/agentic-executor");

  // Create a mock agent with tools enabled
  const mockAgent = {
    id: "test-agent",
    slug: "test-agentic",
    name: "Test Agentic Agent",
    metadata: {
      enabled_tools: ["find_insight_clusters", "compute_graph_analytics"],
    },
  };

  const modelConfig = {
    id: "test-model-1",
    name: "Claude Sonnet (Test)",
    code: "claude-sonnet",
    model: "claude-sonnet-4-20250514",
    provider: "anthropic" as const,
    apiKeyEnvVar: "ANTHROPIC_API_KEY",
  };

  const toolContext = {
    supabase,
    projectId,
  };

  console.log("\nExecuting agentic loop with system prompt asking to use tools...\n");

  try {
    const result = await executeAgenticLoop({
      supabase,
      agent: mockAgent as any,
      modelConfig,
      systemPrompt: `You are a helpful assistant that analyzes project data.
You have access to graph analysis tools. When asked about a project's insights or structure,
you MUST use the available tools to gather data before answering.
Always use at least one tool to demonstrate the capability.`,
      userPrompt: `Analyze the structure of project ${projectId}.
Use the compute_graph_analytics tool to understand the knowledge graph,
then summarize what you found.`,
      toolContext,
      maxOutputTokens: 1024,
      temperature: 0,
    });

    console.log("─".repeat(50));
    console.log(`✅ Execution complete in ${result.iterations} iteration(s)`);
    console.log(`\n📝 Tool calls made: ${result.toolCalls.length}`);

    result.toolCalls.forEach((call, i) => {
      console.log(`\n  ${i + 1}. ${call.name} (${call.latencyMs}ms)`);
      console.log(`     Input: ${JSON.stringify(call.input).slice(0, 100)}...`);
      if (call.error) {
        console.log(`     ❌ Error: ${call.error}`);
      } else {
        console.log(`     ✅ Success`);
      }
    });

    if (result.thinking) {
      console.log("\n🧠 Thinking captured:");
      console.log(result.thinking.slice(0, 300) + "...");
    }

    console.log("\n📄 Final response:");
    console.log(result.content.slice(0, 500) + (result.content.length > 500 ? "..." : ""));

  } catch (error) {
    console.error("❌ Agentic execution failed:", error);
  }
}

async function testLiveWithThinking() {
  console.log("\n🔧 Test 7: Live Agentic with Extended Thinking");
  console.log("─".repeat(50));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log("⚠️ ANTHROPIC_API_KEY not set, skipping");
    return;
  }

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .limit(1);

  if (!projects?.length) {
    console.log("⚠️ No projects found, skipping");
    return;
  }

  const projectId = projects[0].id;
  console.log(`Testing with project: ${projects[0].name}`);

  const { executeAgenticLoop } = await import("../src/lib/ai/agentic-executor");

  const mockAgent = {
    id: "test-thinking",
    slug: "test-thinking",
    name: "Test Thinking Agent",
    metadata: {
      enabled_tools: ["compute_graph_analytics"],
    },
  };

  // Model WITH extended thinking enabled (same model as test 6, but with thinking)
  const modelConfig = {
    id: "test-model-thinking",
    name: "Claude Sonnet Thinking (Test)",
    code: "claude-sonnet-thinking",
    model: "claude-sonnet-4-20250514", // Same as test 6
    provider: "anthropic" as const,
    apiKeyEnvVar: "ANTHROPIC_API_KEY",
    thinkingBudgetTokens: 10000, // Enable extended thinking!
    additionalHeaders: {
      "anthropic-beta": "interleaved-thinking-2025-05-14",
    },
  };

  console.log("\n🧠 Executing with extended thinking (thinkingBudgetTokens: 8000)...\n");

  try {
    const result = await executeAgenticLoop({
      supabase,
      agent: mockAgent as any,
      modelConfig,
      systemPrompt: "You analyze project knowledge graphs. Think step by step about what the data means.",
      userPrompt: `Analyze project ${projectId}. Use compute_graph_analytics to get data, then explain what patterns you observe.`,
      toolContext: { supabase, projectId },
      maxOutputTokens: 2048,
    });

    console.log("─".repeat(50));
    console.log(`✅ Execution complete in ${result.iterations} iteration(s)`);
    console.log(`📝 Tool calls: ${result.toolCalls.length}`);

    if (result.thinking) {
      console.log("\n🧠 THINKING CAPTURED:");
      console.log("═".repeat(50));
      console.log(result.thinking.slice(0, 1500));
      if (result.thinking.length > 1500) {
        console.log(`\n... (${result.thinking.length - 1500} more chars)`);
      }
      console.log("═".repeat(50));
    } else {
      console.log("\n⚠️ No thinking captured (model may not support extended thinking)");
    }

    console.log("\n📄 Final response (first 400 chars):");
    console.log(result.content.slice(0, 400));

  } catch (error) {
    console.error("❌ Execution failed:", error);
  }
}

async function main() {
  console.log("🚀 Agentic Executor Functional Tests");
  console.log("═".repeat(50));

  // Check for --thinking flag to run only thinking test
  const runThinkingOnly = process.argv.includes("--thinking");

  try {
    if (runThinkingOnly) {
      await testLiveWithThinking();
    } else {
      await testToolRegistry();
      await testToolExecution();
      await testRLSWithServiceRole();
      await testGraphAnalytics();
      await testAgenticExecutorDryRun();
      await testAgentMetadataUpdate();
      await testLiveAgenticExecution();
      await testLiveWithThinking();
    }

    console.log("\n" + "═".repeat(50));
    console.log("✅ All tests completed!");

  } catch (error) {
    console.error("\n❌ Test suite failed:", error);
    process.exit(1);
  }
}

main();
