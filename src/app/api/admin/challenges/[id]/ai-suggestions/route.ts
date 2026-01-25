import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminSupabaseClient } from "@/lib/supabaseAdmin";
import { parseErrorMessage } from "@/lib/utils";
import { type ApiResponse, type PersistedAskSuggestions } from "@/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const resolvedParams = await params;
    const challengeId = z.string().uuid().parse(resolvedParams.id);

    const supabase = getAdminSupabaseClient();
    const { data: challenge, error } = await supabase
      .from("challenges")
      .select("ai_ask_suggestions")
      .eq("id", challengeId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!challenge) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: "Challenge not found",
      }, { status: 404 });
    }

    const suggestions = challenge.ai_ask_suggestions as PersistedAskSuggestions | null;

    return NextResponse.json<ApiResponse<PersistedAskSuggestions | null>>({
      success: true,
      data: suggestions,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: error.errors[0]?.message || "Invalid challenge id",
      }, { status: 400 });
    }

    return NextResponse.json<ApiResponse>({
      success: false,
      error: parseErrorMessage(error),
    }, { status: 500 });
  }
}
