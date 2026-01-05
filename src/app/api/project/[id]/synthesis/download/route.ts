import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabaseClient } from "@/lib/supabaseAdmin";
import { getLatestSynthesis } from "@/lib/graphRAG/narrativeSynthesis";

/**
 * GET /api/project/[id]/synthesis/download
 * Download the synthesis as a Markdown file
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

    const adminClient = getAdminSupabaseClient();

    // Get project name for filename
    const { data: project } = await adminClient
      .from("projects")
      .select("name")
      .eq("id", projectId)
      .single();

    // Get latest synthesis
    const synthesis = await getLatestSynthesis(projectId, challengeId, adminClient);

    if (!synthesis) {
      return NextResponse.json(
        { success: false, error: "Aucune synthèse disponible" },
        { status: 404 }
      );
    }

    // Generate filename
    const projectSlug = (project?.name || "projet")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const date = new Date().toISOString().split("T")[0];
    const filename = `synthese-${projectSlug}-${date}.md`;

    // Return as downloadable file
    return new Response(synthesis.markdownContent, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("[Synthesis Download] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to download synthesis",
      },
      { status: 500 }
    );
  }
}
