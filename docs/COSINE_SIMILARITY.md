# Cosine Similarity in Benefits AI Chatbot

## Overview

**Cosine similarity** is a fundamental metric used throughout this codebase for measuring semantic similarity between text embeddings. It's the core mechanism that enables semantic search, duplicate detection, and cache matching.

## What is Cosine Similarity?

Cosine similarity measures the **cosine of the angle** between two vectors in multi-dimensional space.

### Formula
```
cosine_similarity(A, B) = (A · B) / (||A|| × ||B||)

Where:
- A · B = dot product of vectors A and B
- ||A|| = Euclidean norm (magnitude) of vector A
- ||B|| = Euclidean norm (magnitude) of vector B
```

### Score Range
```
 1.0  → Vectors point in exactly the same direction (identical)
 0.8  → Highly similar (typical for synonyms)
 0.5  → Moderately similar (related concepts)
 0.0  → Orthogonal (completely unrelated)
-1.0  → Opposite directions (antonyms)
```

### Why Cosine Similarity for Text?

Unlike Euclidean distance, cosine similarity:
- ✓ **Ignores magnitude** - only direction matters
- ✓ **Scale-invariant** - "benefit" and "benefits benefits benefits" are still similar
- ✓ **Works with high dimensions** - perfect for 1536-dim embeddings
- ✓ **Fast to compute** - single pass over vector elements

---

## Implementation Locations

### 1. **Production RAG Cache** (`lib/rag/cache-utils.ts`)

**Primary use:** L1 semantic cache matching for query deduplication

```typescript
import { cosineSimilarity, findMostSimilar } from '@/lib/rag/cache-utils';

// Calculate similarity between two embedding vectors
const similarity = cosineSimilarity(embedding1, embedding2);

// Find most similar cached query
const match = findMostSimilar(
  queryEmbedding,
  recentQueries,
  0.92  // 92% similarity threshold
);

if (match && match.similarity >= 0.92) {
  // Return cached response instead of re-processing
  return match.cachedResponse;
}
```

**Thresholds:**
- `>= 0.92` (92%) → Cache HIT - reuse cached answer
- `< 0.92` → Cache MISS - generate new answer

---

### 2. **Vector Search Service** (`lib/services/vector-search.ts`)

**New utilities added:**

#### A. Direct Vector Comparison
```typescript
import { vectorSearchService } from '@/lib/services/vector-search';

const similarity = vectorSearchService.calculateCosineSimilarity(
  embeddingA,
  embeddingB
);
console.log(`Similarity: ${(similarity * 100).toFixed(1)}%`);
```

#### B. Text-to-Text Similarity
```typescript
const similarity = await vectorSearchService.calculateTextSimilarity(
  "What is my dental coverage?",
  "Tell me about orthodontic benefits"
);
// Result: ~0.85 (85% similar - related concepts)
```

#### C. Duplicate Detection
```typescript
const duplicates = await vectorSearchService.findDuplicates(
  "Employee dental plan information",
  allDocuments.map(d => d.content),
  0.95  // 95% threshold for near-duplicates
);

duplicates.forEach(dup => {
  console.log(`Found duplicate: ${dup.similarity.toFixed(3)} - ${dup.text}`);
});
```

---

### 3. **Embeddings Router** (`lib/services/embeddings-router.ts`)

**Use:** Find similar past queries to optimize routing

```typescript
// Internal implementation
private cosineSimilarity(a: number[], b: number[]): number {
  // Calculate dot product and magnitudes
  // Returns similarity score 0-1
}

private findMostSimilarQuery(queryEmbedding: number[]): QueryEmbedding | null {
  // Finds cached query with similarity > 0.7 (70%)
  // Reuses routing decision if found
}
```

**Threshold:** `>= 0.70` (70%) for query routing reuse

---

### 4. **Azure AI Search** (`lib/rag/hybrid-retrieval.ts`)

**Use:** Vector similarity search (HNSW index with cosine distance)

```typescript
// Azure Search configuration
const results = await searchClient.search(query, {
  vectorSearchOptions: {
    queries: [{
      kind: "vector",
      vector: queryEmbedding,
      fields: ["content_vector"],
      kNearestNeighborsCount: 24,
      // Uses cosine similarity internally (configured in index)
    }],
  },
});
```

**Index config** (in `infra/azure/main.bicep`):
```json
{
  "vectorSearch": {
    "algorithms": [{
      "name": "hnsw-1536",
      "kind": "hnsw",
      "metric": "cosine"  // ← Cosine distance metric
    }]
  }
}
```

---

## Common Use Cases

### Use Case 1: Query Deduplication (Semantic Cache)

**Problem:** Users ask the same question in different ways
```
- "What is my dental coverage?"
- "Tell me about my dental benefits"
- "Dental plan information?"
```

**Solution:** Use cosine similarity to detect semantic duplicates
```typescript
// In app/api/qa/route.ts
const queryEmbedding = await generateEmbedding(normalizedQuery);
const similarQuery = findMostSimilar(queryEmbedding, recentQueries, 0.92);

if (similarQuery) {
  console.log(`Cache HIT: ${similarQuery.similarity.toFixed(3)}`);
  return similarQuery.cachedResponse;
}
```

**Result:** 
- 92% similarity → Return cached answer (save 2-3 seconds)
- 85% similarity → Generate new answer (too different)

---

### Use Case 2: Duplicate Document Detection

**Problem:** Identify duplicate or near-duplicate benefits documents

```typescript
import { vectorSearchService } from '@/lib/services/vector-search';

async function detectDuplicateDocs(documents: Document[]) {
  const results = [];
  
  for (let i = 0; i < documents.length; i++) {
    const duplicates = await vectorSearchService.findDuplicates(
      documents[i].content,
      documents.slice(i + 1).map(d => d.content),
      0.98  // 98% threshold = near-exact duplicates
    );
    
    if (duplicates.length > 0) {
      results.push({
        original: documents[i],
        duplicates: duplicates.map(d => documents[i + 1 + d.index])
      });
    }
  }
  
  return results;
}
```

---

### Use Case 3: Content Recommendation

**Problem:** Recommend related documents based on user's current reading

```typescript
async function recommendSimilarDocs(
  currentDoc: Document,
  allDocs: Document[],
  topN: number = 3
) {
  const currentEmbedding = await generateEmbedding(currentDoc.content);
  const similarities = [];
  
  for (const doc of allDocs) {
    if (doc.id === currentDoc.id) continue;
    
    const docEmbedding = await generateEmbedding(doc.content);
    const similarity = vectorSearchService.calculateCosineSimilarity(
      currentEmbedding,
      docEmbedding
    );
    
    similarities.push({ doc, similarity });
  }
  
  return similarities
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topN)
    .map(s => s.doc);
}
```

---

### Use Case 4: Semantic Search Quality Scoring

**Problem:** Understand quality of search results

```typescript
// After hybrid retrieval
const searchResults = await hybridRetrieve(query, context);

// Analyze vector search quality
const avgVectorSimilarity = 
  searchResults.chunks.reduce((sum, chunk) => 
    sum + (chunk.metadata.vectorScore || 0), 0
  ) / searchResults.chunks.length;

console.log(`Average cosine similarity: ${avgVectorSimilarity.toFixed(3)}`);

if (avgVectorSimilarity < 0.5) {
  console.warn('Low relevance - consider expanding query or fallback');
}
```

---

## Performance Considerations

### Computational Complexity

```typescript
// Time complexity: O(n) where n = vector dimension
// Space complexity: O(1)

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {  // O(n) single pass
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}
```

**For 3072-dim embeddings (text-embedding-3-large):**
- Single comparison: ~0.01ms
- 1000 comparisons: ~10ms
- Negligible compared to embedding generation (~50ms per text)

### Optimization Tips

1. **Batch comparisons** when possible
```typescript
// ✗ Inefficient - sequential
for (const query of queries) {
  const similarity = await calculateTextSimilarity(newQuery, query);
}

// ✓ Efficient - parallel embedding generation
const embeddings = await Promise.all(
  queries.map(q => generateEmbedding(q))
);
const similarities = embeddings.map(emb => 
  cosineSimilarity(newEmbedding, emb)
);
```

2. **Cache embeddings** for repeated comparisons
```typescript
// Store embeddings instead of regenerating
const embeddingCache = new Map<string, number[]>();

async function getCachedEmbedding(text: string): Promise<number[]> {
  if (embeddingCache.has(text)) {
    return embeddingCache.get(text)!;
  }
  
  const embedding = await generateEmbedding(text);
  embeddingCache.set(text, embedding);
  return embedding;
}
```

3. **Early termination** for large searches
```typescript
// Stop searching once you find good enough match
function findSimilar(
  target: number[],
  candidates: number[][],
  threshold: number = 0.9
): number[] | null {
  for (const candidate of candidates) {
    const similarity = cosineSimilarity(target, candidate);
    if (similarity >= threshold) {
      return candidate;  // Found good match, stop
    }
  }
  return null;
}
```

---

## Threshold Guidelines

Based on our production experience:

| Similarity Score | Interpretation | Use Case |
|-----------------|----------------|----------|
| **0.98 - 1.00** | Near-identical | Exact duplicate detection |
| **0.92 - 0.98** | Highly similar | Semantic cache HIT |
| **0.80 - 0.92** | Very similar | Related content recommendation |
| **0.70 - 0.80** | Similar | Query routing reuse |
| **0.50 - 0.70** | Moderately related | Expanded search results |
| **0.30 - 0.50** | Weakly related | Exploratory suggestions |
| **< 0.30** | Unrelated | Ignore |

### Context-Specific Thresholds

**L1 Semantic Cache** (`app/api/qa/route.ts`):
```typescript
const CACHE_SIMILARITY_THRESHOLD = 0.92;  // 92%
// Conservative to avoid wrong answer
```

**Embeddings Router** (`lib/services/embeddings-router.ts`):
```typescript
const ROUTING_SIMILARITY_THRESHOLD = 0.70;  // 70%
// More lenient - routing decision less critical
```

**Duplicate Detection**:
```typescript
const DUPLICATE_THRESHOLD = 0.95;  // 95%
// High threshold for near-exact matches
```

---

## Testing Cosine Similarity

### Unit Test Example

```typescript
// tests/lib/rag/cache-utils.test.ts
import { cosineSimilarity } from '@/lib/rag/cache-utils';

describe('cosineSimilarity', () => {
  test('identical vectors return 1.0', () => {
    const vec = [1, 2, 3, 4];
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0);
  });

  test('orthogonal vectors return 0.0', () => {
    const vecA = [1, 0, 0];
    const vecB = [0, 1, 0];
    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(0.0);
  });

  test('opposite vectors return -1.0', () => {
    const vecA = [1, 2, 3];
    const vecB = [-1, -2, -3];
    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(-1.0);
  });

  test('handles zero vectors', () => {
    const vecA = [0, 0, 0];
    const vecB = [1, 2, 3];
    expect(cosineSimilarity(vecA, vecB)).toBe(0);
  });
});
```

### Integration Test Example

```typescript
// tests/services/vector-search.test.ts
import { vectorSearchService } from '@/lib/services/vector-search';

describe('VectorSearchService - Cosine Similarity', () => {
  test('similar texts have high similarity', async () => {
    const similarity = await vectorSearchService.calculateTextSimilarity(
      'dental coverage information',
      'orthodontic benefits details'
    );
    
    expect(similarity).toBeGreaterThan(0.75); // Expect > 75%
  });

  test('unrelated texts have low similarity', async () => {
    const similarity = await vectorSearchService.calculateTextSimilarity(
      'dental coverage',
      'vacation policy'
    );
    
    expect(similarity).toBeLessThan(0.5); // Expect < 50%
  });
});
```

---

## Common Pitfalls

### ❌ Comparing Different Embedding Models

```typescript
// WRONG - embeddings from different models aren't comparable
const embedding1 = await openai.embeddings.create({
  model: 'text-embedding-3-large',  // 3072 dims
  input: text1
});

const embedding2 = await openai.embeddings.create({
  model: 'text-embedding-3-small',  // 1536 dims but different space
  input: text2
});

// This similarity score is meaningless!
const similarity = cosineSimilarity(embedding1, embedding2);
```

**Solution:** Always use the same embedding model for comparisons.

---

### ❌ Ignoring Magnitude = 0

```typescript
// WRONG - can cause division by zero
function cosineSimilarity(a: number[], b: number[]): number {
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return dotProduct / magnitude;  // ← Crash if magnitude = 0!
}

// RIGHT - handle zero vectors
function cosineSimilarity(a: number[], b: number[]): number {
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;  // ✓
}
```

---

### ❌ Using Wrong Threshold

```typescript
// WRONG - too strict for cache (wastes money)
const CACHE_THRESHOLD = 0.99;  // 99% - almost never hits

// WRONG - too lenient for duplicates (false positives)
const DUPLICATE_THRESHOLD = 0.7;  // 70% - too many false matches

// RIGHT - appropriate thresholds
const CACHE_THRESHOLD = 0.92;      // 92% for semantic cache
const DUPLICATE_THRESHOLD = 0.95;  // 95% for duplicate detection
```

---

## References

### Internal Files
- `lib/rag/cache-utils.ts` - Production implementation
- `lib/services/vector-search.ts` - Utility methods
- `lib/services/embeddings-router.ts` - Query routing
- `lib/rag/hybrid-retrieval.ts` - Azure AI Search integration

### External Resources
- [Cosine Similarity (Wikipedia)](https://en.wikipedia.org/wiki/Cosine_similarity)
- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)
- [Azure AI Search Vector Search](https://learn.microsoft.com/en-us/azure/search/vector-search-overview)

---

## Quick Reference Card

```typescript
// ═══════════════════════════════════════════════════════════
// COSINE SIMILARITY QUICK REFERENCE
// ═══════════════════════════════════════════════════════════

// 1. Compare two embeddings directly
import { cosineSimilarity } from '@/lib/rag/cache-utils';
const score = cosineSimilarity(embedding1, embedding2);

// 2. Compare two text strings
import { vectorSearchService } from '@/lib/services/vector-search';
const score = await vectorSearchService.calculateTextSimilarity(text1, text2);

// 3. Find duplicates
const dups = await vectorSearchService.findDuplicates(refText, candidates, 0.95);

// 4. Find similar cached query
import { findMostSimilar } from '@/lib/rag/cache-utils';
const match = findMostSimilar(queryEmb, recentQueries, 0.92);

// ═══════════════════════════════════════════════════════════
// THRESHOLDS
// ═══════════════════════════════════════════════════════════
// 0.92+ → Semantic cache HIT (reuse answer)
// 0.70+ → Routing decision reuse
// 0.95+ → Duplicate detection
// 0.50+ → Related content

// ═══════════════════════════════════════════════════════════
```
