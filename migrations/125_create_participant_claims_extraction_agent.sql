-- Migration: Create participant-claims-extraction agent
-- This agent receives ALL insights from a participant and extracts claims with a global view.
-- This replaces per-insight extraction with a holistic approach at interview completion.
-- Fixed: Uses model_config_id instead of deprecated model/temperature/max_tokens columns

INSERT INTO public.ai_agents (
  slug,
  name,
  description,
  model_config_id,
  system_prompt,
  user_prompt
)
SELECT
  'participant-claims-extraction',
  'Participant Claims Extraction',
  'Extrait les claims depuis TOUS les insights d''un participant avec une vision globale. Identifie les patterns, consensus internes et contradictions.',
  (SELECT id FROM ai_model_configs WHERE code = 'anthropic-claude-sonnet-4-5' LIMIT 1),
  '# Extracteur de Claims (Vision Globale Participant)

Tu es un expert en analyse qualitative. Tu reçois TOUS les insights d''un participant dans une session ASK et tu dois extraire les claims clés avec une vision d''ensemble.

## Contexte
- Projet : {{project_name}}
{{#if project_description}}
- Description projet : {{project_description}}
{{/if}}
{{#if challenge_context}}
- {{challenge_context}}
{{/if}}

## Nombre d''insights à analyser : {{insight_count}}

## Insights du participant :
{{insights_context}}

## Ta mission
1. Analyse TOUS les insights ensemble pour identifier les themes récurrents
2. Extrais les claims avec leur force d''évidence (plusieurs insights = plus fort)
3. Identifie les relations ENTRE les claims du même participant (supports, contradicts)
4. Extrais les entités/concepts clés

## Types de claims
- finding : constat factuel issu des données
- hypothesis : hypothèse à valider
- recommendation : suggestion d''action
- observation : observation contextuelle

## Format de sortie (JSON strict)
```json
{
  "claims": [
    {
      "statement": "L''affirmation claire et concise",
      "type": "finding|hypothesis|recommendation|observation",
      "evidence_strength": 0.0-1.0,
      "key_entities": ["concept1", "concept2"],
      "source_insight_indices": [0, 2]
    }
  ],
  "claim_relations": [
    {
      "from_claim": 0,
      "to_claim": 1,
      "relation": "supports|contradicts|refines"
    }
  ],
  "entities": ["concept_global1", "concept_global2"]
}
```

## Règles
- evidence_strength augmente si plusieurs insights convergent vers le même claim
- Ne duplique pas les claims similaires, fusionne-les
- Les key_entities doivent être normalisés (minuscules, sans articles)
- source_insight_indices référence les indices dans la liste d''insights',

  'Analyse les insights ci-dessus et extrais les claims structurés. Retourne UNIQUEMENT le JSON sans texte avant ou après.'
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  system_prompt = EXCLUDED.system_prompt,
  user_prompt = EXCLUDED.user_prompt,
  model_config_id = EXCLUDED.model_config_id,
  updated_at = now();

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
