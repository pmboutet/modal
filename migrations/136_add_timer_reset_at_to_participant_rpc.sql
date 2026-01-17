-- Migration 136: Add timer_reset_at to get_participant_by_token RPC
-- This allows the timer route to detect when timer was reset (e.g., after purge)

BEGIN;

-- Drop the existing function first (required when changing return type)
DROP FUNCTION IF EXISTS public.get_participant_by_token(text);

-- Recreate the function with the new field
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
    ap.participant_email,
    ap.participant_name,
    ap.invite_token,
    ap.role,
    ap.is_spokesperson,
    ap.elapsed_active_seconds,
    ap.timer_reset_at
  FROM ask_participants ap
  WHERE ap.invite_token = p_token;
END;
$$;

-- Grant execute permission to authenticated and anon users
GRANT EXECUTE ON FUNCTION public.get_participant_by_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_participant_by_token(text) TO anon;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';

COMMIT;
