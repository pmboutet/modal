/**
 * LLM integration for Speechmatics Voice Agent
 */

import * as Sentry from '@sentry/nextjs';

export class SpeechmaticsLLM {
  async getLLMApiKey(provider: "anthropic" | "openai"): Promise<string> {
    const response = await fetch('/api/llm-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`Failed to get LLM API key: ${errorText}`);

      // Capture LLM API key retrieval errors to Sentry
      Sentry.captureException(error, {
        tags: {
          component: 'speechmatics-llm',
          error_type: 'llm_api_key_error',
          llm_provider: provider,
        },
        extra: {
          statusCode: response.status,
          errorText,
        },
        level: 'error',
      });

      throw error;
    }

    const data = await response.json();
    return data.apiKey;
  }

  async callLLM(
    provider: "anthropic" | "openai",
    apiKey: string,
    model: string,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options?: {
      enableThinking?: boolean;
      thinkingBudgetTokens?: number;
      signal?: AbortSignal;
    }
  ): Promise<string> {
    const systemMessage = messages.find(m => m.role === 'system');

    const payload: Record<string, unknown> = {
      provider,
      model,
      messages,
      systemPrompt: systemMessage?.content || '',
    };

    if (options?.enableThinking) {
      payload.enableThinking = true;
      if (typeof options.thinkingBudgetTokens === "number") {
        payload.thinkingBudgetTokens = options.thinkingBudgetTokens;
      }
    }

    const response = await fetch('/api/speechmatics-llm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: options?.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = `LLM API error: ${(errorData as any).error || response.statusText}`;
      const error = new Error(errorMessage);

      // Capture LLM API errors to Sentry
      Sentry.captureException(error, {
        tags: {
          component: 'speechmatics-llm',
          error_type: 'llm_api_error',
          llm_provider: provider,
        },
        extra: {
          statusCode: response.status,
          statusText: response.statusText,
          model,
          errorData,
          messageCount: messages.length,
          enableThinking: options?.enableThinking,
        },
        level: 'error',
      });

      throw error;
    }

    const data = await response.json();
    return data.content || '';
  }
}







