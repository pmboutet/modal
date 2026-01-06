import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminSupabaseClient } from "@/lib/supabaseAdmin";
import { sendMagicLink } from "@/lib/auth/magicLink";
import {
  getOrCreateUser,
  ensureClientMembership,
  ensureProjectMembership,
} from "@/app/api/admin/profiles/helpers";
import type { ApiResponse } from "@/types";
import { randomBytes } from "crypto";
import { sanitizeText, sanitizeOptional } from "@/lib/sanitize";

// Schema for email-only step
const emailOnlySchema = z.object({
  askKey: z.string().trim().min(1),
  email: z.string().trim().email().max(255),
  // Optional profile completion fields
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  description: z.string().trim().max(2000).optional(),
});

interface RegisterResponse {
  status: "email_sent" | "needs_completion" | "not_invited";
  missingFields?: string[];
  message?: string;
}

/**
 * POST /api/ask/register
 *
 * Handles public ASK link registration flow:
 * - Validates ASK session exists and checks allow_auto_registration flag
 * - If auto-registration disabled: only existing participants can get their token link
 * - If auto-registration enabled: creates profile + participant if needed
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const payload = emailOnlySchema.parse(body);
    const normalizedEmail = payload.email.toLowerCase().trim();

    const supabase = getAdminSupabaseClient();

    // 1. Fetch ASK session by key
    const { data: askSession, error: askError } = await supabase
      .from("ask_sessions")
      .select("id, ask_key, allow_auto_registration, project_id, projects(client_id)")
      .eq("ask_key", payload.askKey)
      .maybeSingle();

    if (askError) {
      console.error("[register] Error fetching ASK session:", askError);
      throw askError;
    }

    if (!askSession) {
      return NextResponse.json<ApiResponse<RegisterResponse>>({
        success: false,
        error: "Session ASK introuvable",
      }, { status: 404 });
    }

    const allowAutoRegistration = askSession.allow_auto_registration === true;
    const projectId = askSession.project_id;
    const projectsData = askSession.projects;
    const projectRecord = Array.isArray(projectsData) ? projectsData[0] : projectsData;
    const clientId = (projectRecord as { client_id: string | null } | null)?.client_id;

    // 2. Check if email exists in profiles
    const { data: existingProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, description")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (profileError) {
      console.error("[register] Error fetching profile:", profileError);
      throw profileError;
    }

    // 3. Handle based on allow_auto_registration flag
    if (!allowAutoRegistration) {
      // Auto-registration disabled: only existing participants can get their token
      if (!existingProfile) {
        return NextResponse.json<ApiResponse<RegisterResponse>>({
          success: true,
          data: {
            status: "not_invited",
            message: "Vous n'avez pas été invité à cette session.",
          },
        });
      }

      // Check if user is already a participant of THIS ASK
      const { data: existingParticipant } = await supabase
        .from("ask_participants")
        .select("id, invite_token")
        .eq("ask_session_id", askSession.id)
        .eq("user_id", existingProfile.id)
        .maybeSingle();

      if (!existingParticipant) {
        return NextResponse.json<ApiResponse<RegisterResponse>>({
          success: true,
          data: {
            status: "not_invited",
            message: "Vous n'avez pas été invité à cette session.",
          },
        });
      }

      // Send token link via email
      const result = await sendMagicLink(
        normalizedEmail,
        askSession.ask_key,
        projectId ?? undefined,
        existingParticipant.invite_token ?? undefined
      );

      if (!result.success) {
        return NextResponse.json<ApiResponse>({
          success: false,
          error: result.error || "Erreur lors de l'envoi de l'email",
        }, { status: 500 });
      }

      return NextResponse.json<ApiResponse<RegisterResponse>>({
        success: true,
        data: {
          status: "email_sent",
          message: "Un email avec votre lien d'accès a été envoyé.",
        },
      });
    }

    // Auto-registration enabled
    // 4. Profile exists - check completeness or add as participant
    if (existingProfile) {
      const missingFields: string[] = [];
      if (!existingProfile.first_name?.trim()) missingFields.push("firstName");
      if (!existingProfile.last_name?.trim()) missingFields.push("lastName");

      // If profile incomplete and no completion data provided, request completion
      if (missingFields.length > 0 && !payload.firstName && !payload.lastName) {
        return NextResponse.json<ApiResponse<RegisterResponse>>({
          success: true,
          data: {
            status: "needs_completion",
            missingFields,
            message: "Veuillez compléter vos informations pour continuer.",
          },
        });
      }

      // Update profile if completion data provided
      if (payload.firstName || payload.lastName || payload.description) {
        const updateData: Record<string, unknown> = {};
        if (payload.firstName && !existingProfile.first_name?.trim()) {
          updateData.first_name = sanitizeOptional(payload.firstName);
        }
        if (payload.lastName && !existingProfile.last_name?.trim()) {
          updateData.last_name = sanitizeOptional(payload.lastName);
        }
        if (payload.firstName || payload.lastName) {
          const fullName = [
            payload.firstName || existingProfile.first_name,
            payload.lastName || existingProfile.last_name,
          ].filter(Boolean).join(" ");
          if (fullName) updateData.full_name = fullName;
        }
        if (payload.description) {
          updateData.description = sanitizeOptional(payload.description);
        }

        if (Object.keys(updateData).length > 0) {
          await supabase
            .from("profiles")
            .update(updateData)
            .eq("id", existingProfile.id);
        }
      }

      // Check if already a participant
      const { data: existingParticipant } = await supabase
        .from("ask_participants")
        .select("id, invite_token")
        .eq("ask_session_id", askSession.id)
        .eq("user_id", existingProfile.id)
        .maybeSingle();

      if (existingParticipant) {
        // Already a participant, just send the token link
        const result = await sendMagicLink(
          normalizedEmail,
          askSession.ask_key,
          projectId ?? undefined,
          existingParticipant.invite_token ?? undefined
        );

        if (!result.success) {
          return NextResponse.json<ApiResponse>({
            success: false,
            error: result.error || "Erreur lors de l'envoi de l'email",
          }, { status: 500 });
        }

        return NextResponse.json<ApiResponse<RegisterResponse>>({
          success: true,
          data: {
            status: "email_sent",
            message: "Un email avec votre lien d'accès a été envoyé.",
          },
        });
      }

      // Add to client and project memberships
      if (clientId) {
        await ensureClientMembership(supabase, clientId, existingProfile.id);
      }
      if (projectId) {
        await ensureProjectMembership(supabase, projectId, existingProfile.id);
      }

      // Create participant record
      const inviteToken = randomBytes(16).toString("hex");
      await supabase
        .from("ask_participants")
        .insert({
          ask_session_id: askSession.id,
          user_id: existingProfile.id,
          role: "participant",
          invite_token: inviteToken,
        });

      // Send token link via email
      const result = await sendMagicLink(
        normalizedEmail,
        askSession.ask_key,
        projectId ?? undefined,
        inviteToken
      );

      if (!result.success) {
        return NextResponse.json<ApiResponse>({
          success: false,
          error: result.error || "Erreur lors de l'envoi de l'email",
        }, { status: 500 });
      }

      return NextResponse.json<ApiResponse<RegisterResponse>>({
        success: true,
        data: {
          status: "email_sent",
          message: "Un email avec votre lien d'accès a été envoyé.",
        },
      });
    }

    // 5. Profile doesn't exist - require all fields for creation
    if (!payload.firstName || !payload.lastName) {
      return NextResponse.json<ApiResponse<RegisterResponse>>({
        success: true,
        data: {
          status: "needs_completion",
          missingFields: ["firstName", "lastName"],
          message: "Veuillez compléter vos informations pour vous inscrire.",
        },
      });
    }

    // Create new profile
    const { userId: newUserId } = await getOrCreateUser(
      supabase,
      undefined,
      {
        email: normalizedEmail,
        firstName: payload.firstName,
        lastName: payload.lastName,
      }
    );

    // Update description if provided
    if (payload.description) {
      await supabase
        .from("profiles")
        .update({ description: sanitizeOptional(payload.description) })
        .eq("id", newUserId);
    }

    // Add to client and project memberships
    if (clientId) {
      await ensureClientMembership(supabase, clientId, newUserId);
    }
    if (projectId) {
      await ensureProjectMembership(supabase, projectId, newUserId);
    }

    // Create participant record
    const inviteToken = randomBytes(16).toString("hex");
    await supabase
      .from("ask_participants")
      .insert({
        ask_session_id: askSession.id,
        user_id: newUserId,
        role: "participant",
        invite_token: inviteToken,
      });

    // Send token link via email
    const result = await sendMagicLink(
      normalizedEmail,
      askSession.ask_key,
      projectId ?? undefined,
      inviteToken
    );

    if (!result.success) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: result.error || "Erreur lors de l'envoi de l'email",
      }, { status: 500 });
    }

    return NextResponse.json<ApiResponse<RegisterResponse>>({
      success: true,
      data: {
        status: "email_sent",
        message: "Un email avec votre lien d'accès a été envoyé.",
      },
    });
  } catch (error) {
    console.error("[register] Error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: error.errors[0]?.message || "Données invalides",
      }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Erreur interne du serveur";

    // Handle duplicate email error
    if (message.includes("existe déjà")) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: message,
      }, { status: 409 });
    }

    return NextResponse.json<ApiResponse>({
      success: false,
      error: message,
    }, { status: 500 });
  }
}
