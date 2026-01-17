# Appliquer les corrections en production

## Problème

L'erreur 500 sur `/api/ask/token/[token]` en production est causée par :
1. **Erreur "column reference 'ask_session_id' is ambiguous"** - La fonction `get_ask_session_by_token` a une référence ambiguë
2. **Erreur "structure of query does not match function result type"** - Le type de retour `name TEXT` ne correspond pas au type réel `VARCHAR` dans la table

## Solution rapide (Supabase SQL Editor)

1. **Ouvrez Supabase SQL Editor** dans votre projet de production
2. **Copiez-collez le contenu** de `scripts/apply-fixes-to-production.sql`
3. **Exécutez le script**

Le script applique les corrections des migrations 065 et 066 directement.

## Solution automatique (GitHub Actions)

Si vous avez configuré GitHub Actions avec `SUPABASE_DATABASE_URL` :

1. **Poussez le commit** vers `main` :
   ```bash
   git push origin main
   ```

2. **GitHub Actions appliquera automatiquement** les migrations 065 et 066

## Vérification

Après avoir appliqué les corrections, testez avec :

```sql
-- Dans Supabase SQL Editor
SELECT * FROM public.get_ask_session_by_token('1643f806ebf868a0d1a414ceda9b5269');
```

Ou testez l'URL en production :
```
https://app-modal.com/?token=1643f806ebf868a0d1a414ceda9b5269
```

## Corrections appliquées

### Migration 065
- ✅ Qualification de `ask_session_id` avec le nom de la table (`ap.ask_session_id`)
- ✅ Correction de `get_ask_messages_by_token` avec la même qualification

### Migration 066
- ✅ Correction du type de retour `name TEXT` → `name VARCHAR` pour correspondre au schéma

## Fichiers

- `scripts/apply-fixes-to-production.sql` - Script SQL à exécuter dans Supabase
- `migrations/065_fix_ambiguous_ask_session_id_in_functions.sql` - Migration complète
- `migrations/066_fix_function_return_types.sql` - Migration complète

