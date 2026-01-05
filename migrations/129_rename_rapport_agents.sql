-- Migration: Rename agents to use the 'rapport-' prefix for the Rapport & Synthesis category
-- This groups claim comparison and extraction agents under the new category

-- Rename claim-comparison to rapport-claim-comparison
UPDATE public.ai_agents
SET slug = 'rapport-claim-comparison',
    updated_at = now()
WHERE slug = 'claim-comparison';

-- Rename insight-claim-extraction to rapport-claim-extraction
UPDATE public.ai_agents
SET slug = 'rapport-claim-extraction',
    updated_at = now()
WHERE slug = 'insight-claim-extraction';

-- Rename participant-claims-extraction to rapport-participant-claims
UPDATE public.ai_agents
SET slug = 'rapport-participant-claims',
    updated_at = now()
WHERE slug = 'participant-claims-extraction';

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
