import type OpenAI from 'openai';
import { logger } from '@/lib/logger';
import { EXPECTED_EMBEDDING_DIMS } from '@/lib/ai/models';

let openaiClient: OpenAI | null = null;

async function getAzureOpenAIClient(): Promise<OpenAI> {
  if (openaiClient) return openaiClient;
  if (typeof window !== 'undefined') throw new Error('Server-only module');

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;

  if (!endpoint || !apiKey) {
    throw new Error('Azure OpenAI endpoint or API key not configured');
  }

  const OpenAIModule = await import('openai');
  const OpenAI = OpenAIModule.default;

  openaiClient = new OpenAI({
    apiKey,
    baseURL: `${endpoint}/openai/deployments`,
    defaultHeaders: {
      'api-key': apiKey,
    },
    defaultQuery: { 'api-version': '2024-05-01-preview' },
  });

  return openaiClient;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error('Text is required for embedding generation');
  }

  const maxLength = 6000;
  const truncatedText =
    text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;

  const deployment = process.env.AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT || 'text-embedding-3-small';

  try {
    const client = await getAzureOpenAIClient();
    const result = await client.embeddings.create({
      model: deployment,
      input: truncatedText,
    });
    const embedding = result.data?.[0]?.embedding;

    // Validate embedding dimensions
    if (!embedding || embedding.length === 0) {
      throw new Error('Empty embedding returned from API');
    }
    if (embedding.length !== EXPECTED_EMBEDDING_DIMS) {
      logger.warn(`Embedding dimension mismatch: expected ${EXPECTED_EMBEDDING_DIMS}, got ${embedding.length}`);
    }

    return embedding;
  } catch (error) {
    logger.error('Azure OpenAI embedding error:', error);
    throw new Error('Failed to generate embedding');
  }
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (!texts || texts.length === 0) {
    return [];
  }

  const deployment = process.env.AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT || 'text-embedding-3-small';

  try {
    const client = await getAzureOpenAIClient();
    const result = await client.embeddings.create({
      model: deployment,
      input: texts,
    });
    return result.data?.map((d: any) => d.embedding) || [];
  } catch (error) {
    logger.error('Azure OpenAI batch embedding error:', error);
    throw new Error('Failed to generate embeddings');
  }
}

export const getEmbedding = generateEmbedding;
