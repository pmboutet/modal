import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  console.log(`[Middleware] ========== REQUEST: ${request.method} ${pathname} ==========`)

  // Skip auth/session checks entirely in development when IS_DEV=true
  if (process.env.IS_DEV === 'true') {
    console.log('[Middleware] DEV MODE - skipping auth checks')
    return NextResponse.next({
      request: {
        headers: request.headers,
      },
    })
  }

  // Log all cookies for debugging
  const allCookies = request.cookies.getAll()
  const supabaseCookies = allCookies.filter(c => c.name.includes('supabase') || c.name.includes('sb-'))
  console.log(`[Middleware] Cookies found: ${allCookies.length} total, ${supabaseCookies.length} Supabase-related`)
  supabaseCookies.forEach(c => {
    console.log(`[Middleware] Cookie: ${c.name} = ${c.value.substring(0, 50)}...`)
  })

  // Create response that we'll modify with cookies
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  // Use the modern getAll/setAll pattern for Supabase SSR
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          const cookies = request.cookies.getAll()
          console.log(`[Middleware] getAll: ${cookies.length} cookies`)
          return cookies
        },
        setAll(cookiesToSet) {
          console.log(`[Middleware] setAll: ${cookiesToSet.length} cookies`)
          // First set on request (for downstream middleware/routes)
          cookiesToSet.forEach(({ name, value }) => {
            console.log(`[Middleware] Setting cookie: ${name} (${value.length} chars)`)
            request.cookies.set(name, value)
          })
          // Recreate response with updated request
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          // Set cookies on response (for browser)
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  // Allow /auth/callback to process the OAuth flow without redirecting
  if (pathname === '/auth/callback') {
    console.log('[Middleware] /auth/callback - allowing through')
    return response
  }

  // Use getUser() directly - it validates the JWT with Supabase server
  // This is more secure than getSession() which only reads from cookies
  console.log('[Middleware] Calling getUser() to validate authentication...')
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  console.log(`[Middleware] getUser result: user=${user?.email || 'null'}, error=${userError?.message || 'none'}`)

  const isAuthenticated = !userError && !!user
  console.log(`[Middleware] isAuthenticated: ${isAuthenticated}`)

  // Protect admin routes
  if (pathname.startsWith('/admin')) {
    console.log(`[Middleware] Admin route check: isAuthenticated=${isAuthenticated}`)
    if (!isAuthenticated) {
      const redirectUrl = new URL('/auth/login', request.url)
      const redirectPath = `${pathname}${request.nextUrl.search}`
      redirectUrl.searchParams.set('redirectTo', redirectPath)
      console.log(`[Middleware] REDIRECTING to ${redirectUrl.toString()}`)
      return NextResponse.redirect(redirectUrl)
    }
    console.log('[Middleware] Admin route - ACCESS GRANTED')
  }

  // Redirect logged-in users away from auth pages (except callback)
  if (pathname.startsWith('/auth/') && pathname !== '/auth/callback') {
    console.log(`[Middleware] Auth page check: isAuthenticated=${isAuthenticated}`)
    if (isAuthenticated) {
      const redirectTo = request.nextUrl.searchParams.get('redirectTo') || '/admin'
      console.log(`[Middleware] REDIRECTING authenticated user to ${redirectTo}`)
      return NextResponse.redirect(new URL(redirectTo, request.url))
    }
    console.log('[Middleware] Auth page - allowing through (not authenticated)')
  }

  console.log('[Middleware] Passing through')
  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
