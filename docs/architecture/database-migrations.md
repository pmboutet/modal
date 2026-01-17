# Comment Appliquer les Migrations

Ce guide explique comment appliquer les migrations de base de données dans ce projet.

## Prérequis

1. **Variables d'environnement** : Assurez-vous d'avoir configuré la connexion à la base de données :
   - `DATABASE_URL` ou `SUPABASE_MIGRATIONS_URL` doit être défini
   - Pour Supabase, configurez également :
     - `PGSSLMODE=require`
     - `PGSSLREJECTUNAUTHORIZED=false`

2. **Fichiers d'environnement** : Les variables peuvent être dans :
   - `.env.local` (prioritaire)
   - `.env`

## Méthodes pour Appliquer les Migrations

### Méthode 1 : Via les commandes npm (Recommandé)

```bash
# Vérifier le statut des migrations (quelles sont appliquées, lesquelles sont en attente)
npm run migrate:status

# Appliquer toutes les migrations en attente
npm run migrate
```

### Méthode 2 : Via le script directement

```bash
# Vérifier le statut
node scripts/migrate.js status

# Appliquer les migrations
node scripts/migrate.js up
```

### Méthode 3 : Via l'API (pour les déploiements)

Si vous avez accès à l'API de migrations :

```bash
# POST vers /api/migrations avec un token d'autorisation
curl -X POST https://votre-app.vercel.app/api/migrations \
  -H "Authorization: Bearer VOTRE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "up"}'
```

## Comment ça fonctionne

1. **Table de suivi** : Le système utilise une table `schema_migrations` pour suivre quelles migrations ont été appliquées.

2. **Détection automatique** : Le script :
   - Lit tous les fichiers SQL dans le dossier `migrations/`
   - Compare avec les migrations déjà appliquées
   - Applique uniquement les migrations en attente

3. **Sécurité** : 
   - Chaque migration a un hash (checksum)
   - Si une migration déjà appliquée est modifiée, le script refuse de continuer
   - Les migrations sont exécutées dans des transactions

## Exemple de sortie

Lors de l'exécution de `npm run migrate`, vous verrez :

```
➡️  Applying migration 062_add_ai_challenge_builder_results (062_add_ai_challenge_builder_results.sql)
✅ Migration 062_add_ai_challenge_builder_results applied.
✅ No pending migrations.
```

## Vérification après migration

Après avoir appliqué les migrations, vous pouvez :

1. **Vérifier le statut** :
   ```bash
   npm run migrate:status
   ```

2. **Vérifier dans Supabase** :
   - Connectez-vous à votre projet Supabase
   - Allez dans l'éditeur SQL
   - Vérifiez que les tables/colonnes attendues existent

## Dépannage

### Erreur de connexion

Si vous obtenez une erreur de connexion :
- Vérifiez que `DATABASE_URL` est correctement défini
- Pour Supabase, assurez-vous que `PGSSLMODE=require` est défini

### Migration déjà appliquée

Si une migration est déjà appliquée, le script l'ignore automatiquement :
```
ℹ️  Migration 001_initial_schema already applied.
```

### Hash mismatch

Si vous modifiez une migration déjà appliquée, vous obtiendrez :
```
❌ Hash mismatch for migration XXX
```

**Solution** : Ne modifiez jamais une migration déjà appliquée. Créez une nouvelle migration à la place.

## Automatisation

Les migrations sont automatiquement appliquées sur la branche `main` via GitHub Actions (voir `.github/workflows/database-migrations.yml`).

## Structure des migrations

Les fichiers de migration sont dans le dossier `migrations/` et suivent le format :
- `NNN_description.sql` où NNN est un numéro séquentiel
- Exemple : `001_initial_schema.sql`, `044_require_user_id_for_participants.sql`

## Pour plus d'informations

- Voir `docs/AGENT_MIGRATION_GUIDE.md` pour les détails techniques
- Voir `DATABASE_SETUP.md` pour la configuration de la base de données

