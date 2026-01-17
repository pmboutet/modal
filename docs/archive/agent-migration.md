# Agent Playbook: Database Migrations

This guide explains how AI or automation agents should work with the migration tooling introduced in `scripts/migrate.js`.

## 1. Prerequisites

- Ensure the repository is checked out with Git history available.
- Export `DATABASE_URL` (or `SUPABASE_MIGRATIONS_URL`) before running the migration runner.
- Supabase connections require TLS, so set `PGSSLMODE=require` and `PGSSLREJECTUNAUTHORIZED=false` unless a managed CA certificate is installed.

## 2. Creating a new migration

1. Determine the next sequential number in the `migrations/` folder (e.g. if `002_*` exists, use `003_*`).
2. Create a descriptive filename: `NNN_short_description.sql` (lowercase, snake_case, ASCII).
3. Wrap all statements in a transaction using the provided template:
   ```sql
   BEGIN;
   -- DDL / DML here
   COMMIT;

   -- //@UNDO
   BEGIN;
   -- reverse statements
   COMMIT;
   ```
4. Prefer `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` or other idempotent guards when modifying live tables.
5. When migrating data, write deterministic `UPDATE` statements so repeated executions remain safe.
6. Never modify an existing migration once committed; add a new file instead.

## 3. Validating migrations locally

```bash
npm run migrate:status   # review pending changes
npm run migrate          # apply locally
```

- If the migration fails, inspect the SQL error, update the file, and rerun.
- The runner enforces a checksum and will abort if a previously applied file changes.

## 4. Preparing pull requests

- Include references to the migration file in the PR description.
- Mention any required data backfills or manual verification steps.
- Ensure unit/integration tests pass before requesting review.

## 5. Coordinating with automation

- The GitHub Actions workflow `.github/workflows/database-migrations.yml` is responsible for applying migrations on `main`.
- The workflow relies on the `SUPABASE_DATABASE_URL` secret; verify it is configured before merging breaking migrations.
- Avoid pushing destructive changes without a prior backup or maintenance window.

Following this playbook keeps database changes auditable and safe for human collaborators and autonomous agents alike.
