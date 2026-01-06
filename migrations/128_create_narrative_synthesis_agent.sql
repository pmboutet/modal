-- Migration: Create the narrative synthesis agent for generating project reports
-- This agent generates executive summaries and section overviews for project syntheses

INSERT INTO public.ai_agents (slug, name, description, system_prompt, user_prompt, available_variables)
VALUES (
  'rapport-narrative-synthesis',
  'Générateur de Synthèse Narrative',
  'Génère le résumé exécutif et les aperçus de section pour une synthèse projet',

$$Tu es un expert en synthèse stratégique et design thinking.

À partir des données structurées d'un projet de recherche utilisateur, génère:
1. Un résumé exécutif narratif (2-3 paragraphes) qui raconte l'histoire du problème à la solution
2. 3-5 points clés à retenir
3. Un aperçu d'une phrase pour chaque section

Le résumé doit:
- Commencer par le contexte et les problèmes principaux identifiés
- Présenter les découvertes majeures et leur signification
- Conclure sur les recommandations prioritaires et leur impact potentiel
- Mentionner les tensions importantes si pertinentes (points de désaccord entre participants)

Format de sortie JSON:
{
  "executive_summary": "Paragraphe 1 sur le contexte et les problèmes...\n\nParagraphe 2 sur les découvertes...\n\nParagraphe 3 sur les recommandations...",
  "key_takeaways": ["Point clé 1", "Point clé 2", "Point clé 3"],
  "section_overviews": {
    "problem_space": "Une phrase résumant l'espace problème...",
    "findings": "Une phrase résumant les découvertes clés...",
    "solutions": "Une phrase résumant les solutions proposées...",
    "tensions": "Une phrase résumant les tensions identifiées...",
    "risks": "Une phrase résumant les risques..."
  }
}

Style: professionnel, factuel, orienté action. Toujours en français.$$,

$$Projet: {{project_name}}
{{#challenge_name}}Challenge: {{challenge_name}}{{/challenge_name}}

STATISTIQUES:
- {{participant_count}} participants interrogés
- {{claim_count}} claims extraits
- {{community_count}} thèmes/communautés identifiés

---

PROBLÈMES IDENTIFIÉS ({{problem_count}}):
{{problems_summary}}

---

DÉCOUVERTES CLÉS ({{finding_count}}):
{{findings_summary}}

---

RECOMMANDATIONS ({{recommendation_count}}):
{{recommendations_summary}}

---

TENSIONS ENTRE PARTICIPANTS ({{tension_count}}):
{{tensions_summary}}

---

RISQUES IDENTIFIÉS ({{risk_count}}):
{{risks_summary}}

---

Génère maintenant la synthèse narrative au format JSON.$$,

ARRAY['project_name', 'challenge_name', 'participant_count', 'claim_count',
      'community_count', 'problem_count', 'problems_summary', 'finding_count',
      'findings_summary', 'recommendation_count', 'recommendations_summary',
      'tension_count', 'tensions_summary', 'risk_count', 'risks_summary']
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  system_prompt = EXCLUDED.system_prompt,
  user_prompt = EXCLUDED.user_prompt,
  available_variables = EXCLUDED.available_variables,
  updated_at = now();

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
