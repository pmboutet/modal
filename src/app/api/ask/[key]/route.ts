import { NextRequest, NextResponse } from 'next/server';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { ApiResponse, Ask, AskParticipant, Insight, Message } from '@/types';
import { isValidAskKey, parseErrorMessage } from '@/lib/utils';
import { mapInsightRowToInsight } from '@/lib/insights';
import { fetchInsightsForSession } from '@/lib/insightQueries';
import { getAskSessionByKey, getOrCreateConversationThread, getMessagesForThread, shouldUseSharedThread, resolveThreadUserId } from '@/lib/asks';
import { createServerSupabaseClient } from '@/lib/supabaseServer';
import { executeAgent } from '@/lib/ai/service';
import { buildConversationAgentVariables } from '@/lib/ai/conversation-agent';
import { getConversationPlanWithSteps, getActiveStep, ensureConversationPlanExists, type ConversationPlan } from '@/lib/ai/conversation-plan';
import {
  buildParticipantDisplayName,
  buildMessageSenderName,
  fetchElapsedTime,
  fetchParticipantsWithUsers,
  insertAiMessage,
  type UserRow,
  type ProjectRow,
  type ChallengeRow,
  type MessageRow,
  type ParticipantRow,
  type ProjectMemberRow,
} from '@/lib/conversation-context';
import { normaliseMessageMetadata } from '@/lib/messages';
import { loadFullAuthContext, buildParticipantName, type AskViewer } from '@/lib/ask-session-loader';

interface AskSessionRow {
  id: string;
  ask_key: string;
  name?: string | null;
  question: string;
  description?: string | null;
  system_prompt?: string | null;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  delivery_mode?: string | null;
  conversation_mode?: string | null;
  allow_auto_registration?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
  project_id?: string | null;
  challenge_id?: string | null;
}

function isPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = ((error as PostgrestError).code ?? '').toString().toUpperCase();
  if (code === '42501' || code === 'PGRST301' || code === 'PGRST302') {
    return true;
  }

  const message = ((error as { message?: string }).message ?? '').toString().toLowerCase();
  return message.includes('permission denied') || message.includes('unauthorized');
}

function permissionDeniedResponse(): NextResponse<ApiResponse> {
  return NextResponse.json<ApiResponse>({
    success: false,
    error: "Accès non autorisé à cette ASK"
  }, { status: 403 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;

    if (!key || !isValidAskKey(key)) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Invalid ASK key format'
      }, { status: 400 });
    }

    const isDevBypass = process.env.IS_DEV === 'true';

    // Create session client for auth (even in dev mode, we need cookies for auth.getUser)
    const { createServerClient } = await import('@supabase/ssr');
    const { cookies } = await import('next/headers');
    const cookieStore = await cookies();
    const sessionClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set() {},
          remove() {},
        },
      }
    ) as unknown as SupabaseClient;

    // Get admin client for data operations (bypasses RLS)
    const { getAdminSupabaseClient } = await import('@/lib/supabaseAdmin');
    const adminClient = getAdminSupabaseClient();

    // In dev mode, use admin client for data operations
    const dataClient: SupabaseClient = isDevBypass ? adminClient : sessionClient;

    // Check for invite token in headers
    const inviteToken = request.headers.get('X-Invite-Token');

    // 1. First, get the ASK session to know its ID
    const { row: askRow, error: askError } = await getAskSessionByKey<AskSessionRow>(
      dataClient,
      key,
      '*'
    );

    if (askError) {
      if (isPermissionDenied(askError)) {
        return permissionDeniedResponse();
      }
      throw askError;
    }

    if (!askRow) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'ASK introuvable pour la clé fournie'
      }, { status: 404 });
    }

    // 2. Load full auth context (handles token, session, and membership lookup)
    console.log(`🔍 GET /api/ask/[key]: Calling loadFullAuthContext...`);
    let { authContext, viewer } = await loadFullAuthContext({
      inviteToken,
      askSessionId: askRow.id,
      sessionClient,
      isDevBypass,
    });
    console.log(`✅ GET /api/ask/[key]: Auth context loaded:`, {
      profileId: authContext.profileId,
      participantId: authContext.participantId,
      isSpokesperson: authContext.isSpokesperson,
      authMethod: authContext.authMethod,
      hasViewer: !!viewer,
    });

    // Dev mode fallback: if no auth, try to find a spokesperson participant for the viewer
    // This helps with testing consultant mode without requiring login
    if (isDevBypass && !viewer && !authContext.profileId) {
      console.log(`🔓 GET /api/ask/[key]: Dev mode - trying to find spokesperson participant...`);

      // Find participants for this ASK
      const { data: devParticipants } = await adminClient
        .from('ask_participants')
        .select('id, user_id, role, is_spokesperson, participant_name, participant_email')
        .eq('ask_session_id', askRow.id)
        .order('is_spokesperson', { ascending: false }) // Spokespersons first
        .limit(5);

      if (devParticipants && devParticipants.length > 0) {
        // Prefer spokesperson, otherwise first participant
        const devParticipant = devParticipants.find(p => p.is_spokesperson || p.role === 'spokesperson')
          || devParticipants[0];

        const isSpokesperson = devParticipant.is_spokesperson === true || devParticipant.role === 'spokesperson';

        // Fetch the linked profile to get name/email if participant fields are empty
        let profileName: string | null = null;
        let profileEmail: string | null = null;
        if (devParticipant.user_id) {
          const { data: profile } = await adminClient
            .from('profiles')
            .select('full_name, first_name, last_name, email')
            .eq('id', devParticipant.user_id)
            .maybeSingle();

          if (profile) {
            profileName = profile.full_name
              || [profile.first_name, profile.last_name].filter(Boolean).join(' ')
              || null;
            profileEmail = profile.email || null;
          }
        }

        console.log(`✅ GET /api/ask/[key]: Dev mode - using participant for viewer:`, {
          participantId: devParticipant.id,
          profileId: devParticipant.user_id,
          isSpokesperson,
          role: devParticipant.role,
          profileName,
          profileEmail,
        });

        viewer = {
          participantId: devParticipant.id,
          profileId: devParticipant.user_id,
          isSpokesperson,
          // Use buildParticipantName with profile fallback
          name: buildParticipantName(
            devParticipant.participant_name || profileName,
            devParticipant.participant_email || profileEmail,
            devParticipant.id
          ),
          email: devParticipant.participant_email || profileEmail,
          role: devParticipant.role,
        };

        // Update authContext too for consistency
        authContext = {
          ...authContext,
          profileId: devParticipant.user_id,
          participantId: devParticipant.id,
          isSpokesperson,
          participantName: devParticipant.participant_name || profileName,
          participantEmail: devParticipant.participant_email || profileEmail,
          participantRole: devParticipant.role,
          authMethod: 'anonymous',
        };
      } else {
        console.log(`⚠️ GET /api/ask/[key]: Dev mode - no participants found for ASK`);
      }
    }

    // 3. Validate access permissions (only enforce in non-dev mode)
    if (!isDevBypass) {
      const allowAutoReg = askRow.allow_auto_registration === true;
      const hasValidAuth = authContext.profileId !== null;

      // If invite token was provided but invalid, reject
      if (inviteToken && !authContext.participantId) {
        return NextResponse.json<ApiResponse>({
          success: false,
          error: "Ce lien d'invitation n'est pas valide ou n'est pas correctement configuré."
        }, { status: 403 });
      }

      // Require authentication unless session is anonymous
      if (!hasValidAuth && !allowAutoReg) {
        return NextResponse.json<ApiResponse>({
          success: false,
          error: "Authentification requise. Veuillez vous connecter ou utiliser un lien d'invitation valide."
        }, { status: 401 });
      }

      // Require participation unless session is anonymous
      if (hasValidAuth && !authContext.participantId && !allowAutoReg) {
        return permissionDeniedResponse();
      }

      // Auto-add participant for anonymous sessions
      if (allowAutoReg && hasValidAuth && !authContext.participantId) {
        try {
          // Use RPC to bypass RLS for participant creation
          const { data: newParticipant, error: joinError } = await adminClient
            .rpc('join_anonymous_session', {
              p_ask_session_id: askRow.id,
              p_user_id: authContext.profileId,
              p_role: 'participant',
            });

          if (joinError) {
            console.error('❌ GET /api/ask/[key]: Failed to auto-add participant:', joinError);
          } else if (newParticipant) {
            console.log('✅ GET /api/ask/[key]: Auto-added participant:', newParticipant.id);
            // Update authContext with the new participant
            authContext = {
              ...authContext,
              participantId: newParticipant.id,
            };
          }
        } catch (error) {
          console.error('❌ GET /api/ask/[key]: Failed to join anonymous session:', error);
        }
      }
    }

    const askSessionId = askRow.id;

    // Fetch participants and users via centralized helper (DRY)
    const {
      participantRows,
      usersById: fetchedUsersById,
      projectMembersById,
      participants: participantSummaries,
    } = await fetchParticipantsWithUsers(dataClient, askSessionId, askRow.project_id);

    let usersById = fetchedUsersById;

    // Build AskParticipant array for API response (includes more fields than participantSummaries)
    const participants: AskParticipant[] = (participantRows ?? []).map((row, index) => {
      const user = row.user_id ? usersById[row.user_id] ?? null : null;
      return {
        id: row.id,
        userId: row.user_id ?? null, // Profile ID for message alignment in consultant mode
        name: buildParticipantDisplayName(row as ParticipantRow, user, index),
        email: row.participant_email ?? user?.email ?? null,
        role: row.role ?? null,
        isSpokesperson: Boolean(row.is_spokesperson),
        isActive: true,
      };
    });

    // Get or create conversation thread for this user/ASK
    const askConfig = {
      conversation_mode: askRow.conversation_mode ?? null,
    };

    // Use resolveThreadUserId for consistent thread assignment across all routes
    // Map participantRows to ensure they conform to Participant interface
    const participantsForThread = participantRows.map(p => ({
      ...p,
      user_id: p.user_id ?? null,
    }));
    const threadProfileId = resolveThreadUserId(
      authContext.profileId,
      askRow.conversation_mode,
      participantsForThread,
      isDevBypass
    );

    console.log('🔍 GET /api/ask/[key]: Determining conversation thread:', {
      askSessionId,
      profileId: authContext.profileId,
      threadProfileId,
      conversationMode: askConfig.conversation_mode,
      isDevBypass,
    });

    // In dev bypass mode, use admin client to bypass RLS for thread operations
    const threadClient = isDevBypass ? adminClient : dataClient;

    const { thread: conversationThread, error: threadError } = await getOrCreateConversationThread(
      threadClient,
      askSessionId,
      threadProfileId,
      askConfig
    );

    console.log('🔍 GET /api/ask/[key]: Conversation thread determined:', {
      threadId: conversationThread?.id ?? null,
      threadProfileId,
      isShared: conversationThread?.is_shared ?? null,
    });

    if (threadError) {
      if (isPermissionDenied(threadError)) {
        return permissionDeniedResponse();
      }
      throw threadError;
    }

    // Get messages for the thread (or all messages if no thread yet for backward compatibility)
    let messageRows: MessageRow[] = [];

    if (conversationThread) {
      const { messages: threadMessages, error: threadMessagesError } = await getMessagesForThread(
        dataClient,
        conversationThread.id
      );
      
      if (threadMessagesError) {
        if (isPermissionDenied(threadMessagesError)) {
          return permissionDeniedResponse();
        }
        throw threadMessagesError;
      }
      
      // Combine thread messages with messages without thread (for backward compatibility)
      // In individual_parallel mode, ONLY show messages from the user's thread - no legacy messages
      // This ensures strict message isolation between participants
      const threadMessagesList = (threadMessages ?? []) as MessageRow[];

      if (shouldUseSharedThread(askConfig)) {
        // Shared thread mode: include messages without thread_id for backward compatibility
        const { data: messagesWithoutThread, error: messagesWithoutThreadError } = await dataClient
          .from('messages')
          .select('id, ask_session_id, user_id, sender_type, content, message_type, metadata, created_at, conversation_thread_id')
          .eq('ask_session_id', askSessionId)
          .is('conversation_thread_id', null)
          .order('created_at', { ascending: true });

        if (messagesWithoutThreadError && !isPermissionDenied(messagesWithoutThreadError)) {
          console.warn('⚠️ Error fetching messages without thread:', messagesWithoutThreadError);
        }

        const messagesWithoutThreadList = (messagesWithoutThread ?? []) as MessageRow[];
        messageRows = [...threadMessagesList, ...messagesWithoutThreadList].sort((a, b) => {
          const timeA = new Date(a.created_at ?? new Date().toISOString()).getTime();
          const timeB = new Date(b.created_at ?? new Date().toISOString()).getTime();
          return timeA - timeB;
        });
      } else {
        // Individual thread mode: strict isolation - only messages from this user's thread
        messageRows = threadMessagesList;
        console.log(`🔒 GET /api/ask/[key]: Individual thread mode - showing ${messageRows.length} messages from thread ${conversationThread.id}`);
      }
    } else {
      // Fallback: get messages when no thread exists yet
      // In individual_parallel mode, filter by user_id to maintain isolation
      // In shared mode, get all messages for backward compatibility
      if (!shouldUseSharedThread(askConfig) && threadProfileId) {
        // Individual mode without thread yet: only get messages from this user
        const { data, error: messageError } = await dataClient
          .from('messages')
          .select('id, ask_session_id, user_id, sender_type, content, message_type, metadata, created_at, conversation_thread_id')
          .eq('ask_session_id', askSessionId)
          .eq('user_id', threadProfileId)
          .order('created_at', { ascending: true });

        if (messageError) {
          if (isPermissionDenied(messageError)) {
            return permissionDeniedResponse();
          }
          throw messageError;
        }

        messageRows = (data ?? []) as MessageRow[];
        console.log(`🔒 GET /api/ask/[key]: Individual mode without thread - showing ${messageRows.length} messages for user ${threadProfileId}`);
      } else {
        // Shared mode: get all messages for backward compatibility
        const { data, error: messageError } = await dataClient
          .from('messages')
          .select('id, ask_session_id, user_id, sender_type, content, message_type, metadata, created_at, conversation_thread_id')
          .eq('ask_session_id', askSessionId)
          .order('created_at', { ascending: true });

        if (messageError) {
          if (isPermissionDenied(messageError)) {
            return permissionDeniedResponse();
          }
          throw messageError;
        }

        messageRows = (data ?? []) as MessageRow[];
      }
    }

    const messageUserIds = (messageRows ?? [])
      .map(row => row.user_id)
      .filter((value): value is string => Boolean(value));

      const additionalUserIds = messageUserIds.filter(id => !usersById[id]);

      if (additionalUserIds.length > 0) {
        const { data: extraUsers, error: extraUsersError } = await dataClient
          .from('profiles')
          .select('id, email, full_name, first_name, last_name')
          .in('id', additionalUserIds);

      if (extraUsersError) {
        if (isPermissionDenied(extraUsersError)) {
          return permissionDeniedResponse();
        }
        throw extraUsersError;
      }

      (extraUsers ?? []).forEach(user => {
        usersById[user.id] = user;
      });
    }

    // Use unified buildMessageSenderName for consistent sender name logic across all modes
    const messages: Message[] = (messageRows ?? []).map((row, index) => {
      const metadata = normaliseMessageMetadata(row.metadata);
      const user = row.user_id ? usersById[row.user_id] ?? null : null;

      return {
        id: row.id,
        askKey: askRow.ask_key,
        askSessionId: row.ask_session_id,
        conversationThreadId: (row as any).conversation_thread_id ?? null,
        content: row.content,
        type: (row.message_type as Message['type']) ?? 'text',
        senderType: (row.sender_type as Message['senderType']) ?? 'user',
        senderId: row.user_id ?? null,
        senderName: buildMessageSenderName(row as MessageRow, user, index),
        timestamp: row.created_at ?? new Date().toISOString(),
        metadata: metadata,
      };
    });

    // Get conversation plan if thread exists (do this BEFORE initializing messages)
    let conversationPlan: ConversationPlan | null = null;
    if (conversationThread) {
      conversationPlan = await getConversationPlanWithSteps(dataClient, conversationThread.id);
      if (conversationPlan && conversationPlan.plan_data) {
        console.log('📋 GET /api/ask/[key]: Loaded existing conversation plan with', conversationPlan.plan_data.steps.length, 'steps');
      }
    }

    // Load project/challenge context when needed (plan generation or initial prompt)
    let projectData: ProjectRow | null = null;
    let challengeData: ChallengeRow | null = null;
    const shouldLoadContext = !conversationPlan || messages.length === 0;

    if (shouldLoadContext) {
      if (askRow.project_id) {
        const { data, error } = await dataClient
          .from('projects')
          .select('id, name, system_prompt')
          .eq('id', askRow.project_id)
          .maybeSingle<ProjectRow>();

        if (error) {
          console.error('❌ GET /api/ask/[key]: Failed to fetch project for context:', error);
        } else {
          projectData = data ?? null;
        }
      }

      if (askRow.challenge_id) {
        const { data, error } = await dataClient
          .from('challenges')
          .select('id, name, system_prompt')
          .eq('id', askRow.challenge_id)
          .maybeSingle<ChallengeRow>();

        if (error) {
          console.error('❌ GET /api/ask/[key]: Failed to fetch challenge for context:', error);
        } else {
          challengeData = data ?? null;
        }
      }
    }

    // Ensure a conversation plan exists (centralized function handles generation if needed)
    if (conversationThread && !conversationPlan) {
      try {
        conversationPlan = await ensureConversationPlanExists(
          adminClient,
          conversationThread.id,
          {
            askRow,
            projectData,
            challengeData,
            participantSummaries,
          }
        );
      } catch (planError) {
        // IMPORTANT: Plan generation is REQUIRED - fail if it doesn't work
        console.error('❌ GET /api/ask/[key]: Failed to generate conversation plan:', planError);
        return NextResponse.json<ApiResponse>({
          success: false,
          error: 'Failed to generate conversation plan. Please try again.'
        }, { status: 500 });
      }
    }

    // If no messages exist, initiate conversation with agent
    if (messages.length === 0) {
      try {
        console.log('💬 GET /api/ask/[key]: No messages found, initiating conversation with agent');

        // Fetch elapsed times using centralized helper (DRY - same as stream route)
        // IMPORTANT: Pass participantRows to use fallback when profileId doesn't match
        const { elapsedActiveSeconds, stepElapsedActiveSeconds } = await fetchElapsedTime({
          supabase: dataClient,
          askSessionId: askSessionId,
          profileId: authContext.profileId,
          conversationPlan,
          participantRows: participantRows ?? [],
          adminClient,
        });

        const agentVariables = buildConversationAgentVariables({
          ask: {
            ...askRow,
            conversation_mode: askRow.conversation_mode ?? null,
          },
          project: projectData,
          challenge: challengeData,
          messages,
          participants: participantSummaries,
          currentParticipantName: viewer?.name ?? null,
          conversationPlan,
          elapsedActiveSeconds,
          stepElapsedActiveSeconds,
        });
        
        // Execute agent to get initial response
        const agentResult = await executeAgent({
          supabase: dataClient,
          agentSlug: 'ask-conversation-response',
          askSessionId: askSessionId,
          interactionType: 'ask.chat.response',
          variables: agentVariables,
          toolContext: {
            projectId: askRow.project_id,
            challengeId: askRow.challenge_id,
          },
        });

        if (typeof agentResult.content === 'string' && agentResult.content.trim().length > 0) {
          const aiResponse = agentResult.content.trim();

          // Get the currently active plan step to link this message
          let initialPlanStepId: string | null = null;
          if (conversationPlan) {
            try {
              const activeStep = await getActiveStep(dataClient, conversationPlan.id);
              if (activeStep) {
                initialPlanStepId = activeStep.id;
              }
            } catch (stepError) {
              console.warn('⚠️ GET /api/ask/[key]: Failed to get active step for initial message linking:', stepError);
            }
          }

          // Insert the initial AI message via RPC wrapper to bypass RLS
          // Pass initialPlanStepId to link message to current step
          const inserted = await insertAiMessage(
            dataClient,
            askSessionId,
            conversationThread?.id ?? null,
            aiResponse,
            'Agent',
            initialPlanStepId
          );

          if (inserted) {
            const initialMessage: Message = {
              id: inserted.id,
              askKey: askRow.ask_key,
              askSessionId: inserted.ask_session_id,
              conversationThreadId: (inserted as any).conversation_thread_id ?? null,
              content: inserted.content,
              type: (inserted.message_type as Message['type']) ?? 'text',
              senderType: 'ai',
              senderId: inserted.user_id ?? null,
              senderName: 'Agent',
              timestamp: inserted.created_at ?? new Date().toISOString(),
              metadata: normaliseMessageMetadata(inserted.metadata),
            };
            messages.push(initialMessage);
            console.log('✅ GET /api/ask/[key]: Initial conversation message created:', initialMessage.id);
          } else {
            console.error('❌ GET /api/ask/[key]: Failed to insert initial message');
          }
        }
      } catch (error) {
        // Log error but don't fail the request - user can still interact
        console.error('⚠️ GET /api/ask/[key]: Failed to initiate conversation:', error);
      }
    }

    // Get insights for the session
    // In individual mode, we should ideally filter by thread, but to ensure all insights are visible
    // (especially when insights are created in individual threads but viewed from shared thread),
    // we fetch all insights for the session and filter client-side if needed
    let insightRows;
    try {
      // Always fetch all insights for the session to ensure visibility across threads
      // This is important because insights might be created in individual threads
      // but need to be visible when viewing from a shared thread or different user context
      insightRows = await fetchInsightsForSession(dataClient, askSessionId);
      
      console.log('📊 GET /api/ask/[key]: Fetched insights for session:', {
        totalInsights: insightRows.length,
        threadId: conversationThread?.id ?? null,
        isShared: conversationThread?.is_shared ?? null,
        insightsByThread: insightRows.reduce((acc, insight) => {
          const threadId = (insight as any).conversation_thread_id ?? 'no-thread';
          acc[threadId] = (acc[threadId] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      });
      
      // If we have a specific thread and it's not shared, we could filter by thread
      // But for now, we show all insights to ensure visibility
      // TODO: Consider adding a query parameter to filter by thread if needed
    } catch (error) {
      if (isPermissionDenied((error as PostgrestError) ?? null)) {
        return permissionDeniedResponse();
      }
      throw error;
    }

    const insights: Insight[] = insightRows.map((row) => {
      const insight = mapInsightRowToInsight(row);
      return {
        ...insight,
        conversationThreadId: conversationThread?.id ?? null,
      };
    });

    console.log('📊 GET /api/ask/[key]: Returning insights:', {
      insightCount: insights.length,
      insightIds: insights.map(i => i.id),
      conversationThreadId: conversationThread?.id ?? null,
    });

    const endDate = askRow.end_date ?? new Date().toISOString();
    const createdAt = askRow.created_at ?? new Date().toISOString();
    const updatedAt = askRow.updated_at ?? createdAt;

    const ask: Ask = {
      id: askRow.id,
      key: askRow.ask_key,
      name: askRow.name ?? null,
      question: askRow.question,
      description: askRow.description ?? null,
      status: askRow.status ?? null,
      isActive: (askRow.status ?? '').toLowerCase() === 'active',
      startDate: askRow.start_date ?? null,
      endDate,
      createdAt,
      updatedAt,
      deliveryMode: (askRow.delivery_mode as Ask['deliveryMode']) ?? 'digital',
      conversationMode: (askRow.conversation_mode as Ask['conversationMode']) ?? 'collaborative',
      participants,
      askSessionId: askSessionId,
    };

    if (ask.endDate) {
      const now = Date.now();
      const end = new Date(ask.endDate).getTime();
      if (!Number.isNaN(end) && end < now) {
        ask.isActive = false;
      }
    }

    if (ask.startDate) {
      const now = Date.now();
      const start = new Date(ask.startDate).getTime();
      if (!Number.isNaN(start) && start > now) {
        ask.isActive = false;
      }
    }

    // viewer is already built by loadFullAuthContext
    console.log('🔍 GET /api/ask/[key]: Returning viewer info:', {
      hasViewer: !!viewer,
      isSpokesperson: viewer?.isSpokesperson ?? false,
      participantId: viewer?.participantId,
      profileId: viewer?.profileId,
    });

    return NextResponse.json<ApiResponse<{
      ask: Ask;
      messages: Message[];
      insights: Insight[];
      challenges: any[];
      conversationPlan?: ConversationPlan | null;
      conversationThreadId?: string | null;
      viewer?: AskViewer | null;
    }>>({
      success: true,
      data: {
        ask,
        messages,
        insights,
        challenges: [],
        conversationPlan,
        conversationThreadId: conversationThread?.id ?? null,
        viewer,
      }
    });
  } catch (error) {
    console.error('Error retrieving ASK from database:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      error: parseErrorMessage(error)
    }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;

    if (!key || !isValidAskKey(key)) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Invalid ASK key format'
      }, { status: 400 });
    }

    const body = await request.json();

    if (!body?.content) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Message content is required'
      }, { status: 400 });
    }

    const isDevBypass = process.env.IS_DEV === 'true';
    
    // In dev mode, createServerSupabaseClient uses service role which has no user session
    // We need a normal client to get the user session for authentication
    let supabase: SupabaseClient;
    if (isDevBypass) {
      // Create a normal client to get user session even in dev mode
      const { createServerClient } = await import('@supabase/ssr');
      const { cookies } = await import('next/headers');
      const cookieStore = await cookies();
      supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            get(name: string) {
              return cookieStore.get(name)?.value;
            },
            set() {}, // No-op in route handlers
            remove() {}, // No-op in route handlers
          },
        }
      ) as unknown as SupabaseClient;
    } else {
      supabase = await createServerSupabaseClient();
    }

    let adminClient: SupabaseClient | null = null;
    const getAdminClient = async () => {
      if (!adminClient) {
        const { getAdminSupabaseClient } = await import('@/lib/supabaseAdmin');
        adminClient = getAdminSupabaseClient();
      }
      return adminClient;
    };

    let dataClient: SupabaseClient = supabase;

    // Check for invite token in headers (allows anonymous participation)
    const inviteToken = request.headers.get('X-Invite-Token');
    console.log('🔍 POST /api/ask/[key]: Invite token check', {
      hasInviteToken: !!inviteToken,
      tokenPrefix: inviteToken ? inviteToken.substring(0, 8) + '...' : null,
      isDevBypass
    });

    let profileId: string | null = null;
    let participantId: string | null = null;

    // Try to authenticate via invite token first (dev mode should support invite links too)
    if (inviteToken) {
      console.log(`🔑 POST /api/ask/[key]: Attempting authentication via invite token ${inviteToken.substring(0, 8)}...`);

      // Use admin client to validate token and get participant info
      const admin = await getAdminClient();

      // Use RPC function to bypass RLS (direct query fails even with service_role)
      console.log('🔍 POST: Querying participant via RPC with token:', inviteToken.substring(0, 16) + '...');
      const { data: rpcResult, error: tokenError } = await admin
        .rpc('get_participant_by_token', { p_token: inviteToken })
        .maybeSingle<{
          participant_id: string;
          user_id: string | null;
          participant_email: string | null;
          participant_name: string | null;
          invite_token: string;
          role: string | null;
          is_spokesperson: boolean;
        }>();

      // Map RPC result to expected format
      const participant = rpcResult ? {
        id: rpcResult.participant_id,
        user_id: rpcResult.user_id,
        ask_session_id: null as string | null, // Not returned by RPC, will verify later
      } : null;

      console.log('🔍 POST: Token query result (RPC):', {
        hasParticipant: !!participant,
        participantId: participant?.id ?? null,
        userId: participant?.user_id ?? null,
        tokenError: tokenError ? tokenError.message : null
      });

      if (tokenError) {
        console.error('❌ Error validating invite token:', tokenError);
      } else if (participant) {
        // STRICT REQUIREMENT: Every participant MUST have a user_id
        if (!participant.user_id) {
          console.error('❌ Invite token is not linked to a user profile', {
            participantId: participant.id,
            inviteToken: inviteToken.substring(0, 8) + '...'
          });
          return NextResponse.json<ApiResponse>({
            success: false,
            error: "Ce lien d'invitation n'est pas correctement configuré. Contactez l'administrateur pour qu'il regénère votre lien d'accès."
          }, { status: 403 });
        }

        console.log(`✅ Valid invite token for participant ${participant.id}`, {
          hasUserId: !!participant.user_id,
          userId: participant.user_id
        });
        participantId = participant.id;
        profileId = participant.user_id; // REQUIRED - never NULL
        dataClient = admin;
      } else {
        console.warn('⚠️  Invite token not found in database');
      }
    }

    if (!isDevBypass) {
      // If no valid token, try regular auth
      if (!participantId) {
        console.log('🔐 POST /api/ask/[key]: No valid invite token, trying regular auth...');
        const { data: userResult, error: userError } = await supabase.auth.getUser();

        if (userError) {
          console.error('❌ POST /api/ask/[key]: Auth error:', userError);
          if (isPermissionDenied(userError as unknown as PostgrestError)) {
            return permissionDeniedResponse();
          }
          throw userError;
        }

        const user = userResult?.user;

        if (!user) {
          console.warn('⚠️ POST /api/ask/[key]: No authenticated user found and no valid invite token');
          return NextResponse.json<ApiResponse>({
            success: false,
            error: "Authentification requise. Veuillez vous connecter ou utiliser un lien d'invitation valide."
          }, { status: 403 });
        }
        
        console.log('✅ POST /api/ask/[key]: Authenticated user found:', user.id);

        // Get profile ID from auth_id (user.id is the auth UUID, we need the profile UUID)
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id')
          .eq('auth_id', user.id)
          .single();

        if (profileError || !profile) {
          console.error('❌ POST /api/ask/[key]: Profile not found for user:', user.id);
          return NextResponse.json<ApiResponse>({
            success: false,
            error: "Profil utilisateur introuvable"
          }, { status: 401 });
        }

        profileId = profile.id;
        console.log('✅ POST /api/ask/[key]: Profile ID found:', profileId);
      }
    } else {
      // Dev bypass mode - always use admin client to bypass RLS
      console.log('🔓 POST /api/ask/[key]: Dev bypass mode - no auth required');
      const admin = await getAdminClient();
      dataClient = admin;
      console.log('✅ POST /api/ask/[key]: Using admin client in dev bypass mode');
    }

    // Final check: we MUST have a profileId (no anonymous participants allowed)
    // We need EITHER:
    // - profileId from authenticated user OR from valid invite token
    // - dev bypass mode
    if (!isDevBypass && !profileId) {
      console.error('❌ POST /api/ask/[key]: No valid user profile (profileId required)', {
        hasParticipantId: !!participantId,
        hasInviteToken: !!inviteToken
      });
      return NextResponse.json<ApiResponse>({
        success: false,
        error: "Authentification requise. Veuillez vous connecter avec un compte valide ou utiliser un lien d'invitation correctement configuré."
      }, { status: 403 });
    }

    console.log('✅ POST /api/ask/[key]: Authentication validated', {
      hasProfileId: !!profileId,
      hasParticipantId: !!participantId,
      isDevBypass,
      authMethod: participantId ? 'invite_token' : 'regular_auth'
    });

    const { row: askRow, error: askError } = await getAskSessionByKey<Pick<AskSessionRow, 'id' | 'ask_key' | 'allow_auto_registration' | 'conversation_mode'>>(
      dataClient,
      key,
      'id, ask_key, allow_auto_registration, conversation_mode'
    );

    if (askError) {
      if (isPermissionDenied(askError)) {
        return permissionDeniedResponse();
      }
      throw askError;
    }

    if (!askRow) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'ASK introuvable pour la clé fournie'
      }, { status: 404 });
    }

    console.log('🔍 POST /api/ask/[key]: Retrieved ASK', {
      askKey: key,
      askRowId: askRow.id,
      askRowKey: askRow.ask_key,
      participantId,
      profileId
    });

    // En mode dev, si profileId est null, on essaie de récupérer ou créer un profil par défaut
    let finalProfileId = profileId;
    if (isDevBypass && !finalProfileId) {
      // En mode dev, chercher un profil admin par défaut
      const admin = await getAdminClient();
      console.log('🔍 POST: Looking for admin profile (role=full_admin, is_active=true)...');
      const { data: devProfile, error: devProfileError } = await admin
        .from('profiles')
        .select('id')
        .eq('role', 'full_admin')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      console.log('🔍 POST: Admin profile query result:', {
        hasProfile: !!devProfile,
        profileId: devProfile?.id ?? null,
        error: devProfileError ? devProfileError.message : null
      });

      if (devProfile) {
        finalProfileId = devProfile.id;
        console.log('✅ POST /api/ask/[key]: Using default admin profile in dev mode:', finalProfileId);
      } else {
        // If no admin profile found, try to get any active profile
        console.log('🔍 POST: No admin profile, looking for any active profile...');
        const { data: anyProfile, error: anyProfileError } = await admin
          .from('profiles')
          .select('id')
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();

        console.log('🔍 POST: Any active profile query result:', {
          hasProfile: !!anyProfile,
          profileId: anyProfile?.id ?? null,
          error: anyProfileError ? anyProfileError.message : null
        });

        if (anyProfile) {
          finalProfileId = anyProfile.id;
          console.log('✅ POST /api/ask/[key]: Using first active profile in dev mode:', finalProfileId);
        } else {
          console.error('❌ POST /api/ask/[key]: No active profiles found in dev mode. Cannot insert message without user_id.');
          return NextResponse.json<ApiResponse>({
            success: false,
            error: "Aucun profil utilisateur actif trouvé. Veuillez créer un profil utilisateur dans la base de données."
          }, { status: 500 });
        }
      }
    }

    // Final validation: we MUST have a profileId to insert a message
    if (!finalProfileId) {
      console.error('❌ POST /api/ask/[key]: Cannot insert message without user_id', {
        isDevBypass,
        hasProfileId: !!profileId,
        hasParticipantId: !!participantId,
        hasInviteToken: !!inviteToken
      });
      return NextResponse.json<ApiResponse>({
        success: false,
        error: "Impossible d'insérer un message sans identifiant utilisateur. Veuillez vous connecter ou utiliser un lien d'invitation valide."
      }, { status: 403 });
    }

    // Get or create conversation thread for this user/ASK
    const askConfig = {
      conversation_mode: askRow.conversation_mode ?? null,
    };

    // Fetch participants for resolveThreadUserId
    const { data: participantRowsForThread } = await dataClient
      .from('ask_participants')
      .select('id, user_id')
      .eq('ask_session_id', askRow.id)
      .order('joined_at', { ascending: true });

    // Use resolveThreadUserId for consistent thread assignment across all routes
    const threadProfileId = resolveThreadUserId(
      finalProfileId,
      askRow.conversation_mode,
      participantRowsForThread ?? [],
      isDevBypass
    );

    console.log('🔍 POST /api/ask/[key]: Creating/getting conversation thread', {
      askSessionId: askRow.id,
      finalProfileId,
      threadProfileId,
      conversationMode: askConfig.conversation_mode,
      isDevBypass
    });

    // In dev bypass mode, use admin client to bypass RLS for thread operations
    const threadClient = isDevBypass ? await getAdminClient() : dataClient;

    const { thread: conversationThread, error: threadError } = await getOrCreateConversationThread(
      threadClient,
      askRow.id,
      threadProfileId,
      askConfig
    );

    if (threadError) {
      console.error('❌ POST /api/ask/[key]: Thread creation error:', threadError);
      if (isPermissionDenied(threadError)) {
        console.error('❌ POST /api/ask/[key]: Thread creation permission denied');
        // In dev bypass mode, allow continuing without a thread
        if (isDevBypass) {
          console.warn('⚠️ POST /api/ask/[key]: Dev bypass mode - continuing without conversation thread');
        } else {
          return permissionDeniedResponse();
        }
      } else {
        // For non-permission errors, still throw in non-dev mode
        if (!isDevBypass) {
          throw threadError;
        } else {
          console.warn('⚠️ POST /api/ask/[key]: Dev bypass mode - continuing without conversation thread after error');
        }
      }
    } else {
      console.log('✅ POST /api/ask/[key]: Conversation thread ready', {
        threadId: conversationThread?.id ?? null,
        hasThread: !!conversationThread
      });
    }

    if (!isDevBypass && (profileId || participantId)) {
      const allowAutoReg = askRow.allow_auto_registration === true;

      // If authenticated via invite token, verify participant belongs to this ASK
      if (participantId) {
        const admin = await getAdminClient();

        // Use RPC to bypass RLS issues in production
        const { data: participantDataJson, error: participantFetchError } = await admin.rpc(
          'get_participant_by_id',
          { p_participant_id: participantId }
        );

        if (participantFetchError) {
          console.error('❌ POST: Error fetching participant data:', participantFetchError);
          return permissionDeniedResponse();
        }

        const participantData = participantDataJson as { id: string; ask_session_id: string } | null;

        if (!participantData) {
          console.error('❌ POST: Participant not found:', participantId);
          return permissionDeniedResponse();
        }

        console.log('🔍 POST: Participant verification:', {
          participantId,
          participantAskSessionId: participantData.ask_session_id,
          askRowId: askRow.id,
          askKey: askRow.ask_key,
          match: participantData.ask_session_id === askRow.id
        });

        if (participantData.ask_session_id !== askRow.id) {
          console.error('❌ POST: Participant does not belong to this ASK session', {
            participantId,
            participantAskSessionId: participantData.ask_session_id,
            askRowId: askRow.id,
            askKey: askRow.ask_key
          });
          return permissionDeniedResponse();
        }

        console.log(`✅ POST: Participant ${participantId} verified for ASK ${askRow.id}`);
      } else if (profileId) {
        // Check if user is a participant (regular auth flow)
        const { data: membership, error: membershipError } = await supabase
          .from('ask_participants')
          .select('id, user_id')
          .eq('ask_session_id', askRow.id)
          .eq('user_id', profileId)
          .maybeSingle();

        if (membershipError) {
          if (isPermissionDenied(membershipError)) {
            return permissionDeniedResponse();
          }
          throw membershipError;
        }

        // If session allows anonymous participation, allow access even if not in participants list
        // Otherwise, require explicit participation
        if (!membership && !allowAutoReg) {
          return permissionDeniedResponse();
        }

        // Store the membership ID for later use
        if (membership) {
          participantId = membership.id;
        }

        // If anonymous and user is not yet a participant, create one automatically
        if (allowAutoReg && !membership) {
          const { error: insertError } = await supabase
            .from('ask_participants')
            .insert({
              ask_session_id: askRow.id,
              user_id: profileId,
              role: 'participant',
            });

          if (insertError && !isPermissionDenied(insertError)) {
            // Log but don't fail - RLS policies will handle access
            console.warn('Failed to auto-add participant to anonymous session:', insertError);
          }
        }
      }
    }

    // Check if profile is quarantined before allowing message insertion
    if (finalProfileId) {
      const { isProfileQuarantined } = await import('@/lib/security/quarantine');
      const isQuarantined = await isProfileQuarantined(dataClient, finalProfileId);
      
      if (isQuarantined) {
        return NextResponse.json<ApiResponse>({
          success: false,
          error: 'Votre compte a été mis en quarantaine et ne peut plus envoyer de messages. Contactez un administrateur pour plus d\'informations.'
        }, { status: 403 });
      }
    }

    const timestamp = body.timestamp ?? new Date().toISOString();
    const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};

    // IMPORTANT: senderName is REQUIRED for user messages - never use fallbacks like 'Vous'
    if (!body.senderName || typeof body.senderName !== 'string' || body.senderName.trim().length === 0) {
      console.error('❌ POST /api/ask/[key]: senderName is required for user messages');
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'senderName is required for user messages'
      }, { status: 400 });
    }
    metadata.senderName = body.senderName.trim();

    const senderType: Message['senderType'] = 'user';

    // Récupérer parent_message_id si fourni
    const parentMessageId = typeof body.parentMessageId === 'string' && body.parentMessageId.trim().length > 0
      ? body.parentMessageId
      : typeof body.parent_message_id === 'string' && body.parent_message_id.trim().length > 0
      ? body.parent_message_id
      : null;

    // Get the currently active plan step to link this message
    let planStepId: string | null = null;
    if (conversationThread) {
      try {
        const plan = await getConversationPlanWithSteps(dataClient, conversationThread.id);
        if (plan) {
          const activeStep = await getActiveStep(dataClient, plan.id);
          if (activeStep) {
            planStepId = activeStep.id;
          }
        }
      } catch (error) {
        console.warn('⚠️ POST /api/ask/[key]: Failed to get active step for message linking:', error);
        // Continue without linking to step
      }
    }

    const insertPayload = {
      ask_session_id: askRow.id,
      content: body.content,
      message_type: body.type ?? 'text',
      sender_type: senderType,
      metadata,
      created_at: timestamp,
      user_id: finalProfileId, // REQUIRED - never NULL (enforced by validation above)
      // Note: participant_id column does not exist in messages table
      // The user_id already identifies the participant via their profile
      parent_message_id: parentMessageId,
      conversation_thread_id: conversationThread?.id ?? null,
      plan_step_id: planStepId,
    };

    console.log('🔍 POST /api/ask/[key]: Inserting message via RPC', {
      askSessionId: askRow.id,
      userId: finalProfileId,
      hasThreadId: !!conversationThread?.id,
      isDevBypass,
      payloadKeys: Object.keys(insertPayload)
    });

    // Use RPC to bypass RLS in production
    const { data: insertedJson, error: insertError } = await dataClient.rpc('insert_user_message', {
      p_ask_session_id: insertPayload.ask_session_id,
      p_content: insertPayload.content,
      p_message_type: insertPayload.message_type,
      p_sender_type: insertPayload.sender_type,
      p_metadata: insertPayload.metadata,
      p_created_at: insertPayload.created_at,
      p_user_id: insertPayload.user_id,
      p_parent_message_id: insertPayload.parent_message_id ?? null,
      p_conversation_thread_id: insertPayload.conversation_thread_id ?? null,
      p_plan_step_id: insertPayload.plan_step_id ?? null,
    });

    if (insertError) {
      console.error('❌ POST /api/ask/[key]: Message insert error:', {
        error: insertError,
        code: (insertError as any)?.code,
        message: (insertError as any)?.message,
        details: (insertError as any)?.details,
        hint: (insertError as any)?.hint,
        isPermissionDenied: isPermissionDenied(insertError)
      });
      if (isPermissionDenied(insertError)) {
        console.error('❌ POST /api/ask/[key]: Message insert permission denied');
        return permissionDeniedResponse();
      }
      throw insertError;
    }

    console.log('✅ POST /api/ask/[key]: Message inserted successfully', {
      messageId: (insertedJson as any)?.id
    });

    const inserted = insertedJson as MessageRow | undefined;

    if (!inserted) {
      throw new Error('Unable to insert message');
    }

    const message: Message = {
      id: inserted.id,
      askKey: askRow.ask_key,
      askSessionId: inserted.ask_session_id,
      content: inserted.content,
      type: (inserted.message_type as Message['type']) ?? 'text',
      senderType: senderType,
      senderId: inserted.user_id ?? null,
      senderName: typeof metadata.senderName === 'string' ? metadata.senderName : body.senderName ?? null,
      timestamp: inserted.created_at ?? timestamp,
      metadata: normaliseMessageMetadata(inserted.metadata),
    };

    return NextResponse.json<ApiResponse<{ message: Message }>>({
      success: true,
      data: { message },
      message: 'Message saved successfully'
    });
  } catch (error) {
    console.error('Error saving message to database:', error);
    const errorMessage = parseErrorMessage(error);
    console.error('Error details:', {
      message: errorMessage,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    return NextResponse.json<ApiResponse>({
      success: false,
      error: errorMessage
    }, { status: 500 });
  }
}
