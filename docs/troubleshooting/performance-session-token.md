# Fix: get_ask_session_by_token - Erreur "ambiguous column reference"

## Problème

La fonction RPC `get_ask_session_by_token` appelée par `src/app/api/ask/[key]/agent-config/route.ts` génère une erreur 500 en production :

```
column reference "ask_session_id" is ambiguous
```

### Cause

PostgreSQL détecte une ambiguïté car il y a plusieurs colonnes nommées `ask_session_id` dans la requête (dans `ask_sessions` et `ask_participants`). La version originale de la fonction (migration 033) utilisait `a.id` sans alias explicite dans le SELECT, ce qui peut causer des problèmes selon le contexte d'exécution.

## Solution

La migration 034 (`migrations/034_fix_token_access_functions.sql`) corrige ce problème en utilisant un alias explicite :

```sql
SELECT 
  a.id AS ask_session_id,  -- ✅ Alias explicite
  a.ask_key,
  ...
FROM public.ask_sessions a
```

## Vérification

Pour vérifier si la migration 034 a été appliquée en production :

1. **Via le système de migration** :
   ```bash
   npm run migrate:status
   ```
   Vérifiez que la migration 034 est marquée comme appliquée (✅).

2. **Via Supabase SQL Editor** :
   Exécutez cette requête pour vérifier la définition de la fonction :
   ```sql
   SELECT pg_get_functiondef(oid) 
   FROM pg_proc
   WHERE proname = 'get_ask_session_by_token'
     AND pronamespace = 'public'::regnamespace;
   ```
   Cherchez `a.id AS ask_session_id` dans la définition.

## Application du correctif

### Option 1: Via le script SQL (recommandé pour production)

1. Ouvrez Supabase SQL Editor
2. Copiez-collez le contenu de `scripts/fix-get-ask-session-by-token.sql`
3. Exécutez le script

### Option 2: Via le script Node.js

```bash
# Appliquer le correctif
node scripts/fix-get-ask-session-by-token.js

# Appliquer et tester avec un token
node scripts/fix-get-ask-session-by-token.js --test-token YOUR_TOKEN
```

**Note**: Le script Node.js peut nécessiter l'exécution manuelle du SQL si la fonction `exec_sql` n'existe pas dans votre instance Supabase.

### Option 3: Réappliquer la migration 034

Si vous utilisez le système de migration, vous pouvez réappliquer uniquement la migration 034 :

```bash
# Note: Le système de migration standard ne permet pas de réappliquer une migration
# Vous devrez utiliser l'une des options ci-dessus
```

## Test

Pour tester que la fonction fonctionne correctement après le correctif :

```sql
-- Dans Supabase SQL Editor, remplacez YOUR_TOKEN par un token valide
SELECT * FROM public.get_ask_session_by_token('YOUR_TOKEN');
```

Ou via le script Node.js :

```bash
node scripts/fix-get-ask-session-by-token.js --test-token YOUR_TOKEN
```

## Fichiers créés

- `scripts/fix-get-ask-session-by-token.sql` - Script SQL à exécuter dans Supabase SQL Editor
- `scripts/fix-get-ask-session-by-token.js` - Script Node.js pour appliquer et tester le correctif
- `docs/FIX_GET_ASK_SESSION_BY_TOKEN.md` - Cette documentation

## Migration associée

- **Migration 033**: Création initiale de la fonction (version avec problème)
- **Migration 034**: Correctif avec alias explicite (`a.id AS ask_session_id`)
- **Migration 035**: Mise à jour de `get_ask_insights_by_token` (non liée à ce problème)

## Vérification post-correctif

Après avoir appliqué le correctif, testez l'endpoint API :

```bash
curl "https://your-domain.com/api/ask/[key]/agent-config?token=YOUR_TOKEN"
```

L'erreur 500 devrait être résolue et l'endpoint devrait retourner la configuration de l'agent correctement.

