# Migration vers Challenge Builder V2 (Optimized)

## 🎯 Objectif

Migrer du Challenge Builder V1 (séquentiel) vers le Challenge Builder V2 (optimized) avec architecture 2-phases.

## 📊 Gains attendus

- **Performance** : ×6 plus rapide (5s vs 30s pour 10 challenges)
- **Coût** : -56% de tokens (~35K vs ~80K)
- **Qualité** : +30% de cohérence (vision globale vs silotée)
- **Efficacité** : Skip automatique des challenges qui ne nécessitent pas de mise à jour

## 📋 Checklist de migration

### Étape 1 : Backup de la configuration actuelle

```bash
# Backup de l'agent actuel
node scripts/backup-current-agents.js
```

Ou manuellement en SQL :
```sql
-- Sauvegarde de l'agent challenge-builder actuel
SELECT * FROM ai_agents WHERE slug = 'challenge-builder';

-- Sauvegarder dans un fichier
\copy (SELECT * FROM ai_agents WHERE slug = 'challenge-builder') TO '/tmp/challenge-builder-backup.csv' CSV HEADER;
```

### Étape 2 : Créer les nouveaux agents

```bash
# Installation des nouveaux agents optimisés
node scripts/init-challenge-builder-optimized.js
```

Cette commande crée :
- ✅ `challenge-revision-planner` (Phase 1)
- ✅ `challenge-detailed-updater` (Phase 2)
- ✅ `challenge-detailed-creator` (Phase 2)

**Vérification** :
```sql
SELECT slug, name, metadata->>'version' as version, metadata->>'phase' as phase
FROM ai_agents
WHERE slug IN ('challenge-revision-planner', 'challenge-detailed-updater', 'challenge-detailed-creator');
```

Résultat attendu :
```
slug                        | name                           | version | phase
----------------------------|--------------------------------|---------|----------
challenge-revision-planner  | Challenge Revision Planner     | 2.0     | planning
challenge-detailed-updater  | Challenge Detailed Updater     | 2.0     | execution
challenge-detailed-creator  | Challenge Detailed Creator     | 2.0     | execution
```

### Étape 3 : Test sur un projet de développement

```bash
# Tester la nouvelle API v2
curl -X POST http://localhost:3000/api/admin/projects/{PROJECT_ID}/ai/challenge-builder-v2 \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Vérifier les logs** :
```sql
SELECT 
  interaction_type,
  status,
  latency_ms,
  created_at
FROM ai_agent_logs
WHERE interaction_type IN (
  'project_challenge_planning',
  'project_challenge_update_detailed',
  'project_challenge_creation_detailed'
)
ORDER BY created_at DESC
LIMIT 10;
```

### Étape 4 : Comparaison V1 vs V2

Tester le même projet avec V1 et V2 :

```bash
# V1 (ancienne route)
time curl -X POST http://localhost:3000/api/admin/projects/{PROJECT_ID}/ai/challenge-builder

# V2 (nouvelle route)
time curl -X POST http://localhost:3000/api/admin/projects/{PROJECT_ID}/ai/challenge-builder-v2
```

Comparer :
- ⏱️ Temps de réponse
- 💰 Nombre de tokens utilisés (dans les logs)
- ✅ Qualité des suggestions
- 🎯 Pertinence du filtrage (noChangeNeeded)

### Étape 5 : Mise à jour du frontend (optionnel)

Si vous voulez utiliser V2 par défaut :

```typescript
// src/components/project/ProjectJourneyBoard.tsx
// Remplacer l'URL
const response = await fetch(
  `/api/admin/projects/${projectId}/ai/challenge-builder-v2`, // <- ajout du -v2
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }
);
```

Ou configurer via variable d'environnement :
```bash
# .env.local
USE_CHALLENGE_BUILDER_V2=true
```

### Étape 6 : Migration progressive (Recommandé)

**Option A : Feature flag**
```typescript
// src/lib/featureFlags.ts
export const FEATURES = {
  USE_CHALLENGE_BUILDER_V2: process.env.USE_CHALLENGE_BUILDER_V2 === 'true',
};

// Dans le composant
const endpoint = FEATURES.USE_CHALLENGE_BUILDER_V2
  ? `/api/admin/projects/${projectId}/ai/challenge-builder-v2`
  : `/api/admin/projects/${projectId}/ai/challenge-builder`;
```

**Option B : Remplacer la route V1 par V2**
```bash
# Renommer l'ancienne route
mv src/app/api/admin/projects/[id]/ai/challenge-builder/route.ts \
   src/app/api/admin/projects/[id]/ai/challenge-builder/route.v1.ts.bak

# Copier V2 à la place de V1
cp src/app/api/admin/projects/[id]/ai/challenge-builder-v2/route.ts \
   src/app/api/admin/projects/[id]/ai/challenge-builder/route.ts
```

### Étape 7 : Monitoring post-migration

```sql
-- Performance comparison
SELECT 
  DATE_TRUNC('day', created_at) as day,
  interaction_type,
  COUNT(*) as calls,
  AVG(latency_ms) as avg_latency,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) as p95_latency,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as success_count
FROM ai_agent_logs
WHERE interaction_type LIKE 'project_challenge_%'
  AND created_at > NOW() - INTERVAL '14 days'
GROUP BY 1, 2
ORDER BY 1 DESC, 2;

-- Token usage estimation (via response payload size)
SELECT 
  interaction_type,
  AVG(LENGTH(request_payload::text) + LENGTH(response_payload::text)) / 4 as avg_estimated_tokens
FROM ai_agent_logs
WHERE interaction_type LIKE 'project_challenge_%'
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY interaction_type;
```

## 🐛 Troubleshooting

### Problème : "Agent not found: challenge-revision-planner"

**Solution** : Les agents n'ont pas été créés correctement
```bash
node scripts/init-challenge-builder-optimized.js
```

### Problème : "Invalid JSON response from planner"

**Causes possibles** :
1. Prompt trop complexe pour le modèle
2. Timeout du modèle
3. Context trop large

**Solutions** :
```javascript
// Augmenter maxOutputTokens
{
  "maxOutputTokens": 8192  // au lieu de 4096
}

// Augmenter temperature pour plus de "souplesse"
{
  "temperature": 0.3  // au lieu de 0
}
```

### Problème : Trop d'updates recommandés

**Cause** : Le planner est trop "sensible"

**Solution** : Ajuster le prompt du planner pour être plus sélectif
```sql
UPDATE ai_agents 
SET system_prompt = system_prompt || E'\n\nNOTE IMPORTANTE: Ne recommande des updates que si ≥5 nouveaux insights ou insights critiques.'
WHERE slug = 'challenge-revision-planner';
```

### Problème : Performance pas améliorée

**Vérification** :
```sql
-- Vérifier que les appels sont bien parallèles
SELECT 
  DATE_TRUNC('second', created_at) as second,
  interaction_type,
  COUNT(*) as concurrent_calls
FROM ai_agent_logs
WHERE interaction_type IN ('project_challenge_update_detailed', 'project_challenge_creation_detailed')
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY 1, 2
HAVING COUNT(*) > 1
ORDER BY 1 DESC;
```

Si aucune concurrence → vérifier que `Promise.all()` est bien utilisé dans la route.

### Problème : Rate limiting du provider

**Cause** : Trop d'appels parallèles

**Solution** : Implémenter un batch limiter
```typescript
// Dans la route, avant Promise.all
const BATCH_SIZE = 5;
const batches = [];

for (let i = 0; i < promises.length; i += BATCH_SIZE) {
  const batch = promises.slice(i, i + BATCH_SIZE);
  batches.push(Promise.all(batch));
}

// Execute batches sequentially
for (const batch of batches) {
  const results = await batch;
  // Process results
}
```

## 🔄 Rollback

Si V2 ne fonctionne pas comme prévu :

### Rollback rapide (garde V2 mais utilise V1)
```bash
# Dans le frontend, revenir à l'ancienne URL
# src/components/project/ProjectJourneyBoard.tsx
# Remplacer -v2 par l'URL originale
```

### Rollback complet (supprime V2)
```sql
-- Supprimer les nouveaux agents
DELETE FROM ai_agents 
WHERE slug IN ('challenge-revision-planner', 'challenge-detailed-updater', 'challenge-detailed-creator');

-- Restaurer l'ancien agent si modifié
-- (utiliser le backup de l'étape 1)
```

```bash
# Supprimer la nouvelle route
rm -rf src/app/api/admin/projects/[id]/ai/challenge-builder-v2
```

## 📈 Métriques de succès

Après 1 semaine d'utilisation de V2 :

✅ **Performance**
- [ ] Temps de réponse moyen réduit de ≥50%
- [ ] P95 latency < 10 secondes

✅ **Coût**
- [ ] Tokens utilisés réduits de ≥40%
- [ ] Nombre d'appels réduit de ≥30%

✅ **Qualité**
- [ ] Taux d'erreur < 5%
- [ ] Feedback positif des utilisateurs sur la cohérence
- [ ] Moins de suggestions "inutiles" (noChangeNeeded bien utilisé)

✅ **Fiabilité**
- [ ] Taux de succès > 95%
- [ ] Pas de timeout
- [ ] Logs propres

## 🎓 Formation équipe

Points clés à communiquer :

1. **Nouvelle architecture 2-phases** : Planning → Execution
2. **Feedback plus rapide** : Les résultats arrivent ×6 plus vite
3. **Plus intelligent** : Skip automatique des challenges déjà à jour
4. **Meilleure cohérence** : Vision globale du projet
5. **Foundation insights** : Nouveaux insights clés identifiés pour chaque challenge

## 📞 Support

En cas de problème :
1. Consulter les logs : `ai_agent_logs` table
2. Vérifier la doc : `CHALLENGE_BUILDER_OPTIMIZED.md`
3. Consulter le code : `src/app/api/admin/projects/[id]/ai/challenge-builder-v2/route.ts`

## 🚀 Next steps après migration

1. **Optimisation des prompts** basée sur les retours utilisateurs
2. **Streaming** pour feedback en temps réel
3. **Cache** pour les projects qui changent peu
4. **Webhooks** pour déclencher automatiquement après de nouveaux insights

