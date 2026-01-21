-- Migration 144: Fix gen_random_bytes schema reference
-- The gen_random_bytes function is in the 'extensions' schema, not 'public'
-- This fixes the error: "function gen_random_bytes(integer) does not exist"

-- Drop and recreate the trigger function with the correct schema reference
CREATE OR REPLACE FUNCTION public.generate_invite_token()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.invite_token IS NULL THEN
    NEW.invite_token := encode(extensions.gen_random_bytes(16), 'hex');
  END IF;
  RETURN NEW;
END;
$$;

-- Force PostgREST to reload the schema cache
NOTIFY pgrst, 'reload schema';
