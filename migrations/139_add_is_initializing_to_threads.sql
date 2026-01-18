-- Migration: Add is_initializing flag to conversation_threads
-- Purpose: Prevent race conditions when multiple requests try to initialize the same thread concurrently

-- Add the column with default false
ALTER TABLE conversation_threads
ADD COLUMN IF NOT EXISTS is_initializing BOOLEAN NOT NULL DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN conversation_threads.is_initializing IS 'Flag to prevent concurrent initialization of plan and initial message. Set to true when init starts, false when complete.';

-- Create index for efficient lookup
CREATE INDEX IF NOT EXISTS idx_conversation_threads_is_initializing
ON conversation_threads (is_initializing)
WHERE is_initializing = true;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
