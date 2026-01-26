import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * API endpoint for start-of-turn detection (AI-powered barge-in validation)
 * This endpoint acts as a secure proxy to avoid exposing API keys to the client
 *
 * Validates whether detected speech is:
 * 1. A genuine start of user speech (not noise/background)
 * 2. Not an echo of what the assistant is currently saying
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
      console.warn('[API /start-of-turn] ⚠️ Unauthorized access attempt');
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      userTranscript,
      currentAssistantSpeech,
      conversationHistory,
      provider = 'anthropic',
      model
    } = body;

    if (!userTranscript) {
      return NextResponse.json(
        { error: 'Missing required parameter: userTranscript' },
        { status: 400 }
      );
    }

    // Route to appropriate provider
    if (provider === 'anthropic') {
      return await validateWithAnthropic(
        userTranscript,
        currentAssistantSpeech || '',
        conversationHistory || [],
        model || 'claude-3-5-haiku-latest'
      );
    } else if (provider === 'openai') {
      return await validateWithOpenAI(
        userTranscript,
        currentAssistantSpeech || '',
        conversationHistory || [],
        model || 'gpt-4o-mini'
      );
    } else {
      return NextResponse.json(
        { error: `Unsupported provider: ${provider}` },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('[StartOfTurn] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

async function validateWithAnthropic(
  userTranscript: string,
  currentAssistantSpeech: string,
  conversationHistory: Array<{ role: string; content: string }>,
  model: string
): Promise<NextResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[StartOfTurn] ANTHROPIC_API_KEY not configured');
    return NextResponse.json(
      { error: 'Anthropic API key not configured' },
      { status: 500 }
    );
  }

  const systemPrompt = `You are a voice conversation analyzer specializing in echo detection for real-time voice AI systems. Your PRIMARY goal is to PREVENT FALSE POSITIVE BARGE-INS caused by the microphone picking up the assistant's own voice output.

Your task is to determine if a detected speech transcript is:
1. A genuine start of user speech (valid interruption) - ONLY if clearly different from assistant speech
2. An echo/repetition of what the assistant is currently saying - MOST COMMON CASE

Respond with a JSON object:
{
  "isValidStart": true/false,
  "isEcho": true/false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}

CRITICAL RULES (in order of priority):
1. DEFAULT TO ECHO: When in doubt, assume it's an echo. False negatives (missing a real interruption) are better than false positives (stopping the assistant mid-speech for echo)
2. WORD MATCHING: If 30% or more of the transcript words appear in what the assistant is saying, it's almost certainly an echo
3. PHRASE MATCHING: If ANY sequence of 3+ consecutive words from the transcript appears in assistant speech, it's an echo
4. SEMANTIC SIMILARITY: If the transcript conveys similar meaning to recent assistant speech (even with different words), it's likely an echo
5. SHORT TRANSCRIPTS: Transcripts under 10 words are highly suspicious - require very high confidence to accept as valid
6. CONTEXT CHECK: A valid interruption should be semantically DIFFERENT from what the assistant is discussing
7. SPEECH RECOGNITION ERRORS: Account for transcription errors - "il" could be "elle", missing articles, etc.

Examples of ECHO (isEcho=true):
- Assistant says "Je peux vous aider avec ça" → User transcript: "avec ça" or "peux vous aider"
- Assistant says "La météo sera belle demain" → User transcript: "météo belle demain" or "sera belle"
- Any transcript that sounds like a fragment of assistant speech

Examples of VALID INTERRUPTION (isValidStart=true):
- Assistant talking about weather → User asks "Quelle heure est-il?"
- Assistant explaining something → User says "Attends, j'ai une question différente"
- User introduces a completely new topic`;

  const recentHistory = conversationHistory.slice(-2).map(msg =>
    `${msg.role === 'assistant' ? 'Assistant' : 'User'}: ${msg.content}`
  ).join('\n');

  const userPrompt = `Current situation:
- Assistant is currently saying: "${currentAssistantSpeech}"
- Detected user speech: "${userTranscript}"
- Recent conversation:
${recentHistory}

Is this detected speech a valid start of user turn, or is it an echo of the assistant?`;

  console.log('[StartOfTurn] 📤 Calling Anthropic API', {
    model,
    userTranscriptLength: userTranscript.length,
    assistantSpeechLength: currentAssistantSpeech.length,
  });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 256,
      temperature: 0,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt }
      ],
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error('[StartOfTurn] Anthropic API error', {
      status: response.status,
      errorData,
    });
    return NextResponse.json(
      { error: 'Anthropic API error', details: errorData },
      { status: response.status }
    );
  }

  const data = await response.json();
  const content = data.content?.[0]?.text || '';

  // Extract JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('[StartOfTurn] No JSON found in Anthropic response:', content);
    return NextResponse.json(
      { error: 'Invalid response format from AI' },
      { status: 500 }
    );
  }

  // FIX: Wrap JSON.parse in try-catch to handle malformed AI responses
  let result;
  try {
    result = JSON.parse(jsonMatch[0]);
  } catch (parseError) {
    console.error('[StartOfTurn] Failed to parse JSON from Anthropic response:', jsonMatch[0]);
    // Return safe default on parse error
    return NextResponse.json({
      isValidStart: true,
      isEcho: false,
      confidence: 0.5,
      reason: 'JSON parse error - assuming valid',
    });
  }
  console.log('[StartOfTurn] 📥 Anthropic validation result:', result);

  return NextResponse.json(result);
}

async function validateWithOpenAI(
  userTranscript: string,
  currentAssistantSpeech: string,
  conversationHistory: Array<{ role: string; content: string }>,
  model: string
): Promise<NextResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('[StartOfTurn] OPENAI_API_KEY not configured');
    return NextResponse.json(
      { error: 'OpenAI API key not configured' },
      { status: 500 }
    );
  }

  const systemPrompt = `You are a voice conversation analyzer specializing in echo detection. Your PRIMARY goal is to PREVENT false barge-ins from microphone echo.

DEFAULT TO ECHO when in doubt. Respond with JSON only:
{
  "isValidStart": true/false,
  "isEcho": true/false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}

Rules (priority order):
1. If 30%+ transcript words appear in assistant speech → ECHO
2. If 3+ consecutive words match assistant speech → ECHO
3. Short transcripts (<10 words) are suspicious → lower confidence
4. Valid interruption must be semantically DIFFERENT from assistant topic`;

  const recentHistory = conversationHistory.slice(-2).map(msg =>
    `${msg.role === 'assistant' ? 'Assistant' : 'User'}: ${msg.content}`
  ).join('\n');

  const userPrompt = `Assistant currently saying: "${currentAssistantSpeech}"
Detected user speech: "${userTranscript}"
Recent conversation:
${recentHistory}

Is this a valid user interruption or an echo?`;

  console.log('[StartOfTurn] 📤 Calling OpenAI API', {
    model,
    userTranscriptLength: userTranscript.length,
    assistantSpeechLength: currentAssistantSpeech.length,
  });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0,
      max_tokens: 256,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error('[StartOfTurn] OpenAI API error', {
      status: response.status,
      errorData,
    });
    return NextResponse.json(
      { error: 'OpenAI API error', details: errorData },
      { status: response.status }
    );
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '{}';

  // FIX: Wrap JSON.parse in try-catch to handle malformed AI responses
  let result;
  try {
    result = JSON.parse(content);
  } catch (parseError) {
    console.error('[StartOfTurn] Failed to parse JSON from OpenAI response:', content);
    // Return safe default on parse error
    return NextResponse.json({
      isValidStart: true,
      isEcho: false,
      confidence: 0.5,
      reason: 'JSON parse error - assuming valid',
    });
  }
  console.log('[StartOfTurn] 📥 OpenAI validation result:', result);

  return NextResponse.json(result);
}
