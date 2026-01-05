-- Migration: Create project_syntheses table for storing generated narrative syntheses
-- This table stores Markdown syntheses generated for projects and challenges

CREATE TABLE public.project_syntheses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  challenge_id UUID REFERENCES challenges(id) ON DELETE CASCADE,

  -- Content
  markdown_content TEXT NOT NULL,

  -- Structured metadata for UI
  metadata JSONB NOT NULL DEFAULT '{}',
  -- Structure: {
  --   stats: { totalClaims, totalInsights, totalParticipants, communitiesDetected, consensusRate, tensionRate },
  --   sections: { problemSpace, findings, solutions, tensions, risks },
  --   thematicGroups: [{ id, name, claimCount }]
  -- }

  -- Versioning
  version INTEGER NOT NULL DEFAULT 1,

  -- Timestamps
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for fast retrieval
CREATE INDEX idx_project_syntheses_project ON project_syntheses(project_id);
CREATE INDEX idx_project_syntheses_challenge ON project_syntheses(challenge_id) WHERE challenge_id IS NOT NULL;

-- Only one synthesis per scope (project-level or challenge-level)
-- Using COALESCE to handle NULL challenge_id for project-wide syntheses
CREATE UNIQUE INDEX idx_project_syntheses_unique_scope
ON project_syntheses(project_id, COALESCE(challenge_id, '00000000-0000-0000-0000-000000000000'));

-- RLS
ALTER TABLE project_syntheses ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Service role full access" ON project_syntheses
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users can view syntheses for projects they are members of
CREATE POLICY "Project members can view syntheses" ON project_syntheses
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = project_syntheses.project_id
    AND pm.user_id = auth.uid()
  ));

-- Grant permissions
GRANT ALL ON project_syntheses TO service_role;
GRANT SELECT ON project_syntheses TO authenticated;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
