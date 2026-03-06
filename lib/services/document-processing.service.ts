/**
 * Document Processing Service
 * Handles actual file parsing and text extraction from uploaded documents
 */


import { logger } from '@/lib/logger';
import { getStorageServices } from '@/lib/azure/storage';
import { getRepositories } from '@/lib/azure/cosmos';
import { azureOpenAIService } from '@/lib/azure/openai';
import { Document } from '@/lib/schemas/unified';

// PDF parsing - lazy loaded
let pdfjsLib: any = null;

async function getPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import('pdfjs-dist');
  
  // Configure worker for Node.js
  if (typeof window === 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/build/pdf.worker.min.js';
  }
  return pdfjsLib;
}

// DOC/DOCX parsing
import * as mammoth from 'mammoth';

// Text processing
import { createHash } from 'crypto';

export interface ProcessedDocument {
  id: string;
  title: string;
  content: string;
  summary: string;
  chunks: DocumentChunk[];
  metadata: {
    wordCount: number;
    pageCount?: number;
    language: string;
    topics: string[];
    entities: string[];
  };
}

export interface DocumentChunk {
  id: string;
  content: string;
  pageNumber?: number;
  section?: string;
  embedding?: number[];
  metadata: Record<string, any>;
}

export class DocumentProcessingService {
  private readonly maxChunkSize = 1000; // characters per chunk
  private readonly chunkOverlap = 200; // characters overlap between chunks

  /**
   * Process uploaded document and extract text content
   */
  async processDocument(documentId: string, fileBuffer: Buffer, fileName: string): Promise<ProcessedDocument> {
    const startTime = Date.now();
    
    try {
      logger.info('Starting document processing', {
        documentId,
        fileName,
        fileSize: fileBuffer.length,
      });

      // Determine file type
      const fileType = this.getFileType(fileName);
      
      // Extract text content based on file type
      let content: string;
      let pageCount: number | undefined;
      
      switch (fileType) {
        case 'pdf':
          const pdfResult = await this.extractTextFromPDF(fileBuffer);
          content = pdfResult.text;
          pageCount = pdfResult.pageCount;
          break;
          
        case 'docx':
          content = await this.extractTextFromDOCX(fileBuffer);
          break;
          
        case 'doc':
          content = await this.extractTextFromDOC(fileBuffer);
          break;
          
        case 'txt':
          content = fileBuffer.toString('utf-8');
          break;
          
        default:
          throw new Error(`Unsupported file type: ${fileType}`);
      }

      // Clean and normalize content
      content = this.cleanText(content);
      
      // Generate summary
      const summary = await this.generateSummary(content);
      
      // Extract metadata
      const metadata = await this.extractMetadata(content, pageCount);
      
      // Create document chunks
      const chunks = await this.createChunks(content, documentId);
      
      // Generate embeddings for chunks
      await this.generateEmbeddings(chunks);

      const processedDoc: ProcessedDocument = {
        id: documentId,
        title: this.extractTitle(fileName, content),
        content,
        summary,
        chunks,
        metadata,
      };

      // Update document in database
      await this.updateDocumentInDatabase(documentId, processedDoc);

      const duration = Date.now() - startTime;
      
      logger.info('Document processing completed', {
        documentId,
        fileName,
        duration,
        wordCount: metadata.wordCount,
        chunkCount: chunks.length,
        pageCount,
      });

      return processedDoc;
    } catch (error) {
      logger.error('Document processing failed', {
        documentId,
        fileName,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, error as Error);
      
      // Update document status to error
      await this.updateDocumentStatus(documentId, 'error', error instanceof Error ? error.message : 'Processing failed');
      
      throw error;
    }
  }
  /**
   * Extract text from PDF files
   */
  private async extractTextFromPDF(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
    try {
      const pdfLib = await getPdfJs();
      const pdf = await pdfLib.getDocument({ data: buffer }).promise;
      const pageCount = pdf.numPages;
      let fullText = '';

      for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ');
        fullText += `\n--- Page ${pageNum} ---\n${pageText}\n`;
      }

      return { text: fullText, pageCount };
    } catch (error) {
      logger.error('PDF text extraction failed', { data: error });
      throw new Error('Failed to extract text from PDF');
    }
  }

  /**
   * Extract text from DOCX files
   */
  private async extractTextFromDOCX(buffer: Buffer): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    } catch (error) {
      logger.error('DOCX text extraction failed', { data: error });
      throw new Error('Failed to extract text from DOCX');
    }
  }

  /**
   * Extract text from DOC files
   */
  private async extractTextFromDOC(buffer: Buffer): Promise<string> {
    try {
      // For DOC files, we'll use mammoth as well (it supports some DOC files)
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    } catch (error) {
      logger.error('DOC text extraction failed', { data: error });
      throw new Error('Failed to extract text from DOC');
    }
  }

  /**
   * Clean and normalize extracted text
   */
  private cleanText(text: string): string {
    return text
      // Remove excessive whitespace
      .replace(/\s+/g, ' ')
      // Remove page markers
      .replace(/--- Page \d+ ---/g, '')
      // Remove special characters but keep punctuation
      .replace(/[^\w\s.,!?;:()\-'"]/g, '')
      // Normalize line breaks
      .replace(/\n+/g, '\n')
      .trim();
  }

  /**
   * Generate document summary
   */
  private async generateSummary(content: string): Promise<string> {
    try {
      // Simple extractive summarization - take first few sentences
      const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
      const summary = sentences.slice(0, 3).join('. ').trim();
      
      return summary || content.substring(0, 200) + '...';
    } catch (error) {
      logger.error('Summary generation failed', { data: error });
      return content.substring(0, 200) + '...';
    }
  }

  /**
   * Extract metadata from document content
   */
  private async extractMetadata(content: string, pageCount?: number): Promise<{
    wordCount: number;
    pageCount?: number;
    language: string;
    topics: string[];
    entities: string[];
  }> {
    const wordCount = content.split(/\s+/).length;
    
    // Simple language detection (assume English for now)
    const language = 'en';
    
    // Extract topics using simple keyword matching
    const topics = this.extractTopics(content);
    
    // Extract entities (simple approach)
    const entities = this.extractEntities(content);
    
    return {
      wordCount,
      pageCount,
      language,
      topics,
      entities,
    };
  }

  /**
   * Extract topics from content
   */
  private extractTopics(content: string): string[] {
    const topicKeywords = [
      'health insurance', 'dental', 'vision', '401k', 'retirement',
      'benefits', 'coverage', 'premium', 'deductible', 'copay',
      'HSA', 'FSA', 'life insurance', 'disability', 'PTO', 'vacation',
      'medical', 'prescription', 'pharmacy', 'wellness', 'mental health',
    ];

    const foundTopics: string[] = [];
    const lowerContent = content.toLowerCase();

    for (const topic of topicKeywords) {
      if (lowerContent.includes(topic.toLowerCase())) {
        foundTopics.push(topic);
      }
    }

    return [...new Set(foundTopics)]; // Remove duplicates
  }

  /**
   * Extract entities from content
   */
  private extractEntities(content: string): string[] {
    // Simple entity extraction - look for capitalized words and common patterns
    const entities: string[] = [];
    
    // Company names (words that appear after "Company:", "Provider:", etc.)
    const companyPattern = /(?:Company|Provider|Insurer):\s*([A-Z][a-zA-Z\s&]+)/g;
    let match;
    while ((match = companyPattern.exec(content)) !== null) {
      entities.push(match[1].trim());
    }

    // Dollar amounts
    const amountPattern = /\$[\d,]+(?:\.\d{2})?/g;
    while ((match = amountPattern.exec(content)) !== null) {
      entities.push(match[0]);
    }

    // Dates
    const datePattern = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g;
    while ((match = datePattern.exec(content)) !== null) {
      entities.push(match[0]);
    }

    return [...new Set(entities)]; // Remove duplicates
  }

  /**
   * Create document chunks for RAG processing
   */
  private async createChunks(content: string, documentId: string): Promise<DocumentChunk[]> {
    const chunks: DocumentChunk[] = [];
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);

    let currentChunk = '';
    let chunkIndex = 0;
    let pageNumber = 1;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i].trim();
      
      // Check if adding this sentence would exceed chunk size
      if (currentChunk.length + sentence.length > this.maxChunkSize && currentChunk.length > 0) {
        // Create chunk from current content
        const chunk = this.createChunk(currentChunk, documentId, chunkIndex, pageNumber);
        chunks.push(chunk);
        
        // Start new chunk with overlap
        const overlap = this.getChunkOverlap(currentChunk);
        currentChunk = overlap + ' ' + sentence;
        chunkIndex++;
      } else {
        currentChunk += (currentChunk ? '. ' : '') + sentence;
      }

      // Simple page detection (every 20 sentences = 1 page)
      if (i > 0 && i % 20 === 0) {
        pageNumber++;
      }
    }

    // Add final chunk if there's remaining content
    if (currentChunk.trim().length > 0) {
      const chunk = this.createChunk(currentChunk, documentId, chunkIndex, pageNumber);
      chunks.push(chunk);
    }

    return chunks;
  }

  /**
   * Create individual document chunk
   */
  private createChunk(content: string, documentId: string, index: number, pageNumber: number): DocumentChunk {
    const chunkId = createHash('md5')
      .update(`${documentId}-${index}-${content.substring(0, 50)}`)
      .digest('hex');

    return {
      id: chunkId,
      content: content.trim(),
      pageNumber,
      section: this.detectSection(content),
      metadata: {
        documentId,
        chunkIndex: index,
        wordCount: content.split(/\s+/).length,
        createdAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Get overlap text for chunk continuity
   */
  private getChunkOverlap(text: string): string {
    const words = text.split(/\s+/);
    const overlapWords = words.slice(-Math.floor(this.chunkOverlap / 10)); // Approximate word count
    return overlapWords.join(' ');
  }

  /**
   * Detect section from content
   */
  private detectSection(content: string): string {
    const sectionKeywords = [
      'introduction', 'overview', 'coverage', 'benefits', 'eligibility',
      'enrollment', 'costs', 'premiums', 'deductibles', 'exclusions',
      'claims', 'contact', 'terms', 'conditions', 'policy',
    ];

    const lowerContent = content.toLowerCase();
    
    for (const keyword of sectionKeywords) {
      if (lowerContent.includes(keyword)) {
        return keyword.charAt(0).toUpperCase() + keyword.slice(1);
      }
    }

    return 'General';
  }

  /**
   * Generate embeddings for document chunks
   */
  private async generateEmbeddings(chunks: DocumentChunk[]): Promise<void> {
    try {
      for (const chunk of chunks) {
        // Generate embedding using Azure OpenAI
        const embedding = await azureOpenAIService.generateEmbedding(chunk.content);
        chunk.embedding = embedding;
      }
        } catch (error) {
      logger.error('Embedding generation failed', { data: error });
      // Continue without embeddings - they can be generated later
    }
  }

  /**
   * Update document in database with processed content
   */
  private async updateDocumentInDatabase(documentId: string, processedDoc: ProcessedDocument): Promise<void> {
    try {
      const repositories = await getRepositories();
      
      // Update document
      await repositories.documents.update(documentId, {
        content: processedDoc.content,
        summary: processedDoc.summary,
        status: 'processed',
        chunkCount: processedDoc.chunks.length,
        metadata: processedDoc.metadata,
        updatedAt: new Date().toISOString(),
      } as any);

      // Save document chunks
      for (const chunk of processedDoc.chunks) {
        await repositories.documentChunks.create(chunk);
      }

      logger.info('Document updated in database', {
        documentId,
        chunkCount: processedDoc.chunks.length,
      });
    } catch (error) {
      logger.error('Failed to update document in database', {
        documentId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, error as Error);
      throw error;
    }
  }

  /**
   * Update document status
   */
  private async updateDocumentStatus(documentId: string, status: string, error?: string): Promise<void> {
    try {
      const repositories = await getRepositories();
      
      await repositories.documents.update(documentId, {
        status,
        error,
        updatedAt: new Date().toISOString(),
      } as any);
    } catch (error) {
      logger.error('Failed to update document status', {
        documentId,
        status,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, error as Error);
    }
  }

  /**
   * Extract title from filename or content
   */
  private extractTitle(fileName: string, content: string): string {
    // Try to extract title from content first
    const titleMatch = content.match(/^([A-Z][^.!?]*)/);
    if (titleMatch && titleMatch[1].length > 10 && titleMatch[1].length < 100) {
      return titleMatch[1].trim();
    }

    // Fall back to filename
    return fileName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
  }

  /**
   * Get file type from filename
   */
  private getFileType(fileName: string): string {
    const extension = fileName.split('.').pop()?.toLowerCase();
    
    switch (extension) {
      case 'pdf':
        return 'pdf';
      case 'docx':
        return 'docx';
      case 'doc':
        return 'doc';
      case 'txt':
        return 'txt';
      default:
        throw new Error(`Unsupported file type: ${extension}`);
    }
  }
}

// Export singleton instance
export const documentProcessingService = new DocumentProcessingService();
