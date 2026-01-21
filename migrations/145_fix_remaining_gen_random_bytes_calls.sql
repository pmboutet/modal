-- Migration 145: Fix remaining gen_random_bytes schema references
-- These functions also use gen_random_bytes without the 'extensions' schema prefix

-- Fix add_anonymous_participant function
CREATE OR REPLACE FUNCTION public.add_anonymous_participant(
  p_ask_session_id uuid,
  p_user_id uuid,
  p_participant_name text,
  p_role text DEFAULT 'participant'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_participant_record ask_participants;
  v_invite_token text;
BEGIN
  -- Generate a unique invite token
  v_invite_token := encode(extensions.gen_random_bytes(16), 'hex');

  INSERT INTO ask_participants (
    ask_session_id,
    user_id,
    participant_name,
    role,
    invite_token,
    status
  ) VALUES (
    p_ask_session_id,
    p_user_id,
    p_participant_name,
    p_role,
    v_invite_token,
    'active'
  )
  RETURNING * INTO v_participant_record;

  RETURN to_jsonb(v_participant_record);
END;
$$;

-- Fix join_anonymous_session function
CREATE OR REPLACE FUNCTION public.join_anonymous_session(
  p_ask_session_id uuid,
  p_user_id uuid,
  p_role text DEFAULT 'participant'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session_record ask_sessions;
  v_participant_record ask_participants;
  v_invite_token text;
BEGIN
  -- Verify the session exists and allows auto-registration
  SELECT * INTO v_session_record
  FROM ask_sessions
  WHERE id = p_ask_session_id;

  IF v_session_record IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  IF v_session_record.allow_auto_registration != true THEN
    RAISE EXCEPTION 'Session does not allow auto-registration';
  END IF;

  -- Check if participant already exists
  SELECT * INTO v_participant_record
  FROM ask_participants
  WHERE ask_session_id = p_ask_session_id
    AND user_id = p_user_id;

  IF v_participant_record IS NOT NULL THEN
    -- Already a participant, return existing record
    RETURN to_jsonb(v_participant_record);
  END IF;

  -- Generate a unique invite token
  v_invite_token := encode(extensions.gen_random_bytes(16), 'hex');

  -- Insert new participant
  INSERT INTO ask_participants (
    ask_session_id,
    user_id,
    role,
    invite_token,
    status
  ) VALUES (
    p_ask_session_id,
    p_user_id,
    p_role,
    v_invite_token,
    'active'
  )
  RETURNING * INTO v_participant_record;

  RETURN to_jsonb(v_participant_record);
END;
$$;

-- Force PostgREST to reload the schema cache
NOTIFY pgrst, 'reload schema';
