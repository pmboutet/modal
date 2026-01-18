import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabaseClient } from "@/lib/supabaseAdmin";
import { createServerSupabaseClient } from "@/lib/supabaseServer";
import { getSessionSynthesis } from "@/lib/graphRAG/synthesisQueries";
import type { ApiResponse } from "@/types";

/**
 * GET /api/ask/[key]/synthesis
 *
 * Returns synthesis data for an ASK session:
 * - Consensus: Claims supported by multiple participants
 * - Tensions: Claims that contradict each other
 * - Top Recommendations: Most supported recommendations
 * - Key Concepts: Most frequent entities
 *
 * SECURITY: Admin-only endpoint. Participants should NOT have access to synthesis data.
 * BUG-SYNTHESIS-001 FIX: Added authentication and authorization check.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;

    // BUG-SYNTHESIS-001 FIX: Require authenticated user with admin/project access
    const authClient = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await authClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }

    // Check if user has admin role or project access
    const { data: profile } = await authClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const isAdmin = profile?.role === 'full_admin' || profile?.role === 'client_admin';

    if (!isAdmin) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Admin access required for synthesis data" },
        { status: 403 }
      );
    }

    const supabase = getAdminSupabaseClient();

    // Get ASK session by key
    const { data: session, error: sessionError } = await supabase
      .from("ask_sessions")
      .select("id, ask_key, question, project_id, status")
      .eq("ask_key", key)
      .maybeSingle();

    if (sessionError) {
      console.error("Error fetching session:", sessionError);
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Failed to fetch session" },
        { status: 500 }
      );
    }

    if (!session) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Session not found" },
        { status: 404 }
      );
    }

    // Get synthesis data
    const synthesis = await getSessionSynthesis(session.id, supabase);

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        session: {
          id: session.id,
          askKey: session.ask_key,
          question: session.question,
          status: session.status,
        },
        synthesis,
      },
    });

  } catch (error) {
    console.error("Error getting synthesis:", error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get synthesis",
      },
      { status: 500 }
    );
  }
}
