-- Migration 080: Add consultant conversation mode
-- New mode for AI-assisted consultant sessions:
-- - AI listens to conversation via STT with diarization
-- - AI suggests questions to consultant (no TTS)
-- - AI can trigger STEP_COMPLETE automatically
-- - Shared thread for consultant (consultant shares thread with participants)

BEGIN;

-- Drop existing constraint
ALTER TABLE public.ask_sessions
  DROP CONSTRAINT IF EXISTS check_conversation_mode;

-- Add new constraint including 'consultant' mode
ALTER TABLE public.ask_sessions
  ADD CONSTRAINT check_conversation_mode
  CHECK (conversation_mode IN ('individual_parallel', 'collaborative', 'group_reporter', 'consultant'));

-- Update comment to document the new mode
COMMENT ON COLUMN public.ask_sessions.conversation_mode IS
  'Mode de conversation: individual_parallel (réponses individuelles en parallèle), collaborative (conversation multi-voix), group_reporter (groupe avec rapporteur), consultant (IA écoute et suggère des questions)';

COMMIT;

-- //@UNDO
BEGIN;

-- Drop constraint with consultant
ALTER TABLE public.ask_sessions
  DROP CONSTRAINT IF EXISTS check_conversation_mode;

-- Restore original constraint without consultant
ALTER TABLE public.ask_sessions
  ADD CONSTRAINT check_conversation_mode
  CHECK (conversation_mode IN ('individual_parallel', 'collaborative', 'group_reporter'));

-- Restore original comment
COMMENT ON COLUMN public.ask_sessions.conversation_mode IS
  'Mode de conversation: individual_parallel (réponses individuelles en parallèle), collaborative (conversation multi-voix), group_reporter (groupe avec rapporteur)';

COMMIT;
