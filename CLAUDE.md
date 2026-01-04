# Claude Code Instructions

## Development Workflow

### Before Each Commit
1. **Run all unit tests**: `npm test`
2. **Verify build**: `npm run build`
3. **Check Sentry for errors**: `curl -s 'http://localhost:3000/api/admin/sentry/issues?statsPeriod=24h&limit=10' | jq '.data.issues[] | {title, level, count, lastSeen}'`
4. Only commit if tests pass, build succeeds, and no new critical errors in Sentry

### Bug Investigation Protocol

**IMPORTANT: When a user reports a bug, ALWAYS check Sentry first:**

```bash
# Check recent errors (last 24h)
curl -s 'http://localhost:3000/api/admin/sentry/issues?statsPeriod=24h' | jq '.data.issues[] | {id, title, level, count, culprit, lastSeen}'

# Check all unresolved errors
curl -s 'http://localhost:3000/api/admin/sentry/issues?query=is:unresolved' | jq '.data.issues[] | {id, title, level, count, culprit}'
```

This helps identify:
- Silent database errors that weren't visible to the user
- Stack traces and error context
- How many times the error occurred
- Which endpoint/function caused the issue

### Feature Development Guidelines

When developing new features or modifying existing code:

1. **Update or create unit tests** for any changed functionality
2. **Maintain test coverage** - every new function/module should have corresponding tests
3. **Run tests frequently** during development to catch issues early
4. **Check Sentry after testing** - verify no new errors were introduced

### Test Structure

- Tests are located in `__tests__` directories alongside the code they test
- Use Jest with TypeScript (`ts-jest`)
- React hooks tests require `@jest-environment jsdom` directive

### Commands

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests for specific file
npm test -- --testPathPattern="filename"

# Run build
npm run build
```

### Code Quality

- Fix all TypeScript errors before committing
- Ensure no security vulnerabilities (keep dependencies updated)
- Follow existing code patterns and conventions
- DRY DRY DRY AND DRY !!! Always always ALWAYS check if you can factor your code with the exsiting one. 
## Clean Code Principles

### No Legacy Code - DRY 

**NEVER keep legacy/deprecated code when a new feature replaces it.** When a new functionality replaces an old one:

1. **Remove the old code completely** - don't keep deprecated fields/functions/types "for backward compatibility"
2. **Create a data migration** if needed to convert existing data to the new format
3. **Update all references** across the codebase (types, API routes, components, tests)
4. **Update unit tests** to reflect the new behavior
4. **Stay DRY** try to factor all the code. Don't create duplicate

Rationale: Legacy code accumulates technical debt, causes confusion, and leads to bugs when developers don't know which version to use.

### DRY - Don't Repeat Yourself

**ALWAYS check if similar functionality exists before implementing something new.**

1. **Search first** - Before writing new code, search the codebase for similar functions, utilities, or patterns
2. **Reuse existing code** - If something similar exists, extend or adapt it rather than creating a duplicate
3. **Refactor to factorize** - If you find duplicated logic, refactor it into a shared utility even if it takes more time
4. **Prefer quality over speed** - It's better to spend extra time maintaining a well-factorized codebase than to accumulate duplicated code

When implementing a new feature:
- Search for similar patterns: `grep -r "similar_keyword" src/`
- Check utility files: `src/lib/`, `src/utils/`, `src/hooks/`
- Look for existing components that could be extended
- If refactoring is needed to avoid duplication, do it

Rationale: Duplicated code leads to inconsistent behavior, harder maintenance, and bugs when one copy is fixed but not the others.

### Keep Code Simple and Readable

1. **Short files** - break large files into smaller, focused modules
2. **Single responsibility** - each function/module does one thing well
3. **Clear naming** - variable/function names should be self-documenting
4. **Minimal comments** - code should be clear enough without excessive comments
5. **No dead code** - remove unused functions, variables, and imports

### Unit Tests Are Mandatory

1. **Every new function/module must have tests**
2. **Tests should be maintained** - update tests when code changes
3. **Test edge cases** - null values, empty arrays, error conditions
4. **Run tests before committing** - never commit breaking tests

### Search AGAIN for legacy code 

- search agin for legacy code, duplication, non-dry code BEFORE COMMITTING. 
- IF THERE IS some remaining non-dry code, ALWAYS refactor and make it DRY. 1000% DRY

## Critical Architecture Notes


## Supabase Testing & Debugging

### Environment Setup

Les variables d'environnement sont dans `.env.local`. Pour les charger dans le shell:

```bash
source /Users/pmboutet/Documents/GitHub/agentic-design-flow/.env.local
```

### Requêtes SQL directes sur la base de données

Utiliser `psql` avec `DATABASE_URL` et `PGGSSENCMODE=disable` (nécessaire sur macOS pour éviter les erreurs GSSAPI):

```bash
# Charger l'env et exécuter une requête
source .env.local && PGGSSENCMODE=disable psql "$DATABASE_URL" -c "SELECT * FROM table_name LIMIT 5;"

# Requête multi-lignes
source .env.local && PGGSSENCMODE=disable psql "$DATABASE_URL" -c "
SELECT id, ask_key, status
FROM ask_sessions
WHERE status = 'active'
LIMIT 10;
"
```

**Exemples utiles:**

```bash
# Vérifier les participants d'une ASK session
source .env.local && PGGSSENCMODE=disable psql "$DATABASE_URL" -c "
SELECT id, user_id, participant_name, role, LEFT(invite_token, 16) as token_prefix
FROM ask_participants
WHERE ask_session_id = (SELECT id FROM ask_sessions WHERE ask_key = 'ma-ask-key');
"

# Vérifier les politiques RLS sur une table
source .env.local && PGGSSENCMODE=disable psql "$DATABASE_URL" -c "
SELECT policyname, permissive, roles, cmd
FROM pg_policies
WHERE tablename = 'ask_participants';
"

# Vérifier si RLS est activé sur une table
source .env.local && PGGSSENCMODE=disable psql "$DATABASE_URL" -c "
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'profiles';
"

# Vérifier les profils actifs
source .env.local && PGGSSENCMODE=disable psql "$DATABASE_URL" -c "
SELECT id, email, role, is_active
FROM profiles
WHERE is_active = true
LIMIT 5;
"
```

### Tester les API endpoints avec curl

```bash
# GET request simple
curl -s 'http://localhost:3000/api/ask/ma-ask-key' | jq

# POST avec JSON body
curl -s -X POST 'http://localhost:3000/api/ask/ma-ask-key' \
  -H 'Content-Type: application/json' \
  -d '{"content":"Test message"}'

# Avec invite token (authentification participant)
curl -s -X POST 'http://localhost:3000/api/ask/ma-ask-key' \
  -H 'Content-Type: application/json' \
  -H 'X-Invite-Token: mon-invite-token-32-chars' \
  -d '{"content":"Test message"}'

# Vérifier seulement le status code
curl -s -o /dev/null -w "%{http_code}" 'http://localhost:3000/api/endpoint'
```

### Gestion du serveur de développement

```bash
# Trouver les processus sur le port 3000
lsof -ti:3000

# Tuer les processus sur le port 3000
lsof -ti:3000 | xargs kill -9

# Redémarrer le serveur de dev
lsof -ti:3000 | xargs kill -9 2>/dev/null; npm run dev
```

### Migrations SQL

Les migrations sont dans le dossier `migrations/`. Pour appliquer:

```bash
npm run db:migrate:up
```

**Structure d'une migration:**
- Nommer: `XXX_description.sql` (XXX = numéro séquentiel)
- Inclure `NOTIFY pgrst, 'reload schema';` après création de fonctions RPC pour forcer le rechargement du cache PostgREST

**Exemple de fonction RPC avec SECURITY DEFINER (bypass RLS):**

```sql
CREATE OR REPLACE FUNCTION public.get_ask_session_by_key(p_key text)
RETURNS TABLE (
  ask_session_id uuid,
  ask_key text,
  question text
  -- ... autres colonnes
)
LANGUAGE plpgsql
SECURITY DEFINER  -- Permet de bypasser RLS
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT a.id, a.ask_key, a.question
  FROM ask_sessions a
  WHERE a.ask_key = p_key;
END;
$$;

-- Forcer le rechargement du cache PostgREST
NOTIFY pgrst, 'reload schema';
```

### Debugging RLS (Row Level Security)

Si une requête échoue silencieusement (retourne NULL ou tableau vide):

1. **Vérifier si RLS est activé:**
   ```bash
   source .env.local && PGGSSENCMODE=disable psql "$DATABASE_URL" -c "
   SELECT relrowsecurity FROM pg_class WHERE relname = 'ma_table';
   "
   ```

2. **Lister les policies:**
   ```bash
   source .env.local && PGGSSENCMODE=disable psql "$DATABASE_URL" -c "
   SELECT policyname, roles, cmd, qual FROM pg_policies WHERE tablename = 'ma_table';
   "
   ```

3. **Solutions:**
   - Ajouter une policy pour `service_role`: `CREATE POLICY "Service role full access" ON table FOR ALL TO service_role USING (true);`
   - Désactiver RLS temporairement: `ALTER TABLE ma_table DISABLE ROW LEVEL SECURITY;`
   - Utiliser une fonction RPC avec `SECURITY DEFINER`

### Vérification de l'admin client Supabase

Le client admin utilise `SUPABASE_SERVICE_ROLE_KEY` (voir `src/lib/supabaseAdmin.ts`). Pour vérifier qu'il est configuré:

```bash
source .env.local && if [ -n "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "✅ SUPABASE_SERVICE_ROLE_KEY is set (length: ${#SUPABASE_SERVICE_ROLE_KEY})"
else
  echo "❌ SUPABASE_SERVICE_ROLE_KEY is NOT set"
fi
```

## Sentry Error Monitoring

### Configuration

Sentry est configuré pour capturer automatiquement:
- Les erreurs JavaScript (client et serveur)
- Les erreurs de requêtes DB via `safeQuery` wrapper (`src/lib/supabaseQuery.ts`)
- Les console.error

Variables d'environnement requises:
- `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` - DSN du projet
- `SENTRY_ORG` - Organisation Sentry (flowdesign)
- `SENTRY_PROJECT` - Projet Sentry (javascript-nextjs)
- `SENTRY_AUTH_TOKEN` - Token API pour accéder aux issues (créer sur https://sentry.io/settings/account/api/auth-tokens/)

### Accès aux erreurs Sentry via API

Claude peut consulter les erreurs Sentry via ces endpoints:

```bash
# Lister les issues non résolues (derniers 14 jours)
curl -s 'http://localhost:3000/api/admin/sentry/issues' | jq

# Filtrer par query Sentry
curl -s 'http://localhost:3000/api/admin/sentry/issues?query=is:unresolved+level:error' | jq

# Limiter le nombre de résultats
curl -s 'http://localhost:3000/api/admin/sentry/issues?limit=10' | jq

# Changer la période (24h, 7d, 14d, 30d)
curl -s 'http://localhost:3000/api/admin/sentry/issues?statsPeriod=24h' | jq

# Détails d'une issue spécifique (avec dernier event)
curl -s 'http://localhost:3000/api/admin/sentry/issues/ISSUE_ID' | jq
```

### Utilisation du wrapper safeQuery

Toutes les requêtes Supabase critiques doivent utiliser `safeQuery` pour garantir le tracking des erreurs:

```typescript
import { safeQuery, addDbBreadcrumb } from "@/lib/supabaseQuery";

// Ajouter un breadcrumb pour le contexte
addDbBreadcrumb("Fetching user profile", { userId });

// Utiliser safeQuery - les erreurs sont automatiquement envoyées à Sentry
const profile = await safeQuery<Profile>(
  () => supabase.from("profiles").select("*").eq("id", userId).single(),
  {
    table: "profiles",
    operation: "select",
    expectData: true,  // Alerte si aucune donnée retournée
    filters: { id: userId },
    description: "Fetch user profile by ID",
  }
);
```

### Notes

- Les warnings de dépréciation Node.js (comme `url.parse`) sont automatiquement filtrés car ils viennent des dépendances
- Pour tester Sentry manuellement, utiliser `Sentry.captureException(new Error("test"))` dans une route
