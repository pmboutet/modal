import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient, requireAdmin } from "@/lib/supabaseServer";
import { parseErrorMessage } from "@/lib/utils";
import { type ApiResponse, type AiChallengeBuilderResponse } from "@/types";

// Type for persisted results
interface PersistedChallengeBuilderResults {
  suggestions: AiChallengeBuilderResponse["challengeSuggestions"];
  newChallenges: AiChallengeBuilderResponse["newChallengeSuggestions"];
  errors: AiChallengeBuilderResponse["errors"] | null;
  lastRunAt: string | null; // ISO timestamp
  projectId: string;
  runId?: string; // Unique identifier for each execution
  status?: "running" | "completed"; // Track if analysis is in progress
  startedAt?: string; // When the analysis started
}

/**
 * GET /api/admin/projects/[id]/ai/challenge-builder/results
 * Retrieve persisted AI challenge builder results for a project
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const supabase = await createServerSupabaseClient();
    const resolvedParams = await params;
    const projectId = z.string().uuid().parse(resolvedParams.id);

    const { data: project, error } = await supabase
      .from("projects")
      .select("ai_challenge_builder_results")
      .eq("id", projectId)
      .single();

    if (error) {
      throw error;
    }

    const results = project?.ai_challenge_builder_results as PersistedChallengeBuilderResults | null;

    if (!results) {
      return NextResponse.json<ApiResponse<PersistedChallengeBuilderResults | null>>({
        success: true,
        data: null,
      });
    }

    return NextResponse.json<ApiResponse<PersistedChallengeBuilderResults>>({
      success: true,
      data: results,
    });
  } catch (error) {
    let status = 500;
    if (error instanceof z.ZodError) status = 400;
    else if (error instanceof Error && error.message.includes('required')) status = 403;

    return NextResponse.json<ApiResponse>({
      success: false,
      error: error instanceof z.ZodError ? error.errors[0]?.message || "Invalid project id" : parseErrorMessage(error),
    }, { status });
  }
}

/**
 * POST /api/admin/projects/[id]/ai/challenge-builder/results
 * Save AI challenge builder results for a project
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const supabase = await createServerSupabaseClient();
    const resolvedParams = await params;
    const projectId = z.string().uuid().parse(resolvedParams.id);

    const body = await request.json();
    const { suggestions, newChallenges, errors } = body as {
      suggestions?: AiChallengeBuilderResponse["challengeSuggestions"];
      newChallenges?: AiChallengeBuilderResponse["newChallengeSuggestions"];
      errors?: AiChallengeBuilderResponse["errors"];
    };

    const persistedResults: PersistedChallengeBuilderResults = {
      suggestions: suggestions ?? [],
      newChallenges: newChallenges ?? [],
      errors: errors ?? null,
      lastRunAt: new Date().toISOString(),
      projectId,
    };

    const { error } = await supabase
      .from("projects")
      .update({ ai_challenge_builder_results: persistedResults })
      .eq("id", projectId);

    if (error) {
      throw error;
    }

    return NextResponse.json<ApiResponse<PersistedChallengeBuilderResults>>({
      success: true,
      data: persistedResults,
    });
  } catch (error) {
    let status = 500;
    if (error instanceof z.ZodError) status = 400;
    else if (error instanceof Error && error.message.includes('required')) status = 403;

    return NextResponse.json<ApiResponse>({
      success: false,
      error: error instanceof z.ZodError ? error.errors[0]?.message || "Invalid payload" : parseErrorMessage(error),
    }, { status });
  }
}

/**
 * PATCH /api/admin/projects/[id]/ai/challenge-builder/results
 * Remove a specific suggestion from persisted results
 *
 * Body options:
 * - { type: "newChallenge", title: string } - Remove from newChallenges by title
 * - { type: "suggestion", challengeId: string } - Remove from suggestions by challengeId
 * - { type: "newSubChallenge", parentChallengeId: string, title: string } - Remove sub-challenge from a suggestion
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const supabase = await createServerSupabaseClient();
    const resolvedParams = await params;
    const projectId = z.string().uuid().parse(resolvedParams.id);

    const body = await request.json();
    const { type, title, challengeId, parentChallengeId } = z.object({
      type: z.enum(["newChallenge", "suggestion", "newSubChallenge"]),
      title: z.string().optional(),
      challengeId: z.string().uuid().optional(),
      parentChallengeId: z.string().uuid().optional(),
    }).parse(body);

    // Get current results
    const { data: project, error: fetchError } = await supabase
      .from("projects")
      .select("ai_challenge_builder_results")
      .eq("id", projectId)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    const results = project?.ai_challenge_builder_results as PersistedChallengeBuilderResults | null;
    if (!results) {
      return NextResponse.json<ApiResponse<{ message: string }>>({
        success: true,
        data: { message: "No results to update" },
      });
    }

    let updated = false;

    if (type === "newChallenge" && title) {
      const originalLength = results.newChallenges?.length ?? 0;
      results.newChallenges = (results.newChallenges ?? []).filter(
        challenge => challenge.title !== title
      );
      updated = results.newChallenges.length !== originalLength;
    } else if (type === "suggestion" && challengeId) {
      const originalLength = results.suggestions?.length ?? 0;
      results.suggestions = (results.suggestions ?? []).filter(
        suggestion => suggestion.challengeId !== challengeId
      );
      updated = results.suggestions.length !== originalLength;
    } else if (type === "newSubChallenge" && parentChallengeId && title) {
      // Remove a sub-challenge from within a suggestion
      results.suggestions = (results.suggestions ?? []).map(suggestion => {
        if (suggestion.challengeId !== parentChallengeId) {
          return suggestion;
        }
        const originalLength = suggestion.newSubChallenges?.length ?? 0;
        const filteredSubChallenges = (suggestion.newSubChallenges ?? []).filter(
          sub => sub.title !== title
        );
        if (filteredSubChallenges.length !== originalLength) {
          updated = true;
        }
        return {
          ...suggestion,
          newSubChallenges: filteredSubChallenges.length > 0 ? filteredSubChallenges : undefined,
        };
      });
    }

    if (!updated) {
      return NextResponse.json<ApiResponse<{ message: string }>>({
        success: true,
        data: { message: "No matching suggestion found" },
      });
    }

    // Update the database
    const { error: updateError } = await supabase
      .from("projects")
      .update({ ai_challenge_builder_results: results })
      .eq("id", projectId);

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json<ApiResponse<{ message: string; remainingSuggestions: number; remainingNewChallenges: number }>>({
      success: true,
      data: {
        message: "Suggestion removed",
        remainingSuggestions: results.suggestions?.length ?? 0,
        remainingNewChallenges: results.newChallenges?.length ?? 0,
      },
    });
  } catch (error) {
    let status = 500;
    if (error instanceof z.ZodError) status = 400;
    else if (error instanceof Error && error.message.includes('required')) status = 403;

    return NextResponse.json<ApiResponse>({
      success: false,
      error: error instanceof z.ZodError ? error.errors[0]?.message || "Invalid payload" : parseErrorMessage(error),
    }, { status });
  }
}




