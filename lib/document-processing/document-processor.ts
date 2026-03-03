/**
 * Document Processing Pipeline
 * Handles parsing, indexing, and content extraction from various document types
 */

import { Document } from '@/lib/schemas/unified';
import { logger } from '@/lib/logger';
import { getStorageServices } from '@/lib/azure/storage';
import { getRepositories } from '@/lib/azure/cosmos';
import { z } from 'zod';
import crypto from 'crypto';

// Document processing result interface
export interface ProcessingResult {
  success: boolean;
  extractedText: string;
  metadata: DocumentMetadata;
  documentId?: string; // ID of the stored document (if success)
  error?: string;
}

export interface DocumentMetadata {
  title: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  pageCount?: number;
  wordCount?: number;
  language?: string;
  createdAt: Date;
  fileSize: number;
  mimeType: string;
  category?: string;
  tags?: string[];
}

// Document type handlers
export abstract class DocumentHandler {
  abstract canHandle(mimeType: string): boolean;
  abstract extractText(buffer: Buffer): Promise<ProcessingResult>;
  abstract extractMetadata(buffer: Buffer): Promise<DocumentMetadata>;
}

// PDF Handler
export class PDFHandler extends DocumentHandler {
  canHandle(mimeType: string): boolean {
    return mimeType === 'application/pdf';
  }

  async extractText(buffer: Buffer): Promise<ProcessingResult> {
    try {
      const { PDFParse } = await import('pdf-parse');
      // Convert Buffer to Uint8Array
      const uint8Array = new Uint8Array(buffer);
      const parser = new PDFParse(uint8Array);
      const textResult = await parser.getText();
      const infoResult = await parser.getInfo();
      
      const extractedText = textResult.text || '';
      const pdfInfo = infoResult.info || {};
      
      return {
        success: true,
        extractedText,
        metadata: {
          title: pdfInfo.Title || 'Untitled Document',
          author: pdfInfo.Author,
          subject: pdfInfo.Subject,
          pageCount: infoResult.total || 0,
          wordCount: extractedText.split(/\s+/).length,
          createdAt: new Date(),
          fileSize: buffer.length,
          mimeType: 'application/pdf',
          category: 'benefits',
          tags: this.extractTags(extractedText)
        }
      };
    } catch (error) {
      logger.error('PDF processing failed', { data: error });
      return {
        success: false,
        extractedText: '',
        metadata: {
          title: 'PDF Document',
          createdAt: new Date(),
          fileSize: buffer.length,
          mimeType: 'application/pdf',
          category: 'benefits'
        },
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async extractMetadata(buffer: Buffer): Promise<DocumentMetadata> {
    try {
      const { PDFParse } = await import('pdf-parse');
      // Convert Buffer to Uint8Array
      const uint8Array = new Uint8Array(buffer);
      const parser = new PDFParse(uint8Array);
      const textResult = await parser.getText();
      const infoResult = await parser.getInfo();
      
      const extractedText = textResult.text || '';
      const pdfInfo = infoResult.info || {};
      
      return {
        title: pdfInfo.Title || 'Untitled Document',
        author: pdfInfo.Author,
        subject: pdfInfo.Subject,
        pageCount: infoResult.total || 0,
        wordCount: extractedText.split(/\s+/).length,
        createdAt: new Date(),
        fileSize: buffer.length,
        mimeType: 'application/pdf',
        category: 'benefits',
        tags: this.extractTags(extractedText)
      };
    } catch (error) {
      logger.error('PDF metadata extraction failed', { data: error });
      return {
        title: 'PDF Document',
        createdAt: new Date(),
        fileSize: buffer.length,
        mimeType: 'application/pdf',
        category: 'benefits'
      };
    }
  }

  private extractTags(text: string): string[] {
    const tags: string[] = [];
    const lowerText = text.toLowerCase();
    
    // Common benefits-related keywords
    const keywords = [
      'health insurance', 'dental', 'vision', '401k', 'retirement',
      'hsa', 'fsa', 'life insurance', 'disability', 'pension',
      'benefits', 'enrollment', 'coverage', 'deductible', 'copay',
      'premium', 'out of pocket', 'network', 'provider'
    ];
    
    keywords.forEach(keyword => {
      if (lowerText.includes(keyword)) {
        tags.push(keyword);
      }
    });
    
    return Array.from(new Set(tags)); // Remove duplicates
  }
}

// Word Document Handler
export class WordHandler extends DocumentHandler {
  canHandle(mimeType: string): boolean {
    return mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
           mimeType === 'application/msword';
  }

  async extractText(buffer: Buffer): Promise<ProcessingResult> {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      
      return {
        success: true,
        extractedText: result.value,
        metadata: {
          title: 'Word Document',
          pageCount: Math.ceil(result.value.length / 2000), // Rough estimate
          wordCount: result.value.split(/\s+/).length,
          createdAt: new Date(),
          fileSize: buffer.length,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          category: 'benefits',
          tags: this.extractTags(result.value)
        }
      };
    } catch (error) {
      logger.error('Word document processing failed', { data: error });
      return {
        success: false,
        extractedText: '',
        metadata: {
          title: 'Word Document',
          createdAt: new Date(),
          fileSize: buffer.length,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          category: 'benefits'
        },
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async extractMetadata(buffer: Buffer): Promise<DocumentMetadata> {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      
      return {
        title: 'Word Document',
        pageCount: Math.ceil(result.value.length / 2000),
        wordCount: result.value.split(/\s+/).length,
        createdAt: new Date(),
        fileSize: buffer.length,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        category: 'benefits',
        tags: this.extractTags(result.value)
      };
    } catch (error) {
      logger.error('Word document metadata extraction failed', { data: error });
      return {
        title: 'Word Document',
        createdAt: new Date(),
        fileSize: buffer.length,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        category: 'benefits'
      };
    }
  }

  private extractTags(text: string): string[] {
    const tags: string[] = [];
    const lowerText = text.toLowerCase();
    
    const keywords = [
      'health insurance', 'dental', 'vision', '401k', 'retirement',
      'hsa', 'fsa', 'life insurance', 'disability', 'pension',
      'benefits', 'enrollment', 'coverage', 'deductible', 'copay',
      'premium', 'out of pocket', 'network', 'provider'
    ];
    
    keywords.forEach(keyword => {
      if (lowerText.includes(keyword)) {
        tags.push(keyword);
      }
    });
    
    return [...new Set(tags)];
  }
}

// Text Handler
export class TextHandler extends DocumentHandler {
  canHandle(mimeType: string): boolean {
    return mimeType === 'text/plain' || mimeType === 'text/markdown';
  }

  async extractText(buffer: Buffer): Promise<ProcessingResult> {
    try {
      const text = buffer.toString('utf-8');
      
      return {
        success: true,
        extractedText: text,
        metadata: {
          title: 'Text Document',
          wordCount: text.split(/\s+/).length,
          createdAt: new Date(),
          fileSize: buffer.length,
          mimeType: 'text/plain',
          category: 'benefits',
          tags: this.extractTags(text)
        }
      };
    } catch (error) {
      logger.error('Text document processing failed', { data: error });
      return {
        success: false,
        extractedText: '',
        metadata: {
          title: 'Text Document',
          createdAt: new Date(),
          fileSize: buffer.length,
          mimeType: 'text/plain',
          category: 'benefits'
        },
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async extractMetadata(buffer: Buffer): Promise<DocumentMetadata> {
    try {
      const text = buffer.toString('utf-8');
      
      return {
        title: 'Text Document',
        wordCount: text.split(/\s+/).length,
        createdAt: new Date(),
        fileSize: buffer.length,
        mimeType: 'text/plain',
        category: 'benefits',
        tags: this.extractTags(text)
      };
    } catch (error) {
      logger.error('Text document metadata extraction failed', { data: error });
      return {
        title: 'Text Document',
        createdAt: new Date(),
        fileSize: buffer.length,
        mimeType: 'text/plain',
        category: 'benefits'
      };
    }
  }

  private extractTags(text: string): string[] {
    const tags: string[] = [];
    const lowerText = text.toLowerCase();
    
    const keywords = [
      'health insurance', 'dental', 'vision', '401k', 'retirement',
      'hsa', 'fsa', 'life insurance', 'disability', 'pension',
      'benefits', 'enrollment', 'coverage', 'deductible', 'copay',
      'premium', 'out of pocket', 'network', 'provider'
    ];
    
    keywords.forEach(keyword => {
      if (lowerText.includes(keyword)) {
        tags.push(keyword);
      }
    });
    
    return [...new Set(tags)];
  }
}

// Main Document Processor
export class DocumentProcessor {
  private handlers: DocumentHandler[] = [
    new PDFHandler(),
    new WordHandler(),
    new TextHandler()
  ];

  async processDocument(
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    companyId: string,
    uploadedBy: string
  ): Promise<ProcessingResult> {
    try {
      // Find appropriate handler
      const handler = this.handlers.find(h => h.canHandle(mimeType));
      
      if (!handler) {
        return {
          success: false,
          extractedText: '',
          metadata: {
            title: fileName,
            createdAt: new Date(),
            fileSize: fileBuffer.length,
            mimeType,
            category: 'benefits'
          },
          error: `Unsupported file type: ${mimeType}`
        };
      }

      // Process the document
      const result = await handler.extractText(fileBuffer);
      
      if (result.success) {
        // Store the processed document and capture the created document ID
        const documentId = await this.storeDocument(result, fileName, companyId, uploadedBy);
        
        // Index for search using the actual document ID
        await this.indexDocument(result, fileName, companyId, documentId);
        
        // Add documentId to result
        result.documentId = documentId;
      }

      return result;
    } catch (error) {
      logger.error('Document processing failed', { data: error });
      return {
        success: false,
        extractedText: '',
        metadata: {
          title: fileName,
          createdAt: new Date(),
          fileSize: fileBuffer.length,
          mimeType,
          category: 'benefits'
        },
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async storeDocument(
    result: ProcessingResult,
    fileName: string,
    companyId: string,
    uploadedBy: string
  ): Promise<string> {
    try {
      const repositories = await getRepositories();
      
      const generatedId = crypto.randomUUID();
      const document: Document = {
        id: generatedId,
        title: result.metadata.title,
        content: result.extractedText,
        fileName,
        fileType: result.metadata.mimeType,
        fileSize: result.metadata.fileSize,
        companyId,
        uploadedBy,
        documentType: 'benefits_guide',
        ragProcessed: false,
        tags: result.metadata.tags || [],
        metadata: {
          pageCount: result.metadata.pageCount,
          wordCount: result.metadata.wordCount,
          language: result.metadata.language,
          author: result.metadata.author,
          subject: result.metadata.subject,
          keywords: result.metadata.keywords
        },
        status: 'processed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1
      };

      await repositories.documents.create(document as any);
      
      logger.info('Document stored successfully', {
        documentId: document.id,
        fileName,
        companyId,
        uploadedBy
      });
      
      // Return created document ID for downstream linkage
      return generatedId;
    } catch (error) {
      logger.error('Failed to store document', { data: error });
      throw error;
    }
  }

  private async indexDocument(
    result: ProcessingResult,
    fileName: string,
    companyId: string,
    documentId: string
  ): Promise<void> {
    try {
      logger.info('Starting document indexing pipeline', {
        documentId,
        fileName,
        companyId,
        textLength: result.extractedText.length
      });

      // ========================================================================
      // STEP 1: Create basic search index entry (for traditional search)
      // ========================================================================
      const searchIndex = {
        id: crypto.randomUUID(),
        documentId: documentId,
        title: result.metadata.title,
        content: result.extractedText,
        fileName,
        companyId,
        category: result.metadata.category || 'benefits',
        tags: result.metadata.tags || [],
        searchableText: `${result.metadata.title} ${result.extractedText}`.toLowerCase(),
        indexedAt: new Date().toISOString()
      };

      const repositories = await getRepositories();
      await repositories.searchIndex.create(searchIndex);
      
      logger.info('Basic search index created', {
        documentId,
        fileName
      });

      // ========================================================================
      // STEP 2: Chunk and index for RAG vector search
      // ========================================================================
      // Import chunking and embedding utilities
      const { ingestDocument } = await import('@/lib/rag/chunking');
      const { upsertDocumentChunks } = await import('@/lib/ai/vector-search');
      
      // Create document object for chunking
      const doc: any = {
        id: documentId,
        companyId,
        title: result.metadata.title,
        content: result.extractedText,
        type: 'pdf' as any,
        metadata: {
          benefitYear: new Date().getFullYear(),
          carrier: 'N/A',
          category: result.metadata.category || 'benefits',
          tags: result.metadata.tags || []
        }
      };

      // Ingest document and create chunks with embeddings
      logger.info('Starting document chunking', { documentId });
      const chunks = await ingestDocument(doc);
      
      logger.info('Document chunked successfully', {
        documentId,
        chunkCount: chunks.length
      });

      // Prepare chunks for Azure AI Search (filter out chunks without embeddings)
      const chunksForIndex = chunks
        .filter(chunk => chunk.vector && chunk.vector.length > 0)
        .map(chunk => ({
          id: chunk.id,
          text: chunk.content,
          embedding: chunk.vector as number[], // Safe to assert since we filtered
          metadata: {
            documentId: documentId,
            companyId: companyId,
            sectionPath: chunk.sectionPath,
            title: chunk.title,
            position: chunk.position,
            ...chunk.metadata
          }
        }));

      // Upsert chunks to Azure AI Search
      logger.info('Upserting chunks to Azure AI Search', {
        documentId,
        chunkCount: chunksForIndex.length
      });

      const upsertResult = await upsertDocumentChunks(companyId, chunksForIndex);
      
      if (upsertResult.status === 'success') {
        logger.info('Document indexed successfully for RAG', {
          documentId,
          fileName,
          companyId,
          chunksIndexed: upsertResult.vectorsUpserted,
          searchableTextLength: searchIndex.searchableText.length
        });
      } else {
        logger.error('Failed to upsert document chunks', {
          documentId,
          fileName,
          companyId
        });
      }

    } catch (error) {
      logger.error('Failed to index document', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      // Don't throw here as document storage succeeded
    }
  }

  async getSupportedTypes(): Promise<string[]> {
    const types: string[] = [];
    
    for (const handler of this.handlers) {
      // This is a simplified approach - in reality, you'd need to track supported types
      if (handler instanceof PDFHandler) {
        types.push('application/pdf');
      } else if (handler instanceof WordHandler) {
        types.push('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        types.push('application/msword');
      } else if (handler instanceof TextHandler) {
        types.push('text/plain');
        types.push('text/markdown');
      }
    }
    
    return types;
  }
}

// Export singleton instance
export const documentProcessor = new DocumentProcessor();
