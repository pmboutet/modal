-- Migration: Remove legacy insight-entity-extraction agent
-- This agent has been replaced by insight-claim-extraction as part of the Graph RAG refactor.
-- Claims now include key_entities, making separate entity extraction redundant.

DELETE FROM public.ai_agents
WHERE slug = 'insight-entity-extraction';

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
