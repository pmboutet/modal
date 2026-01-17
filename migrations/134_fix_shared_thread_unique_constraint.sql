-- Migration 134: Fix shared thread unique constraint
-- BUG-003: PostgreSQL unique indexes don't prevent multiple NULL values
-- This creates a partial unique index to ensure only ONE shared thread per ask_session

BEGIN;

-- FIRST: Clean up any duplicate shared threads that may have been created by race conditions
-- Keep the oldest one (by created_at), delete the rest
-- Must be done BEFORE creating the unique index

-- Step 1: Update messages and insights to point to the thread we're keeping (oldest)
WITH threads_to_keep AS (
  SELECT DISTINCT ON (ask_session_id) id, ask_session_id
  FROM public.conversation_threads
  WHERE user_id IS NULL
  ORDER BY ask_session_id, created_at ASC
),
threads_to_delete AS (
  SELECT ct.id, ct.ask_session_id
  FROM public.conversation_threads ct
  WHERE ct.user_id IS NULL
    AND ct.id NOT IN (SELECT id FROM threads_to_keep)
)
UPDATE public.messages m
SET conversation_thread_id = tk.id
FROM threads_to_delete td
JOIN threads_to_keep tk ON td.ask_session_id = tk.ask_session_id
WHERE m.conversation_thread_id = td.id;

-- Step 2: Same for insights
WITH threads_to_keep AS (
  SELECT DISTINCT ON (ask_session_id) id, ask_session_id
  FROM public.conversation_threads
  WHERE user_id IS NULL
  ORDER BY ask_session_id, created_at ASC
),
threads_to_delete AS (
  SELECT ct.id, ct.ask_session_id
  FROM public.conversation_threads ct
  WHERE ct.user_id IS NULL
    AND ct.id NOT IN (SELECT id FROM threads_to_keep)
)
UPDATE public.insights i
SET conversation_thread_id = tk.id
FROM threads_to_delete td
JOIN threads_to_keep tk ON td.ask_session_id = tk.ask_session_id
WHERE i.conversation_thread_id = td.id;

-- Step 3: Delete duplicate shared threads (keeping the oldest per ask_session)
WITH threads_to_keep AS (
  SELECT DISTINCT ON (ask_session_id) id
  FROM public.conversation_threads
  WHERE user_id IS NULL
  ORDER BY ask_session_id, created_at ASC
)
DELETE FROM public.conversation_threads
WHERE user_id IS NULL
  AND id NOT IN (SELECT id FROM threads_to_keep);

-- Step 4: Now create the partial unique index for shared threads
-- This ensures exactly one shared thread can exist per ask_session
CREATE UNIQUE INDEX IF NOT EXISTS conversation_threads_shared_unique_idx
  ON public.conversation_threads (ask_session_id)
  WHERE user_id IS NULL;

COMMIT;

-- //@UNDO (manual rollback - do not execute automatically)
-- BEGIN;
-- DROP INDEX IF EXISTS public.conversation_threads_shared_unique_idx;
-- COMMIT;
