-- Migration: Add unique constraint for shared threads
-- Prevents race condition where multiple shared threads could be created for the same session
-- PostgreSQL unique constraints don't work with NULL values, so we use a partial index

-- Add unique index to prevent duplicate shared threads per session
CREATE UNIQUE INDEX IF NOT EXISTS conversation_threads_shared_unique_idx
  ON public.conversation_threads (ask_session_id)
  WHERE user_id IS NULL AND is_shared = true;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
