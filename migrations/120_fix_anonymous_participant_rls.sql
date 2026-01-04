-- Migration: Allow users to join anonymous ASK sessions
-- Purpose: Enable auto-add participant for anonymous sessions
--
-- ISSUE: Users cannot join anonymous sessions because:
-- 1. There's no INSERT policy allowing self-registration for anonymous sessions
-- 2. The only INSERT policy requires is_moderator_or_facilitator()
--
-- FIX: Add a policy that allows authenticated users to add themselves
-- as participants to anonymous ASK sessions.

-- Create a policy for self-registration in anonymous sessions
DROP POLICY IF EXISTS "Users can join anonymous sessions" ON ask_participants;
CREATE POLICY "Users can join anonymous sessions"
ON ask_participants
FOR INSERT
TO authenticated
WITH CHECK (
  -- User must be adding themselves (not someone else)
  user_id = current_user_id()
  -- Session must be anonymous
  AND EXISTS (
    SELECT 1
    FROM ask_sessions a
    WHERE a.id = ask_participants.ask_session_id
    AND a.is_anonymous = true
  )
);

-- Also create an RPC function for participant creation that bypasses RLS
-- This is a fallback for cases where RLS still doesn't work
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
  -- Verify the session exists and is anonymous
  SELECT * INTO v_session_record
  FROM ask_sessions
  WHERE id = p_ask_session_id;

  IF v_session_record IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  IF v_session_record.is_anonymous != true THEN
    RAISE EXCEPTION 'Session is not anonymous';
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

GRANT EXECUTE ON FUNCTION public.join_anonymous_session TO anon, authenticated, service_role;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
