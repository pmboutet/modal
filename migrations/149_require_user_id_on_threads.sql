-- Migration: Enforce NOT NULL on conversation_threads.user_id
-- Reason: No anonymous threads allowed - every thread must have an owner
-- Date: 2026-01-25

-- Add NOT NULL constraint to user_id column
-- This will fail if there are any NULL values (we already cleaned them up)
ALTER TABLE conversation_threads
ALTER COLUMN user_id SET NOT NULL;

-- Add a comment to document the constraint
COMMENT ON COLUMN conversation_threads.user_id IS 'Required: Profile ID of the thread owner. Anonymous threads are not allowed.';

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
