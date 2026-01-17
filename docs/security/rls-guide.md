# Row Level Security (RLS) Guide

This guide explains the Row Level Security implementation for the application database.

## Overview

The RLS system implements three permission levels:

1. **Full Admin** - Complete access to all database tables and records
2. **Moderator/Facilitator** - Access to clients and projects they're associated with, plus all related data
3. **Regular Users** - Access to messages and insights they're associated with

## Permission Levels

### 1. Full Admin (`role = 'admin'` or `role = 'full_admin'`)

Full admins have unrestricted access to:
- All tables
- All CRUD operations (Create, Read, Update, Delete)
- All records regardless of ownership or association

**Use cases:**
- System administrators
- Platform maintainers
- Data analysts (read-only admin could be added)

### 2. Moderator/Facilitator (`role = 'moderator'` or `role = 'facilitator'`)

Moderators and facilitators have access to:

**Full Access (Read, Update, Create, Delete):**
- Projects they're members of (via `project_members`)
- Challenges in their projects
- Ask sessions in their projects
- Ask participants in their sessions
- Project members in their projects
- Messages in their sessions (delete only)
- Insights in their sessions
- KPI estimations for insights in their sessions
- Challenge-insight relationships

**Read-Only Access:**
- Clients for their projects
- AI model configurations
- AI agents
- AI logs for their sessions
- Documents

**Use cases:**
- Project managers
- Workshop facilitators
- Team leads

### 3. Regular Users (all other roles, e.g., `role = 'participant'`)

Regular users have access to:

**Read Access:**
- Their own profile
- Profiles of other participants in their sessions
- Projects they're members of
- Challenges assigned to them
- Ask sessions they participate in
- Messages in sessions they participate in
- Insights in sessions they participate in
- Insights they authored
- Ask participants in their sessions
- KPI estimations for insights they can see

**Create Access:**
- Messages in sessions they participate in
- Insights in sessions they participate in

**Update/Delete Access:**
- Their own profile (update only)
- Their own messages
- Their own project memberships (view only)

**Use cases:**
- Workshop participants
- Survey respondents
- Team members

## Helper Functions

The RLS system uses several helper functions (all in the `auth` schema):

### `auth.is_full_admin()`
Returns `true` if the current user has the `admin` or `full_admin` role.

### `auth.is_moderator_or_facilitator()`
Returns `true` if the current user has the `moderator` or `facilitator` role.

### `auth.current_user_id()`
Returns the profile UUID of the current authenticated user.

### `auth.has_project_access(project_uuid UUID)`
Returns `true` if the current user is a member of the specified project (via `project_members` table).

### `auth.has_client_access(client_uuid UUID)`
Returns `true` if the current user has access to any project belonging to the specified client.

### `auth.is_ask_participant(ask_session_uuid UUID)`
Returns `true` if the current user is a participant in the specified ask session (via `ask_participants` table).

## Table-by-Table Breakdown

### Core Tables

#### `profiles`
- **Admins:** Full access
- **Moderators:** Can view profiles of users in their projects
- **Users:** Can view and update their own profile

#### `clients`
- **Admins:** Full access
- **Moderators:** Read-only for clients they have project access to
- **Users:** No access

#### `projects`
- **Admins:** Full access
- **Moderators:** View and update projects they're members of
- **Users:** No direct access (can see via `project_members`)

#### `project_members`
- **Admins:** Full access
- **Moderators:** Full CRUD for their projects
- **Users:** Can view their own memberships

### Challenge & Ask Tables

#### `challenges`
- **Admins:** Full access
- **Moderators:** Full CRUD for challenges in their projects
- **Users:** Can view challenges assigned to them

#### `ask_sessions`
- **Admins:** Full access
- **Moderators:** Full CRUD for ask sessions in their projects
- **Users:** Can view sessions they participate in

#### `ask_participants`
- **Admins:** Full access
- **Moderators:** Full CRUD for participants in their project sessions
- **Users:** Can view participants in their sessions and their own participation

### Content Tables

#### `messages`
- **Admins:** Full access
- **Moderators:** Read and delete for their project sessions
- **Users:** Read for their sessions, create/update/delete their own messages

#### `insights`
- **Admins:** Full access
- **Moderators:** Full CRUD for insights in their project sessions
- **Users:** Read insights in their sessions or ones they authored, create in their sessions

#### `insight_authors`
- **Admins:** Full access
- **Moderators:** View and create for their project insights
- **Users:** View for insights in their sessions

#### `kpi_estimations`
- **Admins:** Full access
- **Moderators:** Full CRUD for estimations in their project insights
- **Users:** View for insights they can see

### Relationship Tables

#### `challenge_insights`
- **Admins:** Full access
- **Moderators:** View, create, and delete for their project challenges
- **Users:** No direct access

#### `challenge_foundation_insights`
- **Admins:** Full access
- **Moderators:** Full CRUD for their project challenges
- **Users:** No direct access

### AI & System Tables

#### `ai_model_configs`
- **Admins:** Full access
- **Moderators:** Read-only
- **Users:** No access

#### `ai_agents`
- **Admins:** Full access
- **Moderators:** Read-only
- **Users:** No access

#### `ai_agent_logs`
- **Admins:** Read all logs
- **Moderators:** Read logs for their project sessions
- **Users:** No access

#### `ai_insight_jobs`
- **Admins:** Full access
- **Moderators:** Read for their project sessions
- **Users:** No access

#### `documents`
- **Admins:** Full access
- **Moderators:** Read-only
- **Users:** No access

#### `insight_types`
- **Admins:** Full access
- **Everyone:** Read-only (reference data)

## Migration Instructions

### Running the Migration

```bash
# Using psql
psql -h your-host -U your-user -d your-database -f migrations/014_enable_rls_security.sql

# Or using Supabase CLI
supabase db push
```

### Pre-Migration Checklist

Before running the migration:

1. ✅ **Backup your database** - Always backup before applying RLS
2. ✅ **Review existing roles** - Ensure users have appropriate roles in the `profiles` table
3. ✅ **Check service role usage** - Service role bypasses RLS, use carefully
4. ✅ **Test with non-admin account** - Verify policies work as expected
5. ✅ **Update application code** - Ensure your app properly authenticates users

### Post-Migration Testing

After migration, test each permission level:

```sql
-- Test as admin
SET ROLE admin_user;
SELECT count(*) FROM projects; -- Should see all

-- Test as moderator
SET ROLE moderator_user;
SELECT count(*) FROM projects; -- Should see only their projects

-- Test as regular user
SET ROLE regular_user;
SELECT count(*) FROM messages; -- Should see only their messages
```

## Important Notes

### Service Role Access

The **service role** (used in backend API calls) bypasses RLS entirely. Use it only when:
- Performing system operations
- Running administrative tasks
- Executing cron jobs

For user-initiated requests, always use the **authenticated role** with the user's JWT.

### Anonymous Access

By default, there are **no policies for anonymous users** (`auth.uid()` is NULL). If you need to support anonymous access:

```sql
-- Example: Allow anonymous users to view public projects
CREATE POLICY "Anonymous users can view public projects"
  ON public.projects FOR SELECT
  USING (status = 'public' AND auth.uid() IS NULL);
```

### Performance Considerations

RLS policies are evaluated on every query. For optimal performance:

1. **Index foreign keys** - Ensure all foreign keys used in policies are indexed
2. **Use efficient joins** - Helper functions use EXISTS clauses for efficiency
3. **Monitor slow queries** - Watch for policy-related performance issues
4. **Consider materialized views** - For complex permission checks

### Security Best Practices

1. **Principle of Least Privilege** - Users only get access they need
2. **Defense in Depth** - RLS is a last line of defense, validate in application too
3. **Audit Regularly** - Review policies and permissions periodically
4. **Use SECURITY DEFINER carefully** - Helper functions use this, audit them
5. **Test Thoroughly** - Test all permission levels before deploying

## Troubleshooting

### "Permission Denied" Errors

If users can't access data they should be able to:

1. Check their role in the `profiles` table
2. Verify they're in `project_members` for the relevant project
3. Verify they're in `ask_participants` for the relevant session
4. Check if they're using the correct authentication token
5. Ensure the table has RLS enabled and has policies

### Testing Policies

To test a specific policy:

```sql
-- Check what the helper functions return
SELECT auth.current_user_id();
SELECT auth.is_full_admin();
SELECT auth.has_project_access('project-uuid-here');

-- View active policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Disable RLS temporarily (for debugging only!)
ALTER TABLE public.projects DISABLE ROW LEVEL SECURITY;
-- Remember to re-enable after testing
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
```

### Common Issues

**Issue:** Users can't see data even with correct permissions
- **Solution:** Check if they have an active session with valid JWT
- **Solution:** Verify `auth.uid()` returns their user ID

**Issue:** Policies too restrictive
- **Solution:** Review and adjust policy USING/WITH CHECK clauses
- **Solution:** Consider adding OR conditions for edge cases

**Issue:** Performance degradation
- **Solution:** Add indexes on foreign key columns
- **Solution:** Simplify policy logic
- **Solution:** Use database query analysis (EXPLAIN ANALYZE)

## Extending the RLS System

### Adding New Roles

To add a new role (e.g., "observer"):

```sql
-- 1. Create helper function
CREATE OR REPLACE FUNCTION auth.is_observer()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE auth_id = auth.uid() 
    AND role = 'observer'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Add policies
CREATE POLICY "Observers can view projects"
  ON public.projects FOR SELECT
  USING (auth.is_observer());
```

### Adding New Tables

When adding new tables:

```sql
-- 1. Enable RLS
ALTER TABLE public.new_table ENABLE ROW LEVEL SECURITY;

-- 2. Add admin policy
CREATE POLICY "Full admins can manage new_table"
  ON public.new_table FOR ALL
  USING (auth.is_full_admin())
  WITH CHECK (auth.is_full_admin());

-- 3. Add role-specific policies as needed
```

### Modifying Existing Policies

To update a policy:

```sql
-- Drop the old policy
DROP POLICY "policy_name" ON public.table_name;

-- Create the new version
CREATE POLICY "policy_name"
  ON public.table_name FOR SELECT
  USING (new_condition);
```

## Database Schema & RLS Relationship

The RLS system relies on these key relationships:

```
profiles (auth_id -> auth.users.id)
    ↓
project_members (user_id -> profiles.id, project_id -> projects.id)
    ↓
projects (client_id -> clients.id)
    ↓
challenges, ask_sessions (project_id -> projects.id)
    ↓
ask_participants (ask_session_id -> ask_sessions.id, user_id -> profiles.id)
    ↓
messages, insights (ask_session_id -> ask_sessions.id)
```

This hierarchy determines access:
- **Admins:** Access all
- **Moderators:** Access via `project_members`
- **Users:** Access via `ask_participants`

## Recent Security Updates

### Migration 131: Security Fixes - RLS and Search Path

This migration addresses security vulnerabilities in SQL functions and adds proper RLS policies for new tables.

**Key Changes:**
1. **search_path Security**: All helper functions now use `SET search_path = public` to prevent search_path injection attacks
2. **Conversation Threads**: Added RLS policy for authenticated users to manage their conversation threads
3. **Updated `is_ask_participant()`**: Function now checks `allow_auto_registration` instead of deprecated `is_anonymous` column
4. **Vector Search Functions**: Fixed `find_similar_insights()`, `find_similar_entities()`, `find_similar_syntheses()` with proper search_path
5. **Token Access Functions**: Updated `get_ask_session_by_token()`, `get_ask_participants_by_token()`, `get_ask_messages_by_token()` with security fixes

### Migration 132: Enable RLS on Claims Tables

**Problem:** The `claims` and `claim_entities` tables had RLS policies defined but RLS was not enabled on the tables themselves.

**Solution:**
```sql
ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_entities ENABLE ROW LEVEL SECURITY;
```

Also fixed the `security_monitoring_queue` policy which was incorrectly assigned to the `public` role instead of `service_role`.

### Migration 133: Secure User Signup (handle_new_user Trigger)

**Problem:** When an admin creates a profile without a password (auth_id = NULL), and the user later signs up themselves, the trigger caught the unique_violation and silently returned. This created an orphaned auth user without a linked profile.

**Security Risk:** Auto-linking profiles would allow an attacker to sign up with a victim's email and inherit their profile/role.

**Solution:** On unique_violation, the function now raises an error to fail the signup transaction:
```sql
WHEN unique_violation THEN
  RAISE EXCEPTION 'A profile with this email already exists. Please sign in or use password reset.'
    USING ERRCODE = 'unique_violation';
```

### Session Isolation for Individual Parallel Mode

The `GET /api/ask/[key]` endpoint now enforces strict message isolation for `individual_parallel` conversation mode:
- In individual_parallel mode, users only see messages from their own conversation thread
- Legacy messages without a thread ID are not shown to maintain isolation
- Shared/collaborative modes retain backward compatibility with legacy messages

## Support & Maintenance

For issues or questions:
1. Check this guide first
2. Review the policy definitions in `014_enable_rls_security.sql`
3. Review recent security migrations (131-133)
4. Test using the troubleshooting queries above
5. Check Supabase/PostgreSQL documentation
6. Contact your database administrator

