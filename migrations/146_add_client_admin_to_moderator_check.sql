-- Migration 146: Add client_admin to is_moderator_or_facilitator check
-- client_admin should be able to manage ASKs for their assigned clients/projects

CREATE OR REPLACE FUNCTION public.is_moderator_or_facilitator()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE auth_id = auth.uid()
    AND role IN ('moderator', 'facilitator', 'client_admin')
    AND is_active = true
  );
END;
$$;

-- Force PostgREST to reload the schema cache
NOTIFY pgrst, 'reload schema';
