-- Migration: Rename agents to use the 'rapport-' prefix for the Rapport & Synthesis category
-- This groups claim comparison and extraction agents under the new category
-- Made idempotent: handles cases where target already exists

-- Handle claim-comparison -> rapport-claim-comparison
DO $$
BEGIN
  -- If target exists and source exists, delete source (target is correct)
  IF EXISTS (SELECT 1 FROM ai_agents WHERE slug = 'rapport-claim-comparison')
     AND EXISTS (SELECT 1 FROM ai_agents WHERE slug = 'claim-comparison') THEN
    DELETE FROM ai_agents WHERE slug = 'claim-comparison';
  -- If only source exists, rename it
  ELSIF EXISTS (SELECT 1 FROM ai_agents WHERE slug = 'claim-comparison') THEN
    UPDATE ai_agents SET slug = 'rapport-claim-comparison', updated_at = now()
    WHERE slug = 'claim-comparison';
  END IF;
END $$;

-- Handle insight-claim-extraction -> rapport-claim-extraction
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ai_agents WHERE slug = 'rapport-claim-extraction')
     AND EXISTS (SELECT 1 FROM ai_agents WHERE slug = 'insight-claim-extraction') THEN
    DELETE FROM ai_agents WHERE slug = 'insight-claim-extraction';
  ELSIF EXISTS (SELECT 1 FROM ai_agents WHERE slug = 'insight-claim-extraction') THEN
    UPDATE ai_agents SET slug = 'rapport-claim-extraction', updated_at = now()
    WHERE slug = 'insight-claim-extraction';
  END IF;
END $$;

-- Handle participant-claims-extraction -> rapport-participant-claims
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ai_agents WHERE slug = 'rapport-participant-claims')
     AND EXISTS (SELECT 1 FROM ai_agents WHERE slug = 'participant-claims-extraction') THEN
    DELETE FROM ai_agents WHERE slug = 'participant-claims-extraction';
  ELSIF EXISTS (SELECT 1 FROM ai_agents WHERE slug = 'participant-claims-extraction') THEN
    UPDATE ai_agents SET slug = 'rapport-participant-claims', updated_at = now()
    WHERE slug = 'participant-claims-extraction';
  END IF;
END $$;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
