# Supabase Auth Migration Guide

## Overview

This project has been migrated from a custom user table (`public.users`) to Supabase's built-in authentication system using `auth.users` with a companion `public.profiles` table for business data.

## Architecture Changes

### Before
```
public.users (id, email, password_hash, first_name, last_name, role, ...)
```

### After
```
auth.users (id, email, encrypted_password, ...)  ← Managed by Supabase
    ↓ (trigger)
public.profiles (id, auth_id → auth.users.id, first_name, last_name, role, ...)
```

## Key Changes

### 1. Database Schema

- **Migration 010**: Renames `public.users` → `public.profiles` and adds `auth_id` column
- **Migration 011**: Enables Row Level Security (RLS) on all tables with role-based policies
- **Trigger**: Auto-creates profiles when users sign up via `handle_new_user()` function

### 2. API Routes

All user management routes have been migrated:
- `/api/admin/users` → `/api/admin/profiles`
- `/api/admin/users/[id]` → `/api/admin/profiles/[id]`

### 3. Authentication

New authentication system using Supabase Auth:
- `src/lib/supabaseClient.ts` - Browser client with auth support
- `src/components/auth/AuthProvider.tsx` - Auth context provider
- `src/app/auth/login/page.tsx` - Login page
- `src/app/auth/signup/page.tsx` - Signup page
- `src/middleware.ts` - Route protection middleware

### 4. Row Level Security (RLS)

All tables now have RLS enabled with policies that:
- Allow users to view their own data
- Allow users to view data from their client/projects
- Grant admins full access
- Restrict sensitive operations to authorized roles

## Running the Migration

### Prerequisites

1. Install the new dependency:
```bash
npm install @supabase/ssr
```

2. Ensure environment variables are set:
```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Step-by-Step Migration

1. **Run Database Migrations**
```bash
npm run migrate
```

This will execute:
- Migration 010: Rename users → profiles
- Migration 011: Enable RLS policies

2. **Seed Test Users**
```bash
node scripts/seed-auth-users.js
```

This creates test users in Supabase Auth:
- pierre.marie@techcorp.com / Password123!
- sarah.manager@techcorp.com / Password123!
- dev.team@techcorp.com / Password123!
- admin@techcorp.com / Admin123!

3. **Test Authentication**

Visit the following URLs:
- `/auth/login` - Sign in page
- `/auth/signup` - Sign up page
- `/admin` - Protected admin dashboard (requires login)

## Development Notes

### Creating New Users

Users can be created in two ways:

1. **Self-signup** (via `/auth/signup`):
   - User signs up with email/password
   - Profile auto-created via trigger
   - Email confirmation can be required (configure in Supabase)

2. **Admin creation** (via `/api/admin/profiles`):
   - Admins can create users with passwords
   - Profile is created with the auth user
   - Email is auto-confirmed

### Accessing User Data

In client components:
```tsx
import { useAuth } from '@/components/auth/AuthProvider';

function MyComponent() {
  const { user, profile, status } = useAuth();
  
  if (status === 'loading') return <div>Loading...</div>;
  if (status === 'signed-out') return <div>Please sign in</div>;
  
  return <div>Hello, {profile?.fullName}!</div>;
}
```

In API routes:
```ts
import { getAdminSupabaseClient } from '@/lib/supabaseAdmin';

const supabase = getAdminSupabaseClient();
const { data } = await supabase
  .from('profiles')
  .select('*')
  .eq('auth_id', userId);
```

### Row Level Security

When using the browser client, RLS policies automatically apply based on the authenticated user. When using the admin client (service role key), RLS is bypassed.

**Important**: Always use the browser client in client components and the admin client only in API routes.

## Rollback

If you need to rollback the migration:

```bash
# This will restore the users table and remove auth integration
node scripts/migrate.js down
```

## Troubleshooting

### "Profile not found" errors
- Check that the `handle_new_user()` trigger is installed
- Verify that profiles were created for existing auth users
- Run the seed script to create test profiles

### RLS blocking legitimate requests
- Verify you're using the correct Supabase client (browser vs admin)
- Check the user's role in the profiles table
- Review the RLS policies in migration 011

### Authentication redirects not working
- Ensure middleware.ts is properly configured
- Check that NEXT_PUBLIC_SUPABASE_URL is set
- Verify cookies are being set correctly

## Security Considerations

1. **Service Role Key**: Never expose `SUPABASE_SERVICE_ROLE_KEY` in client code
2. **RLS Policies**: Always enable RLS on new tables
3. **Admin Access**: Limit `full_admin` role to trusted users
4. **Password Requirements**: Enforce strong passwords (min 6 characters currently)
5. **Email Confirmation**: Consider enabling email confirmation in production

## Next Steps

- [ ] Configure email templates in Supabase dashboard
- [ ] Enable email confirmation for production
- [ ] Add password reset functionality
- [ ] Implement OAuth providers (Google, GitHub, etc.)
- [ ] Add profile picture upload
- [ ] Implement 2FA for admin accounts

