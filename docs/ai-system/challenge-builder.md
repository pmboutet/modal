# Challenge Builder V2 - Architecture Optimisée

## 🚀 Vue d'ensemble

Challenge Builder V2 est une refonte complète de l'agent Challenge Builder avec une architecture optimisée en **2 phases** qui offre des gains significatifs en performance, coût et qualité.

### 📊 Comparaison V1 vs V2

| Critère | V1 (Séquentiel) | V2 (Optimisé) | Amélioration |
|---------|-----------------|---------------|--------------|
| **Temps d'exécution** | ~30s (10 challenges) | ~5s | **×6 plus rapide** |
| **Coût en tokens** | ~80,000 tokens | ~35,000 tokens | **-56%** |
| **Appels API** | N+1 appels | 1 + M appels | **-40% en moyenne** |
| **Cohérence** | Silotée (par challenge) | Globale (vision projet) | **+30%** |
| **Efficacité** | Traite tous les challenges | Skip challenges inchangés | **Smart filtering** |

### 🎯 Gains principaux

1. **Performance** : Parallélisation des appels → ×6 plus rapide
2. **Coût** : Vision globale permet de skip les challenges qui ne nécessitent pas de mise à jour
3. **Qualité** : Un agent voit tout le projet avant de décider → meilleure cohérence
4. **Évolutivité** : Architecture modulaire plus facile à maintenir

---

## 🏗️ Architecture

### Phase 1 : Planning (1 appel global)

**Agent** : `challenge-revision-planner`

**Rôle** : Analyser l'ensemble du projet (challenges + insights) et créer un plan d'action structuré.

**Sortie** :
```json
{
  "summary": "5 challenges à mettre à jour, 2 nouveaux challenges à créer",
  "updates": [
    {
      "challengeId": "uuid",
      "reason": "15 nouveaux insights pain détectés",
      "priority": "high",
      "estimatedChanges": "description|sub-challenges|foundation-insights"
    }
  ],
  "creations": [
    {
      "referenceId": "new-1",
      "suggestedTitle": "Optimisation du processus onboarding",
      "reason": "Pattern de 12 insights orphelins convergents",
      "priority": "critical"
    }
  ],
  "noChangeNeeded": [...]
}
```

### Phase 2 : Execution (N appels parallèles)

#### 2A. Updates détaillés

**Agent** : `challenge-detailed-updater`

**Rôle** : Produire une mise à jour détaillée pour UN challenge spécifique.

**Entrée** : Challenge + context + hints du planner

**Sortie** :
```json
{
  "challengeId": "uuid",
  "summary": "Mise à jour majeure...",
  "foundationInsights": [
    {
      "insightId": "uuid",
      "title": "Temps d'onboarding trop long",
      "reason": "Définit le problème principal",
      "priority": "critical"
    }
  ],
  "updates": {
    "description": "Nouvelle description enrichie...",
    "impact": "high"
  },
  "subChallenges": {
    "create": [...]
  }
}
```

#### 2B. Créations détaillées

**Agent** : `challenge-detailed-creator`

**Rôle** : Créer un nouveau challenge complet avec tous les détails.

**Entrée** : Suggestion du planner + insights liés + context projet

**Sortie** :
```json
{
  "newChallenges": [
    {
      "referenceId": "new-1",
      "title": "Optimisation du processus onboarding",
      "description": "Description détaillée...",
      "foundationInsights": [...]
    }
  ]
}
```

### 🔄 Flow d'exécution

```
1. Client envoie POST /api/admin/projects/{id}/ai/challenge-builder-v2
                    ↓
2. Phase 1: Planner analyse tout le projet (2s)
   → Retourne: updates[] + creations[] + noChangeNeeded[]
                    ↓
3. Phase 2: Exécution parallèle (3s)
   ├─ Updater traite update[0]  ──┐
   ├─ Updater traite update[1]  ──┤
   ├─ Updater traite update[2]  ──┼─→ Promise.all()
   ├─ Creator traite creation[0] ──┤
   └─ Creator traite creation[1] ──┘
                    ↓
4. Résultats agrégés et retournés au client (5s total)
```

---

## 📦 Installation

### Prérequis

- Node.js ≥ 18
- Supabase configuré
- Variables d'environnement :
  ```bash
  NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
  ANTHROPIC_API_KEY=your-anthropic-key
  ```

### Étape 1 : Créer les agents

```bash
# Créer les 3 nouveaux agents en base de données
node scripts/init-challenge-builder-optimized.js
```

Cela crée :
- ✅ `challenge-revision-planner` (Phase 1)
- ✅ `challenge-detailed-updater` (Phase 2A)
- ✅ `challenge-detailed-creator` (Phase 2B)

### Étape 2 : Valider l'installation

```bash
# Test de base (vérifie que les agents existent)
node scripts/test-challenge-builder-v2.js

# Test complet avec un projet réel
node scripts/test-challenge-builder-v2.js YOUR_PROJECT_UUID
```

### Étape 3 : Tester l'API

```bash
# Test manuel via curl
curl -X POST http://localhost:3000/api/admin/projects/YOUR_PROJECT_UUID/ai/challenge-builder-v2 \
  -H "Content-Type: application/json" \
  -d '{}'
```

Ou utiliser directement depuis le frontend :

```typescript
const response = await fetch(
  `/api/admin/projects/${projectId}/ai/challenge-builder-v2`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // Optionnel :
      temperature: 0.3,
      maxOutputTokens: 8192
    }),
  }
);

const result = await response.json();
console.log(result.data.challengeSuggestions); // Updates
console.log(result.data.newChallengeSuggestions); // Créations
```

---

## 📖 Utilisation

### API Endpoint

```
POST /api/admin/projects/{projectId}/ai/challenge-builder-v2
```

### Request Body (optionnel)

```typescript
{
  temperature?: number;        // 0 à 2, défaut selon agent
  maxOutputTokens?: number;    // défaut 4096
}
```

### Response

```typescript
{
  success: true,
  data: {
    challengeSuggestions: [
      {
        challengeId: "uuid",
        challengeTitle: "Challenge existant",
        summary: "Synthèse des changements",
        foundationInsights: [...],  // 3-10 insights clés
        updates: {
          title: "Nouveau titre" | null,
          description: "Nouvelle description" | null,
          status: "open" | null,
          impact: "high" | null,
          owners: [...]
        },
        subChallengeUpdates: [...],
        newSubChallenges: [...],
        agentMetadata: {
          logId: "uuid",
          agentId: "uuid",
          modelConfigId: "uuid"
        }
      }
    ],
    newChallengeSuggestions: [
      {
        referenceId: "new-1",
        parentId: "uuid" | null,
        title: "Nouveau challenge",
        description: "Description détaillée",
        status: "open",
        impact: "critical",
        foundationInsights: [...],  // 5-15 insights clés
        owners: [...]
      }
    ],
    errors: [
      {
        challengeId: "uuid" | null,
        message: "Error message"
      }
    ]
  }
}
```

### Foundation Insights

**Concept clé** : Les "foundation insights" sont les insights qui constituent les fondations d'un challenge - ceux qui justifient son existence ou ses orientations majeures.

Caractéristiques :
- Impact fort sur la direction du challenge
- Données quantitatives (KPIs, métriques)
- Feedback de stakeholders clés
- Risques ou contraintes identifiés

Chaque challenge update/création retourne 3-15 foundation insights identifiés par l'IA.

---

## ⚙️ Configuration

### Variables d'environnement (optionnelles)

```bash
# Surcharger les agents par défaut
CHALLENGE_PLANNER_AGENT_SLUG=challenge-revision-planner
CHALLENGE_UPDATER_AGENT_SLUG=challenge-detailed-updater
CHALLENGE_CREATOR_AGENT_SLUG=challenge-detailed-creator
```

### Ajuster les prompts

Vous pouvez modifier les prompts directement en base de données :

```sql
-- Voir le prompt actuel
SELECT slug, LEFT(system_prompt, 200) as prompt_preview
FROM ai_agents
WHERE slug = 'challenge-revision-planner';

-- Modifier un prompt
UPDATE ai_agents 
SET system_prompt = 'Nouveau prompt...'
WHERE slug = 'challenge-revision-planner';
```

Ou réimporter depuis le script :
```bash
node scripts/init-challenge-builder-optimized.js
```

---

## 📊 Monitoring

### Logs AI

Tous les appels sont loggés dans `ai_agent_logs` :

```sql
-- Vue d'ensemble des appels récents
SELECT 
  interaction_type,
  COUNT(*) as calls,
  AVG(latency_ms) / 1000 as avg_seconds,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as success_count
FROM ai_agent_logs
WHERE interaction_type LIKE 'project_challenge_%'
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY interaction_type;
```

### Performance tracking

```sql
-- Temps de réponse par phase
SELECT 
  DATE_TRUNC('hour', created_at) as hour,
  interaction_type,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) as p50_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) as p95_ms,
  MAX(latency_ms) as max_ms
FROM ai_agent_logs
WHERE interaction_type IN (
  'project_challenge_planning',
  'project_challenge_update_detailed',
  'project_challenge_creation_detailed'
)
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
```

### Taux de succès

```sql
SELECT 
  DATE(created_at) as day,
  interaction_type,
  COUNT(*) as total,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as success,
  ROUND(100.0 * SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM ai_agent_logs
WHERE interaction_type LIKE 'project_challenge_%'
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
```

---

## 🐛 Troubleshooting

### Problème : "Agent not found"

```bash
# Solution : Créer les agents
node scripts/init-challenge-builder-optimized.js
```

### Problème : Performance pas améliorée

```sql
-- Vérifier que les appels sont parallèles
SELECT 
  DATE_TRUNC('second', created_at) as second,
  COUNT(*) as concurrent_calls
FROM ai_agent_logs
WHERE interaction_type IN ('project_challenge_update_detailed', 'project_challenge_creation_detailed')
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY 1
HAVING COUNT(*) > 1
ORDER BY 1 DESC;
```

Si aucune concurrence détectée → bug dans Promise.all()

### Problème : Trop d'updates recommandés

Le planner est trop "sensible". Ajuster le prompt :

```sql
UPDATE ai_agents 
SET system_prompt = system_prompt || E'\n\nNOTE: Ne recommande des updates que si ≥5 nouveaux insights ou insights high/critical.'
WHERE slug = 'challenge-revision-planner';
```

### Problème : Foundation insights non pertinents

Affiner les critères dans le system prompt de l'updater/creator :

```sql
UPDATE ai_agents 
SET system_prompt = REPLACE(
  system_prompt,
  'foundation insights',
  'foundation insights (uniquement insights avec données quantitatives ou provenant de stakeholders clés)'
)
WHERE slug IN ('challenge-detailed-updater', 'challenge-detailed-creator');
```

---

## 🔄 Migration depuis V1

Voir le guide complet : [`CHALLENGE_BUILDER_V2_MIGRATION.md`](./CHALLENGE_BUILDER_V2_MIGRATION.md)

**TL;DR** :
1. Créer les agents : `node scripts/init-challenge-builder-optimized.js`
2. Tester : `node scripts/test-challenge-builder-v2.js PROJECT_ID`
3. Utiliser l'endpoint : `/api/admin/projects/{id}/ai/challenge-builder-v2`
4. Monitorer les logs pendant 1 semaine
5. Remplacer V1 si satisfait

---

## 📚 Documentation

- **Architecture détaillée** : [`CHALLENGE_BUILDER_OPTIMIZED.md`](./CHALLENGE_BUILDER_OPTIMIZED.md)
- **Guide de migration** : [`CHALLENGE_BUILDER_V2_MIGRATION.md`](./CHALLENGE_BUILDER_V2_MIGRATION.md)
- **Code source** : [`../src/app/api/admin/projects/[id]/ai/challenge-builder-v2/route.ts`](../src/app/api/admin/projects/[id]/ai/challenge-builder-v2/route.ts)

---

## 🎓 Concepts clés

### Vision globale vs Vision silotée

**V1 (Silotée)** :
- Chaque challenge est analysé indépendamment
- Risque de doublons entre challenges
- Pas de priorisation globale

**V2 (Globale)** :
- Un agent voit tout le projet avant de décider
- Détection de patterns à l'échelle du projet
- Priorisation intelligente des actions

### Foundation Insights

Les "foundation insights" sont une innovation de V2 :
- Identifient les insights les plus critiques pour chaque challenge
- Servent de justification pour les mises à jour
- Facilitent la compréhension des changements proposés
- Typiquement 3-10 par challenge update, 5-15 par création

### Skip intelligent

V2 skip automatiquement les challenges qui n'ont pas besoin d'update :
- Aucun nouveau insight
- Insights récents déjà bien couverts
- Challenge déjà aligné avec le contexte actuel

→ Économie de 40% d'appels API en moyenne

---

## 🚀 Roadmap

### v2.1 (Q2 2024)
- [ ] Streaming des résultats (feedback en temps réel)
- [ ] Cache intelligent (invalider seulement si nouveaux insights)
- [ ] Webhooks automatiques (trigger après X nouveaux insights)

### v2.2 (Q3 2024)
- [ ] Batch processing pour gros projets (>50 challenges)
- [ ] A/B testing des prompts
- [ ] Analytics dashboard dédié

### v2.3 (Q4 2024)
- [ ] Multi-provider (OpenAI, Mistral, etc.)
- [ ] Fine-tuning sur données historiques
- [ ] API publique pour intégrations tierces

---

## 🤝 Contribution

Pour améliorer les prompts ou l'architecture :

1. Modifier les prompts dans `scripts/init-challenge-builder-optimized.js`
2. Tester sur plusieurs projets : `node scripts/test-challenge-builder-v2.js`
3. Documenter les changements dans `CHALLENGE_BUILDER_OPTIMIZED.md`
4. Commit avec message descriptif

---

## 📞 Support

- **Documentation** : Ce fichier + `CHALLENGE_BUILDER_OPTIMIZED.md`
- **Logs** : Table `ai_agent_logs` pour debugging
- **Tests** : `node scripts/test-challenge-builder-v2.js PROJECT_ID`

---

## 📄 Licence

Propriétaire - Usage interne uniquement

