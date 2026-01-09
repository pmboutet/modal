-- ============================================================================
-- MIGRATION 133: Fix handle_new_user trigger - reject signup if profile exists
-- ============================================================================
--
-- Problem: When an admin creates a profile without a password (auth_id = NULL),
-- and the user later signs up themselves, the trigger catches the unique_violation
-- and silently returns. This creates an orphaned auth user without a linked profile.
--
-- Solution: On unique_violation, RAISE an error to fail the signup transaction.
-- The user should contact admin or use password reset instead.
--
-- Security note: Auto-linking profiles would be a security vulnerability - an
-- attacker could sign up with a victim's email and inherit their profile/role.
--

BEGIN;

-- Recreate handle_new_user function with proper error handling
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  INSERT INTO public.profiles (auth_id, email, first_name, last_name, full_name, role, is_active)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'first_name', new.raw_user_meta_data->>'firstName'),
    COALESCE(new.raw_user_meta_data->>'last_name', new.raw_user_meta_data->>'lastName'),
    COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'fullName'),
    COALESCE(new.raw_user_meta_data->>'role', 'participant'),
    true
  );
  RETURN new;
EXCEPTION
  WHEN unique_violation THEN
    -- Profile already exists - reject signup for security
    -- User should contact admin or use password reset
    RAISE EXCEPTION 'A profile with this email already exists. Please sign in or use password reset.'
      USING ERRCODE = 'unique_violation';
  WHEN OTHERS THEN
    -- Log the error but don't fail the signup for other errors
    RAISE WARNING 'handle_new_user: Failed to create profile for user %: %', new.id, SQLERRM;
    RETURN new;
END;
$$;

-- Ensure the trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMIT;

-- //@UNDO
BEGIN;

-- Revert to previous version (silent return on unique_violation)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  INSERT INTO public.profiles (auth_id, email, first_name, last_name, full_name, role, is_active)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'first_name', new.raw_user_meta_data->>'firstName'),
    COALESCE(new.raw_user_meta_data->>'last_name', new.raw_user_meta_data->>'lastName'),
    COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'fullName'),
    COALESCE(new.raw_user_meta_data->>'role', 'participant'),
    true
  );
  RETURN new;
EXCEPTION
  WHEN unique_violation THEN
    -- Profile already exists (e.g., created by admin), just return
    RETURN new;
  WHEN OTHERS THEN
    -- Log the error but don't fail the signup
    RAISE WARNING 'handle_new_user: Failed to create profile for user %: %', new.id, SQLERRM;
    RETURN new;
END;
$$;

COMMIT;
