/**
 * Build context string from retrieved chunks for RAG
 */

import type { Chunk } from '@/types/rag';

/**
 * Build a formatted context string from retrieved chunks
 * Includes document titles, content snippets, and metadata
 */
export function buildRAGContext(
  chunks: Chunk[],
  options: {
    maxChunks?: number;
    maxLength?: number;
    includeMetadata?: boolean;
  } = {}
): string {
  const {
    maxChunks = 10,
    maxLength = 4000,
    includeMetadata = true
  } = options;

  // Take top chunks by score
  const selectedChunks = chunks.slice(0, maxChunks);

  const contextParts: string[] = [];

  selectedChunks.forEach((chunk, index) => {
    let part = `\n--- Chunk ${index + 1} ---\n`;

    // Add title if available
    if (chunk.title) {
      part += `Document: ${chunk.title}\n`;
    }

    // Add metadata if requested
    if (includeMetadata && chunk.metadata) {
      if (chunk.metadata.fileName) {
        part += `Source: ${chunk.metadata.fileName}\n`;
      }
      if (chunk.metadata.category) {
        part += `Category: ${chunk.metadata.category}\n`;
      }
    }

    // Add content
    part += `Content: ${chunk.content}\n`;

    contextParts.push(part);
  });

  let context = contextParts.join('');

  // Truncate if too long
  if (context.length > maxLength) {
    context = context.substring(0, maxLength) + '\n... (truncated)';
  }

  return context;
}

/**
 * Build a concise summary of chunks for quick context
 */
export function buildChunkSummary(chunks: Chunk[]): string {
  if (chunks.length === 0) {
    return 'No relevant documents found.';
  }

  const titles = chunks
    .map(c => c.title)
    .filter(Boolean)
    .slice(0, 5)
    .join(', ');

  return `Found ${chunks.length} relevant document(s): ${titles || 'benefit information'}`;
}

export default {
  buildRAGContext,
  buildChunkSummary
};
