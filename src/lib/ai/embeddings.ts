/**
 * Embeddings generation service
 * Supports multiple providers with priority: Voyage AI > Mistral > OpenAI
 * Voyage AI is recommended by Anthropic for embeddings
 */

export type EmbeddingProvider = 'voyage' | 'mistral' | 'openai';

export interface EmbeddingOptions {
  provider?: EmbeddingProvider;
  model?: string;
}

/**
 * Normalize text for embedding generation
 */
export function normalizeTextForEmbedding(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  // Remove extra whitespace, normalize line breaks
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n+/g, ' ')
    .trim();
}

/**
 * Generate embedding using Voyage AI (recommended by Anthropic)
 */
async function generateVoyageEmbedding(
  text: string,
  model: string = 'voyage-3'
): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  
  if (!apiKey) {
    throw new Error(
      'VOYAGE_API_KEY environment variable is not set. ' +
      'Get your API key from https://www.voyageai.com/'
    );
  }

  const normalizedText = normalizeTextForEmbedding(text);
  
  if (!normalizedText) {
    throw new Error('Cannot generate embedding for empty text');
  }

  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: normalizedText,
      model: model,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(
      `Voyage AI embedding error (${response.status}): ${errorText}`
    );
  }

  const data = await response.json();
  
  if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
    throw new Error('Invalid response from Voyage AI embeddings API');
  }

  const embedding = data.data[0].embedding;
  
  if (!Array.isArray(embedding) || embedding.length !== 1024) {
    throw new Error(
      `Invalid embedding dimensions: expected 1024, got ${embedding.length}`
    );
  }

  return embedding;
}

/**
 * Generate embedding using Mistral AI (if available)
 */
async function generateMistralEmbedding(
  text: string,
  model: string = 'mistral-embed'
): Promise<number[]> {
  const apiKey = process.env.MISTRAL_API_KEY;
  
  if (!apiKey) {
    throw new Error('MISTRAL_API_KEY environment variable is not set');
  }

  const normalizedText = normalizeTextForEmbedding(text);
  
  if (!normalizedText) {
    throw new Error('Cannot generate embedding for empty text');
  }

  // Mistral embeddings API (if available)
  const response = await fetch('https://api.mistral.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: normalizedText,
      model: model,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(
      `Mistral embedding error (${response.status}): ${errorText}`
    );
  }

  const data = await response.json();
  
  if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
    throw new Error('Invalid response from Mistral embeddings API');
  }

  const embedding = data.data[0].embedding;
  
  if (!Array.isArray(embedding)) {
    throw new Error('Invalid embedding format from Mistral');
  }

  return embedding;
}

/**
 * Generate embedding using OpenAI
 */
async function generateOpenAIEmbedding(
  text: string,
  model: string = 'text-embedding-3-small'
): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  const normalizedText = normalizeTextForEmbedding(text);
  
  if (!normalizedText) {
    throw new Error('Cannot generate embedding for empty text');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: normalizedText,
      model: model,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(
      `OpenAI embedding error (${response.status}): ${errorText}`
    );
  }

  const data = await response.json();
  
  if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
    throw new Error('Invalid response from OpenAI embeddings API');
  }

  const embedding = data.data[0].embedding;
  
  if (!Array.isArray(embedding)) {
    throw new Error('Invalid embedding format from OpenAI');
  }

  return embedding;
}

/**
 * Generate embedding with automatic provider selection and fallback
 * Priority: Voyage AI > Mistral > OpenAI
 * 
 * @param text - Text to generate embedding for
 * @param options - Optional provider and model specification
 * @returns Promise resolving to embedding vector (number array)
 */
export async function generateEmbedding(
  text: string,
  options: EmbeddingOptions = {}
): Promise<number[]> {
  const { provider, model } = options;
  const normalizedText = normalizeTextForEmbedding(text);

  if (!normalizedText) {
    throw new Error('Cannot generate embedding for empty text');
  }

  // If provider is explicitly specified, use it
  if (provider === 'voyage') {
    return generateVoyageEmbedding(normalizedText, model);
  }
  
  if (provider === 'mistral') {
    return generateMistralEmbedding(normalizedText, model);
  }
  
  if (provider === 'openai') {
    return generateOpenAIEmbedding(normalizedText, model);
  }

  // Automatic fallback: try providers in priority order
  const providers: { name: EmbeddingProvider; try: () => Promise<number[]> }[] = [
    {
      name: 'voyage',
      try: () => generateVoyageEmbedding(normalizedText, model),
    },
    {
      name: 'mistral',
      try: () => generateMistralEmbedding(normalizedText, model),
    },
    {
      name: 'openai',
      try: () => generateOpenAIEmbedding(normalizedText, model),
    },
  ];

  let lastError: Error | null = null;

  for (const { name, try: tryGenerate } of providers) {
    try {
      // Check if API key is available before trying
      const apiKeyEnvVar = 
        name === 'voyage' ? 'VOYAGE_API_KEY' :
        name === 'mistral' ? 'MISTRAL_API_KEY' :
        'OPENAI_API_KEY';
      
      if (!process.env[apiKeyEnvVar]) {
        continue; // Skip if no API key
      }

      return await tryGenerate();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Continue to next provider
      continue;
    }
  }

  // All providers failed
  throw new Error(
    `Failed to generate embedding with any available provider. ` +
    `Last error: ${lastError?.message ?? 'Unknown error'}. ` +
    `Ensure at least one of VOYAGE_API_KEY, MISTRAL_API_KEY, or OPENAI_API_KEY is set.`
  );
}

/**
 * Get the expected embedding dimensions for a provider/model
 */
export function getEmbeddingDimensions(
  provider: EmbeddingProvider,
  model?: string
): number {
  if (provider === 'voyage') {
    return 1024; // voyage-3 produces 1024-dimensional embeddings
  }
  
  if (provider === 'mistral') {
    // Mistral embed typically produces 1024 dimensions (verify with actual model)
    return 1024;
  }
  
  if (provider === 'openai') {
    if (model?.includes('large')) {
      return 3072; // text-embedding-3-large
    }
    return 1536; // text-embedding-3-small default
  }
  
  return 1024; // Default for Voyage AI
}

