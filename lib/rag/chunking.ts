/**
 * Document Chunking & Ingestion Pipeline
 * 
 * Purpose:
 * - Extract text from documents (PDF, DOCX, HTML)
 * - Clean and normalize content
 * - Apply sliding window chunking (800-1200 tokens, stride 120-200)
 * - Generate embeddings for vector search
 * - Store chunks in Azure AI Search index
 * 
 * Chunking Strategy:
 * - Window size: 800-1200 tokens (configurable)
 * - Stride: 120-200 tokens (15-25% overlap)
 * - Preserve section headers and context
 * - Minimum chunk size: 100 tokens
 * - Maximum chunk size: 1500 tokens
 * 
 * Architecture:
 * - Text extraction: PDF.js, Mammoth (DOCX), Cheerio (HTML)
 * - Tokenization: GPT-4 tokenizer (cl100k_base)
 * - Embedding: Azure OpenAI text-embedding-3-large
 * - Storage: Azure AI Search with vector config
 */

import type {
  Document,
  Chunk,
  ChunkingConfig,
  DocumentType,
  ChunkMetadata,
} from '../../types/rag';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  windowSize: 1000,          // Target chunk size in tokens
  stride: 150,               // Overlap between chunks (15%)
  preserveHeaders: true,     // Keep section headers with chunks
  minChunkSize: 100,         // Minimum viable chunk size
  maxChunkSize: 1500,        // Maximum chunk size
  overlapTokens: 150,        // Explicit overlap (matches stride)
};

const EMBEDDING_BATCH_SIZE = 16;  // Batch embeddings for efficiency
const MAX_RETRIES = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Tokenization (Stub for GPT Tokenizer)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estimate token count
 * Uses character-based heuristic: ~4 chars per token (GPT-4 average)
 * 
 * TODO: Replace with actual tokenizer (tiktoken or gpt-tokenizer)
 * - npm install @dqbd/tiktoken or gpt-tokenizer
 * - Use cl100k_base encoding for GPT-4/GPT-3.5
 */
function estimateTokenCount(text: string): number {
  // Heuristic: 1 token ≈ 4 characters for English text
  return Math.ceil(text.length / 4);
}

/**
 * Split text into tokens
 * Simplified word-based tokenization for development
 */
function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(t => t.length > 0);
}

/**
 * Reconstruct text from tokens
 */
function detokenize(tokens: string[]): string {
  return tokens.join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Text Extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract text from document based on type
 * 
 * Supported formats:
 * - PDF: Use PDF.js or similar library
 * - DOCX: Use Mammoth.js for conversion
 * - HTML: Use Cheerio for parsing
 * - JSON: Direct parsing
 * - Plain text: No processing
 * 
 * TODO: Integrate actual document parsers
 * - PDF: pdf-parse or @pdf-lib/pdfjs-dist
 * - DOCX: mammoth
 * - HTML: cheerio
 */
async function extractText(
  document: Document
): Promise<{ text: string; metadata: Record<string, any> }> {
  const docType = document.type;

  switch (docType) {
    case 'pdf':
      // TODO: Integrate PDF parser
      console.log('[Chunking] PDF extraction not implemented - using content as-is');
      return {
        text: document.content,
        metadata: { pages: 1, extractedAt: new Date().toISOString() },
      };

    case 'docx':
      // TODO: Integrate DOCX parser (mammoth)
      console.log('[Chunking] DOCX extraction not implemented - using content as-is');
      return {
        text: document.content,
        metadata: { extractedAt: new Date().toISOString() },
      };

    case 'html':
      // TODO: Integrate HTML parser (cheerio)
      console.log('[Chunking] HTML extraction not implemented - using content as-is');
      return {
        text: document.content,
        metadata: { extractedAt: new Date().toISOString() },
      };

    case 'json':
    case 'faq':
    case 'policy':
    case 'handbook':
    default:
      return {
        text: document.content,
        metadata: { extractedAt: new Date().toISOString() },
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Text Cleaning & Normalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clean and normalize extracted text
 * 
 * Operations:
 * - Remove excessive whitespace
 * - Normalize line breaks
 * - Remove special characters (optional)
 * - Fix common OCR errors (optional)
 * - Preserve structure (headers, lists, tables)
 */
function cleanText(text: string): string {
  let cleaned = text;

  // Normalize line breaks
  cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Remove excessive whitespace
  cleaned = cleaned.replace(/[ \t]+/g, ' ');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // Trim each line
  cleaned = cleaned
    .split('\n')
    .map(line => line.trim())
    .join('\n');

  // Trim overall
  cleaned = cleaned.trim();

  return cleaned;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section Detection
// ─────────────────────────────────────────────────────────────────────────────

interface Section {
  header: string;
  content: string;
  level: number;
  start: number;
  end: number;
}

/**
 * Detect section headers in text
 * 
 * Patterns:
 * - Markdown headers: # Header, ## Header
 * - Numbered sections: 1. Header, 1.1 Header
 * - All-caps lines: HEADER TEXT
 * - Title case followed by colon: Header Title:
 */
function detectSections(text: string): Section[] {
  const lines = text.split('\n');
  const sections: Section[] = [];
  let currentHeader = '';
  let currentContent = '';
  let currentLevel = 0;
  let startLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Markdown header
    const mdMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (mdMatch) {
      if (currentContent.trim()) {
        sections.push({
          header: currentHeader,
          content: currentContent.trim(),
          level: currentLevel,
          start: startLine,
          end: i - 1,
        });
      }
      currentHeader = mdMatch[2];
      currentLevel = mdMatch[1].length;
      currentContent = '';
      startLine = i;
      continue;
    }

    // Numbered section
    const numMatch = line.match(/^(\d+\.)+\s+(.+)$/);
    if (numMatch) {
      if (currentContent.trim()) {
        sections.push({
          header: currentHeader,
          content: currentContent.trim(),
          level: currentLevel,
          start: startLine,
          end: i - 1,
        });
      }
      currentHeader = line;
      currentLevel = (numMatch[1].match(/\./g) || []).length;
      currentContent = '';
      startLine = i;
      continue;
    }

    // All-caps header (at least 3 words)
    if (line === line.toUpperCase() && line.split(/\s+/).length >= 3 && line.length < 100) {
      if (currentContent.trim()) {
        sections.push({
          header: currentHeader,
          content: currentContent.trim(),
          level: currentLevel,
          start: startLine,
          end: i - 1,
        });
      }
      currentHeader = line;
      currentLevel = 1;
      currentContent = '';
      startLine = i;
      continue;
    }

    // Regular content line
    currentContent += line + '\n';
  }

  // Add final section
  if (currentContent.trim()) {
    sections.push({
      header: currentHeader,
      content: currentContent.trim(),
      level: currentLevel,
      start: startLine,
      end: lines.length - 1,
    });
  }

  return sections;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sliding Window Chunking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply sliding window chunking with overlap
 * 
 * Algorithm:
 * 1. Tokenize text
 * 2. Create windows of size `windowSize` with stride `stride`
 * 3. Preserve section headers if configured
 * 4. Ensure minimum chunk size
 * 5. Generate chunk metadata
 */
export function chunkText(
  text: string,
  config: Partial<ChunkingConfig> = {}
): Array<{ content: string; tokenCount: number; windowStart: number; windowEnd: number }> {
  const cfg: ChunkingConfig = {
    ...DEFAULT_CHUNKING_CONFIG,
    ...config,
  };

  const tokens = tokenize(text);
  const chunks: Array<{
    content: string;
    tokenCount: number;
    windowStart: number;
    windowEnd: number;
  }> = [];

  let position = 0;

  while (position < tokens.length) {
    const windowEnd = Math.min(position + cfg.windowSize, tokens.length);
    const chunkTokens = tokens.slice(position, windowEnd);
    const chunkText = detokenize(chunkTokens);
    const tokenCount = estimateTokenCount(chunkText);

    // Skip chunks that are too small (unless it's the last chunk)
    if (tokenCount < cfg.minChunkSize && windowEnd < tokens.length) {
      position += cfg.stride;
      continue;
    }

    chunks.push({
      content: chunkText,
      tokenCount,
      windowStart: position,
      windowEnd,
    });

    // Move window forward by stride
    position += cfg.stride;

    // If we're within one stride of the end, make this the last chunk
    if (position + cfg.stride >= tokens.length && windowEnd < tokens.length) {
      position = tokens.length - cfg.windowSize;
      if (position < chunks[chunks.length - 1].windowEnd) {
        break; // Avoid creating overlapping final chunk
      }
    }
  }

  return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Embedding Generation (Stub)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate embedding for text chunk
 * 
 * TODO: Integrate Azure OpenAI Embeddings API
 * - Model: text-embedding-3-large (3072 dims)
 * - Batch requests for efficiency (max 16 per batch)
 * - Handle rate limits and retries
 * 
 * Stub: Returns random vector for development
 */
async function generateEmbedding(text: string): Promise<number[]> {
  // TODO: Call Azure OpenAI Embeddings API
  // Example:
  // const response = await openai.embeddings.create({
  //   model: "text-embedding-3-large",
  //   input: text,
  // });
  // return response.data[0].embedding;

  // Stub: Generate random 3072-dimensional vector
  const dims = 3072;
  const vector = new Array(dims).fill(0).map(() => Math.random() * 2 - 1);
  
  // Normalize to unit vector
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  return vector.map(val => val / magnitude);
}

/**
 * Generate embeddings in batches
 */
async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    const batchEmbeddings = await Promise.all(
      batch.map(text => generateEmbedding(text))
    );
    embeddings.push(...batchEmbeddings);
    
    console.log(`[Chunking] Generated embeddings: ${embeddings.length}/${texts.length}`);
  }
  
  return embeddings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Ingestion Pipeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ingest document and create chunks
 * 
 * Flow:
 * 1. Extract text from document
 * 2. Clean and normalize text
 * 3. Detect sections (optional)
 * 4. Apply sliding window chunking
 * 5. Generate embeddings for each chunk
 * 6. Create Chunk objects with metadata
 * 
 * Returns array of Chunk objects ready for indexing
 */
export async function ingestDocument(
  document: Document,
  config?: Partial<ChunkingConfig>
): Promise<Chunk[]> {
  console.log(`[Chunking] Ingesting document: ${document.id} (${document.type})`);

  // Step 1: Extract text
  const { text, metadata: extractMetadata } = await extractText(document);
  console.log(`[Chunking] Extracted ${text.length} characters`);

  // Step 2: Clean text
  const cleanedText = cleanText(text);
  console.log(`[Chunking] Cleaned text: ${cleanedText.length} characters`);

  // Step 3: Detect sections (for context preservation)
  const sections = detectSections(cleanedText);
  console.log(`[Chunking] Detected ${sections.length} sections`);

  // Step 4: Chunk text
  const rawChunks = chunkText(cleanedText, config);
  console.log(`[Chunking] Created ${rawChunks.length} chunks`);

  // Step 5: Generate embeddings
  const chunkTexts = rawChunks.map(c => c.content);
  const embeddings = await generateEmbeddingsBatch(chunkTexts);

  // Step 6: Create Chunk objects
  const chunks: Chunk[] = rawChunks.map((rawChunk, idx) => {
    // Find section for this chunk
    const chunkSection = sections.find(
      s => s.start <= rawChunk.windowStart && s.end >= rawChunk.windowStart
    );

    const metadata: ChunkMetadata = {
      tokenCount: rawChunk.tokenCount,
      sectionHeaders: chunkSection ? [chunkSection.header] : [],
      benefitYear: document.metadata.benefitYear,
      carrier: document.metadata.carrier,
      docType: document.type,
    };

    return {
      id: `${document.id}-chunk-${idx}`,
      docId: document.id,
      companyId: document.companyId,
      sectionPath: chunkSection?.header || 'Unknown Section',
      title: chunkSection?.header || document.title,
      content: rawChunk.content,
      vector: embeddings[idx],
      position: idx,
      windowStart: rawChunk.windowStart,
      windowEnd: rawChunk.windowEnd,
      metadata,
      createdAt: new Date(),
    };
  });

  console.log(`[Chunking] Ingestion complete: ${chunks.length} chunks created`);
  return chunks;
}

/**
 * Batch ingest multiple documents
 */
export async function ingestDocumentsBatch(
  documents: Document[],
  config?: Partial<ChunkingConfig>
): Promise<Chunk[]> {
  console.log(`[Chunking] Batch ingestion: ${documents.length} documents`);

  const allChunks: Chunk[] = [];

  for (const doc of documents) {
    try {
      const chunks = await ingestDocument(doc, config);
      allChunks.push(...chunks);
    } catch (error) {
      console.error(`[Chunking] Error ingesting document ${doc.id}:`, error);
      // Continue with other documents
    }
  }

  console.log(`[Chunking] Batch complete: ${allChunks.length} total chunks from ${documents.length} documents`);
  return allChunks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export {
  DEFAULT_CHUNKING_CONFIG,
  estimateTokenCount,
  cleanText,
  detectSections,
  generateEmbedding,
  generateEmbeddingsBatch,
};
