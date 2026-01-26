import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * API endpoint to get ElevenLabs API key
 * SECURITY FIX: Now requires authentication to prevent unauthorized access
 */
export async function GET(request: NextRequest) {
  console.log('[API /elevenlabs-token] 🔐 Token request received');

  // SECURITY: Require authentication
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    console.warn('[API /elevenlabs-token] ⚠️ Unauthorized access attempt');
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  const key = process.env.ELEVENLABS_API_KEY;

  if (!key) {
    console.error('[API /elevenlabs-token] ❌ ELEVENLABS_API_KEY not set');
    return NextResponse.json(
      { error: 'ElevenLabs API key is not set' },
      { status: 500 }
    );
  }

  console.log('[API /elevenlabs-token] ✅ API key returned for user:', user.email);
  return NextResponse.json({ apiKey: key });
}









