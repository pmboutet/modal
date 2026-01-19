-- Migration: Add elapsed_active_seconds, timer_reset_at, and profile info to get_ask_participants_by_token RPC
-- Purpose: Fix voice agent timer showing 0/8min and participant_details being empty
-- Bug 1: The RPC was not returning timer fields, causing agent-config to receive 0 for elapsed time
-- Bug 2: The RPC was not returning profile info, causing participant names to be "Participant N" instead of actual names
-- Related: migrations 087 and 136 added timer fields to get_participant_by_token but not to get_ask_participants_by_token

-- Drop the existing function first (return type is changing)
DROP FUNCTION IF EXISTS public.get_ask_participants_by_token(character varying);

-- Recreate with elapsed_active_seconds, timer_reset_at, and profile info included
CREATE OR REPLACE FUNCTION public.get_ask_participants_by_token(p_token character varying)
RETURNS TABLE(
  participant_id uuid,
  user_id uuid,
  participant_name character varying,
  participant_email character varying,
  role character varying,
  is_spokesperson boolean,
  joined_at timestamp with time zone,
  elapsed_active_seconds integer,  -- Added: Required for timer display
  timer_reset_at timestamp with time zone,  -- Added: Required for timer reset functionality
  -- Profile fields (added to fix participant_details matching)
  profile_full_name character varying,
  profile_first_name character varying,
  profile_last_name character varying,
  profile_email character varying,
  profile_description text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_ask_session_id UUID;
BEGIN
  -- Get ASK session ID from token
  SELECT ap.ask_session_id INTO v_ask_session_id
  FROM public.ask_participants ap
  WHERE invite_token = p_token
  LIMIT 1;

  -- If token not found, return empty
  IF v_ask_session_id IS NULL THEN
    RETURN;
  END IF;

  -- Return participants with profile info (bypasses RLS but only for verified session)
  RETURN QUERY
  SELECT
    ap.id AS participant_id,
    ap.user_id,
    ap.participant_name,
    ap.participant_email,
    ap.role,
    ap.is_spokesperson,
    ap.joined_at,
    ap.elapsed_active_seconds,
    ap.timer_reset_at,
    -- Profile fields (LEFT JOIN to handle participants without profiles)
    p.full_name AS profile_full_name,
    p.first_name AS profile_first_name,
    p.last_name AS profile_last_name,
    p.email AS profile_email,
    p.description AS profile_description
  FROM public.ask_participants ap
  LEFT JOIN public.profiles p ON p.id = ap.user_id
  WHERE ap.ask_session_id = v_ask_session_id
  ORDER BY ap.joined_at ASC;
END;
$function$;

-- Force PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
