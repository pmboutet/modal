import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * API endpoint to call LLM (Anthropic or OpenAI) for Speechmatics voice agent
 * This avoids CORS issues by making the API call server-side
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
      console.warn('[API /speechmatics-llm] ⚠️ Unauthorized access attempt');
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { provider, model, messages, systemPrompt, enableThinking, thinkingBudgetTokens } = body;

    if (!provider || !model || !messages) {
      return NextResponse.json(
        { error: 'Missing required fields: provider, model, messages' },
        { status: 400 }
      );
    }

    let apiKey: string | undefined;
    if (provider === 'openai') {
      apiKey = process.env.OPENAI_API_KEY;
    } else if (provider === 'anthropic') {
      apiKey = process.env.ANTHROPIC_API_KEY;
    } else {
      return NextResponse.json(
        { error: `Unsupported provider: ${provider}` },
        { status: 400 }
      );
    }

    if (!apiKey) {
      console.error(`[API /speechmatics-llm] ❌ ${provider.toUpperCase()}_API_KEY not set`);
      return NextResponse.json(
        { error: `${provider} API key is not set` },
        { status: 500 }
      );
    }

    // Filter out system messages and prepare conversation
    const conversationMessages = messages.filter((m: any) => m.role !== 'system');

    if (provider === 'anthropic') {
      let maxTokens = 1024;
      let thinkingBudget: number | undefined;

      if (enableThinking) {
        const desiredBudget = Math.max(1024, thinkingBudgetTokens ?? 10000);
        thinkingBudget = desiredBudget;
        if (maxTokens <= desiredBudget) {
          maxTokens = desiredBudget + 1024;
        }
      }

      const anthropicBody: Record<string, unknown> = {
        model,
        max_tokens: maxTokens,
        system: systemPrompt || '',
        messages: conversationMessages,
      };

      // Add thinking mode if enabled
      if (thinkingBudget) {
        anthropicBody.thinking = {
          type: "enabled",
          budget_tokens: thinkingBudget,
        };
      }

      // LOG ACTUAL PAYLOAD SENT TO LLM
      console.log('[API /speechmatics-llm] 📤 Anthropic request:', JSON.stringify({
        model,
        systemPromptLength: (systemPrompt || '').length,
        systemPromptPreview: (systemPrompt || '').substring(0, 500),
        messagesCount: conversationMessages.length,
        messages: conversationMessages.map((m: any) => ({
          role: m.role,
          contentLength: m.content?.length,
          contentPreview: m.content?.substring(0, 200),
        })),
        enableThinking,
        thinkingBudget,
      }, null, 2));

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(anthropicBody),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        console.error('[API /speechmatics-llm] ❌ Anthropic API error:', error);
        return NextResponse.json(
          { error: `Anthropic API error: ${(error as any).error?.message || response.statusText}` },
          { status: response.status }
        );
      }

      const data = await response.json();
      const content = data.content[0]?.text || '';

      // LOG LLM RESPONSE
      console.log('[API /speechmatics-llm] 📥 Anthropic response:', JSON.stringify({
        contentLength: content.length,
        contentPreview: content.substring(0, 300),
        usage: data.usage,
      }, null, 2));

      return NextResponse.json({ content });
    } else {
      // OpenAI
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: messages, // OpenAI includes system messages in the array
          max_tokens: 1024,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        console.error('[API /speechmatics-llm] ❌ OpenAI API error:', error);
        return NextResponse.json(
          { error: `OpenAI API error: ${(error as any).error?.message || response.statusText}` },
          { status: response.status }
        );
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content || '';
      return NextResponse.json({ content });
    }
  } catch (error) {
    console.error('[API /speechmatics-llm] ❌ Error:', error);
    return NextResponse.json(
      { error: `Internal error: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
