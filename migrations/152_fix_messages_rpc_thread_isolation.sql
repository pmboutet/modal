-- Migration: Fix get_ask_messages_by_token to properly isolate threads in individual_parallel mode
-- Bug: When v_thread_id is NULL in individual_parallel mode, the RPC returned ALL messages
--      instead of an empty list, causing context pollution between participants
-- Fix: Check conversation_mode and return empty if individual_parallel with no thread

-- Drop the existing function first
DROP FUNCTION IF EXISTS public.get_ask_messages_by_token(character varying);

-- Recreate with proper thread isolation for individual_parallel mode
CREATE OR REPLACE FUNCTION public.get_ask_messages_by_token(p_token character varying)
RETURNS TABLE(
  message_id uuid,
  content text,
  type character varying,
  sender_type character varying,
  sender_id uuid,
  sender_name text,
  created_at timestamp with time zone,
  metadata jsonb,
  plan_step_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_participant_id UUID;
  v_ask_session_id UUID;
  v_user_id UUID;
  v_thread_id UUID;
  v_conversation_mode TEXT;
BEGIN
  -- First, verify token exists and get participant info
  SELECT ap.id, ap.ask_session_id, ap.user_id INTO v_participant_id, v_ask_session_id, v_user_id
  FROM public.ask_participants ap
  WHERE ap.invite_token = p_token
  LIMIT 1;

  -- If token not found, return empty result
  IF v_participant_id IS NULL THEN
    RETURN;
  END IF;

  -- Get the conversation mode for the session
  SELECT a.conversation_mode INTO v_conversation_mode
  FROM public.ask_sessions a
  WHERE a.id = v_ask_session_id;

  -- Get the conversation thread for this user (for individual_parallel mode support)
  SELECT ct.id INTO v_thread_id
  FROM public.conversation_threads ct
  WHERE ct.ask_session_id = v_ask_session_id
    AND (ct.user_id = v_user_id OR ct.is_shared = true)
  ORDER BY ct.is_shared ASC  -- Prefer user-specific thread over shared
  LIMIT 1;

  -- BUG FIX: In individual_parallel mode, if no thread exists for this user,
  -- return empty result to prevent context pollution from other participants
  IF v_conversation_mode = 'individual_parallel' AND v_thread_id IS NULL THEN
    RETURN;  -- Return empty - user hasn't started their conversation yet
  END IF;

  -- Return messages for the conversation thread
  -- For individual_parallel mode: only messages from user's thread
  -- For other modes: messages from shared thread or all session messages
  RETURN QUERY
  SELECT
    m.id AS message_id,
    m.content,
    m.message_type AS type,
    m.sender_type,
    m.user_id AS sender_id,
    COALESCE(
      p.full_name,
      CONCAT(p.first_name, ' ', p.last_name),
      p.email,
      'Unknown'
    )::TEXT AS sender_name,
    m.created_at,
    m.metadata,
    m.plan_step_id
  FROM public.messages m
  LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE m.ask_session_id = v_ask_session_id
    AND (
      v_thread_id IS NULL  -- No thread = return all (for shared/consultant modes)
      OR m.conversation_thread_id = v_thread_id  -- Messages in user's thread
      OR m.conversation_thread_id IS NULL  -- Legacy messages without thread
    )
  ORDER BY m.created_at ASC;
END;
$function$;

-- Force PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
