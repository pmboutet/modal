-- Migration: Fix type mismatch in get_ask_session_by_token RPC function
-- Column 3 (name) has character varying in table but function declares TEXT

BEGIN;

-- Drop and recreate the function with correct types matching the table
DROP FUNCTION IF EXISTS public.get_ask_session_by_token(VARCHAR);

CREATE OR REPLACE FUNCTION public.get_ask_session_by_token(
  p_token VARCHAR
)
RETURNS TABLE (
  ask_session_id UUID,
  ask_key VARCHAR,
  name VARCHAR,
  question TEXT,
  description TEXT,
  status VARCHAR,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  allow_auto_registration BOOLEAN,
  max_participants INTEGER,
  delivery_mode VARCHAR,
  conversation_mode VARCHAR,
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
