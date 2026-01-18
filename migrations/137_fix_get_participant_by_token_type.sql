-- Migration: Fix get_participant_by_token return type mismatch
-- Problem: participant_email is varchar but function returns text
-- Solution: Cast varchar columns to text explicitly

CREATE OR REPLACE FUNCTION public.get_participant_by_token(p_token text)
RETURNS TABLE (
  participant_id uuid,
  user_id uuid,
  participant_email text,
  participant_name text,
  invite_token text,
  role text,
  is_spokesperson boolean,
  elapsed_active_seconds integer,
  timer_reset_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ap.id as participant_id,
    ap.user_id,
    ap.participant_email::text,  -- Cast varchar to text
    ap.participant_name::text,   -- Cast varchar to text
    ap.invite_token::text,       -- Cast varchar to text
    ap.role::text,               -- Cast varchar to text
    ap.is_spokesperson,
    ap.elapsed_active_seconds,
    ap.timer_reset_at
  FROM ask_participants ap
  WHERE ap.invite_token = p_token;
END;
$$;

-- Force PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
