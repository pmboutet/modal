import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getAdminSupabaseClient } from '@/lib/supabaseAdmin'

/**
 * OAuth callback route
 * Handles the redirect from OAuth providers (Google, GitHub, etc.)
 * Exchanges the code for a session and redirects to the app
 */
export async function GET(request: NextRequest) {
  console.log('[Callback] ========== OAuth Callback Started ==========')

  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const nextParam = requestUrl.searchParams.get('next')
  const redirectTo = requestUrl.searchParams.get('redirect_to') || nextParam
  const error_description = requestUrl.searchParams.get('error_description')

  // Extract askKey or token directly from URL params first (from emailRedirectTo)
  // This handles the case where Supabase redirects to /auth/callback?token=XXX&code=YYY
  let askKey: string | null = requestUrl.searchParams.get('key')
  let token: string | null = requestUrl.searchParams.get('token')

  console.log(`[Callback] Params: code=${code ? 'exists' : 'none'}, next=${nextParam}, redirectTo=${redirectTo}, token=${token ? 'exists' : 'none'}, key=${askKey || 'none'}, error=${error_description}`)

  // Log incoming cookies
  const allCookies = request.cookies.getAll()
  console.log(`[Callback] Incoming cookies: ${allCookies.length}`)
  allCookies.forEach(c => console.log(`[Callback] Cookie IN: ${c.name}`))

  // If not found in direct params, try extracting from redirect URL (legacy support)
  if (!askKey && !token && redirectTo) {
    try {
      const redirectUrl = new URL(redirectTo, requestUrl.origin)
      askKey = redirectUrl.searchParams.get('key')
      token = redirectUrl.searchParams.get('token')
    } catch {
      // If redirectTo is not a full URL, try parsing it as a path with query
      const keyMatch = redirectTo.match(/[?&]key=([^&]+)/)
      const tokenMatch = redirectTo.match(/[?&]token=([^&]+)/)
      if (keyMatch) {
        askKey = keyMatch[1]
      }
      if (tokenMatch) {
        token = tokenMatch[1]
      }
    }
  }

  // Handle OAuth errors
  if (error_description) {
    console.error('OAuth error:', error_description)
    return NextResponse.redirect(
      new URL(`/auth/login?error=${encodeURIComponent(error_description)}`, request.url)
    )
  }

  // Store cookies to be set on the response
  const cookiesToSet: Array<{ name: string; value: string; options: Record<string, unknown> }> = []

  if (code) {
    console.log('[Callback] Exchanging code for session...')

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            const cookies = request.cookies.getAll()
            console.log(`[Callback] getAll called, returning ${cookies.length} cookies`)
            return cookies
          },
          setAll(cookies) {
            console.log(`[Callback] setAll called with ${cookies.length} cookies`)
            // Collect cookies to set on the redirect response
            cookies.forEach(({ name, value, options }) => {
              console.log(`[Callback] Cookie to set: ${name} (${value.length} chars)`)
              cookiesToSet.push({ name, value, options: options || {} })
            })
          },
        },
      }
    )

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      console.error('[Callback] exchangeCodeForSession ERROR:', error.message)
      return NextResponse.redirect(
        new URL(`/auth/login?error=${encodeURIComponent(error.message)}`, request.url)
      )
    }

    console.log(`[Callback] exchangeCodeForSession SUCCESS: user=${data.session?.user?.email}, access_token=${data.session?.access_token ? 'exists' : 'none'}`)
    console.log(`[Callback] Cookies collected for redirect: ${cookiesToSet.length}`)
    cookiesToSet.forEach(c => console.log(`[Callback] Will set cookie: ${c.name}`))

    // Ensure profile exists for the authenticated user
    // This handles cases where the database trigger failed or wasn't installed
    if (data.session?.user) {
      const authUser = data.session.user
      try {
        const adminSupabase = getAdminSupabaseClient()

        // Check if profile exists
        const { data: existingProfile, error: checkError } = await adminSupabase
          .from('profiles')
          .select('id')
          .eq('auth_id', authUser.id)
          .maybeSingle()

        if (checkError) {
          console.error('[Callback] Error checking profile:', checkError.message)
        } else if (!existingProfile) {
          console.log('[Callback] No profile found, creating one for:', authUser.email)

          // Extract user metadata
          const metadata = authUser.user_metadata || {}
          const firstName = metadata.first_name || metadata.firstName || metadata.given_name || null
          const lastName = metadata.last_name || metadata.lastName || metadata.family_name || null
          const fullName = metadata.full_name || metadata.fullName || metadata.name ||
            [firstName, lastName].filter(Boolean).join(' ') || null

          // Create profile
          const { error: insertError } = await adminSupabase
            .from('profiles')
            .insert({
              auth_id: authUser.id,
              email: authUser.email?.toLowerCase(),
              first_name: firstName,
              last_name: lastName,
              full_name: fullName,
              role: 'participant',
              is_active: true
            })

          if (insertError) {
            // If it's a unique violation, profile was created by another process (race condition)
            if (insertError.code === '23505') {
              console.log('[Callback] Profile already exists (race condition), continuing')
            } else {
              console.error('[Callback] Error creating profile:', insertError.message)
            }
          } else {
            console.log('[Callback] Profile created successfully for:', authUser.email)
          }
        } else {
          console.log('[Callback] Profile already exists for:', authUser.email)
        }
      } catch (profileError) {
        // Don't fail the auth flow if profile creation fails
        console.error('[Callback] Profile creation error:', profileError)
      }
    }
  } else {
    console.log('[Callback] No code provided, skipping exchange')
  }

  // Helper function to create redirect with cookies
  const createRedirectWithCookies = (url: URL) => {
    console.log(`[Callback] Creating redirect to: ${url.toString()}`)
    const response = NextResponse.redirect(url)
    // Set all cookies collected during session exchange
    console.log(`[Callback] Setting ${cookiesToSet.length} cookies on response`)
    cookiesToSet.forEach(({ name, value, options }) => {
      console.log(`[Callback] Setting cookie on response: ${name}`)
      // Ensure cookies are accessible from JavaScript (httpOnly: false)
      // and from all routes (path: '/')
      const cookieOptions = {
        ...options,
        path: '/',
        httpOnly: false, // Required for browser client to read auth tokens
      } as Parameters<typeof response.cookies.set>[2]
      response.cookies.set(name, value, cookieOptions)
    })
    // Log response cookies
    const responseCookies = response.cookies.getAll()
    console.log(`[Callback] Response now has ${responseCookies.length} cookies`)
    responseCookies.forEach(c => console.log(`[Callback] Response cookie: ${c.name}`))
    return response
  }

  // Priority: If token is present, redirect to ask session page with token
  if (token) {
    return createRedirectWithCookies(new URL(`/?token=${token}`, requestUrl.origin))
  }

  // Priority: If askKey is present, redirect to ask session page
  if (askKey) {
    return createRedirectWithCookies(new URL(`/?key=${askKey}`, requestUrl.origin))
  }

  // New users go to onboarding; the onboarding page redirects admins to /admin
  const fallbackDestination = '/onboarding'

  const safeNext = (() => {
    if (!nextParam) {
      return fallbackDestination
    }

    try {
      const candidateUrl = new URL(nextParam, requestUrl.origin)

      if (candidateUrl.origin !== requestUrl.origin) {
        return fallbackDestination
      }

      const normalizedDestination = `${candidateUrl.pathname}${candidateUrl.search}${candidateUrl.hash}`

      if (normalizedDestination === '' || normalizedDestination === '/') {
        return fallbackDestination
      }

      return normalizedDestination
    } catch {
      return fallbackDestination
    }
  })()

  // Redirect to the intended destination (default: admin) with cookies
  return createRedirectWithCookies(new URL(safeNext, requestUrl.origin))
}

