-- Migration 147: Add discovered_subtopics column to ask_conversation_plan_steps
-- This enables dynamic sub-topic tracking during conversations
--
-- Structure of discovered_subtopics JSONB:
-- [
--   {
--     "id": "subtopic_1",
--     "label": "Canal print",
--     "status": "pending" | "explored" | "skipped",
--     "discovered_at": "2024-01-20T14:07:00Z",
--     "explored_at": null,
--     "relevant_for_steps": ["step_3", "step_4"],
--     "priority": "high" | "medium" | "low"
--   }
-- ]

ALTER TABLE ask_conversation_plan_steps
ADD COLUMN IF NOT EXISTS discovered_subtopics JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN ask_conversation_plan_steps.discovered_subtopics IS
'Dynamic subtopics discovered during conversation, tracked per step. Each subtopic has id, label, status (pending/explored/skipped), priority, and optional relevant_for_steps array.';

-- Create index for efficient querying of subtopics by status
CREATE INDEX IF NOT EXISTS idx_plan_steps_subtopics_status
ON ask_conversation_plan_steps
USING gin (discovered_subtopics jsonb_path_ops);

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
