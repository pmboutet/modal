/**
 * Gets the base URL for magic links
 * 
 * Priority:
 * 1. NEXT_PUBLIC_APP_URL (configured in Vercel or .env.local)
 * 2. localhost:3000 (fallback for local dev)
 */
function getBaseUrl(): string {
  // Use NEXT_PUBLIC_APP_URL if configured (works for both dev and production)
  if (process.env.NEXT_PUBLIC_APP_URL) {
    // Remove trailing slash to avoid double slashes in URLs
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
  }

  // Fallback to localhost for local development
  return 'http://localhost:3000';
}

/**
 * Generates a magic link URL for a participant without sending an email.
 * This can be used to display links that admins can copy/paste.
 *
 * @param email - Email address for the participant (optional, for display purposes)
 * @param askKey - Ask session key (kept for backward compatibility but not used in URL)
 * @param participantToken - Unique token for the participant (required for URL generation)
 * @returns The magic link URL
 * @throws Error if participantToken is not provided
 */
export function generateMagicLinkUrl(
  email: string,
  askKey: string,
  participantToken?: string
): string {
  const baseUrl = getBaseUrl();

  // Token is required for participant access
  if (!participantToken) {
    throw new Error('participantToken is required to generate a magic link URL');
  }

  return `${baseUrl}/?token=${participantToken}`;
}

/**
 * Generates the email redirect URL for Supabase auth.
 * This URL goes through /auth/callback to exchange the code for a session,
 * then redirects to the final destination with the ASK token.
 *
 * @param askKey - Ask session key (kept for backward compatibility but not used)
 * @param participantToken - Unique token for the participant (required)
 * @returns The auth callback URL with token preserved
 * @throws Error if participantToken is not provided
 */
export function generateEmailRedirectUrl(
  askKey: string,
  participantToken?: string
): string {
  const baseUrl = getBaseUrl();

  // Token is required for email redirect
  if (!participantToken) {
    throw new Error('participantToken is required for email redirect URL');
  }

  // Use path-based token to avoid Supabase stripping query params
  // The callback will extract the token from the path and redirect to /?token=XXX
  return `${baseUrl}/auth/callback/token/${participantToken}`;
}

/**
 * Sends a magic link email to the specified email address.
 * The link will redirect to the ask session page.
 * 
 * @param email - Email address to send magic link to
 * @param askKey - Ask session key for the redirect URL
 * @param projectId - Project ID (optional, for context)
 * @returns Success status and any error message
 */
export async function sendMagicLink(
  email: string,
  askKey: string,
  projectId?: string,
  participantToken?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const normalizedEmail = email.toLowerCase().trim();

    // Build the redirect URL - goes through /auth/callback to exchange code for session
    // Then redirects to the ASK page with token/key preserved
    const redirectUrl = generateEmailRedirectUrl(askKey, participantToken);
    console.log(`[MagicLink] Sending magic link to ${normalizedEmail} with redirectUrl: ${redirectUrl}, participantToken: ${participantToken ? 'present' : 'missing'}`);

    // Create a client with anon key for sending OTP
    // This will send a magic link email via Supabase's built-in email service
    const { createClient } = await import('@supabase/supabase-js');
    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: { persistSession: false }
      }
    );

    // Send OTP email (magic link email)
    // When user clicks the link, Supabase will redirect them to the redirectUrl
    const { error: otpError } = await anonClient.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });

    if (otpError) {
      console.error(`Failed to send magic link email to ${normalizedEmail}:`, otpError);
      return { success: false, error: otpError.message };
    }

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error sending magic link to ${email}:`, error);
    return { success: false, error: errorMessage };
  }
}
