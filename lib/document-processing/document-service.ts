/**
 * Document Service
 * High-level service for document management and processing
 */

import { DocumentProcessor, ProcessingResult } from './document-processor';
import { getStorageServices } from '@/lib/azure/storage';
import { getRepositories } from '@/lib/azure/cosmos';
import { logger } from '@/lib/logger';
import { Document } from '@/lib/schemas/unified';
import { z } from 'zod';

// Document upload request schema
const uploadRequestSchema = z.object({
  fileName: z.string().min(1, 'File name is required'),
  mimeType: z.string().min(1, 'MIME type is required'),
  fileSize: z.number().positive('File size must be positive'),
  category: z.string().optional().default('benefits'),
  tags: z.array(z.string()).optional().default([])
});

// Document search request schema
const searchRequestSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().positive().max(100).default(20),
  offset: z.number().nonnegative().default(0)
});

export interface DocumentSearchResult {
  id: string;
  title: string;
  content: string;
  fileName: string;
  mimeType: string;
  category: string;
  tags: string[];
  relevanceScore: number;
  highlights: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DocumentUploadResult {
  success: boolean;
  documentId?: string;
  error?: string;
  processingResult?: ProcessingResult;
}

export class DocumentService {
  private processor: DocumentProcessor;

  constructor() {
    this.processor = new DocumentProcessor();
  }

  /**
   * Upload and process a document
   */
  async uploadDocument(
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    companyId: string,
    uploadedBy: string,
    metadata?: {
      category?: string;
      tags?: string[];
    }
  ): Promise<DocumentUploadResult> {
    try {
      // Validate request
      const validatedData = uploadRequestSchema.parse({
        fileName,
        mimeType,
        fileSize: fileBuffer.length,
        category: metadata?.category,
        tags: metadata?.tags
      });

      // Check file size limit (10MB)
      const maxFileSize = 10 * 1024 * 1024; // 10MB
      if (fileBuffer.length > maxFileSize) {
        return {
          success: false,
          error: 'File size exceeds 10MB limit'
        };
      }

      // Check if file type is supported
      const supportedTypes = await this.processor.getSupportedTypes();
      if (!supportedTypes.includes(mimeType)) {
        return {
          success: false,
          error: `Unsupported file type: ${mimeType}. Supported types: ${supportedTypes.join(', ')}`
        };
      }

      // Process the document
      const processingResult = await this.processor.processDocument(
        fileBuffer,
        fileName,
        mimeType,
        companyId,
        uploadedBy
      );

      if (!processingResult.success) {
        return {
          success: false,
          error: processingResult.error || 'Document processing failed',
          processingResult
        };
      }

      // Get the stored document ID
      const repositories = await getRepositories();
      const queryResult = await repositories.documents.query({
        query: 'SELECT * FROM c WHERE c.companyId = @companyId AND c.uploadedBy = @uploadedBy ORDER BY c.createdAt DESC OFFSET 0 LIMIT 1',
        parameters: [
          { name: '@companyId', value: companyId },
          { name: '@uploadedBy', value: uploadedBy }
        ]
      });
      const documents = (queryResult as any).items ?? queryResult;
      const latestDocument = (Array.isArray(documents) ? documents : [])[0];

      return {
        success: true,
        documentId: latestDocument?.id,
        processingResult
      };

    } catch (error) {
      logger.error('Document upload failed', { data: error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Search documents
   */
  async searchDocuments(
    query: string,
    companyId: string,
    options?: {
      category?: string;
      tags?: string[];
      limit?: number;
      offset?: number;
    }
  ): Promise<DocumentSearchResult[]> {
    try {
      // Validate search request
      const validatedData = searchRequestSchema.parse({
        query,
        category: options?.category,
        tags: options?.tags,
        limit: options?.limit,
        offset: options?.offset
      });

      const repositories = await getRepositories();
      
      // Build search query
      let searchQuery = 'SELECT * FROM c WHERE c.companyId = @companyId';
      const parameters: any[] = [{ name: '@companyId', value: companyId }];

      // Add text search
      if (validatedData.query) {
        searchQuery += ' AND (CONTAINS(LOWER(c.title), LOWER(@query)) OR CONTAINS(LOWER(c.content), LOWER(@query)))';
        parameters.push({ name: '@query', value: validatedData.query });
      }

      // Add category filter
      if (validatedData.category) {
        searchQuery += ' AND c.category = @category';
        parameters.push({ name: '@category', value: validatedData.category });
      }

      // Add tags filter
      if (validatedData.tags && validatedData.tags.length > 0) {
        searchQuery += ' AND ARRAY_CONTAINS(c.tags, @tag)';
        parameters.push({ name: '@tag', value: validatedData.tags[0] }); // Simplified for single tag
      }

      searchQuery += ' ORDER BY c.updatedAt DESC';

      // Execute search
      const queryResult = await repositories.documents.query({
        query: searchQuery,
        parameters
      });
      const documents = ((queryResult as any).items ?? queryResult) as any[];

      // Limit results
      const limitedDocuments = documents.slice(
        validatedData.offset,
        validatedData.offset + validatedData.limit
      );

      // Transform to search results
      const results: DocumentSearchResult[] = limitedDocuments.map(doc => ({
        id: doc.id,
        title: doc.title,
        content: doc.content,
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        category: doc.category,
        tags: doc.tags || [],
        relevanceScore: this.calculateRelevanceScore(doc, validatedData.query),
        highlights: this.generateHighlights(doc, validatedData.query),
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt
      }));

      // Sort by relevance score
      results.sort((a, b) => b.relevanceScore - a.relevanceScore);

      logger.info('Document search completed', {
        query: validatedData.query,
        companyId,
        resultCount: results.length,
        totalFound: documents.length
      });

      return results;

    } catch (error) {
      logger.error('Document search failed', { data: error });
      return [];
    }
  }

  /**
   * Get document by ID
   */
  async getDocument(documentId: string, companyId: string): Promise<Document | null> {
    try {
      const repositories = await getRepositories();
      const document = await repositories.documents.getById(documentId) as any;
      
      if (!document || document.companyId !== companyId) {
        return null;
      }

      return document;
    } catch (error) {
      logger.error('Failed to get document', { data: error });
      return null;
    }
  }

  /**
   * List documents for a company
   */
  async listDocuments(
    companyId: string,
    options?: {
      category?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<Document[]> {
    try {
      const repositories = await getRepositories();
      
      let query = 'SELECT * FROM c WHERE c.companyId = @companyId';
      const parameters: any[] = [{ name: '@companyId', value: companyId }];

      if (options?.category) {
        query += ' AND c.category = @category';
        parameters.push({ name: '@category', value: options.category });
      }

      query += ' ORDER BY c.updatedAt DESC';

      const queryResult3 = await repositories.documents.query({
        query,
        parameters
      });
      const documents3 = ((queryResult3 as any).items ?? queryResult3) as any[];

      const limit = options?.limit || 50;
      const offset = options?.offset || 0;

      return documents3.slice(offset, offset + limit);

    } catch (error) {
      logger.error('Failed to list documents', { data: error });
      return [];
    }
  }

  /**
   * Delete document
   */
  async deleteDocument(documentId: string, companyId: string, userId: string): Promise<boolean> {
    try {
      const repositories = await getRepositories();
      
      // Verify document exists and user has permission
      const document = await repositories.documents.getById(documentId) as any;
      if (!document || document.companyId !== companyId) {
        return false;
      }

      // Delete from storage
      const storageServices = await getStorageServices();
      await storageServices.documents.deleteFile(document.fileName);

      // Delete from database
      await repositories.documents.delete(documentId);

      // Delete from search index
      await repositories.searchIndex.delete(documentId);

      logger.info('Document deleted successfully', {
        documentId,
        companyId,
        userId
      });

      return true;

    } catch (error) {
      logger.error('Failed to delete document', { data: error });
      return false;
    }
  }

  /**
   * Get document statistics
   */
  async getDocumentStats(companyId: string): Promise<{
    totalDocuments: number;
    totalSize: number;
    documentsByCategory: Record<string, number>;
    documentsByType: Record<string, number>;
    recentUploads: number;
  }> {
    try {
      const repositories = await getRepositories();
      const queryResult4 = await repositories.documents.query({
        query: 'SELECT * FROM c WHERE c.companyId = @companyId',
        parameters: [{ name: '@companyId', value: companyId }]
      });
      const companyDocuments = (((queryResult4 as any).items ?? queryResult4) as any[]);

      const stats = {
        totalDocuments: companyDocuments.length,
        totalSize: companyDocuments.reduce((sum, doc) => sum + doc.fileSize, 0),
        documentsByCategory: {} as Record<string, number>,
        documentsByType: {} as Record<string, number>,
        recentUploads: 0
      };

      // Calculate category breakdown
      companyDocuments.forEach(doc => {
        const category = doc.category || 'uncategorized';
        stats.documentsByCategory[category] = (stats.documentsByCategory[category] || 0) + 1;
        
        const type = doc.mimeType.split('/')[1] || 'unknown';
        stats.documentsByType[type] = (stats.documentsByType[type] || 0) + 1;
      });

      // Calculate recent uploads (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      stats.recentUploads = companyDocuments.filter(doc => 
        new Date(doc.createdAt) > sevenDaysAgo
      ).length;

      return stats;

    } catch (error) {
      logger.error('Failed to get document stats', { data: error });
      return {
        totalDocuments: 0,
        totalSize: 0,
        documentsByCategory: {},
        documentsByType: {},
        recentUploads: 0
      };
    }
  }

  /**
   * Calculate relevance score for search results
   */
  private calculateRelevanceScore(document: Document, query: string): number {
    if (!query) return 0;

    const lowerQuery = query.toLowerCase();
    const lowerTitle = document.title.toLowerCase();
    const lowerContent = (document.content || '').toLowerCase();

    let score = 0;

    // Title matches are worth more
    if (lowerTitle.includes(lowerQuery)) {
      score += 10;
    }

    // Content matches
    const contentMatches = (lowerContent.match(new RegExp(lowerQuery, 'g')) || []).length;
    score += contentMatches * 2;

    // Tag matches
    if (document.tags) {
      const tagMatches = document.tags.filter(tag => 
        tag.toLowerCase().includes(lowerQuery)
      ).length;
      score += tagMatches * 5;
    }

    return score;
  }

  /**
   * Generate highlights for search results
   */
  private generateHighlights(document: Document, query: string): string[] {
    if (!query) return [];

    const highlights: string[] = [];
    const lowerQuery = query.toLowerCase();
    const content = document.content || '';
    const words = content.split(/\s+/);
    const queryWords = query.split(/\s+/);

    // Find sentences containing query words
    const sentences = content.split(/[.!?]+/);
    
    sentences.forEach(sentence => {
      const lowerSentence = sentence.toLowerCase();
      if (queryWords.some(word => lowerSentence.includes(word.toLowerCase()))) {
        // Truncate long sentences
        const truncated = sentence.length > 200 
          ? sentence.substring(0, 200) + '...'
          : sentence;
        highlights.push(truncated.trim());
      }
    });

    return highlights.slice(0, 3); // Return top 3 highlights
  }
}

// Export singleton instance
export const documentService = new DocumentService();
