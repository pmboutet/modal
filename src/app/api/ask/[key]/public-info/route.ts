import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse } from '@/types';
import { isValidAskKey } from '@/lib/utils';
import { getAskSessionByKey } from '@/lib/asks';
import { getAdminSupabaseClient } from '@/lib/supabaseAdmin';

interface PublicAskInfo {
  askKey: string;
  name: string | null;
  question: string;
  allowAutoRegistration: boolean;
}

interface AskRow {
  ask_key: string;
  name: string | null;
  question: string;
  allow_auto_registration: boolean | null;
}

/**
 * GET /api/ask/[key]/public-info
 *
 * Returns minimal public information about an ASK session.
 * No authentication required - used for the public entry form.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
): Promise<NextResponse<ApiResponse<PublicAskInfo>>> {
  try {
    const { key } = await params;

    if (!key || !isValidAskKey(key)) {
      return NextResponse.json({
        success: false,
        error: 'Format de clé ASK invalide'
      }, { status: 400 });
    }

    // Use admin client to bypass RLS
    const supabase = getAdminSupabaseClient();
    const { row: askSession, error } = await getAskSessionByKey<AskRow>(
      supabase,
      key,
      'ask_key, name, question, allow_auto_registration'
    );

    if (error) {
      console.error('[PublicAskInfo] DB error:', error);
      return NextResponse.json({
        success: false,
        error: 'Erreur lors de la récupération des informations'
      }, { status: 500 });
    }

    if (!askSession) {
      return NextResponse.json({
        success: false,
        error: 'Session ASK non trouvée'
      }, { status: 404 });
    }

    // Return only public-safe information
    return NextResponse.json({
      success: true,
      data: {
        askKey: askSession.ask_key,
        name: askSession.name ?? null,
        question: askSession.question,
        allowAutoRegistration: askSession.allow_auto_registration ?? false,
      }
    });
  } catch (error) {
    console.error('[PublicAskInfo] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'Erreur lors de la récupération des informations'
    }, { status: 500 });
  }
}
