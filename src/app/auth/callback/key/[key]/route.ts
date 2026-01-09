import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getAdminSupabaseClient } from '@/lib/supabaseAdmin'

/**
 * Path-based OAuth callback for ask keys
 * Handles: /auth/callback/key/[key]?code=XXX
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const resolvedParams = await params
  const askKey = resolvedParams.key

  console.log('[Callback/Key] ========== OAuth Callback Started ==========')
  console.log(`[Callback/Key] Ask key from path: ${askKey}`)

  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const error_description = requestUrl.searchParams.get('error_description')

  // Handle OAuth errors
  if (error_description) {
    console.error('[Callback/Key] OAuth error:', error_description)
    return NextResponse.redirect(
      new URL(`/auth/login?error=${encodeURIComponent(error_description)}`, request.url)
    )
  }

  // Store cookies to be set on the response
  const cookiesToSet: Array<{ name: string; value: string; options: Record<string, unknown> }> = []

  if (code) {
    console.log('[Callback/Key] Exchanging code for session...')

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookies) {
            cookies.forEach(({ name, value, options }) => {
              cookiesToSet.push({ name, value, options: options || {} })
            })
          },
        },
      }
    )

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      console.error('[Callback/Key] exchangeCodeForSession ERROR:', error.message)
      return NextResponse.redirect(
        new URL(`/auth/login?error=${encodeURIComponent(error.message)}`, request.url)
      )
    }

    console.log(`[Callback/Key] Session created for: ${data.session?.user?.email}`)

    // Ensure profile exists
    if (data.session?.user) {
      const authUser = data.session.user
      try {
        const adminSupabase = getAdminSupabaseClient()
        const { data: existingProfile } = await adminSupabase
          .from('profiles')
          .select('id')
          .eq('auth_id', authUser.id)
          .maybeSingle()

        if (!existingProfile) {
          const metadata = authUser.user_metadata || {}
          const firstName = metadata.first_name || metadata.firstName || metadata.given_name || null
          const lastName = metadata.last_name || metadata.lastName || metadata.family_name || null
          const fullName = metadata.full_name || metadata.fullName || metadata.name ||
            [firstName, lastName].filter(Boolean).join(' ') || null

          await adminSupabase.from('profiles').insert({
            auth_id: authUser.id,
            email: authUser.email?.toLowerCase(),
            first_name: firstName,
            last_name: lastName,
            full_name: fullName,
            role: 'participant',
            is_active: true
          })
          console.log('[Callback/Key] Profile created for:', authUser.email)
        }
      } catch (profileError) {
        console.error('[Callback/Key] Profile creation error:', profileError)
      }
    }
  }

  // Redirect to home with key
  const redirectUrl = new URL(`/?key=${askKey}`, requestUrl.origin)
  console.log(`[Callback/Key] Redirecting to: ${redirectUrl.toString()}`)

  const response = NextResponse.redirect(redirectUrl)
  cookiesToSet.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, {
      ...options,
      path: '/',
      httpOnly: false,
    } as Parameters<typeof response.cookies.set>[2])
  })

  return response
}
