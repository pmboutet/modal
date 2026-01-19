-- Migration: Add plan_step_id to get_ask_messages_by_token RPC
-- Purpose: Fix voice agent amnesia bug where step_messages_json was always empty
-- Bug: The RPC was not returning plan_step_id, causing message filtering by step to fail

-- Drop the existing function first (signature remains the same, but return type changes)
DROP FUNCTION IF EXISTS public.get_ask_messages_by_token(character varying);

-- Recreate with plan_step_id included in the return table
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
  plan_step_id uuid  -- Added: Required for step_messages filtering
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

  -- Get the conversation thread for this user (for individual_parallel mode support)
  SELECT ct.id INTO v_thread_id
  FROM public.conversation_threads ct
  WHERE ct.ask_session_id = v_ask_session_id
    AND (ct.user_id = v_user_id OR ct.is_shared = true)
  ORDER BY ct.is_shared ASC  -- Prefer user-specific thread over shared
  LIMIT 1;

  -- Return messages for the conversation thread (or session if no thread)
  -- This ensures we only return messages relevant to this participant's conversation
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
    m.plan_step_id  -- Added: Now included in return
  FROM public.messages m
  LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE m.ask_session_id = v_ask_session_id
    AND (v_thread_id IS NULL OR m.conversation_thread_id = v_thread_id OR m.conversation_thread_id IS NULL)
  ORDER BY m.created_at ASC;
END;
$function$;

-- Force PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
