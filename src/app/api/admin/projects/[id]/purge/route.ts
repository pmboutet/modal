import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient, requireAdmin } from "@/lib/supabaseServer";
import { getAdminSupabaseClient } from "@/lib/supabaseAdmin";
import { parseErrorMessage } from "@/lib/utils";
import type { ApiResponse } from "@/types";

/**
 * Required confirmation word to purge project data.
 * User must type this exact word to confirm the dangerous operation.
 */
const CONFIRMATION_WORD = "SUPPRIMER-TOUT";

const purgeSchema = z.object({
  confirmationWord: z.string().trim(),
  participantId: z.string().uuid().optional().nullable(),
});

interface PurgeResult {
  deletedMessages: number;
  deletedInsights: number;
  deletedConversationThreads: number;
  deletedInsightSyntheses: number;
  deletedGraphEdges: number;
  aiBuilderResultsCleared: boolean;
  timersReset: number;
}

/**
 * POST /api/admin/projects/[id]/purge
 *
 * Purges conversation data from a project while preserving ASK sessions and participants.
 *
 * If `participantId` is provided, only purges data for that specific participant:
 * - Messages from that participant's conversation threads
 * - Insights from that participant's conversation threads
 * - Resets only that participant's timer
 *
 * If `participantId` is NOT provided (or null), purges ALL project data:
 * - Messages (all conversation content)
 * - Insights (cascades to: insight_keywords, challenge_insights)
 * - Conversation threads (will be recreated when users start new conversations)
 * - Insight syntheses
 * - Knowledge graph edges related to deleted insights
 * - AI challenge builder results stored in the project
 *
 * PRESERVED: ask_sessions and ask_participants remain intact.
 *
 * IMPORTANT: This action is irreversible and restricted to full_admin only.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify user is authenticated and has admin access
    const { profile } = await requireAdmin();

    // CRITICAL: Only full_admin can purge project data
    if (!profile || profile.role !== "full_admin") {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: "Cette action est réservée aux administrateurs complets (full_admin)"
      }, { status: 403 });
    }

    const resolvedParams = await params;
    const projectId = z.string().uuid().parse(resolvedParams.id);

    // Parse and validate request body
    const body = await request.json();
    const { confirmationWord, participantId } = purgeSchema.parse(body);

    // Verify confirmation word
    if (confirmationWord !== CONFIRMATION_WORD) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: `Le mot de confirmation est incorrect. Veuillez entrer "${CONFIRMATION_WORD}" pour confirmer.`
      }, { status: 400 });
    }

    // Use admin client to bypass RLS for deletion operations
    const adminSupabase = getAdminSupabaseClient();
    const supabase = await createServerSupabaseClient();

    // Verify project exists
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, name")
      .eq("id", projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: "Projet non trouvé"
      }, { status: 404 });
    }

    const result: PurgeResult = {
      deletedMessages: 0,
      deletedInsights: 0,
      deletedConversationThreads: 0,
      deletedInsightSyntheses: 0,
      deletedGraphEdges: 0,
      aiBuilderResultsCleared: false,
      timersReset: 0,
    };

    // Step 1: Get all ask_session IDs for this project
    const { data: askSessions } = await adminSupabase
      .from("ask_sessions")
      .select("id")
      .eq("project_id", projectId);

    const askSessionIds = askSessions?.map(s => s.id) ?? [];

    if (askSessionIds.length === 0) {
      // No sessions to purge, just clear AI builder results if not filtering by participant
      if (!participantId) {
        const { error: clearError } = await adminSupabase
          .from("projects")
          .update({ ai_challenge_builder_results: null })
          .eq("id", projectId);
        result.aiBuilderResultsCleared = !clearError;
      }

      return NextResponse.json<ApiResponse<PurgeResult>>({
        success: true,
        data: result
      });
    }

    // If filtering by participant, get their user_id and find their threads
    let participantUserId: string | null = null;
    let participantThreadIds: string[] = [];

    if (participantId) {
      // Get the participant's user_id
      const { data: participant } = await adminSupabase
        .from("ask_participants")
        .select("user_id")
        .eq("id", participantId)
        .in("ask_session_id", askSessionIds)
        .single();

      if (!participant?.user_id) {
        return NextResponse.json<ApiResponse>({
          success: false,
          error: "Participant non trouvé ou sans user_id associé"
        }, { status: 404 });
      }

      participantUserId = participant.user_id;

      // Get conversation threads for this user
      const { data: threads } = await adminSupabase
        .from("conversation_threads")
        .select("id")
        .eq("user_id", participantUserId)
        .in("ask_session_id", askSessionIds);

      participantThreadIds = threads?.map(t => t.id) ?? [];

      if (participantThreadIds.length === 0) {
        // No threads found for this participant
        return NextResponse.json<ApiResponse<PurgeResult>>({
          success: true,
          data: result
        });
      }
    }

    // PARTICIPANT-SPECIFIC PURGE: Only delete data from participant's threads
    if (participantId && participantUserId && participantThreadIds.length > 0) {
      // Delete messages from participant's threads
      const { count: messagesDeleted } = await adminSupabase
        .from("messages")
        .delete({ count: "exact" })
        .in("conversation_thread_id", participantThreadIds);
      result.deletedMessages = messagesDeleted ?? 0;

      // Get insight IDs from participant's threads (for potential graph edge cleanup)
      const { data: participantInsights } = await adminSupabase
        .from("insights")
        .select("id")
        .in("conversation_thread_id", participantThreadIds);
      const participantInsightIds = participantInsights?.map(i => i.id) ?? [];

      // Delete graph edges for participant's insights
      if (participantInsightIds.length > 0) {
        const { count: edgesDeleted } = await adminSupabase
          .from("knowledge_graph_edges")
          .delete({ count: "exact" })
          .or(
            `and(source_type.eq.insight,source_id.in.(${participantInsightIds.join(",")})),` +
            `and(target_type.eq.insight,target_id.in.(${participantInsightIds.join(",")}))`
          );
        result.deletedGraphEdges = edgesDeleted ?? 0;
      }

      // Delete insights from participant's threads
      const { count: insightsDeleted } = await adminSupabase
        .from("insights")
        .delete({ count: "exact" })
        .in("conversation_thread_id", participantThreadIds);
      result.deletedInsights = insightsDeleted ?? 0;

      // Delete participant's conversation threads
      const { count: threadsDeleted } = await adminSupabase
        .from("conversation_threads")
        .delete({ count: "exact" })
        .in("id", participantThreadIds);
      result.deletedConversationThreads = threadsDeleted ?? 0;

      // Reset timer only for this participant
      const { count: timersReset } = await adminSupabase
        .from("ask_participants")
        .update({
          elapsed_active_seconds: 0,
          timer_reset_at: new Date().toISOString()
        }, { count: "exact" })
        .eq("id", participantId);
      result.timersReset = timersReset ?? 0;

      console.log(`[Purge] Participant ${participantId} data purged from project ${project.name} (${projectId}) by full_admin:`, result);
    } else {
      // FULL PROJECT PURGE: Delete all data

      // Step 2: Get all insight IDs from these ask sessions (for graph edge cleanup)
      const { data: insights } = await adminSupabase
        .from("insights")
        .select("id")
        .in("ask_session_id", askSessionIds);
      const projectInsightIds = insights?.map(i => i.id) ?? [];

      // Step 3: Delete knowledge_graph_edges that reference project insights
      if (projectInsightIds.length > 0) {
        const { count: edgesDeleted } = await adminSupabase
          .from("knowledge_graph_edges")
          .delete({ count: "exact" })
          .or(
            `and(source_type.eq.insight,source_id.in.(${projectInsightIds.join(",")})),` +
            `and(target_type.eq.insight,target_id.in.(${projectInsightIds.join(",")}))`
          );
        result.deletedGraphEdges = edgesDeleted ?? 0;
      }

      // Step 4: Delete insight_syntheses for this project
      const { count: synthesesDeleted } = await adminSupabase
        .from("insight_syntheses")
        .delete({ count: "exact" })
        .eq("project_id", projectId);
      result.deletedInsightSyntheses = synthesesDeleted ?? 0;

      // Step 5: Delete all messages for the project's ask sessions
      const { count: messagesDeleted } = await adminSupabase
        .from("messages")
        .delete({ count: "exact" })
        .in("ask_session_id", askSessionIds);
      result.deletedMessages = messagesDeleted ?? 0;

      // Step 6: Delete all insights for the project's ask sessions
      const { count: insightsDeleted } = await adminSupabase
        .from("insights")
        .delete({ count: "exact" })
        .in("ask_session_id", askSessionIds);
      result.deletedInsights = insightsDeleted ?? 0;

      // Step 7: Delete all conversation_threads for the project's ask sessions
      const { count: threadsDeleted } = await adminSupabase
        .from("conversation_threads")
        .delete({ count: "exact" })
        .in("ask_session_id", askSessionIds);
      result.deletedConversationThreads = threadsDeleted ?? 0;

      // Step 8: Reset session timers for all participants
      const { count: timersReset } = await adminSupabase
        .from("ask_participants")
        .update({
          elapsed_active_seconds: 0,
          timer_reset_at: new Date().toISOString()
        }, { count: "exact" })
        .in("ask_session_id", askSessionIds);
      result.timersReset = timersReset ?? 0;

      // Step 9: Clear AI challenge builder results from project
      const { error: clearError } = await adminSupabase
        .from("projects")
        .update({ ai_challenge_builder_results: null })
        .eq("id", projectId);
      result.aiBuilderResultsCleared = !clearError;

      console.log(`[Purge] Project ${project.name} (${projectId}) purged by full_admin:`, result);
    }

    return NextResponse.json<ApiResponse<PurgeResult>>({
      success: true,
      data: result
    });

  } catch (error) {
    console.error("[Purge] Error:", error);

    let status = 500;
    if (error instanceof z.ZodError) status = 400;
    else if (error instanceof Error && error.message.includes("required")) status = 403;

    return NextResponse.json<ApiResponse>({
      success: false,
      error: error instanceof z.ZodError
        ? error.errors[0]?.message || "Données invalides"
        : parseErrorMessage(error)
    }, { status });
  }
}
