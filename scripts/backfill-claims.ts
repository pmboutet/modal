/**
 * Backfill script: Extract claims from all existing insights
 *
 * This script processes all insights in the database and extracts claims
 * using the new insight-claim-extraction agent.
 *
 * Usage:
 *   npx ts-node scripts/backfill-claims.ts [--project-id=<uuid>] [--dry-run] [--batch-size=10]
 *
 * Options:
 *   --project-id    Only process insights from a specific project
 *   --dry-run       Don't actually save claims, just log what would be done
 *   --batch-size    Number of insights to process in parallel (default: 10)
 */

import { createClient } from "@supabase/supabase-js";
import { extractClaimsFromInsight, generateClaimEmbeddings } from "../src/lib/graphRAG/extractClaims";
import { buildClaimEdges } from "../src/lib/graphRAG/graphBuilder";
import { generateEmbedding } from "../src/lib/ai/embeddings";
import type { Insight } from "../src/types";

// Parse command line arguments
const args = process.argv.slice(2);
const projectIdArg = args.find(a => a.startsWith("--project-id="));
const projectId = projectIdArg ? projectIdArg.split("=")[1] : null;
const dryRun = args.includes("--dry-run");
const batchSizeArg = args.find(a => a.startsWith("--batch-size="));
const batchSize = batchSizeArg ? parseInt(batchSizeArg.split("=")[1], 10) : 10;

// Environment validation
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Error: Missing environment variables");
  console.error("Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface InsightRow {
  id: string;
  content: string;
  summary: string | null;
  type: string;
  category: string | null;
  ask_session_id: string;
  challenge_id: string | null;
  project_id: string;
}

/**
 * Map database row to Insight type
 */
function mapRowToInsight(row: InsightRow): Insight {
  return {
    id: row.id,
    content: row.content,
    summary: row.summary,
    type: row.type as Insight["type"],
    category: row.category,
    askSessionId: row.ask_session_id,
    askId: row.ask_session_id, // Same as askSessionId
    challengeId: row.challenge_id,
    // These fields are not used by claim extraction but required by the type
    priority: "medium",
    status: "reviewed",
    authors: [],
    relatedChallengeIds: [],
    kpis: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Process a batch of insights
 */
async function processBatch(insights: InsightRow[]): Promise<{
  processed: number;
  claims: number;
  entities: number;
  errors: number;
}> {
  let processed = 0;
  let totalClaims = 0;
  let totalEntities = 0;
  let errors = 0;

  for (const insightRow of insights) {
    try {
      const insight = mapRowToInsight(insightRow);

      console.log(`  Processing insight ${insight.id.substring(0, 8)}...`);

      if (dryRun) {
        console.log(`    [DRY RUN] Would extract claims from: "${insight.content.substring(0, 50)}..."`);
        processed++;
        continue;
      }

      // Extract claims
      const { claimIds, entityIds, relations } = await extractClaimsFromInsight(insight);

      if (claimIds.length > 0) {
        // Generate embeddings for claims
        await generateClaimEmbeddings(supabase, claimIds);

        // Build claim edges
        await buildClaimEdges(supabase, insight.id, claimIds, relations, insight.challengeId);

        totalClaims += claimIds.length;
      }

      if (entityIds.length > 0) {
        // Generate embeddings for entities that don't have one yet
        const { data: entities } = await supabase
          .from("knowledge_entities")
          .select("id, name, embedding")
          .in("id", entityIds)
          .is("embedding", null);

        if (entities && entities.length > 0) {
          for (const entity of entities) {
            try {
              const embedding = await generateEmbedding(entity.name);
              if (embedding) {
                await supabase
                  .from("knowledge_entities")
                  .update({ embedding })
                  .eq("id", entity.id);
              }
            } catch (err) {
              console.error(`    Error generating embedding for entity ${entity.id}:`, err);
            }
          }
        }
        totalEntities += entityIds.length;
      }

      console.log(`    Extracted ${claimIds.length} claims, ${entityIds.length} entities`);
      processed++;
    } catch (error) {
      console.error(`    Error processing insight ${insightRow.id}:`, error);
      errors++;
    }
  }

  return { processed, claims: totalClaims, entities: totalEntities, errors };
}

/**
 * Main backfill function
 */
async function backfillClaims() {
  console.log("=".repeat(60));
  console.log("Claims Backfill Script");
  console.log("=".repeat(60));
  console.log(`Project ID: ${projectId || "ALL"}`);
  console.log(`Batch Size: ${batchSize}`);
  console.log(`Dry Run: ${dryRun}`);
  console.log("=".repeat(60));

  // Build query for insights
  let query = supabase
    .from("insights")
    .select(`
      id,
      content,
      summary,
      category,
      ask_session_id,
      challenge_id,
      insight_types(name),
      ask_sessions!inner(project_id)
    `)
    .order("created_at", { ascending: true });

  if (projectId) {
    // Filter by project through ask_sessions
    query = query.eq("ask_sessions.project_id", projectId);
  }

  const { data: insightsRaw, error: fetchError } = await query;

  if (fetchError) {
    console.error("Error fetching insights:", fetchError);
    process.exit(1);
  }

  if (!insightsRaw || insightsRaw.length === 0) {
    console.log("No insights found to process.");
    return;
  }

  // Get insight IDs that already have claims
  const { data: existingClaims } = await supabase
    .from("claims")
    .select("source_insight_ids");

  const processedInsightIds = new Set<string>();
  if (existingClaims) {
    for (const claim of existingClaims) {
      if (claim.source_insight_ids) {
        for (const id of claim.source_insight_ids) {
          processedInsightIds.add(id);
        }
      }
    }
  }
  console.log(`Found ${processedInsightIds.size} already processed insights`);

  // Filter out already processed insights
  const unprocessedInsightsRaw = insightsRaw.filter(row => !processedInsightIds.has(row.id));
  console.log(`${unprocessedInsightsRaw.length} insights remaining to process`);

  if (unprocessedInsightsRaw.length === 0) {
    console.log("All insights have already been processed.");
    return;
  }

  // Map to proper format
  const insights: InsightRow[] = unprocessedInsightsRaw.map(row => {
    // Handle the join result - can be object or array depending on Supabase version
    const askSession = Array.isArray(row.ask_sessions)
      ? row.ask_sessions[0]
      : row.ask_sessions;
    const insightType = Array.isArray(row.insight_types)
      ? row.insight_types[0]
      : row.insight_types;
    return {
      id: row.id,
      content: row.content,
      summary: row.summary,
      type: (insightType as { name: string })?.name || "observation",
      category: row.category,
      ask_session_id: row.ask_session_id,
      challenge_id: row.challenge_id,
      project_id: (askSession as { project_id: string })?.project_id || "",
    };
  });

  console.log(`Found ${insights.length} insights to process`);
  console.log("");

  // Process in batches
  let totalProcessed = 0;
  let totalClaims = 0;
  let totalEntities = 0;
  let totalErrors = 0;
  const totalBatches = Math.ceil(insights.length / batchSize);

  for (let i = 0; i < insights.length; i += batchSize) {
    const batchNum = Math.floor(i / batchSize) + 1;
    const batch = insights.slice(i, i + batchSize);

    console.log(`Batch ${batchNum}/${totalBatches} (${batch.length} insights)`);

    const result = await processBatch(batch);
    totalProcessed += result.processed;
    totalClaims += result.claims;
    totalEntities += result.entities;
    totalErrors += result.errors;

    // Small delay between batches to avoid rate limiting
    if (i + batchSize < insights.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log("");
  console.log("=".repeat(60));
  console.log("Summary");
  console.log("=".repeat(60));
  console.log(`Insights processed: ${totalProcessed}`);
  console.log(`Claims extracted: ${totalClaims}`);
  console.log(`Entities extracted: ${totalEntities}`);
  console.log(`Errors: ${totalErrors}`);
  console.log("=".repeat(60));

  if (dryRun) {
    console.log("");
    console.log("This was a DRY RUN. No data was modified.");
    console.log("Run without --dry-run to actually process claims.");
  }
}

// Run the script
backfillClaims().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
