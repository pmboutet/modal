import { NextRequest, NextResponse } from "next/server";
import { type SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { createServerSupabaseClient } from "@/lib/supabaseServer";
import { getAdminSupabaseClient } from "@/lib/supabaseAdmin";
import { captureDbError } from "@/lib/supabaseQuery";
import { type ApiResponse, type Message, type AskConversationMode, type Insight } from "@/types";
import { getOrCreateConversationThread, shouldUseSharedThread, getMessagesForThread } from "@/lib/asks";
import { fetchInsightsForThread, fetchInsightsForSession } from "@/lib/insightQueries";
import { mapInsightRowToInsight } from "@/lib/insights";
import {
  getConversationPlanWithSteps,
  generateConversationPlan,
  createConversationPlan,
  type ConversationPlan,
  type ConversationPlanWithSteps
} from "@/lib/ai/conversation-plan";
import { executeAgent } from "@/lib/ai/service";
import { buildConversationAgentVariables } from "@/lib/ai/conversation-agent";
import { normaliseMessageMetadata } from "@/lib/messages";
import { buildMessageSenderName, buildParticipantDisplayName, fetchElapsedTime, type MessageRow, type UserRow, type ParticipantRow } from "@/lib/conversation-context";
import { type AskViewer } from "@/lib/ask-session-loader";

type AskSessionRow = {
  ask_session_id: string;
  ask_key: string;
  name: string;
  question: string;
  description: string | null;
  start_date: string;
  end_date: string;
  status: string;
  allow_auto_registration: boolean;
  max_participants: number | null;
  delivery_mode: string;
  conversation_mode: string;
  expected_duration_minutes: number | null;
  project_id: string;
  challenge_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type TokenDataBundle = {
  askRow: AskSessionRow;
  participantInfo: {
    participant_id: string | null;
    user_id: string | null;
    participant_email: string | null;
    participant_name: string | null;
    invite_token: string | null;
    role: string | null;
    is_spokesperson: boolean | null;
  } | null;
  participants: Array<{
    participant_id: string;
    user_id: string | null;
    participant_name: string | null;
    participant_email: string | null;
    role: string | null;
    is_spokesperson: boolean | null;
    joined_at: string | null;
  }>;
  contextRows: Array<{ project_name: string | null; challenge_name: string | null }>;
  messages: Array<{
    message_id: string;
    content: string;
    type: string;
    sender_type: string;
    sender_id: string | null;
    sender_name: string | null;
    created_at: string;
    metadata: Record<string, unknown> | null;
  }>;
  insights: Array<{
    insight_id: string;
    content: string;
    summary: string | null;
    challenge_id: string | null;
    status: string | null;
    category: string | null;
    insight_type_name: string | null;
    created_at: string;
    updated_at: string;
  }>;
  profileClient: SupabaseClient;
};

async function loadTokenDataWithAdmin(token: string): Promise<TokenDataBundle | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  try {
    const admin = getAdminSupabaseClient();
    const { data: participantInfoRow, error: participantFetchError } = await admin
      .from("ask_participants")
      .select("id, user_id, participant_name, participant_email, role, is_spokesperson, invite_token, ask_session_id, joined_at")
      .eq("invite_token", token)
      .maybeSingle();

    if (participantFetchError || !participantInfoRow) {
      return null;
    }

    const askSessionId = participantInfoRow.ask_session_id;

    const { data: askRow, error: askError } = await admin
      .from("ask_sessions")
      .select(
        "ask_session_id:id, ask_key, name, question, description, status, start_date, end_date, allow_auto_registration, max_participants, delivery_mode, conversation_mode, expected_duration_minutes, project_id, challenge_id, created_by, created_at, updated_at",
      )
      .eq("id", askSessionId)
      .maybeSingle<AskSessionRow>();

    if (askError || !askRow) {
      console.error("Fallback loader: ask session not found for token", askError);
      return null;
    }

    const [participantsResult, messagesResult, insightsResult, projectResult, challengeResult] = await Promise.all([
      admin
        .from("ask_participants")
        .select("id, user_id, participant_name, participant_email, role, is_spokesperson, joined_at")
        .eq("ask_session_id", askRow.ask_session_id)
        .order("joined_at", { ascending: true }),
      admin
        .from("messages")
        .select("id, content, message_type, sender_type, user_id, created_at, metadata")
        .eq("ask_session_id", askRow.ask_session_id)
        .order("created_at", { ascending: true }),
      admin
        .from("insights")
        .select("id, ask_session_id, challenge_id, content, summary, status, category, insight_type_id, created_at, updated_at, insight_types(name)")
        .eq("ask_session_id", askRow.ask_session_id),
      askRow.project_id
        ? admin.from("projects").select("id, name").eq("id", askRow.project_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      askRow.challenge_id
        ? admin.from("challenges").select("id, name").eq("id", askRow.challenge_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (participantsResult.error) {
      throw participantsResult.error;
    }
    if (messagesResult.error) {
      throw messagesResult.error;
    }
    if (insightsResult.error) {
      throw insightsResult.error;
    }

    // Get user profiles for sender names
    const messageUserIds = (messagesResult.data ?? [])
      .map(row => row.user_id)
      .filter((id): id is string => Boolean(id));
    
    let usersById: Record<string, { full_name?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null }> = {};
    if (messageUserIds.length > 0) {
      const { data: users } = await admin
        .from('profiles')
        .select('id, full_name, first_name, last_name, email')
        .in('id', messageUserIds);
      
      if (users) {
        users.forEach(user => {
          usersById[user.id] = user;
        });
      }
    }

    const contextRows = [
      {
        project_name: projectResult.data?.name ?? null,
        challenge_name: challengeResult.data?.name ?? null,
      },
    ];

    return {
      askRow,
      participantInfo: {
        participant_id: participantInfoRow.id,
        user_id: participantInfoRow.user_id,
        participant_email: participantInfoRow.participant_email,
        participant_name: participantInfoRow.participant_name,
        invite_token: participantInfoRow.invite_token,
        role: participantInfoRow.role,
        is_spokesperson: participantInfoRow.is_spokesperson,
      },
      participants:
        (participantsResult.data ?? []).map(row => ({
          participant_id: row.id,
          user_id: row.user_id,
          participant_name: row.participant_name,
          participant_email: row.participant_email,
          role: row.role,
          is_spokesperson: row.is_spokesperson,
          joined_at: row.joined_at,
        })) ?? [],
      contextRows,
      messages:
        (messagesResult.data ?? []).map((row, index) => {
          const metadata = row.metadata as Record<string, unknown> | null;
          const user = row.user_id ? usersById[row.user_id] ?? null : null;

          return {
            message_id: row.id,
            content: row.content,
            type: (row.message_type as string) || 'text',
            sender_type: row.sender_type,
            sender_id: row.user_id,
            sender_name: buildMessageSenderName(row as MessageRow, user as UserRow | null, index),
            created_at: row.created_at,
            metadata: metadata ?? null,
          };
        }) ?? [],
      insights:
        (insightsResult.data ?? []).map(row => ({
          insight_id: row.id,
          content: row.content,
          summary: row.summary,
          challenge_id: row.challenge_id,
          status: row.status,
          category: row.category ?? null,
          insight_type_name: (row.insight_types as unknown as { name: string } | null)?.name ?? null,
          created_at: row.created_at,
          updated_at: row.updated_at,
        })) ?? [],
      profileClient: admin,
    };
  } catch (error) {
    console.error("Fallback loader: unexpected error", error);
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const isPoll = request.nextUrl.searchParams.get('poll') === 'true';

    if (!token || token.trim().length === 0) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Token invalide'
      }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();
    const isDevBypass = process.env.IS_DEV === 'true';

    let askRow: AskSessionRow | null = null;
    let participantInfo: TokenDataBundle["participantInfo"] = null;
    let participantRows: TokenDataBundle["participants"] = [];
    let contextRows: TokenDataBundle["contextRows"] = [];
    let messageRows: TokenDataBundle["messages"] = [];
    let insightRows: TokenDataBundle["insights"] = [];
    let profileClient: SupabaseClient = supabase;

    // BUG-035 FIX: SECURITY - Never log token values, use [TOKEN] placeholder in any debug/error logs
    // Attempt to fetch via RPC (preferred). Fallback to admin client if RPC unavailable or empty.
    const { data: askRows, error: askError } = await supabase
      .rpc('get_ask_session_by_token', { p_token: token });

    if (askError || !askRows || askRows.length === 0) {
      const fallbackData = await loadTokenDataWithAdmin(token);
      if (!fallbackData) {
        return NextResponse.json<ApiResponse>({
          success: false,
          error: 'ASK introuvable pour le token fourni'
        }, { status: 404 });
      }
      askRow = fallbackData.askRow;
      participantInfo = fallbackData.participantInfo;
      participantRows = fallbackData.participants;
      contextRows = fallbackData.contextRows;
      messageRows = fallbackData.messages;
      insightRows = fallbackData.insights;
      profileClient = fallbackData.profileClient;
    } else {
      askRow = askRows[0] as AskSessionRow;

      const [
        { data: participantInfoRows, error: participantInfoError },
        { data: participantRowsData, error: participantError },
        { data: contextRowsData, error: contextError },
        { data: messageRowsData, error: messageError },
        { data: insightRowsData, error: insightError },
      ] = await Promise.all([
        supabase.rpc('get_participant_by_token', { p_token: token }),
        supabase.rpc('get_ask_participants_by_token', { p_token: token }),
        supabase.rpc('get_ask_context_by_token', { p_token: token }),
        supabase.rpc('get_ask_messages_by_token', { p_token: token }),
        supabase.rpc('get_ask_insights_by_token', { p_token: token }),
      ]);

      if (participantInfoError) {
        console.error('Error getting participant by token:', participantInfoError);
      }
      participantInfo = participantInfoRows && participantInfoRows.length > 0
        ? participantInfoRows[0] as { participant_id: string | null; user_id: string | null; participant_email: string | null; participant_name: string | null; invite_token: string | null; role: string | null; is_spokesperson: boolean | null }
        : null;

      if (participantError) {
        console.error('Error getting participants by token:', participantError);
        return NextResponse.json<ApiResponse>({
          success: false,
          error: 'Erreur lors de la récupération des participants'
        }, { status: 500 });
      }
      participantRows = (participantRowsData ?? []) as TokenDataBundle["participants"];

      if (contextError) {
        console.error('Error getting context by token:', contextError);
      } else {
        contextRows = contextRowsData as TokenDataBundle["contextRows"];
      }

      if (messageError) {
        console.error('Error getting messages by token:', messageError);
      } else {
        messageRows = (messageRowsData ?? []) as TokenDataBundle["messages"];
      }

      if (insightError) {
        console.error('Error getting insights by token:', insightError);
      } else {
        insightRows = (insightRowsData ?? []) as TokenDataBundle["insights"];
      }
    }

    // Try to get authenticated user (optional - token access doesn't require auth)
    let profileId: string | null = null;
    let isAuthenticated = false;

    if (!isDevBypass) {
      const { data: userResult, error: userError } = await supabase.auth.getUser();

      if (!userError && userResult?.user) {
        isAuthenticated = true;
        
        // Get profile ID from auth_id
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id')
          .eq('auth_id', userResult.user.id)
          .single();

        if (!profileError && profile) {
          profileId = profile.id;

          // If participant has a user_id, verify it matches the current user
          if (participantInfo?.user_id && participantInfo.user_id !== profileId) {
            return NextResponse.json<ApiResponse>({
              success: false,
              error: 'Ce lien est associé à un autre participant'
            }, { status: 403 });
          }
        }
      }
    } else {
      isAuthenticated = true; // Dev bypass
    }

    // Token is valid - allow access to view the ASK
    // The token itself is proof of authorization
    // Authentication is optional but recommended for full participation
    // If participant has user_id but user is not authenticated, we still allow access
    // but the frontend can prompt for authentication if needed

    const participantUserIds = (participantRows ?? [])
      .map((row: any) => row.user_id)
      .filter((value: any): value is string => Boolean(value));

    // Get user profiles for participants using RPC to bypass RLS
    let usersById: Record<string, any> = {};
    if (participantUserIds.length > 0) {
      const profileAdmin = getAdminSupabaseClient();
      const { data: usersJson } = await profileAdmin.rpc('get_profiles_by_ids', {
        p_user_ids: participantUserIds,
      });

      if (usersJson && Array.isArray(usersJson)) {
        usersJson.forEach((user: any) => {
          usersById[user.id] = user;
        });
      }
    }

    const participants = (participantRows ?? []).map((row: any, index: number) => {
      const user = usersById[row.user_id] ?? null;

      // Use centralized function for display name
      const displayName = buildParticipantDisplayName(
        row as ParticipantRow,
        user as UserRow | null,
        index
      );

      return {
        id: String(row.user_id ?? row.participant_id),
        name: displayName,
        email: row.participant_email || user?.email || null,
        role: user?.role || row.role || null,
        isSpokesperson: row.is_spokesperson === true,
        isActive: true,
      };
    });

    let project = null;
    let challenge = null;
    if (contextRows && contextRows.length > 0) {
      const context = contextRows[0] as any;
      project = context.project_name ? { name: context.project_name } : null;
      challenge = context.challenge_name ? { name: context.challenge_name } : null;
    }

    // Transform RPC rows to use centralized sender name logic (consistent with all routes)
    const messages = (messageRows ?? []).map((row: any, index: number) => {
      // Transform RPC row to MessageRow format for centralized sender name function
      const messageRow: MessageRow = {
        id: row.message_id,
        ask_session_id: askRow.ask_session_id,
        content: row.content,
        sender_type: row.sender_type,
        user_id: row.sender_id,
        created_at: row.created_at,
        metadata: row.metadata,
      };
      const user = row.sender_id ? usersById[row.sender_id] ?? null : null;

      return {
        id: row.message_id,
        askKey: askRow.ask_key,
        askSessionId: askRow.ask_session_id,
        content: row.content,
        type: row.type || 'text',
        senderType: row.sender_type || 'user',
        senderId: row.sender_id,
        senderName: buildMessageSenderName(messageRow, user as UserRow | null, index),
        timestamp: row.created_at,
        metadata: row.metadata || {},
        clientId: row.message_id,
      };
    });

    // Get insight authors separately (they may have RLS, but we'll try)
    const insightIds = (insightRows ?? []).map((row: any) => row.insight_id);
    let insightAuthorsById: Record<string, any[]> = {};
    if (insightIds.length > 0) {
      const { data: authors } = await profileClient
        .from('insight_authors')
        .select('insight_id, user_id, display_name')
        .in('insight_id', insightIds);
      
      if (authors) {
        authors.forEach(author => {
          if (!insightAuthorsById[author.insight_id]) {
            insightAuthorsById[author.insight_id] = [];
          }
          insightAuthorsById[author.insight_id].push(author);
        });
      }
    }

    // Map insights from RPC data (insight_type_name is already hydrated by the RPC)
    // Default to 'idea' to match central resolveInsightType logic
    let insights: Insight[] = (insightRows ?? []).map((row: any) => ({
      id: row.insight_id,
      askId: askRow.ask_key,
      askSessionId: askRow.ask_session_id,
      challengeId: row.challenge_id,
      authorId: null,
      authorName: null,
      authors: (insightAuthorsById[row.insight_id] ?? []).map((author: any) => ({
        id: author.user_id || '',
        userId: author.user_id,
        name: author.display_name,
      })),
      content: row.content,
      summary: row.summary,
      type: (row.insight_type_name || 'idea') as any,
      category: row.category ?? null,
      status: row.status || 'new',
      priority: null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      relatedChallengeIds: row.challenge_id ? [row.challenge_id] : [],
      kpis: [],
      sourceMessageId: null,
    }));

    // Get challenges if any
    const challenges: any[] = [];

    // Build viewer from participant info (using shared type for consistency with key route)
    let viewer: AskViewer | null = null;

    if (participantInfo) {
      const participantRow = (participantRows ?? []).find((row: any) => row.participant_id === participantInfo?.participant_id) ?? null;
      const viewerUser = participantInfo.user_id ? (usersById[participantInfo.user_id] ?? null) : null;

      // Use centralized function for display name (consistent with all other routes)
      const participantIndex = participantRow
        ? (participantRows ?? []).findIndex((row: any) => row.participant_id === participantRow.participant_id)
        : 0;
      const resolvedName = buildParticipantDisplayName(
        (participantRow ?? {}) as ParticipantRow,
        viewerUser as UserRow | null,
        participantIndex >= 0 ? participantIndex : 0
      );

      // Check both is_spokesperson flag AND role === "spokesperson" (both are used depending on how spokesperson was assigned)
      const viewerRole = participantInfo.role ?? participantRow?.role ?? null;
      const isSpokesperson = participantInfo.is_spokesperson === true || participantRow?.is_spokesperson === true || viewerRole === "spokesperson";

      viewer = {
        participantId: participantRow?.participant_id ?? participantInfo.participant_id ?? null,
        profileId: participantInfo.user_id,
        name: resolvedName,
        email: participantRow?.participant_email ?? viewerUser?.email ?? participantInfo.participant_email ?? null,
        role: viewerRole,
        isSpokesperson,
      };
    }

    // Get conversation thread and plan
    let conversationPlan: ConversationPlanWithSteps | null = null;

    // Use participant's user_id for thread creation (from token), or fall back to authenticated profileId
    const threadUserId = participantInfo?.user_id ?? profileId;

    // Track thread ID for realtime subscriptions (set inside try block)
    let conversationThreadId: string | null = null;

    try {
      const askConfig = {
        conversation_mode: askRow.conversation_mode,
      };

      const adminClient = getAdminSupabaseClient();
      const { thread: conversationThread, error: threadError } = await getOrCreateConversationThread(
        adminClient,
        askRow.ask_session_id,
        threadUserId,
        askConfig
      );

      // Store thread ID for response (used for realtime subscriptions)
      conversationThreadId = conversationThread?.id ?? null;

      // In individual_parallel mode, filter messages to only show those from the participant's thread
      // This ensures message isolation between participants
      if (conversationThread && !shouldUseSharedThread(askConfig)) {
        // Individual thread mode - reload messages for this specific thread only
        const { messages: threadMessages, error: threadMessagesError } = await getMessagesForThread(
          adminClient,
          conversationThread.id
        );

        if (!threadMessagesError && threadMessages) {
          // Get user profiles for sender names
          const threadMessageUserIds = threadMessages
            .map(row => row.user_id)
            .filter((id): id is string => Boolean(id));

          // Update usersById with any new user IDs
          if (threadMessageUserIds.length > 0) {
            const missingUserIds = threadMessageUserIds.filter(id => !usersById[id]);
            if (missingUserIds.length > 0) {
              const { data: newUsers } = await adminClient
                .from('profiles')
                .select('id, full_name, first_name, last_name, email')
                .in('id', missingUserIds);

              if (newUsers) {
                newUsers.forEach(user => {
                  usersById[user.id] = user;
                });
              }
            }
          }

          // Replace messages array with filtered thread messages
          messages.length = 0; // Clear existing messages
          threadMessages.forEach((row, index) => {
            const messageRow: MessageRow = {
              id: row.id,
              ask_session_id: askRow.ask_session_id,
              content: row.content,
              sender_type: row.sender_type,
              user_id: row.user_id,
              created_at: row.created_at,
              metadata: row.metadata as Record<string, unknown> | null,
            };
            const user = row.user_id ? usersById[row.user_id] ?? null : null;

            messages.push({
              id: row.id,
              askKey: askRow.ask_key,
              askSessionId: askRow.ask_session_id,
              content: row.content,
              type: (row.message_type as string) || 'text',
              senderType: row.sender_type || 'user',
              senderId: row.user_id,
              senderName: buildMessageSenderName(messageRow, user as UserRow | null, index),
              timestamp: row.created_at,
              metadata: (row.metadata as Record<string, unknown>) || {},
              clientId: row.id,
            });
          });

          console.log(`[token route] Individual thread mode: filtered ${messages.length} messages for thread ${conversationThread.id}`);
        }

        // Filter insights by thread in individual_parallel mode
        // This ensures participants only see insights from their own conversation
        // Using centralized fetchInsightsForThread which properly hydrates type names
        try {
          const threadInsightRows = await fetchInsightsForThread(adminClient, conversationThread.id);
          insights = threadInsightRows.map(mapInsightRowToInsight);
          console.log(`[token route] Individual thread mode: filtered ${insights.length} insights for thread ${conversationThread.id}`);
        } catch (threadInsightsError) {
          console.error('[token route] Error fetching thread insights:', threadInsightsError);
          // Keep the original insights if thread fetch fails
        }
      }

      if (conversationThread) {
        conversationPlan = await getConversationPlanWithSteps(adminClient, conversationThread.id);

        // Check if plan or initial message needs to be generated
        const needsPlan = !conversationPlan;
        const needsInitialMessage = messages.length === 0 && askRow.conversation_mode !== 'consultant';
        // Check the is_initializing flag from the thread to see if another process is already working on it
        const threadIsInitializing = (conversationThread as any).is_initializing === true;

        // Log initialization status - frontend will trigger /init if needed
        // (fire-and-forget from backend doesn't work reliably in serverless)
        if (needsPlan || needsInitialMessage) {
          console.log(`📋 [token route] Needs initialization (needsPlan: ${needsPlan}, needsInitialMessage: ${needsInitialMessage}, isInitializing: ${threadIsInitializing})`);
        }
      }
    } catch (threadPlanError) {
      // Log the error for debugging
      console.error('❌ [token route] Thread/plan setup failed:', threadPlanError instanceof Error ? threadPlanError.message : threadPlanError);
      // Continue without the plan - it's an enhancement, not a requirement
    }

    // Determine if async initialization is in progress
    // This is true if:
    // 1. The thread has is_initializing flag set (another process is generating)
    // 2. OR plan doesn't exist yet AND we just triggered /init
    // 3. OR initial message doesn't exist yet AND we just triggered /init
    // We need to check if conversationThread has is_initializing set
    let isInitializing = false;
    if (conversationThreadId) {
      // Re-fetch the thread to get the current is_initializing state
      // (it might have been set by the /init we just triggered)
      const adminClient = getAdminSupabaseClient();
      const { data: threadState } = await adminClient
        .from('conversation_threads')
        .select('is_initializing')
        .eq('id', conversationThreadId)
        .single();

      if (threadState?.is_initializing) {
        isInitializing = true;
      } else {
        // If not initializing but still missing plan/message, it needs init
        const needsPlan = !conversationPlan;
        const needsInitialMessage = messages.length === 0 && askRow.conversation_mode !== 'consultant';
        isInitializing = needsPlan || needsInitialMessage;
      }
    }

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        ask: {
          id: askRow.ask_session_id,
          key: askRow.ask_key,
          name: askRow.name,
          question: askRow.question,
          description: askRow.description,
          status: askRow.status,
          isActive: askRow.status === 'active',
          startDate: askRow.start_date,
          endDate: askRow.end_date,
          createdAt: askRow.created_at,
          updatedAt: askRow.updated_at,
          deliveryMode: askRow.delivery_mode as "physical" | "digital",
          conversationMode: askRow.conversation_mode as AskConversationMode,
          expectedDurationMinutes: askRow.expected_duration_minutes,
          participants,
          askSessionId: askRow.ask_session_id,
        },
        messages,
        insights,
        challenges,
        viewer,
        conversationPlan,
        conversationThreadId,
        // Flag to indicate async initialization is in progress
        isInitializing,
      }
    });
  } catch (error) {
    console.error('Error in GET /api/ask/token/[token]:', error);
    Sentry.captureException(error, {
      tags: { route: 'ask/token', method: 'GET' },
    });
    return NextResponse.json<ApiResponse>({
      success: false,
      error: error instanceof Error ? error.message : "Une erreur est survenue"
    }, { status: 500 });
  }
}
