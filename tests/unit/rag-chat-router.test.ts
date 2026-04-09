import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/rag/hybrid-retrieval', () => ({
  hybridRetrieve: vi.fn(),
}));

vi.mock('@/lib/rag/context-builder', () => ({
  buildRAGContext: vi.fn(() => 'mock context'),
}));

vi.mock('@/lib/rag/validation-pipeline', () => ({
  validateChunkPresenceForClaims: vi.fn(() => ({
    valid: true,
    sanitizedAnswer: '',
    ungroundedClaims: [],
  })),
}));

vi.mock('@/lib/services/hybrid-llm-router', () => ({
  hybridLLMRouter: {
    createChatCompletion: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { hybridRetrieve } from '@/lib/rag/hybrid-retrieval';
import { hybridLLMRouter } from '@/lib/services/hybrid-llm-router';
import { ragChatRouter } from '@/lib/services/rag-chat-router';

describe('RAGChatRouter grounding fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENROLLMENT_PORTAL_URL = 'https://example.com/enroll';
  });

  it('returns the portal fallback when retrieval has no chunks', async () => {
    vi.mocked(hybridRetrieve).mockResolvedValue({ chunks: [] } as any);

    const result = await ragChatRouter.routeMessage('What is my deductible?', {
      companyId: 'amerivet',
      state: 'TX',
      category: 'Medical',
    });

    expect(result.responseType).toBe('fallback');
    expect(result.content).toContain('official AmeriVet benefits documents');
    expect(result.content).toContain('https://example.com/enroll');
    expect(result.metadata?.chunksUsed).toBe(0);
    expect(vi.mocked(hybridLLMRouter.createChatCompletion)).not.toHaveBeenCalled();
  });
});
