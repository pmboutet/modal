-- Migration 135: Add timer_reset_at column to ask_participants
-- This column tracks when the timer was last reset (e.g., after a purge operation)
-- The client-side timer will use this to detect resets and clear localStorage accordingly

-- Add the column
ALTER TABLE public.ask_participants
ADD COLUMN IF NOT EXISTS timer_reset_at timestamptz DEFAULT NULL;

-- Add a comment explaining the column's purpose
COMMENT ON COLUMN public.ask_participants.timer_reset_at IS
'Timestamp of last timer reset (e.g., via purge operation). Client uses this to detect resets and clear localStorage cache.';

-- Grant service_role access to the new column
GRANT SELECT, UPDATE ON public.ask_participants TO service_role;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
