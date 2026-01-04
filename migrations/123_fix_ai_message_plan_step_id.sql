-- Migration 123: Fix AI messages not getting plan_step_id
-- This fixes a bug where AI messages were inserted without plan_step_id,
-- causing step_messages_json to only contain user messages.
-- The result was that the AI couldn't see its own previous questions
-- and would ask the same questions repeatedly.

-- Update the insert_ai_message RPC function to accept plan_step_id
CREATE OR REPLACE FUNCTION public.insert_ai_message(
  p_ask_session_id uuid,
  p_conversation_thread_id uuid,
  p_content text,
  p_sender_name text DEFAULT 'Agent',
  p_plan_step_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message_record messages;
BEGIN
  INSERT INTO messages (
    ask_session_id,
    conversation_thread_id,
    content,
    sender_type,
    message_type,
    metadata,
    plan_step_id
  ) VALUES (
    p_ask_session_id,
    p_conversation_thread_id,
    p_content,
    'ai',
    'text',
    jsonb_build_object('senderName', p_sender_name),
    p_plan_step_id
  )
  RETURNING * INTO v_message_record;

  RETURN row_to_json(v_message_record)::jsonb;
END;
$$;

-- Force PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
