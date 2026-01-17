# Guide de Migration - Refactorisation des Plans de Conversation

## Vue d'ensemble

Cette migration transforme le système de plans de conversation d'une structure JSONB monolithique vers une architecture normalisée suivant les bonnes pratiques de bases de données relationnelles.

### Problèmes résolus

1. ✅ **Performance** : Extraction des métadonnées en colonnes dédiées pour des requêtes rapides
2. ✅ **Résumés IA** : Génération automatique de résumés d'étapes via agent spécialisé
3. ✅ **Traçabilité** : Liaison directe messages/insights → steps via foreign keys
4. ✅ **Analytique** : Requêtes SQL simples pour statistiques et progression
5. ✅ **Scalabilité** : Architecture extensible pour futures fonctionnalités

## Architecture

### Avant (Structure Legacy)

```sql
ask_conversation_plans
├── id
├── conversation_thread_id
├── plan_data (JSONB) -- TOUT était ici
├── current_step_id
├── created_at
└── updated_at
```

**Problèmes** :
- Impossible d'indexer les champs du JSON
- Requêtes lentes pour filtrer par statut
- Pas de lien direct messages → steps
- Résumés manuels basiques

### Après (Structure Normalisée)

```sql
ask_conversation_plans
├── id
├── conversation_thread_id
├── title                    -- Nouveau
├── objective                -- Nouveau
├── total_steps              -- Nouveau
├── completed_steps          -- Nouveau (auto-update via trigger)
├── status                   -- Nouveau (active/completed/abandoned)
├── plan_data (JSONB)        -- LEGACY (rétrocompatibilité)
├── current_step_id
├── created_at
└── updated_at

ask_conversation_plan_steps (TABLE NOUVELLE)
├── id
├── plan_id (FK → plans)
├── step_identifier          -- Ex: "step_1", "step_2"
├── step_order               -- 1, 2, 3...
├── title
├── objective
├── status
├── summary                  -- Résumé IA auto-généré
├── created_at
├── activated_at             -- Quand status → 'active'
└── completed_at             -- Quand status → 'completed'

messages
└── plan_step_id (FK)        -- Nouveau lien

insights
└── plan_step_id (FK)        -- Nouveau lien
```

## Migrations SQL

### 1. Migration 058 : Schéma et données

**Fichier** : `migrations/058_refactor_conversation_plans.sql`

**Actions** :
- ✅ Création table `ask_conversation_plan_steps`
- ✅ Ajout colonnes métadonnées à `ask_conversation_plans`
- ✅ Ajout `plan_step_id` à `messages` et `insights`
- ✅ Migration automatique données existantes JSONB → tables normalisées
- ✅ Trigger auto-update `completed_steps` counter
- ✅ Fonctions helpers PostgreSQL
- ✅ RLS policies complètes
- ✅ Indexes de performance

### 2. Migration 059 : Agent de résumé

**Fichier** : `migrations/059_add_step_summarizer_agent.sql`

**Actions** :
- ✅ Création agent `ask-conversation-step-summarizer`
- ✅ Prompt optimisé pour résumés concis (2-4 phrases)
- ✅ Variables: `step_title`, `step_objective`, `step_duration`, `message_count`, `step_messages`

## Modifications Code

### Types TypeScript

**Fichier** : `src/lib/ai/conversation-plan.ts`

**Nouveaux types** :
```typescript
interface ConversationPlanStep {
  id: string;  // UUID de la BDD
  plan_id: string;
  step_identifier: string;  // "step_1", "step_2"...
  step_order: number;
  title: string;
  objective: string;
  status: 'pending' | 'active' | 'completed' | 'skipped';
  summary: string | null;  // Résumé IA
  created_at: string;
  activated_at: string | null;
  completed_at: string | null;
}

interface ConversationPlan {
  id: string;
  conversation_thread_id: string;
  title: string | null;
  objective: string | null;
  total_steps: number;
  completed_steps: number;
  status: 'active' | 'completed' | 'abandoned';
  plan_data: LegacyConversationPlanData | null;  // Legacy
  current_step_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ConversationPlanWithSteps extends ConversationPlan {
  steps: ConversationPlanStep[];  // Chargées depuis table normalisée
}
```

### Nouvelles Fonctions

**Fichier** : `src/lib/ai/conversation-plan.ts`

1. **`getConversationPlanWithSteps()`**
   - Charge plan + steps depuis table normalisée
   - Remplace `getConversationPlan()` dans le nouveau code

2. **`getPlanStep()`**
   - Récupère un step spécifique par son identifier

3. **`getActiveStep()`**
   - Récupère le step actif d'un plan
   - Utilisé pour lier messages/insights

4. **`completeStep()`**
   - Marque un step comme complété
   - Active automatiquement le step suivant
   - Remplace `updatePlanStep()`

5. **`generateStepSummary()`**
   - Appelle l'agent `ask-conversation-step-summarizer`
   - Génère un résumé IA des messages du step
   - Appelé automatiquement lors de `STEP_COMPLETE:<ID>`

6. **`formatCompletedStepsForPrompt()`**
   - Formatte les steps complétés avec résumés
   - Nouvelle variable agent

7. **`formatPlanProgress()`**
   - Retourne "Progression: 2/5 étapes (40%)"
   - Nouvelle variable agent

### Liaison Messages → Steps

**Fichiers** :
- `src/app/api/ask/[key]/respond/route.ts`
- `src/app/api/ask/[key]/stream/route.ts`

**Changements** :
```typescript
// Avant insertion du message, récupérer le step actif
let planStepId: string | null = null;
if (conversationThread) {
  const plan = await getConversationPlanWithSteps(supabase, conversationThread.id);
  if (plan) {
    const activeStep = await getActiveStep(supabase, plan.id);
    if (activeStep) {
      planStepId = activeStep.id;
    }
  }
}

// Insertion avec lien au step
await supabase.from('messages').insert({
  // ... autres champs
  plan_step_id: planStepId,  // ← NOUVEAU
});
```

### Résumé Automatique (STEP_COMPLETE)

**Fichiers** :
- `src/app/api/ask/[key]/respond/route.ts` (lignes 2015-2075)
- `src/app/api/ask/[key]/stream/route.ts` (lignes 741-801)

**Workflow** :
1. Détection `STEP_COMPLETE:<ID>` dans réponse IA
2. Validation : ID correspond au step courant
3. Génération résumé IA via `generateStepSummary()`
4. Complétion step via `completeStep()` avec résumé
5. Activation automatique step suivant

### Nouvelles Variables Agent

**Fichier** : `src/lib/ai/constants.ts`

Ajout de 2 nouvelles variables :

```typescript
{
  key: "completed_steps_summary",
  label: "Résumés des étapes complétées",
  description: "Liste des étapes complétées avec leurs résumés IA",
  example: "Étapes complétées (2/5) :\n\n1. ✅ Contexte (step_1)\n   Résumé: L'équipe a partagé...",
  type: "string",
  category: "conversation",
},
{
  key: "plan_progress",
  label: "Progression du plan",
  description: "Progression en pourcentage et nombre d'étapes",
  example: "Progression du plan: 2/5 étapes (40%)",
  type: "string",
  category: "conversation",
}
```

**Fichier** : `src/lib/ai/conversation-agent.ts`

Mise à jour de `buildConversationAgentVariables()` pour exposer les nouvelles variables.

## Rétrocompatibilité

### Stratégie

✅ **Double structure maintenue** :
- Nouvelle table normalisée (`ask_conversation_plan_steps`)
- Ancienne colonne JSONB (`plan_data`) conservée

✅ **Fonctions helpers compatibles** :
- `getCurrentStep()` fonctionne avec les deux formats
- `formatPlanForPrompt()` détecte automatiquement la structure
- Support `step.id` (legacy) et `step.step_identifier` (nouveau)

✅ **Migration automatique** :
- Toutes les données existantes migrées au démarrage
- Pas de perte de données
- Pas d'intervention manuelle requise

### Fonctions Deprecated

```typescript
// ⚠️ Deprecated mais toujours fonctionnelles
updatePlanStep() // → Utiliser completeStep()
summarizeStepMessages() // → Utiliser generateStepSummary()
getCurrentStep() // → Utiliser getActiveStep() pour nouveaux cas
```

## Installation & Tests

### 1. Appliquer les migrations

```bash
# Via Supabase CLI
supabase db reset

# Ou manuellement
psql -d your_database -f migrations/058_refactor_conversation_plans.sql
psql -d your_database -f migrations/059_add_step_summarizer_agent.sql
```

### 2. Vérifier la migration

```sql
-- Vérifier que les tables existent
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('ask_conversation_plans', 'ask_conversation_plan_steps');

-- Vérifier les nouvelles colonnes
SELECT column_name FROM information_schema.columns
WHERE table_name = 'ask_conversation_plans'
AND column_name IN ('title', 'total_steps', 'completed_steps', 'status');

-- Vérifier les données migrées
SELECT
  p.id,
  p.total_steps,
  p.completed_steps,
  COUNT(s.id) as steps_in_table
FROM ask_conversation_plans p
LEFT JOIN ask_conversation_plan_steps s ON s.plan_id = p.id
GROUP BY p.id, p.total_steps, p.completed_steps;

-- Vérifier l'agent
SELECT slug, name FROM agents WHERE slug = 'ask-conversation-step-summarizer';
```

### 3. Tests fonctionnels

#### Test 1 : Création de plan
1. Créer une nouvelle conversation ASK
2. Vérifier qu'un plan est généré
3. Vérifier dans la BDD :
   ```sql
   SELECT * FROM ask_conversation_plans WHERE conversation_thread_id = '<ID>';
   SELECT * FROM ask_conversation_plan_steps WHERE plan_id = '<PLAN_ID>' ORDER BY step_order;
   ```

#### Test 2 : Liaison messages → steps
1. Envoyer des messages dans la conversation
2. Vérifier que `plan_step_id` est rempli :
   ```sql
   SELECT id, content, plan_step_id
   FROM messages
   WHERE conversation_thread_id = '<ID>'
   ORDER BY created_at DESC
   LIMIT 10;
   ```

#### Test 3 : Complétion de step + résumé IA
1. Faire progresser la conversation jusqu'à `STEP_COMPLETE:step_1`
2. Vérifier dans les logs console :
   - `🎯 Step completion detected`
   - `📝 Generating AI summary`
   - `✅ AI summary generated: [résumé]`
3. Vérifier dans la BDD :
   ```sql
   SELECT
     step_identifier,
     title,
     status,
     summary,
     activated_at,
     completed_at
   FROM ask_conversation_plan_steps
   WHERE plan_id = '<PLAN_ID>'
   ORDER BY step_order;
   ```

#### Test 4 : Nouvelles variables agent
1. Consulter le prompt généré dans les logs
2. Vérifier présence de :
   - `{{completed_steps_summary}}`
   - `{{plan_progress}}`

### 4. Tests de performance

```sql
-- Test index sur plan_step_id
EXPLAIN ANALYZE
SELECT * FROM messages WHERE plan_step_id = '<STEP_UUID>';

-- Test requête steps par statut
EXPLAIN ANALYZE
SELECT * FROM ask_conversation_plan_steps WHERE status = 'completed';

-- Test trigger auto-update
-- (Observer que completed_steps se met à jour automatiquement)
```

## Rollback (si nécessaire)

### Option 1 : Rollback partiel (garder données)

```sql
-- Supprimer seulement les nouvelles tables
DROP TABLE IF EXISTS ask_conversation_plan_steps CASCADE;

-- Supprimer nouvelles colonnes
ALTER TABLE ask_conversation_plans
  DROP COLUMN IF EXISTS title,
  DROP COLUMN IF EXISTS objective,
  DROP COLUMN IF EXISTS total_steps,
  DROP COLUMN IF EXISTS completed_steps,
  DROP COLUMN IF EXISTS status;

ALTER TABLE messages DROP COLUMN IF EXISTS plan_step_id;
ALTER TABLE insights DROP COLUMN IF EXISTS plan_step_id;

-- Supprimer agent
DELETE FROM agents WHERE slug = 'ask-conversation-step-summarizer';
```

### Option 2 : Rollback complet

```bash
# Revenir à la migration précédente
supabase db reset
# Puis restaurer depuis backup
```

## FAQ

### Q : Que se passe-t-il avec les anciennes conversations ?

**R** : Elles sont automatiquement migrées lors de l'exécution de la migration 058. Le script :
1. Lit `plan_data` de chaque plan existant
2. Crée les enregistrements dans `ask_conversation_plan_steps`
3. Remplit les métadonnées (`total_steps`, etc.)
4. Conserve `plan_data` pour rétrocompatibilité

### Q : Les messages existants sont-ils liés aux steps ?

**R** : Non. Seuls les nouveaux messages créés après la migration seront liés aux steps via `plan_step_id`. Les anciens messages ont `plan_step_id = NULL`.

### Q : Faut-il mettre à jour les agents existants ?

**R** : Non obligatoire. Les nouvelles variables (`completed_steps_summary`, `plan_progress`) sont disponibles mais optionnelles. Les agents existants continuent de fonctionner avec les variables classiques (`conversation_plan`, `current_step`, etc.).

### Q : Comment tester les résumés IA ?

**R** :
1. Créer une conversation avec un plan
2. Échanger plusieurs messages
3. Faire en sorte que l'IA réponde avec `STEP_COMPLETE:step_1`
4. Observer les logs : le résumé devrait être généré automatiquement
5. Vérifier dans la BDD que `summary` est rempli

### Q : Les insights sont-ils liés aux steps ?

**R** : La colonne `plan_step_id` a été ajoutée à la table `insights`, mais le code d'insertion n'a pas encore été modifié. C'est prévu pour une future itération. Pour l'instant, seuls les messages sont liés automatiquement.

### Q : Peut-on désactiver la génération automatique de résumés ?

**R** : Oui, il suffit de commenter l'appel à `generateStepSummary()` dans les fichiers `respond/route.ts` et `stream/route.ts`. Le step sera quand même complété, mais sans résumé IA.

## Prochaines Étapes

### Améliorations futures

1. **Insights → Steps** : Lier automatiquement les insights aux steps
2. **Analytics Dashboard** : Exploiter les nouvelles données pour des statistiques
3. **Step Templates** : Bibliothèque de plans pré-définis
4. **Conditional Steps** : Steps conditionnels basés sur les réponses
5. **Collaborative Editing** : Modifier le plan en cours de conversation
6. **Export/Import** : Sauvegarder et réutiliser des plans

### Optimisations

1. **Cache Redis** : Mettre en cache les plans actifs
2. **Batch Updates** : Optimiser les mises à jour de statuts
3. **Async Summaries** : Générer résumés en arrière-plan via queue
4. **Compression** : Compresser les résumés pour réduire le stockage

## Support

En cas de problème :
1. Consulter les logs applicatifs (console)
2. Vérifier les logs Supabase
3. Tester les requêtes SQL manuellement
4. Ouvrir une issue GitHub avec :
   - Description du problème
   - Logs d'erreur
   - Steps de reproduction
   - Version de la migration appliquée

---

**Auteur** : Migration générée automatiquement
**Date** : 2025-01-17
**Version** : 1.0.0
