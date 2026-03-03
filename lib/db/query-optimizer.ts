// @ts-nocheck
/**
 * Database query optimization utilities
 */

import { cosmosService } from '@/lib/azure/cost-optimized-services';
import { getRepositories } from '@/lib/azure/cosmos';
import { logger } from '@/lib/logger';

interface QueryOptions {
  limit?: number;
  orderBy?: { field: string; direction: 'asc' | 'desc' };
  where?: Array<{ field: string; operator: any; value: any }>;
  select?: string[];
}

// Helper type to ensure documents have an id property
type WithId<T = Record<string, unknown>> = T & { id: string };

export class QueryOptimizer {
  /**
   * Optimized query for user documents with caching
   */
  static async getUsers(companyId: string, options: QueryOptions = {}) {
    const startTime = Date.now();
    
    try {
      // Build Cosmos DB query
      let queryText = 'SELECT * FROM c WHERE c.companyId = @companyId';
      const parameters = [{ name: '@companyId', value: companyId }];
      
      // Apply filters
      if (options.where) {
        options.where.forEach((condition, index) => {
          const paramName = `@where${index}`;
          queryText += ` AND c.${condition.field} ${condition.operator} ${paramName}`;
          parameters.push({ name: paramName, value: condition.value });
        });
      }
      
      // Apply ordering
      if (options.orderBy) {
        queryText += ` ORDER BY c.${options.orderBy.field} ${options.orderBy.direction.toUpperCase()}`;
      }
      
      // Apply limit
      if (options.limit) {
        queryText += ` OFFSET 0 LIMIT ${options.limit}`;
      }
      
      const users = await cosmosService.queryItems('users', queryText, parameters);
      
      const duration = Date.now() - startTime;
      logger.info({
        collection: 'users',
        companyId,
        resultCount: users.length,
        duration
      }, 'Database query completed');
      
      return users;
    } catch (error) {
      logger.error('Database query error', {
        error: error instanceof Error ? error.message : String(error),
        collection: 'users',
        companyId,
      });
      throw error;
    }
  }

  /**
   * Optimized query for conversations with pagination
   */
  static async getConversations(
    companyId: string,
    userId: string,
    options: QueryOptions = {}
  ) {
    const startTime = Date.now();
    
    try {
      // Build Cosmos DB query for conversations
      let queryText = 'SELECT * FROM c WHERE c.companyId = @companyId AND c.userId = @userId';
      const parameters = [
        { name: '@companyId', value: companyId },
        { name: '@userId', value: userId }
      ];
      
      // Apply ordering
      if (options.orderBy) {
        queryText += ` ORDER BY c.${options.orderBy.field} ${options.orderBy.direction.toUpperCase()}`;
      } else {
        // Default ordering by updatedAt
        queryText += ' ORDER BY c.updatedAt DESC';
      }
      
      // Apply limit
      if (options.limit) {
        queryText += ` OFFSET 0 LIMIT ${options.limit}`;
      }
      
      const conversations = await cosmosService.queryItems('chats', queryText, parameters);
      
      const duration = Date.now() - startTime;
      logger.info({
        collection: 'conversations',
        companyId,
        userId,
        resultCount: conversations.length,
        duration
      }, 'Database query completed');
      
      return conversations;
    } catch (error) {
      logger.error('Database query error', {
        error: error instanceof Error ? error.message : String(error),
        collection: 'conversations',
        companyId,
        userId,
      });
      throw error;
    }
  }

  /**
   * Batch operations for better performance
   */
  static async batchUpdate(
    updates: Array<{
      collection: string;
      docId: string;
      data: any;
    }>
  ) {
    const startTime = Date.now();
    
    try {
      // Process updates sequentially for Cosmos DB
      const results = [];
      
      for (const { collection, docId, data } of updates) {
        try {
          // Get existing document first
          const existing = await cosmosService.getItem(collection, docId);
          if (existing) {
            // Update existing document
            const updated = { ...existing, ...data };
            await cosmosService.createItem(collection, updated);
            results.push({ success: true, docId });
          } else {
            // Create new document
            await cosmosService.createItem(collection, { id: docId, ...data });
            results.push({ success: true, docId });
          }
        } catch (error) {
          results.push({ success: false, docId, error: error instanceof Error ? error.message : 'Unknown error' });
        }
      }
      
      const duration = Date.now() - startTime;
      logger.info({
        operationCount: updates.length,
        successfulCount: results.filter(r => r.success).length,
        duration
      }, 'Batch update completed');
      
      return { success: true, count: results.filter(r => r.success).length, results };
    } catch (error) {
      logger.error('Batch update error', {
        error: error instanceof Error ? error.message : String(error),
        updateCount: updates.length,
      });
      throw error;
    }
  }

  /**
   * Get document with caching
   */
  static async getDocument(
    collection: string,
    docId: string,
    useCache: boolean = true
  ) {
    const startTime = Date.now();
    
    try {
      // Simple in-memory cache for development
      if (useCache && process.env.NODE_ENV === 'development') {
        const cacheKey = `${collection}:${docId}`;
        const cached = (global as any).__docCache?.[cacheKey];
        if (cached && Date.now() - cached.timestamp < 60000) { // 1 minute cache
          return cached.data;
        }
      }
      
      const doc = await cosmosService.getItem(collection, docId);
      
      if (!doc) {
        return null;
      }
      
      const data = { id: docId, ...doc };
      
      // Cache the result
      if (useCache && process.env.NODE_ENV === 'development') {
        if (!(global as any).__docCache) {
          (global as any).__docCache = {};
        }
        (global as any).__docCache[`${collection}:${docId}`] = {
          data,
          timestamp: Date.now(),
        };
      }
      
      const duration = Date.now() - startTime;
      logger.info({
        collection,
        docId,
        cached: false,
        duration
      }, 'Document retrieved');
      
      return data;
    } catch (error) {
      logger.error('Document get error', {
        error: error instanceof Error ? error.message : String(error),
        collection,
        docId,
      });
      throw error;
    }
  }

  /**
   * Search with text indexing
   */
  static async searchDocuments(
    companyId: string,
    searchTerm: string,
    collection: string = 'documents'
  ) {
    const startTime = Date.now();
    
    try {
      // Use Cosmos DB query for search
      // In production, consider using Azure Cognitive Search or Elasticsearch
      const queryText = `
        SELECT * FROM c 
        WHERE c.companyId = @companyId 
          AND c.searchableText >= @searchTerm 
          AND c.searchableText <= @searchTermEnd
        ORDER BY c.searchableText
        OFFSET 0 LIMIT 20
      `;
      
      const parameters = [
        { name: '@companyId', value: companyId },
        { name: '@searchTerm', value: searchTerm },
        { name: '@searchTermEnd', value: searchTerm + '\uf8ff' }
      ];
      
      const results = await cosmosService.queryItems(collection, queryText, parameters);
      
      const duration = Date.now() - startTime;
      logger.info({
        collection,
        companyId,
        searchTerm,
        resultCount: results.length,
        duration
      }, 'Search query completed');
      
      return results;
    } catch (error) {
      logger.error('Search query error', {
        error: error instanceof Error ? error.message : String(error),
        collection,
        companyId,
        searchTerm,
      });
      throw error;
    }
  }
}
