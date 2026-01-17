# RLS Permissions Matrix - Quick Reference

## Permission Legend
- ✅ **Full Access** - Create, Read, Update, Delete
- 👁️ **Read Only** - View data only
- ✏️ **Read + Update** - View and modify
- ➕ **Read + Create** - View and add new
- 🔒 **No Access** - Cannot access
- 👤 **Own Only** - Only their own data

## Core Tables

| Table | Full Admin | Moderator/Facilitator | Regular User |
|-------|------------|----------------------|--------------|
| `profiles` | ✅ Full | 👁️ Project members | 👤 Own profile (✏️ update) |
| `clients` | ✅ Full | 👁️ Their clients | 🔒 No access |
| `projects` | ✅ Full | ✏️ Their projects | 🔒 No access |
| `project_members` | ✅ Full | ✅ Their projects | 👁️ Own memberships |

## Challenge & Ask Tables

| Table | Full Admin | Moderator/Facilitator | Regular User |
|-------|------------|----------------------|--------------|
| `challenges` | ✅ Full | ✅ Project challenges | 👁️ Assigned to them |
| `ask_sessions` | ✅ Full | ✅ Project sessions | 👁️ Participating sessions |
| `ask_participants` | ✅ Full | ✅ Session participants | 👁️ Their sessions + own participation |

## Content Tables

| Table | Full Admin | Moderator/Facilitator | Regular User |
|-------|------------|----------------------|--------------|
| `messages` | ✅ Full | 👁️ + 🗑️ Delete project messages | 👁️ Session messages<br>✅ Own messages |
| `insights` | ✅ Full | ✅ Project insights | 👁️ Session insights<br>➕ Create in sessions |
| `insight_authors` | ✅ Full | 👁️ + ➕ Project insights | 👁️ Session insights |
| `insight_types` | ✅ Full | 👁️ Read only | 👁️ Read only |

## Relationship Tables

| Table | Full Admin | Moderator/Facilitator | Regular User |
|-------|------------|----------------------|--------------|
| `challenge_insights` | ✅ Full | 👁️ + ➕ + 🗑️ Project challenges | 🔒 No access |
| `challenge_foundation_insights` | ✅ Full | ✅ Project challenges | 🔒 No access |
| `kpi_estimations` | ✅ Full | ✅ Project insights | 👁️ Visible insights |

## AI & System Tables

| Table | Full Admin | Moderator/Facilitator | Regular User |
|-------|------------|----------------------|--------------|
| `ai_model_configs` | ✅ Full | 👁️ Read only | 🔒 No access |
| `ai_agents` | ✅ Full | 👁️ Read only | 🔒 No access |
| `ai_agent_logs` | 👁️ All logs | 👁️ Project logs | 🔒 No access |
| `ai_insight_jobs` | ✅ Full | 👁️ Project jobs | 🔒 No access |
| `documents` | ✅ Full | 👁️ Read only | 🔒 No access |

## Claims & Knowledge Tables

| Table | Full Admin | Moderator/Facilitator | Regular User | Service Role |
|-------|------------|----------------------|--------------|--------------|
| `claims` | ✅ Full | Via project access | 🔒 No access | ✅ Full |
| `claim_entities` | ✅ Full | Via project access | 🔒 No access | ✅ Full |
| `knowledge_entities` | ✅ Full | 👁️ Read only | 🔒 No access | ✅ Full |
| `conversation_threads` | ✅ Full | ✅ Project threads | ✅ Own threads | ✅ Full |
| `security_monitoring_queue` | 🔒 No access | 🔒 No access | 🔒 No access | ✅ Full |

**Note:** `claims` and `claim_entities` have RLS enabled as of migration 132. The `security_monitoring_queue` is restricted to `service_role` only for security monitoring purposes.

## Access Determination Flow

### How access is determined for each role:

#### Full Admin
```
Is role = 'admin' or 'full_admin'?
  └─ YES → Full access to everything
```

#### Moderator/Facilitator
```
Is role = 'moderator' or 'facilitator'?
  └─ YES → Check project membership
      └─ Is user in project_members for this project?
          ├─ YES → Access to project and all related data
          └─ NO → No access
```

#### Regular User
```
For Messages/Insights:
  └─ Check ask_participants
      └─ Is user in ask_participants for this session?
          ├─ YES → Can view and create
          └─ NO → No access

For Own Data:
  └─ Is user_id = current user?
      ├─ YES → Can view/edit
      └─ NO → No access
```

## Common Scenarios

### Scenario 1: User wants to view a project
- **Admin:** ✅ Can view all projects
- **Moderator:** ✅ Can view if they're in `project_members`
- **User:** 🔒 Cannot view projects directly

### Scenario 2: User wants to send a message in an Ask session
- **Admin:** ✅ Can send messages anywhere
- **Moderator:** ✅ Can send if they have project access
- **User:** ✅ Can send if they're in `ask_participants`

### Scenario 3: User wants to create a challenge
- **Admin:** ✅ Can create anywhere
- **Moderator:** ✅ Can create in their projects
- **User:** 🔒 Cannot create challenges

### Scenario 4: User wants to view insights
- **Admin:** ✅ Can view all insights
- **Moderator:** ✅ Can view insights in their project sessions
- **User:** ✅ Can view insights in sessions they participate in

### Scenario 5: User wants to manage project members
- **Admin:** ✅ Can manage all members
- **Moderator:** ✅ Can manage members in their projects
- **User:** 🔒 Cannot manage members (can only view own membership)

## Role Assignments

### Setting User Roles

Update the `role` column in the `profiles` table:

```sql
-- Make user a full admin
UPDATE profiles 
SET role = 'admin' 
WHERE email = 'user@example.com';

-- Make user a moderator
UPDATE profiles 
SET role = 'moderator' 
WHERE email = 'user@example.com';

-- Make user a facilitator
UPDATE profiles 
SET role = 'facilitator' 
WHERE email = 'user@example.com';

-- Make user a regular participant
UPDATE profiles 
SET role = 'participant' 
WHERE email = 'user@example.com';
```

### Adding Users to Projects

```sql
-- Add moderator to project
INSERT INTO project_members (project_id, user_id, role)
VALUES ('project-uuid', 'user-uuid', 'moderator');

-- Add regular member to project
INSERT INTO project_members (project_id, user_id, role)
VALUES ('project-uuid', 'user-uuid', 'member');
```

### Adding Users to Ask Sessions

```sql
-- Add participant to ask session
INSERT INTO ask_participants (ask_session_id, user_id, role)
VALUES ('session-uuid', 'user-uuid', 'participant');

-- Add spokesperson to ask session
INSERT INTO ask_participants (ask_session_id, user_id, role, is_spokesperson)
VALUES ('session-uuid', 'user-uuid', 'participant', true);
```

## Security Considerations

### ⚠️ Important Notes

1. **Service Role Bypass**: The service role key bypasses ALL RLS policies
   - Use only in server-side code
   - Never expose to client
   - Use authenticated client for user requests

2. **JWT Required**: RLS policies rely on `auth.uid()` from JWT token
   - Users must be authenticated
   - Anonymous users have no access by default

3. **Role Changes**: Changing a user's role takes effect immediately
   - No cache invalidation needed
   - User must refresh their session

4. **Performance**: Complex policies can impact query performance
   - All foreign keys are indexed
   - Monitor slow queries
   - Consider caching in application layer

## Testing Access

### Quick Test Queries

```sql
-- Check current user's access
SELECT auth.current_user_id();
SELECT auth.is_full_admin();
SELECT auth.is_moderator_or_facilitator();

-- Check project access
SELECT auth.has_project_access('project-uuid-here');

-- Check ask session participation
SELECT auth.is_ask_participant('session-uuid-here');

-- View all policies on a table
SELECT policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'projects';
```

### Testing as Different Users

```sql
-- Impersonate user (requires superuser)
SET ROLE authenticated;
SET request.jwt.claims.sub TO 'user-auth-uuid';

-- Reset to default
RESET ROLE;
```

## Troubleshooting

| Issue | Likely Cause | Solution |
|-------|--------------|----------|
| "Permission denied" error | No matching policy | Check user's role and memberships |
| Can see data shouldn't | Missing policy or too broad | Review USING clause in policy |
| Performance slow | Complex policy queries | Add indexes, simplify policies |
| Policies not applying | Using service role | Switch to authenticated client |
| Changes not reflected | Session cache | User needs to refresh session |

## Quick Commands

```bash
# Apply RLS migration
psql -f migrations/014_enable_rls_security.sql

# Check if RLS is enabled on a table
psql -c "SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'projects';"

# List all policies
psql -c "SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public';"

# Disable RLS on a table (emergency only!)
psql -c "ALTER TABLE public.projects DISABLE ROW LEVEL SECURITY;"

# Re-enable RLS
psql -c "ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;"
```

---

**For detailed explanations, see:** [RLS_SECURITY_GUIDE.md](./RLS_SECURITY_GUIDE.md)

