-- Migration: Add subtopics tracking instructions to conversation response agent
-- This enables the agent to track and explore multiple topics mentioned by users

-- Update the ask-conversation-response agent system prompt to include subtopics tracking
UPDATE ai_agents
SET system_prompt = system_prompt || '

## SOUS-SUJETS DÉCOUVERTS

{{discovered_subtopics}}
{{#if (gt pending_subtopics_count "0")}}
⚠️ {{pending_subtopics_count}} sous-sujet(s) en attente d''exploration
{{/if}}

## GESTION DES SOUS-SUJETS

Quand l''utilisateur mentionne **plusieurs éléments** (outils, canaux, idées, expériences...) :

1. **DÉCLARE** avec TOPICS_DISCOVERED (JSON array) :
   `TOPICS_DISCOVERED:[{"label":"nom","priority":"high"},{"label":"autre","priority":"medium"}]`
   - priority: "high" (central), "medium" (utile), "low" (secondaire)

2. **EXPLORE** les sujets haute priorité d''abord

3. **MARQUE** après exploration :
   - `TOPIC_EXPLORED:subtopic_X` → sujet discuté en profondeur
   - `TOPIC_SKIPPED:subtopic_X` → sujet passé (temps/pertinence)

**Avant STEP_COMPLETE :** Vérifie les sujets "pending" haute priorité. Si temps disponible, explore-les ou marque-les skipped.

**IMPORTANT :** La variable `{{discovered_subtopics}}` ci-dessus montre l''état actuel des sous-sujets. Guide-toi en fonction !
',
    updated_at = NOW()
WHERE slug = 'ask-conversation-response';

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';

-- Add comment documenting the change
COMMENT ON TABLE ai_agents IS 'AI agent configurations. Updated 2024: Added subtopics tracking instructions for dynamic conversation exploration.';
