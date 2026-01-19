-- Migration: Add expected_duration_minutes to get_ask_session_by_token RPC function
-- This allows the frontend to display the correct expected duration for conversations

BEGIN;

-- Drop and recreate the function with the new return column
DROP FUNCTION IF EXISTS public.get_ask_session_by_token(VARCHAR(255));

CREATE OR REPLACE FUNCTION public.get_ask_session_by_token(
  p_token VARCHAR(255)
)
RETURNS TABLE (
  ask_session_id UUID,
  ask_key VARCHAR(255),
  name TEXT,
  question TEXT,
  description TEXT,
  status VARCHAR(50),
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  allow_auto_registration BOOLEAN,
  max_participants INTEGER,
  delivery_mode VARCHAR(50),
  conversation_mode VARCHAR(30),
  expected_duration_minutes INTEGER,
  project_id UUID,
  challenge_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_participant_id UUID;
  v_ask_session_id UUID;
BEGIN
  -- First, verify token exists and get participant
  SELECT id, ap.ask_session_id INTO v_participant_id, v_ask_session_id
  FROM public.ask_participants ap
  WHERE invite_token = p_token
  LIMIT 1;

  -- If token not found, return empty result
  IF v_participant_id IS NULL THEN
    RETURN;
  END IF;

  -- Return ASK session data (bypasses RLS due to SECURITY DEFINER)
  RETURN QUERY
  SELECT
    a.id,
    a.ask_key,
    a.name,
    a.question,
    a.description,
    a.status,
    a.start_date,
    a.end_date,
    a.allow_auto_registration,
    a.max_participants,
    a.delivery_mode,
    a.conversation_mode,
    a.expected_duration_minutes,
    a.project_id,
    a.challenge_id,
    a.created_by,
    a.created_at,
    a.updated_at
  FROM public.ask_sessions a
  WHERE a.id = v_ask_session_id;
END;
$$;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';

COMMIT;
