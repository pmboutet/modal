/**
 * Shared ASK Session Loader
 *
 * Centralizes authentication, session loading, and viewer detection
 * for both /api/ask/[key] and /api/ask/token/[token] routes.
 *
 * Also provides utilities for determining when diarization is needed
 * (voice mode with multi-speaker scenarios).
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getAdminSupabaseClient } from './supabaseAdmin';

/**
 * Build a participant display name with proper fallbacks.
 * Ensures we never return null/empty - always a usable name.
 *
 * Priority: participantName > email > generated ID
 */
export function buildParticipantName(
  participantName: string | null | undefined,
  email: string | null | undefined,
  participantId?: string | null
): string {
  if (participantName?.trim()) return participantName.trim();
  if (email?.trim()) return email.trim();
  if (participantId) return `Participant ${participantId.slice(0, 8)}`;
  return 'Participant';
}

/**
 * Determine if the current scenario requires diarization (speaker assignment post-hoc).
 *
 * Diarization is needed when:
 * - Input mode is VOICE (not text)
 * - AND conversation mode is one of: collaborative, group_reporter, consultant
 *
 * In these scenarios, multiple speakers may use the same microphone,
 * so messages are created without a user and assigned later via speaker-assignment.
 */
export function needsDiarization(
  conversationMode: string | null | undefined,
  inputMode: 'text' | 'voice'
): boolean {
  if (inputMode === 'text') return false;

  const diarizationConvModes = ['collaborative', 'group_reporter', 'consultant'];
  return diarizationConvModes.includes(conversationMode || '');
}

/**
 * Viewer information for the current user
 *
 * Note: profileId can be null for token-based access where
 * the participant was created before being linked to a user profile.
 *
 * name is guaranteed to be a non-empty string (uses fallbacks via buildParticipantName)
 */
export interface AskViewer {
  participantId: string | null;
  profileId: string | null;
  isSpokesperson: boolean;
  name: string; // Never null - uses buildParticipantName() fallbacks
  email: string | null;
  role: string | null;
}

/**
 * Authentication context from various sources
 */
export interface AuthContext {
  profileId: string | null;
  participantId: string | null;
  isSpokesperson: boolean;
  participantName: string | null;
  participantEmail: string | null;
  participantRole: string | null;
  authMethod: 'invite_token' | 'session' | 'anonymous' | 'none';
  /** Whether to use admin client for data operations (bypasses RLS) */
  useAdminClient: boolean;
}

/**
 * Options for loading auth context
 */
export interface LoadAuthContextOptions {
  /** Invite token from header or query */
  inviteToken?: string | null;
  /** ASK session ID (required for membership lookup) */
  askSessionId?: string | null;
  /** Supabase client with user session (for session-based auth) */
  sessionClient: SupabaseClient;
  /** Whether to bypass auth errors in dev mode */
  isDevBypass?: boolean;
}

/**
 * Load authentication context from invite token
 *
 * Looks up participant by invite_token and returns their info including spokesperson status.
 */
export async function loadAuthFromInviteToken(
  inviteToken: string
): Promise<AuthContext | null> {
  console.log(`🔑 [ask-session-loader] Loading auth from invite token ${inviteToken.substring(0, 8)}...`);

  const admin = getAdminSupabaseClient();

  const { data: participant, error } = await admin
    .from('ask_participants')
    .select('id, user_id, ask_session_id, is_spokesperson, role, participant_name, participant_email')
    .eq('invite_token', inviteToken)
    .maybeSingle();

  if (error) {
    console.error('❌ [ask-session-loader] Error loading participant from token:', error);
    return null;
  }

  if (!participant) {
    console.warn('⚠️ [ask-session-loader] Invite token not found in database');
    return null;
  }

  // STRICT: Every participant MUST have a user_id
  if (!participant.user_id) {
    console.error('❌ [ask-session-loader] Invite token is not linked to a user profile', {
      participantId: participant.id,
    });
    return null;
  }

  const isSpokesperson = Boolean(participant.is_spokesperson) || participant.role === 'spokesperson';

  console.log(`✅ [ask-session-loader] Auth from token successful:`, {
    participantId: participant.id,
    profileId: participant.user_id,
    isSpokesperson,
    role: participant.role,
  });

  return {
    profileId: participant.user_id,
    participantId: participant.id,
    isSpokesperson,
    participantName: participant.participant_name,
    participantEmail: participant.participant_email,
    participantRole: participant.role,
    authMethod: 'invite_token',
    useAdminClient: true, // Invite token auth requires admin client to bypass RLS
  };
}

/**
 * Load authentication context from Supabase session
 *
 * Gets the authenticated user from session cookies and looks up their profile.
 */
export async function loadAuthFromSession(
  sessionClient: SupabaseClient,
  isDevBypass: boolean = false
): Promise<AuthContext | null> {
  console.log(`🔐 [ask-session-loader] Loading auth from session...`);

  const { data: userResult, error: userError } = await sessionClient.auth.getUser();

  if (userError) {
    if (isDevBypass) {
      console.log('🔓 [ask-session-loader] Dev mode - auth error ignored:', userError.message);
      return null;
    }
    console.error('❌ [ask-session-loader] Auth error:', userError);
    return null;
  }

  const user = userResult?.user;
  if (!user) {
    if (isDevBypass) {
      console.log('🔓 [ask-session-loader] Dev mode - no authenticated user');
      return null;
    }
    console.warn('⚠️ [ask-session-loader] No authenticated user in session');
    return null;
  }

  // Get profile ID from auth_id
  const { data: profile, error: profileError } = await sessionClient
    .from('profiles')
    .select('id, email, full_name, first_name, last_name')
    .eq('auth_id', user.id)
    .single();

  if (profileError || !profile) {
    if (isDevBypass) {
      console.log('🔓 [ask-session-loader] Dev mode - profile not found');
      return null;
    }
    console.error('❌ [ask-session-loader] Profile not found for user:', user.id);
    return null;
  }

  console.log(`✅ [ask-session-loader] Auth from session successful:`, {
    profileId: profile.id,
    email: profile.email,
  });

  // Build participant name from profile
  const participantName = profile.full_name
    || [profile.first_name, profile.last_name].filter(Boolean).join(' ')
    || null;

  return {
    profileId: profile.id,
    participantId: null, // Will be populated by loadParticipantMembership
    isSpokesperson: false, // Will be populated by loadParticipantMembership
    participantName,
    participantEmail: profile.email,
    participantRole: null,
    authMethod: 'session',
    useAdminClient: false, // Session auth has proper RLS access
  };
}

/**
 * Load participant membership for an ASK session
 *
 * Looks up if the user is a participant in the given ASK session
 * and updates their spokesperson status.
 */
export async function loadParticipantMembership(
  authContext: AuthContext,
  askSessionId: string,
  options: {
    sessionClient: SupabaseClient;
    isDevBypass?: boolean;
  }
): Promise<AuthContext> {
  if (!authContext.profileId) {
    return authContext;
  }

  // If already authenticated via token, participantId is already set
  if (authContext.authMethod === 'invite_token' && authContext.participantId) {
    console.log(`✅ [ask-session-loader] Participant already identified via token`);
    return authContext;
  }

  console.log(`🔍 [ask-session-loader] Looking up membership for profile ${authContext.profileId} in ASK ${askSessionId}...`);

  // Use admin client in dev mode to bypass RLS
  const lookupClient = options.isDevBypass
    ? getAdminSupabaseClient()
    : options.sessionClient;

  const { data: membership, error } = await lookupClient
    .from('ask_participants')
    .select('id, user_id, role, is_spokesperson, participant_name, participant_email')
    .eq('ask_session_id', askSessionId)
    .eq('user_id', authContext.profileId)
    .maybeSingle();

  if (error) {
    if (options.isDevBypass) {
      console.log('🔓 [ask-session-loader] Dev mode - membership lookup error ignored:', error.message);
    } else {
      console.error('❌ [ask-session-loader] Membership lookup error:', error);
    }
    return authContext;
  }

  if (!membership) {
    console.log(`⚠️ [ask-session-loader] User is not a participant in this ASK`);
    return authContext;
  }

  const isSpokesperson = Boolean(membership.is_spokesperson) || membership.role === 'spokesperson';

  console.log(`✅ [ask-session-loader] Membership found:`, {
    participantId: membership.id,
    isSpokesperson,
    role: membership.role,
  });

  return {
    ...authContext,
    participantId: membership.id,
    isSpokesperson,
    participantRole: membership.role ?? authContext.participantRole,
    participantName: membership.participant_name ?? authContext.participantName,
    participantEmail: membership.participant_email ?? authContext.participantEmail,
  };
}

/**
 * Build viewer object from auth context
 *
 * Returns null if no authenticated user (profileId is required).
 * Uses buildParticipantName() to ensure name is never null.
 */
export function buildViewer(authContext: AuthContext): AskViewer | null {
  if (!authContext.profileId) {
    console.log(`🔍 [ask-session-loader] No viewer - no profileId`);
    return null;
  }

  // Use buildParticipantName to ensure we always have a displayable name
  const name = buildParticipantName(
    authContext.participantName,
    authContext.participantEmail,
    authContext.participantId
  );

  const viewer: AskViewer = {
    participantId: authContext.participantId,
    profileId: authContext.profileId,
    isSpokesperson: authContext.isSpokesperson,
    name,
    email: authContext.participantEmail,
    role: authContext.participantRole,
  };

  console.log(`✅ [ask-session-loader] Built viewer:`, {
    hasViewer: true,
    isSpokesperson: viewer.isSpokesperson,
    participantId: viewer.participantId,
    profileId: viewer.profileId,
    name: viewer.name,
  });

  return viewer;
}

/**
 * Full auth context loader
 *
 * Tries invite token first, then session auth, then loads membership.
 * Returns both the auth context and the viewer object.
 */
export async function loadFullAuthContext(
  options: LoadAuthContextOptions & { askSessionId: string }
): Promise<{ authContext: AuthContext; viewer: AskViewer | null }> {
  console.log(`🔍 [ask-session-loader] loadFullAuthContext called:`, {
    hasInviteToken: !!options.inviteToken,
    askSessionId: options.askSessionId,
    isDevBypass: options.isDevBypass,
  });

  let authContext: AuthContext = {
    profileId: null,
    participantId: null,
    isSpokesperson: false,
    participantName: null,
    participantEmail: null,
    participantRole: null,
    authMethod: 'none',
    useAdminClient: false,
  };

  // 1. Try invite token first
  if (options.inviteToken) {
    console.log(`🔑 [ask-session-loader] Trying invite token auth...`);
    const tokenAuth = await loadAuthFromInviteToken(options.inviteToken);
    if (tokenAuth) {
      authContext = tokenAuth;
      console.log(`✅ [ask-session-loader] Invite token auth successful`);
    } else {
      console.log(`❌ [ask-session-loader] Invite token auth failed`);
    }
  }

  // 2. If no token auth, try session auth
  if (authContext.authMethod === 'none') {
    console.log(`🔐 [ask-session-loader] Trying session auth...`);
    const sessionAuth = await loadAuthFromSession(
      options.sessionClient,
      options.isDevBypass
    );
    if (sessionAuth) {
      authContext = sessionAuth;
      console.log(`✅ [ask-session-loader] Session auth successful:`, {
        profileId: sessionAuth.profileId,
        authMethod: sessionAuth.authMethod,
      });
    } else {
      console.log(`⚠️ [ask-session-loader] Session auth returned null (no user session)`);
    }
  }

  // 3. Load membership to get spokesperson status (if we have a profileId)
  if (authContext.profileId && options.askSessionId) {
    console.log(`🔍 [ask-session-loader] Loading membership for profileId: ${authContext.profileId}`);
    authContext = await loadParticipantMembership(
      authContext,
      options.askSessionId,
      {
        sessionClient: options.sessionClient,
        isDevBypass: options.isDevBypass,
      }
    );
    console.log(`✅ [ask-session-loader] After membership lookup:`, {
      participantId: authContext.participantId,
      isSpokesperson: authContext.isSpokesperson,
    });
  } else {
    console.log(`⚠️ [ask-session-loader] Skipping membership lookup:`, {
      hasProfileId: !!authContext.profileId,
      hasAskSessionId: !!options.askSessionId,
    });
  }

  // 4. Build viewer
  const viewer = buildViewer(authContext);
  console.log(`🏁 [ask-session-loader] Final result:`, {
    hasViewer: !!viewer,
    isSpokesperson: viewer?.isSpokesperson ?? false,
    authMethod: authContext.authMethod,
  });

  return { authContext, viewer };
}
