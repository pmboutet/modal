-- Migration 132: Security fixes - claims RLS and monitoring queue policy
--
-- Fixes:
-- 1. claims and claim_entities tables had RLS policies but RLS was not enabled
-- 2. security_monitoring_queue policy was assigned to public instead of service_role

BEGIN;

-- Enable RLS on claims tables
ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_entities ENABLE ROW LEVEL SECURITY;

-- Fix security_monitoring_queue policy (was assigned to public role instead of service_role)
DROP POLICY IF EXISTS "Service role can manage monitoring queue" ON public.security_monitoring_queue;
CREATE POLICY "Service role full access" ON public.security_monitoring_queue
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

COMMIT;

-- //@UNDO
BEGIN;

ALTER TABLE public.claims DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_entities DISABLE ROW LEVEL SECURITY;

-- Restore original policy
DROP POLICY IF EXISTS "Service role full access" ON public.security_monitoring_queue;
CREATE POLICY "Service role can manage monitoring queue" ON public.security_monitoring_queue
  FOR ALL
  USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

COMMIT;
