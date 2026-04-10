import { describe, expect, it } from 'vitest';
import { isRecoverableVectorFailure } from '@/lib/rag/hybrid-retrieval';

describe('hybrid-retrieval', () => {
  it('treats embedding generation outages as recoverable vector failures', () => {
    expect(
      isRecoverableVectorFailure(new Error('Embedding generation unavailable for production retrieval'))
    ).toBe(true);
  });

  it('treats vector dimension mismatches as recoverable vector failures', () => {
    expect(
      isRecoverableVectorFailure(new Error('InvalidVectorQuery: vector dimensions do not match content_vector'))
    ).toBe(true);
  });

  it('does not swallow unrelated retrieval failures', () => {
    expect(
      isRecoverableVectorFailure(new Error('Cosmos repository unavailable'))
    ).toBe(false);
  });
});
