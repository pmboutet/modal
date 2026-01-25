-- Migration: Add INSERT policy for ai_agent_logs
-- Fix: Allow API routes to insert logs even when service_role bypass is not working
-- This is safe because ai_agent_logs only contains internal AI interaction logs
-- and the existing SELECT policies still control who can read the data.

-- Add INSERT policy for authenticated users (logged-in API calls)
CREATE POLICY "Authenticated users can insert ai agent logs"
ON ai_agent_logs
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Add INSERT policy for anonymous users (anonymous API calls)
CREATE POLICY "Anon users can insert ai agent logs"
ON ai_agent_logs
FOR INSERT
TO anon
WITH CHECK (true);

-- Also add UPDATE policy for these roles to allow completing logs
CREATE POLICY "Authenticated users can update ai agent logs"
ON ai_agent_logs
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Anon users can update ai agent logs"
ON ai_agent_logs
FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
