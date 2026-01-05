import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabaseClient } from "@/lib/supabaseAdmin";
import {
  generateNarrativeSynthesis,
  saveSynthesis,
  getLatestSynthesis,
} from "@/lib/graphRAG/narrativeSynthesis";

/**
 * GET /api/project/[id]/synthesis
 * Retrieve the latest synthesis for a project (optionally filtered by challenge)
 *
 * Query params:
 * - challengeId: optional UUID to filter by challenge
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const { searchParams } = new URL(request.url);
    const challengeId = searchParams.get("challengeId") || undefined;

    // Get latest synthesis using admin client
    const adminClient = getAdminSupabaseClient();
    const synthesis = await getLatestSynthesis(projectId, challengeId, adminClient);

    if (!synthesis) {
      return NextResponse.json({
        success: true,
        data: null,
        message: "Aucune synthèse générée pour ce projet",
      });
    }

    return NextResponse.json({
      success: true,
      data: synthesis,
    });
  } catch (error) {
    console.error("[Synthesis API] GET error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get synthesis",
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/project/[id]/synthesis
 * Generate a new synthesis for a project
 *
 * Body:
 * - challengeId: optional UUID to scope to a specific challenge
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const body = await request.json().catch(() => ({}));
    const challengeId = body.challengeId || null;

    // Generate synthesis using admin client (this can take 10-30 seconds)
    const adminClient = getAdminSupabaseClient();
    const { markdown, metadata } = await generateNarrativeSynthesis(
      projectId,
      challengeId,
      adminClient
    );

    // Save to database
    const synthesis = await saveSynthesis(
      projectId,
      challengeId,
      markdown,
      metadata,
      adminClient
    );

    return NextResponse.json({
      success: true,
      data: synthesis,
    });
  } catch (error) {
    console.error("[Synthesis API] POST error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to generate synthesis",
      },
      { status: 500 }
    );
  }
}
