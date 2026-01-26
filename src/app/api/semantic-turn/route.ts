import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * API endpoint for semantic turn detection using Mistral AI
 * This endpoint acts as a secure proxy to avoid exposing the Mistral API key to the client
 *
 * Since Mistral doesn't provide logprobs like OpenAI, we use a different approach:
 * We ask Mistral to evaluate if the conversation seems complete and return a confidence score.
 */
export async function POST(request: NextRequest) {
  try {
    // Authentication check
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
      console.warn('[API /semantic-turn] ⚠️ Unauthorized access attempt');
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { prompt, model = 'mistral-small-latest', max_tokens = 1, temperature = 0, logprobs = 8 } = body;

    if (!prompt) {
      return NextResponse.json(
        { error: 'Missing required parameter: prompt' },
        { status: 400 }
      );
    }

    // Get Mistral API key from environment
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      console.error('[SemanticTurn] MISTRAL_API_KEY not configured');
      return NextResponse.json(
        { error: 'Mistral API key not configured' },
        { status: 500 }
      );
    }

    // Create a semantic evaluation prompt for Mistral
    // We ask it to evaluate if the last user message seems complete
    const evaluationPrompt = `Analyze this conversation and determine if the last user message seems COMPLETE (a full thought/sentence) or INCOMPLETE (cut off, unfinished).

${prompt}

Respond with ONLY a single word:
- "COMPLETE" if the last message seems finished
- "INCOMPLETE" if it seems cut off or unfinished

Response:`;

    const messages = [{ role: 'user', content: evaluationPrompt }];

    // Call Mistral API using chat completions endpoint
    const mistralUrl = 'https://api.mistral.ai/v1/chat/completions';

    console.log('[SemanticTurn] 📤 Calling Mistral API for semantic evaluation', {
      model,
      promptLength: prompt.length,
    });

    const response = await fetch(mistralUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 10, // Just need one word
        temperature: 0, // Deterministic
        stream: false,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[SemanticTurn] Mistral API error', {
        status: response.status,
        data,
      });
      return NextResponse.json(
        { error: 'Mistral API error', details: data },
        { status: response.status }
      );
    }

    const mistralResponse = data.choices?.[0]?.message?.content?.trim().toUpperCase() || '';

    console.log('[SemanticTurn] 📥 Mistral evaluation:', {
      response: mistralResponse,
    });

    // Convert Mistral's response to a probability score
    // COMPLETE = high probability (0.9)
    // INCOMPLETE = low probability (0.1)
    // Use strict equality to avoid matching "INCOMPLETE" as complete
    const isComplete = mistralResponse === 'COMPLETE' || mistralResponse.startsWith('COMPLETE');
    const probability = isComplete ? 0.9 : 0.1;

    // Transform to legacy completions format expected by turn detector
    // We simulate logprobs by creating a fake structure with our calculated probability
    const legacyResponse = {
      choices: [{
        text: mistralResponse,
        logprobs: {
          tokens: ['.'],
          token_logprobs: [Math.log(probability)], // Convert probability to logprob
          top_logprobs: [{
            '.': Math.log(probability),
            '!': Math.log(probability * 0.8),
            '?': Math.log(probability * 0.7),
            '\n': Math.log(probability * 0.6),
          }]
        },
        finish_reason: 'stop'
      }]
    };

    console.log('[SemanticTurn] 📊 Semantic probability:', {
      isComplete,
      probability,
      logprob: Math.log(probability),
    });

    return NextResponse.json(legacyResponse);
  } catch (error) {
    console.error('[SemanticTurn] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
