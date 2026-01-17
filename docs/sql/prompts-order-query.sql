-- Requête SQL pour récupérer les prompts (system_prompt et user_prompt) 
-- dans l'ordre logique d'exécution basé sur les slugs
--
-- Ordre d'exécution logique du Challenge Builder V2:
-- 1. challenge-revision-planner (Phase 1: Planning)
-- 2. challenge-detailed-updater (Phase 2: Execution - Updates)
-- 3. challenge-detailed-creator (Phase 2: Execution - Creations)
--
-- Ordre d'exécution logique du Workflow ASK:
-- 1. ask-conversation-response (Génération de réponse)
-- 2. ask-insight-detection (Détection d'insights)
-- 
-- Autres agents:
-- 3. ask-generator (Génération de nouvelles sessions ASK)

-- ============================================================================
-- Requête 1: Tous les agents principaux (Challenge Builder V2 + ASK)
-- ============================================================================

SELECT 
  slug,
  name,
  description,
  system_prompt,
  user_prompt,
  available_variables,
  created_at,
  updated_at
FROM public.ai_agents
WHERE slug IN (
  -- Challenge Builder V2
  'challenge-revision-planner',    -- Phase 1: Planning
  'challenge-detailed-updater',    -- Phase 2: Execution - Updates
  'challenge-detailed-creator',    -- Phase 2: Execution - Creations
  -- Workflow ASK
  'ask-conversation-response',     -- Étape 1: Génération de réponse
  'ask-insight-detection',        -- Étape 2: Détection d'insights
  -- Autres agents ASK
  'ask-generator'                  -- Génération de nouvelles sessions ASK
)
ORDER BY 
  CASE slug
    -- Challenge Builder V2 (ordre d'exécution)
    WHEN 'challenge-revision-planner' THEN 1      -- Phase 1: Planning
    WHEN 'challenge-detailed-updater' THEN 2     -- Phase 2: Updates
    WHEN 'challenge-detailed-creator' THEN 3     -- Phase 2: Creations
    -- Workflow ASK (ordre d'exécution)
    WHEN 'ask-conversation-response' THEN 10    -- Étape 1: Conversation
    WHEN 'ask-insight-detection' THEN 11        -- Étape 2: Détection
    -- Autres agents ASK
    WHEN 'ask-generator' THEN 20                -- Génération ASK
    ELSE 99
  END;

-- ============================================================================
-- Requête 2: Uniquement les agents du Workflow ASK (ordre logique)
-- ============================================================================

SELECT 
  slug,
  name,
  description,
  system_prompt,
  user_prompt,
  available_variables,
  created_at,
  updated_at
FROM public.ai_agents
WHERE slug IN (
  'ask-conversation-response',     -- Étape 1: Génération de réponse
  'ask-insight-detection'          -- Étape 2: Détection d'insights
)
ORDER BY 
  CASE slug
    WHEN 'ask-conversation-response' THEN 1      -- Étape 1: Conversation
    WHEN 'ask-insight-detection' THEN 2         -- Étape 2: Détection
    ELSE 99
  END;

-- ============================================================================
-- Requête 3: Tous les agents avec ordre logique général (complet)
-- ============================================================================

SELECT 
  slug,
  name,
  description,
  system_prompt,
  user_prompt,
  available_variables,
  created_at,
  updated_at
FROM public.ai_agents
ORDER BY 
  CASE slug
    -- Challenge Builder V2 (ordre d'exécution logique)
    WHEN 'challenge-revision-planner' THEN 1      -- Phase 1: Planning
    WHEN 'challenge-detailed-updater' THEN 2      -- Phase 2: Updates
    WHEN 'challenge-detailed-creator' THEN 3     -- Phase 2: Creations
    -- Workflow ASK (ordre d'exécution logique)
    WHEN 'ask-conversation-response' THEN 10     -- Étape 1: Conversation
    WHEN 'ask-insight-detection' THEN 11         -- Étape 2: Détection
    -- Autres agents ASK
    WHEN 'ask-generator' THEN 20                 -- Génération ASK
    -- Agents d'analyse Graph RAG (peuvent être appelés en parallèle)
    WHEN 'insight-entity-extraction' THEN 30     -- Extraction d'entités
    WHEN 'insight-synthesis' THEN 31             -- Synthèse d'insights
    -- Legacy agents (en dernier)
    WHEN 'challenge-builder' THEN 99             -- Ancien agent (non utilisé)
    -- Autres agents non listés
    ELSE 100
  END,
  slug ASC;  -- Tri alphabétique pour les agents du même niveau

-- ============================================================================
-- Requête 4: Uniquement les prompts (simplifié pour export/visualisation)
-- ============================================================================

-- Variante A: Challenge Builder V2 uniquement
SELECT 
  slug,
  system_prompt,
  user_prompt
FROM public.ai_agents
WHERE slug IN (
  'challenge-revision-planner',
  'challenge-detailed-updater',
  'challenge-detailed-creator'
)
ORDER BY 
  CASE slug
    WHEN 'challenge-revision-planner' THEN 1
    WHEN 'challenge-detailed-updater' THEN 2
    WHEN 'challenge-detailed-creator' THEN 3
  END;

-- Variante B: Workflow ASK uniquement
SELECT 
  slug,
  system_prompt,
  user_prompt
FROM public.ai_agents
WHERE slug IN (
  'ask-conversation-response',
  'ask-insight-detection'
)
ORDER BY 
  CASE slug
    WHEN 'ask-conversation-response' THEN 1
    WHEN 'ask-insight-detection' THEN 2
  END;

-- Variante C: Tous les agents principaux (Challenge Builder V2 + ASK)
SELECT 
  slug,
  system_prompt,
  user_prompt
FROM public.ai_agents
WHERE slug IN (
  'challenge-revision-planner',
  'challenge-detailed-updater',
  'challenge-detailed-creator',
  'ask-conversation-response',
  'ask-insight-detection',
  'ask-generator'
)
ORDER BY 
  CASE slug
    -- Challenge Builder V2
    WHEN 'challenge-revision-planner' THEN 1
    WHEN 'challenge-detailed-updater' THEN 2
    WHEN 'challenge-detailed-creator' THEN 3
    -- Workflow ASK
    WHEN 'ask-conversation-response' THEN 10
    WHEN 'ask-insight-detection' THEN 11
    -- Autres ASK
    WHEN 'ask-generator' THEN 20
  END;

