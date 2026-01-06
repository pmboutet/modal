-- Migration 131: Security Fixes - Enable RLS and Fix Function Search Paths
--
-- This migration addresses Supabase Database Linter security anomalies:
-- 1. Tables with RLS policies but RLS disabled
-- 2. Tables without RLS
-- 3. Functions missing SET search_path = public
--
-- Token-based authentication continues to work because SECURITY DEFINER
-- functions bypass RLS and validate tokens internally before returning data.

BEGIN;

-- ============================================================================
-- SECTION 1: ENABLE RLS ON ALL AFFECTED TABLES
-- ============================================================================

-- Tables that had RLS disabled (migrations 028, 094, 096, 117)
ALTER TABLE public.ai_agent_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_insight_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ask_conversation_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ask_conversation_plan_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insight_syntheses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insight_keywords ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- SECTION 2: ADD SERVICE_ROLE POLICIES (DROP IF EXISTS FIRST TO AVOID DUPLICATES)
-- ============================================================================

-- ai_agent_logs
DROP POLICY IF EXISTS "Service role has full access to ai agent logs" ON public.ai_agent_logs;
DROP POLICY IF EXISTS "Service role full access" ON public.ai_agent_logs;
CREATE POLICY "Service role full access" ON public.ai_agent_logs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ai_insight_jobs
DROP POLICY IF EXISTS "Service role has full access to ai insight jobs" ON public.ai_insight_jobs;
DROP POLICY IF EXISTS "Service role full access" ON public.ai_insight_jobs;
CREATE POLICY "Service role full access" ON public.ai_insight_jobs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ask_conversation_plans
DROP POLICY IF EXISTS "Service role has full access to conversation plans" ON public.ask_conversation_plans;
DROP POLICY IF EXISTS "Service role full access" ON public.ask_conversation_plans;
CREATE POLICY "Service role full access" ON public.ask_conversation_plans
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ask_conversation_plan_steps
DROP POLICY IF EXISTS "Service role has full access to plan steps" ON public.ask_conversation_plan_steps;
DROP POLICY IF EXISTS "Service role full access" ON public.ask_conversation_plan_steps;
CREATE POLICY "Service role full access" ON public.ask_conversation_plan_steps
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- conversation_threads
DROP POLICY IF EXISTS "Service role full access" ON public.conversation_threads;
CREATE POLICY "Service role full access" ON public.conversation_threads
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- knowledge_entities
DROP POLICY IF EXISTS "Service role full access" ON public.knowledge_entities;
CREATE POLICY "Service role full access" ON public.knowledge_entities
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- knowledge_graph_edges
DROP POLICY IF EXISTS "Service role full access" ON public.knowledge_graph_edges;
CREATE POLICY "Service role full access" ON public.knowledge_graph_edges
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- insight_syntheses
DROP POLICY IF EXISTS "Service role full access" ON public.insight_syntheses;
CREATE POLICY "Service role full access" ON public.insight_syntheses
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- insight_keywords
DROP POLICY IF EXISTS "Service role full access" ON public.insight_keywords;
CREATE POLICY "Service role full access" ON public.insight_keywords
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================================
-- SECTION 3: FIX HELPER FUNCTIONS FROM MIGRATION 014
-- ============================================================================

-- is_full_admin
CREATE OR REPLACE FUNCTION public.is_full_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE auth_id = auth.uid()
    AND role IN ('admin', 'full_admin')
    AND is_active = true
  );
END;
$$;

-- is_moderator_or_facilitator
CREATE OR REPLACE FUNCTION public.is_moderator_or_facilitator()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE auth_id = auth.uid()
    AND role IN ('moderator', 'facilitator')
    AND is_active = true
  );
END;
$$;

-- current_user_id
CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT id
    FROM public.profiles
    WHERE auth_id = auth.uid()
  );
END;
$$;

-- has_project_access
CREATE OR REPLACE FUNCTION public.has_project_access(project_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.project_members
    WHERE project_id = project_uuid
    AND user_id = public.current_user_id()
  );
END;
$$;

-- has_client_access
CREATE OR REPLACE FUNCTION public.has_client_access(client_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if user is member of any project belonging to this client
  RETURN EXISTS (
    SELECT 1
    FROM public.projects p
    INNER JOIN public.project_members pm ON pm.project_id = p.id
    WHERE p.client_id = client_uuid
    AND pm.user_id = public.current_user_id()
  );
END;
$$;

-- ============================================================================
-- SECTION 4: FIX is_ask_participant FROM MIGRATION 021
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_ask_participant(ask_session_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  session_is_anonymous BOOLEAN;
BEGIN
  -- Check if the session allows anonymous participation
  SELECT is_anonymous INTO session_is_anonymous
  FROM public.ask_sessions
  WHERE id = ask_session_uuid;

  -- If session allows anonymous participation, any logged-in user can participate
  IF session_is_anonymous = true AND public.current_user_id() IS NOT NULL THEN
    RETURN true;
  END IF;

  -- Otherwise, check if user is explicitly a participant
  RETURN EXISTS (
    SELECT 1
    FROM public.ask_participants
    WHERE ask_session_id = ask_session_uuid
    AND user_id = public.current_user_id()
  );
END;
$$;

-- ============================================================================
-- SECTION 5: FIX check_* FUNCTIONS FROM MIGRATION 018
-- ============================================================================

-- check_user_authored_insight
CREATE OR REPLACE FUNCTION public.check_user_authored_insight(insight_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.insight_authors
    WHERE insight_id = insight_uuid
    AND user_id = public.current_user_id()
  );
END;
$$;

-- check_insight_session_access
CREATE OR REPLACE FUNCTION public.check_insight_session_access(insight_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  session_id UUID;
BEGIN
  -- Get the ask_session_id for this insight without triggering RLS
  SELECT ask_session_id INTO session_id
  FROM public.insights
  WHERE id = insight_uuid;

  -- If no session found, deny access
  IF session_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Check if user is participant in this session
  RETURN public.is_ask_participant(session_id);
END;
$$;

-- ============================================================================
-- SECTION 6: FIX VECTOR SEARCH FUNCTIONS FROM MIGRATION 025
-- ============================================================================

-- find_similar_insights
CREATE OR REPLACE FUNCTION public.find_similar_insights(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.75,
  match_count int DEFAULT 10,
  exclude_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  similarity float
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.id,
    1 - (i.content_embedding <=> query_embedding) as similarity
  FROM insights i
  WHERE i.content_embedding IS NOT NULL
    AND (exclude_id IS NULL OR i.id != exclude_id)
    AND (1 - (i.content_embedding <=> query_embedding)) >= match_threshold
  ORDER BY i.content_embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- insights_similarity_score
CREATE OR REPLACE FUNCTION public.insights_similarity_score(
  embedding1 vector(1024),
  embedding2 vector(1024)
)
RETURNS float
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT 1 - (embedding1 <=> embedding2);
$$;

-- find_similar_entities
CREATE OR REPLACE FUNCTION public.find_similar_entities(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.75,
  match_count int DEFAULT 10,
  entity_type varchar DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  name varchar,
  type varchar,
  similarity float
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ke.id,
    ke.name,
    ke.type,
    1 - (ke.embedding <=> query_embedding) as similarity
  FROM knowledge_entities ke
  WHERE ke.embedding IS NOT NULL
    AND (entity_type IS NULL OR ke.type = entity_type)
    AND (1 - (ke.embedding <=> query_embedding)) >= match_threshold
  ORDER BY ke.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- find_similar_syntheses
CREATE OR REPLACE FUNCTION public.find_similar_syntheses(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.75,
  match_count int DEFAULT 10,
  project_id_filter uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  project_id uuid,
  synthesized_text text,
  similarity float
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    isyn.id,
    isyn.project_id,
    isyn.synthesized_text,
    1 - (isyn.embedding <=> query_embedding) as similarity
  FROM insight_syntheses isyn
  WHERE isyn.embedding IS NOT NULL
    AND (project_id_filter IS NULL OR isyn.project_id = project_id_filter)
    AND (1 - (isyn.embedding <=> query_embedding)) >= match_threshold
  ORDER BY isyn.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ============================================================================
-- SECTION 7: FIX TOKEN ACCESS FUNCTIONS FROM MIGRATION 033
-- ============================================================================

-- get_ask_session_by_token
CREATE OR REPLACE FUNCTION public.get_ask_session_by_token(
  p_token VARCHAR(255)
)
RETURNS TABLE (
  ask_session_id UUID,
  ask_key VARCHAR(255),
  name TEXT,
  question TEXT,
  description TEXT,
  status VARCHAR(50),
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  is_anonymous BOOLEAN,
  max_participants INTEGER,
  delivery_mode VARCHAR(50),
  audience_scope VARCHAR(50),
  response_mode VARCHAR(50),
  project_id UUID,
  challenge_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_participant_id UUID;
  v_ask_session_id UUID;
BEGIN
  -- First, verify token exists and get participant
  SELECT id, ap.ask_session_id INTO v_participant_id, v_ask_session_id
  FROM public.ask_participants ap
  WHERE invite_token = p_token
  LIMIT 1;

  -- If token not found, return empty result
  IF v_participant_id IS NULL THEN
    RETURN;
  END IF;

  -- Return ASK session data (bypasses RLS due to SECURITY DEFINER)
  RETURN QUERY
  SELECT
    a.id,
    a.ask_key,
    a.name,
    a.question,
    a.description,
    a.status,
    a.start_date,
    a.end_date,
    a.is_anonymous,
    a.max_participants,
    a.delivery_mode,
    a.audience_scope,
    a.response_mode,
    a.project_id,
    a.challenge_id,
    a.created_by,
    a.created_at,
    a.updated_at
  FROM public.ask_sessions a
  WHERE a.id = v_ask_session_id;
END;
$$;

-- get_ask_participants_by_token
CREATE OR REPLACE FUNCTION public.get_ask_participants_by_token(
  p_token VARCHAR(255)
)
RETURNS TABLE (
  participant_id UUID,
  user_id UUID,
  participant_name TEXT,
  participant_email TEXT,
  role TEXT,
  is_spokesperson BOOLEAN,
  joined_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ask_session_id UUID;
BEGIN
  -- Get ASK session ID from token
  SELECT ap.ask_session_id INTO v_ask_session_id
  FROM public.ask_participants ap
  WHERE invite_token = p_token
  LIMIT 1;

  -- If token not found, return empty
  IF v_ask_session_id IS NULL THEN
    RETURN;
  END IF;

  -- Return participants (bypasses RLS but only for verified session)
  RETURN QUERY
  SELECT
    ap.id,
    ap.user_id,
    ap.participant_name,
    ap.participant_email,
    ap.role,
    ap.is_spokesperson,
    ap.joined_at
  FROM public.ask_participants ap
  WHERE ap.ask_session_id = v_ask_session_id
  ORDER BY ap.joined_at ASC;
END;
$$;

-- get_ask_messages_by_token
CREATE OR REPLACE FUNCTION public.get_ask_messages_by_token(
  p_token VARCHAR(255)
)
RETURNS TABLE (
  message_id UUID,
  content TEXT,
  type VARCHAR(50),
  sender_type VARCHAR(50),
  sender_id UUID,
  sender_name TEXT,
  created_at TIMESTAMPTZ,
  metadata JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ask_session_id UUID;
BEGIN
  -- Get ASK session ID from token
  SELECT ap.ask_session_id INTO v_ask_session_id
  FROM public.ask_participants ap
  WHERE invite_token = p_token
  LIMIT 1;

  IF v_ask_session_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.content,
    m.type,
    m.sender_type,
    m.sender_id,
    m.sender_name,
    m.created_at,
    m.metadata
  FROM public.messages m
  WHERE m.ask_session_id = v_ask_session_id
  ORDER BY m.created_at ASC;
END;
$$;

-- get_ask_insights_by_token
CREATE OR REPLACE FUNCTION public.get_ask_insights_by_token(
  p_token VARCHAR(255)
)
RETURNS TABLE (
  insight_id UUID,
  content TEXT,
  summary TEXT,
  status VARCHAR(50),
  challenge_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  insight_type_name VARCHAR(255)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ask_session_id UUID;
BEGIN
  -- Get ASK session ID from token
  SELECT ap.ask_session_id INTO v_ask_session_id
  FROM public.ask_participants ap
  WHERE invite_token = p_token
  LIMIT 1;

  IF v_ask_session_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    i.id,
    i.content,
    i.summary,
    i.status,
    i.challenge_id,
    i.created_at,
    i.updated_at,
    it.name
  FROM public.insights i
  LEFT JOIN public.insight_types it ON it.id = i.insight_type_id
  WHERE i.ask_session_id = v_ask_session_id
  ORDER BY i.created_at DESC;
END;
$$;

-- get_ask_context_by_token
CREATE OR REPLACE FUNCTION public.get_ask_context_by_token(
  p_token VARCHAR(255)
)
RETURNS TABLE (
  project_id UUID,
  project_name TEXT,
  challenge_id UUID,
  challenge_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ask_session_id UUID;
  v_project_id UUID;
  v_challenge_id UUID;
BEGIN
  -- Get ASK session ID from token
  SELECT ap.ask_session_id INTO v_ask_session_id
  FROM public.ask_participants ap
  WHERE invite_token = p_token
  LIMIT 1;

  IF v_ask_session_id IS NULL THEN
    RETURN;
  END IF;

  -- Get project and challenge IDs
  SELECT a.project_id, a.challenge_id INTO v_project_id, v_challenge_id
  FROM public.ask_sessions a
  WHERE a.id = v_ask_session_id;

  -- Return project and challenge info
  RETURN QUERY
  SELECT
    p.id,
    p.name,
    c.id,
    c.name
  FROM public.projects p
  LEFT JOIN public.challenges c ON c.id = v_challenge_id
  WHERE p.id = v_project_id;
END;
$$;

-- ============================================================================
-- SECTION 8: FIX SECURITY MONITORING FUNCTIONS FROM MIGRATION 042
-- ============================================================================

-- detect_malicious_content
CREATE OR REPLACE FUNCTION public.detect_malicious_content(content TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  detections JSONB := '[]'::JSONB;
  detection JSONB;
  content_lower TEXT;
  content_length INTEGER;
  max_length INTEGER := 10000;
BEGIN
  content_lower := LOWER(content);
  content_length := LENGTH(content);

  -- Check for excessive length
  IF content_length > max_length THEN
    detection := jsonb_build_object(
      'type', 'length',
      'severity', 'medium',
      'pattern', format('Message length: %s characters (max: %s)', content_length, max_length),
      'details', jsonb_build_object('length', content_length, 'max_length', max_length)
    );
    detections := detections || jsonb_build_array(detection);
  END IF;

  -- SQL Injection patterns
  IF content_lower ~* '(union\s+select|drop\s+table|delete\s+from|insert\s+into|update\s+set|exec\s*\(|execute\s*\(|''\s*or\s*''1''\s*=\s*''1|''\s*or\s*1\s*=\s*1|''\s*or\s*''a''\s*=\s*''a)' THEN
    detection := jsonb_build_object(
      'type', 'injection',
      'severity', 'critical',
      'pattern', 'SQL injection pattern detected',
      'details', jsonb_build_object('matched', 'SQL injection keywords')
    );
    detections := detections || jsonb_build_array(detection);
  END IF;

  -- XSS patterns
  IF content_lower ~* '(<script|javascript:|onerror\s*=|onclick\s*=|onload\s*=|eval\s*\(|alert\s*\()' THEN
    detection := jsonb_build_object(
      'type', 'xss',
      'severity', 'high',
      'pattern', 'XSS pattern detected',
      'details', jsonb_build_object('matched', 'XSS keywords')
    );
    detections := detections || jsonb_build_array(detection);
  END IF;

  -- Spam patterns: excessive repetition
  IF content_length > 100 THEN
    -- Check for repeated character sequences (more than 10 times)
    IF content_lower ~* '(.)\1{20,}' THEN
      detection := jsonb_build_object(
        'type', 'spam',
        'severity', 'low',
        'pattern', 'Excessive character repetition',
        'details', jsonb_build_object('matched', 'Repeated characters')
      );
      detections := detections || jsonb_build_array(detection);
    END IF;

    -- Check for suspicious URLs (basic pattern)
    IF content_lower ~* '(http[s]?://[^\s]+|www\.[^\s]+|bit\.ly|tinyurl|t\.co)' THEN
      -- Count URLs
      DECLARE
        url_count INTEGER;
      BEGIN
        SELECT COUNT(*) INTO url_count
        FROM regexp_split_to_table(content_lower, '\s+') AS word
        WHERE word ~* '(http[s]?://|www\.|bit\.ly|tinyurl|t\.co)';

        IF url_count > 3 THEN
          detection := jsonb_build_object(
            'type', 'spam',
            'severity', 'medium',
            'pattern', format('Multiple suspicious URLs detected: %s', url_count),
            'details', jsonb_build_object('url_count', url_count)
          );
          detections := detections || jsonb_build_array(detection);
        END IF;
      END;
    END IF;
  END IF;

  -- Command injection patterns
  IF content_lower ~* '(;|\||&|`|\$\(|<\s*\(|>\s*\(|cat\s+/etc/passwd|rm\s+-rf|wget\s+|curl\s+)' THEN
    detection := jsonb_build_object(
      'type', 'injection',
      'severity', 'high',
      'pattern', 'Command injection pattern detected',
      'details', jsonb_build_object('matched', 'Command injection keywords')
    );
    detections := detections || jsonb_build_array(detection);
  END IF;

  RETURN detections;
END;
$$;

-- trigger_security_monitoring
CREATE OR REPLACE FUNCTION public.trigger_security_monitoring()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only monitor user messages
  IF NEW.sender_type = 'user' THEN
    INSERT INTO public.security_monitoring_queue (message_id, status)
    VALUES (NEW.id, 'pending')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- SECTION 9: FIX PLAN STEP FUNCTIONS FROM MIGRATION 058
-- ============================================================================

-- get_current_plan_step
CREATE OR REPLACE FUNCTION public.get_current_plan_step(p_plan_id UUID)
RETURNS TABLE (
  id UUID,
  step_identifier VARCHAR(100),
  step_order INTEGER,
  title TEXT,
  objective TEXT,
  status VARCHAR(20)
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.step_identifier,
    s.step_order,
    s.title,
    s.objective,
    s.status
  FROM public.ask_conversation_plan_steps s
  WHERE s.plan_id = p_plan_id
    AND s.status = 'active'
  ORDER BY s.step_order
  LIMIT 1;
END;
$$;

-- get_step_messages
CREATE OR REPLACE FUNCTION public.get_step_messages(p_step_id UUID)
RETURNS TABLE (
  id UUID,
  sender_type VARCHAR(50),
  content TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.sender_type,
    m.content,
    m.created_at
  FROM public.messages m
  WHERE m.plan_step_id = p_step_id
  ORDER BY m.created_at ASC;
END;
$$;

-- update_plan_progress
CREATE OR REPLACE FUNCTION public.update_plan_progress()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Update completed_steps counter
  UPDATE public.ask_conversation_plans
  SET
    completed_steps = (
      SELECT COUNT(*)
      FROM public.ask_conversation_plan_steps
      WHERE plan_id = NEW.plan_id AND status = 'completed'
    ),
    status = CASE
      WHEN (
        SELECT COUNT(*)
        FROM public.ask_conversation_plan_steps
        WHERE plan_id = NEW.plan_id AND status = 'completed'
      ) >= total_steps THEN 'completed'
      ELSE 'active'
    END,
    updated_at = NOW()
  WHERE id = NEW.plan_id;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- SECTION 10: FIX REMAINING TRIGGER FUNCTIONS
-- ============================================================================

-- generate_invite_token (from migration 032)
CREATE OR REPLACE FUNCTION public.generate_invite_token()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.invite_token IS NULL THEN
    NEW.invite_token := encode(gen_random_bytes(16), 'hex');
  END IF;
  RETURN NEW;
END;
$$;

-- update_updated_at_column (from migration 010)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- update_client_members_updated_at (from migration 020)
CREATE OR REPLACE FUNCTION public.update_client_members_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- update_claims_updated_at (from migration 111)
CREATE OR REPLACE FUNCTION public.update_claims_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================================
-- SECTION 11: NOTIFY POSTGREST TO RELOAD SCHEMA
-- ============================================================================

NOTIFY pgrst, 'reload schema';

COMMIT;

-- //@UNDO
BEGIN;

-- Disable RLS on tables that were enabled
ALTER TABLE public.ai_agent_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_insight_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ask_conversation_plans DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ask_conversation_plan_steps DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_threads DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_entities DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_graph_edges DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.insight_syntheses DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.insight_keywords DISABLE ROW LEVEL SECURITY;

-- Drop the service role policies we added
DROP POLICY IF EXISTS "Service role full access" ON public.ai_agent_logs;
DROP POLICY IF EXISTS "Service role full access" ON public.ai_insight_jobs;
DROP POLICY IF EXISTS "Service role full access" ON public.ask_conversation_plans;
DROP POLICY IF EXISTS "Service role full access" ON public.ask_conversation_plan_steps;
DROP POLICY IF EXISTS "Service role full access" ON public.conversation_threads;
DROP POLICY IF EXISTS "Service role full access" ON public.knowledge_entities;
DROP POLICY IF EXISTS "Service role full access" ON public.knowledge_graph_edges;
DROP POLICY IF EXISTS "Service role full access" ON public.insight_syntheses;
DROP POLICY IF EXISTS "Service role full access" ON public.insight_keywords;

-- Note: Functions will retain SET search_path after rollback
-- This is safe as it only enhances security

NOTIFY pgrst, 'reload schema';

COMMIT;
