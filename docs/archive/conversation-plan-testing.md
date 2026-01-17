# Guide de test du système de plan de conversation

Ce document décrit comment tester le système de plan de conversation guidé pour les sessions ASK.

## Prérequis

### 1. Exécuter la migration

Appliquer la migration pour créer la table `ask_conversation_plans` :

```bash
# Vérifier que la migration 057 est présente
ls migrations/057_add_conversation_plans.sql

# Exécuter la migration via votre système de migration
# (exemple avec un outil de migration SQL ou directement via Supabase)
```

### 2. Créer l'agent de génération de plan

Exécuter le script pour créer l'agent `ask-conversation-plan-generator` :

```bash
node scripts/create-conversation-plan-agent.js
```

**Vérification** : L'agent doit être créé dans la table `ai_agents` avec le slug `ask-conversation-plan-generator`.

## Scénarios de test

### Test 1 : Initialisation avec génération automatique de plan

**Objectif** : Vérifier que le plan est généré automatiquement lors de la première initialisation d'une conversation.

**Étapes** :
1. Créer une nouvelle session ASK dans l'interface
2. Ouvrir la conversation (focus sur le textarea)
3. Observer les logs serveur

**Résultats attendus** :
- Logs montrant : `🎯 POST /api/ask/[key]/init: Checking for existing conversation plan`
- Logs montrant : `📋 POST /api/ask/[key]/init: Generating new conversation plan`
- Logs montrant : `✅ POST /api/ask/[key]/init: Conversation plan created with X steps`
- Un message d'accueil de l'IA apparaît dans la conversation
- La table `ask_conversation_plans` contient un enregistrement pour ce thread

**Vérification en base de données** :
```sql
SELECT 
  acp.id,
  acp.conversation_thread_id,
  acp.current_step_id,
  acp.plan_data
FROM ask_conversation_plans acp
JOIN conversation_threads ct ON ct.id = acp.conversation_thread_id
WHERE ct.ask_session_id = '<votre_ask_session_id>';
```

### Test 2 : Variables de plan dans les réponses

**Objectif** : Vérifier que les variables `conversation_plan` et `current_step` sont disponibles dans l'agent de réponse.

**Étapes** :
1. Dans une conversation avec plan généré, poster un message
2. Observer les logs serveur

**Résultats attendus** :
- Logs montrant : `📋 Conversation plan available: { planId: '...', stepsCount: X, currentStepId: 'step_1' }`
- L'agent répond en tenant compte du contexte de l'étape courante

### Test 3 : Transition d'étape avec marqueur

**Objectif** : Vérifier que le système détecte le marqueur `STEP_COMPLETE:<ID>` et met à jour le plan.

**Configuration** :
- Modifier temporairement le `user_prompt` de l'agent `ask-conversation-response` pour inclure :
  ```
  Si tu estimes que l'objectif de l'étape courante est atteint, termine ta réponse par STEP_COMPLETE:<step_id>
  ```

**Étapes** :
1. Avoir une conversation active avec un plan
2. Échanger plusieurs messages pour "compléter" l'objectif de l'étape 1
3. Observer la réponse de l'IA

**Résultats attendus** :
- La réponse de l'IA contient `STEP_COMPLETE:step_1`
- Logs montrant : `🎯 Step completion detected: step_1`
- Logs montrant : `✅ Conversation plan updated - step completed: step_1`
- La base de données montre :
  - `step_1` avec `status: 'completed'` et `completed_at` renseigné
  - `step_2` avec `status: 'active'` et `created_at` renseigné
  - `current_step_id` mis à jour vers `step_2`

**Vérification en base de données** :
```sql
SELECT 
  acp.current_step_id,
  jsonb_pretty(acp.plan_data) as plan_details
FROM ask_conversation_plans acp
JOIN conversation_threads ct ON ct.id = acp.conversation_thread_id
WHERE ct.ask_session_id = '<votre_ask_session_id>';
```

### Test 4 : Mode streaming avec détection d'étapes

**Objectif** : Vérifier que la détection fonctionne aussi en mode streaming.

**Étapes** :
1. Utiliser le mode streaming pour poster un message
2. L'IA répond avec un marqueur `STEP_COMPLETE:step_X`
3. Observer les logs

**Résultats attendus** :
- Logs montrant : `🎯 Step completion detected in stream: step_X`
- Logs montrant : `✅ Conversation plan updated in stream - step completed: step_X`
- Le plan est mis à jour correctement

### Test 5 : Réutilisation du plan existant

**Objectif** : Vérifier qu'un plan existant n'est pas régénéré.

**Étapes** :
1. Avoir une session avec un plan déjà créé
2. Recharger la page ou se reconnecter
3. Observer les logs lors de l'initialisation

**Résultats attendus** :
- Logs montrant : `✅ POST /api/ask/[key]/init: Using existing conversation plan`
- Pas de nouvelle génération de plan
- Le plan existant est récupéré et utilisé

### Test 6 : Comportement sans plan (backward compatibility)

**Objectif** : Vérifier que le système fonctionne toujours sans plan (pour les anciennes sessions).

**Étapes** :
1. Créer une session ASK
2. Désactiver temporairement l'agent `ask-conversation-plan-generator` ou simuler son échec
3. Poster des messages dans la conversation

**Résultats attendus** :
- Logs montrant : `⚠️ POST /api/ask/[key]/init: Failed to generate conversation plan, continuing without it`
- La conversation fonctionne normalement
- Les variables `conversation_plan` et `current_step` sont vides
- Aucune erreur n'est levée

## Vérifications post-test

### Structure du plan en base de données

Le champ `plan_data` doit respecter cette structure :

```json
{
  "steps": [
    {
      "id": "step_1",
      "title": "Titre de l'étape",
      "objective": "Objectif détaillé",
      "status": "completed",
      "summary": "Résumé de l'étape",
      "created_at": "2024-01-01T10:00:00Z",
      "completed_at": "2024-01-01T10:15:00Z"
    },
    {
      "id": "step_2",
      "title": "Titre de l'étape 2",
      "objective": "Objectif détaillé",
      "status": "active",
      "created_at": "2024-01-01T10:15:00Z",
      "completed_at": null
    },
    {
      "id": "step_3",
      "title": "Titre de l'étape 3",
      "objective": "Objectif détaillé",
      "status": "pending",
      "created_at": null,
      "completed_at": null
    }
  ]
}
```

### Logs à surveiller

**Logs de succès** :
- ✅ `Conversation plan created with X steps`
- ✅ `Using existing conversation plan`
- ✅ `Conversation plan updated - step completed`
- 📋 `Conversation plan available`

**Logs d'avertissement** (non bloquants) :
- ⚠️ `Failed to generate conversation plan, continuing without it`
- ⚠️ `Failed to update conversation plan`
- ⚠️ `Step completion marker does not match current step`

**Logs d'erreur** (à investiguer) :
- ❌ Toute erreur avec une stack trace

## Tests manuels complémentaires

### Test avec différents types d'ASK

Tester la génération de plan pour :
- ASK avec `system_prompt_ask` défini
- ASK lié à un projet avec `system_prompt_project`
- ASK lié à un challenge avec `system_prompt_challenge`
- ASK avec les trois system prompts combinés

**Vérification** : Le plan doit s'adapter au contexte fourni.

### Test avec threads partagés vs individuels

- **Thread partagé** : Vérifier qu'un seul plan est créé pour tout le groupe
- **Threads individuels** : Vérifier qu'un plan est créé par utilisateur

## Résolution de problèmes

### Le plan n'est pas généré

**Vérifications** :
1. L'agent `ask-conversation-plan-generator` existe-t-il ?
   ```sql
   SELECT * FROM ai_agents WHERE slug = 'ask-conversation-plan-generator';
   ```
2. L'agent a-t-il un `model_config_id` valide ?
3. La clé API est-elle configurée correctement ?

### Les étapes ne se mettent pas à jour

**Vérifications** :
1. Le marqueur `STEP_COMPLETE:<ID>` est-il présent dans la réponse ?
2. L'ID de l'étape correspond-il à `current_step_id` du plan ?
3. Le `conversation_thread_id` est-il correct ?

### Erreurs de permissions

Si vous voyez des erreurs de type "permission denied" :
1. Vérifier que les RLS policies ont été créées correctement
2. Vérifier que l'utilisateur a accès au thread de conversation
3. Tester avec le service_role pour écarter les problèmes de permissions

## Commandes SQL utiles

### Voir tous les plans

```sql
SELECT 
  acp.id,
  acp.current_step_id,
  ct.ask_session_id,
  ct.is_shared,
  ct.user_id,
  jsonb_array_length(acp.plan_data->'steps') as steps_count,
  acp.created_at
FROM ask_conversation_plans acp
JOIN conversation_threads ct ON ct.id = acp.conversation_thread_id
ORDER BY acp.created_at DESC;
```

### Voir les étapes d'un plan spécifique

```sql
SELECT 
  step->>'id' as step_id,
  step->>'title' as title,
  step->>'status' as status,
  step->>'objective' as objective
FROM ask_conversation_plans acp,
     jsonb_array_elements(acp.plan_data->'steps') as step
WHERE acp.id = '<plan_id>';
```

### Réinitialiser un plan (pour tests)

```sql
DELETE FROM ask_conversation_plans 
WHERE conversation_thread_id = '<thread_id>';
```

## Conclusion

Une fois tous ces tests passés, le système de plan de conversation est prêt pour la production. N'oubliez pas de :
- Surveiller les logs en production
- Ajuster les prompts de l'agent de génération de plan si nécessaire
- Collecter les retours utilisateurs sur la qualité des plans générés

