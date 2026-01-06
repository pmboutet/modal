-- Migration 130: Rename is_anonymous to allow_auto_registration
-- This column now represents whether users can self-register via public ASK links
-- Previously "is_anonymous" was misleading as it didn't make participation anonymous

BEGIN;

-- ============================================================
-- 1. Rename the column
-- ============================================================
ALTER TABLE ask_sessions RENAME COLUMN is_anonymous TO allow_auto_registration;

COMMENT ON COLUMN ask_sessions.allow_auto_registration IS
  'When TRUE, users can self-register via public ASK link (/?ask=<key>). When FALSE, only pre-invited participants can access.';

-- ============================================================
-- 2. Update is_ask_participant function
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_ask_participant(ask_session_uuid UUID)
RETURNS BOOLEAN AS $$
DECLARE
  session_allow_auto_registration BOOLEAN;
BEGIN
  -- Check if the session allows auto-registration
  SELECT allow_auto_registration INTO session_allow_auto_registration
  FROM public.ask_sessions
  WHERE id = ask_session_uuid;

  -- If session allows auto-registration, any logged-in user can participate
  IF session_allow_auto_registration = true AND public.current_user_id() IS NOT NULL THEN
    RETURN true;
  END IF;

  -- Otherwise, check if user is explicitly a participant
  RETURN EXISTS (
    SELECT 1
    FROM public.ask_participants
    WHERE ask_session_id = ask_session_uuid
    AND user_id = public.current_user_id()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.is_ask_participant(UUID) IS
  'Returns true if the current user can participate in the ask session.
   Returns true automatically for auto-registration sessions (allow_auto_registration=true) if user is logged in.
   Otherwise checks if user is in ask_participants table.';

-- ============================================================
-- 3. Update join_anonymous_session function (keep name for backward compatibility)
-- ============================================================
CREATE OR REPLACE FUNCTION public.join_anonymous_session(
  p_ask_session_id uuid,
  p_user_id uuid,
  p_role text DEFAULT 'participant'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  v_invite_token := encode(gen_random_bytes(16), 'hex');

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

-- ============================================================
-- 4. Update get_ask_session_by_key function
-- ============================================================
DROP FUNCTION IF EXISTS public.get_ask_session_by_key(text);

CREATE OR REPLACE FUNCTION public.get_ask_session_by_key(p_key text)
RETURNS TABLE (
  ask_session_id uuid,
  ask_key text,
  question text,
  description text,
  status text,
  project_id uuid,
  challenge_id uuid,
  conversation_mode text,
  expected_duration_minutes integer,
  system_prompt text,
  allow_auto_registration boolean,
  name text,
  delivery_mode text,
  start_date timestamptz,
  end_date timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id as ask_session_id,
    a.ask_key::text,
    a.question::text,
    a.description::text,
    a.status::text,
    a.project_id,
    a.challenge_id,
    a.conversation_mode::text,
    a.expected_duration_minutes,
    a.system_prompt::text,
    a.allow_auto_registration,
    a.name::text,
    a.delivery_mode::text,
    a.start_date,
    a.end_date,
    a.created_at,
    a.updated_at
  FROM ask_sessions a
  WHERE a.ask_key = p_key;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ask_session_by_key(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ask_session_by_key(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_ask_session_by_key(text) TO service_role;

-- ============================================================
-- 5. Update get_ask_session_by_token function
-- ============================================================
DROP FUNCTION IF EXISTS public.get_ask_session_by_token(VARCHAR);

CREATE OR REPLACE FUNCTION public.get_ask_session_by_token(
  p_token VARCHAR(255)
)
RETURNS TABLE (
  ask_session_id UUID,
  ask_key VARCHAR(255),
  name VARCHAR,
  question TEXT,
  description TEXT,
  status VARCHAR(50),
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  allow_auto_registration BOOLEAN,
  max_participants INTEGER,
  delivery_mode VARCHAR(50),
  conversation_mode VARCHAR(30),
  project_id UUID,
  challenge_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
DECLARE
  v_participant_id UUID;
  v_ask_session_id UUID;
BEGIN
  -- First, verify token exists and get participant
  SELECT ap.id, ap.ask_session_id INTO v_participant_id, v_ask_session_id
  FROM public.ask_participants ap
  WHERE ap.invite_token = p_token
  LIMIT 1;

  -- If token not found, return empty result
  IF v_participant_id IS NULL THEN
    RETURN;
  END IF;

  -- Return ASK session data (bypasses RLS due to SECURITY DEFINER)
  RETURN QUERY
  SELECT
    a.id AS ask_session_id,
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
    a.project_id,
    a.challenge_id,
    a.created_by,
    a.created_at,
    a.updated_at
  FROM public.ask_sessions a
  WHERE a.id = v_ask_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.get_ask_session_by_token(VARCHAR) IS
  'Returns ASK session data for a valid invite token. Returns allow_auto_registration flag.';

-- ============================================================
-- 6. Update RLS policy for self-registration
-- ============================================================
DROP POLICY IF EXISTS "Users can join anonymous sessions" ON ask_participants;
CREATE POLICY "Users can self-register in auto-registration sessions"
ON ask_participants
FOR INSERT
TO authenticated
WITH CHECK (
  -- User must be adding themselves (not someone else)
  user_id = current_user_id()
  -- Session must allow auto-registration
  AND EXISTS (
    SELECT 1
    FROM ask_sessions a
    WHERE a.id = ask_participants.ask_session_id
    AND a.allow_auto_registration = true
  )
);

-- ============================================================
-- 7. Reload schema cache
-- ============================================================
NOTIFY pgrst, 'reload schema';

COMMIT;
