/**
 * Cosmos DB Operations
 * Type-safe database operations with proper error handling and pagination
 * 
 * Best Practices:
 * - Type safety with generics
 * - Pagination support with continuation tokens
 * - Query parameterization to prevent injection
 * - Proper error handling and logging
 * - Optimistic concurrency control with ETags
 * - Bulk operations for efficiency
 */

import { Container, SqlQuerySpec, FeedResponse } from '@azure/cosmos';
import { CosmosContainers } from './client';

/**
 * Base document interface
 * All Cosmos documents extend this
 */
export interface CosmosDocument {
  id: string;
  _etag?: string;
  _ts?: number;
}

/**
 * Paginated query result
 */
export interface PaginatedResult<T> {
  items: T[];
  continuationToken?: string;
  hasMore: boolean;
  requestCharge: number;
}

/**
 * Query options
 */
export interface QueryOptions {
  maxItemCount?: number;
  continuationToken?: string;
  partitionKey?: string;
}

/**
 * Generic CRUD Operations
 */
export class CosmosOperations {
  /**
   * Create a document
   * Uses optimistic concurrency control
   */
  static async create<T extends CosmosDocument>(
    container: Container,
    document: T,
    partitionKey: string
  ): Promise<T> {
    try {
      const { resource } = await container.items.create(document);
      return resource as T;
    } catch (error) {
      console.error('Cosmos create error:', error);
      throw new Error(`Failed to create document: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Read a document by ID
   */
  static async read<T extends CosmosDocument>(
    container: Container,
    id: string,
    partitionKey: string
  ): Promise<T | null> {
    try {
      const { resource } = await container.item(id, partitionKey).read<T>();
      return resource || null;
    } catch (error: any) {
      if (error.code === 404) {
        return null;
      }
      console.error('Cosmos read error:', error);
      throw new Error(`Failed to read document: ${error.message}`);
    }
  }

  /**
   * Update a document
   * Uses ETag for optimistic concurrency control
   */
  static async update<T extends CosmosDocument>(
    container: Container,
    id: string,
    partitionKey: string,
    document: Partial<T>,
    etag?: string
  ): Promise<T> {
    try {
      const { resource } = await container.item(id, partitionKey).replace(
        { ...document, id },
        etag ? { accessCondition: { type: 'IfMatch', condition: etag } } : undefined
      );
      return resource as unknown as T;
    } catch (error: any) {
      if (error.code === 412) {
        throw new Error('Document was modified by another process. Please retry.');
      }
      console.error('Cosmos update error:', error);
      throw new Error(`Failed to update document: ${error.message}`);
    }
  }

  /**
   * Delete a document
   */
  static async delete(
    container: Container,
    id: string,
    partitionKey: string
  ): Promise<void> {
    try {
      await container.item(id, partitionKey).delete();
    } catch (error: any) {
      if (error.code === 404) {
        return; // Already deleted
      }
      console.error('Cosmos delete error:', error);
      throw new Error(`Failed to delete document: ${error.message}`);
    }
  }

  /**
   * Query documents with pagination
   * Uses parameterized queries to prevent SQL injection
   */
  static async query<T extends CosmosDocument>(
    container: Container,
    querySpec: SqlQuerySpec,
    options: QueryOptions = {}
  ): Promise<PaginatedResult<T>> {
    try {
      const { maxItemCount = 50, continuationToken, partitionKey } = options;

      const queryOptions: any = {
        maxItemCount,
        continuationToken,
      };

      if (partitionKey) {
        queryOptions.partitionKey = partitionKey;
      }

      const response: FeedResponse<T> = await container.items
        .query<T>(querySpec, queryOptions)
        .fetchNext();

      return {
        items: response.resources,
        continuationToken: response.continuationToken,
        hasMore: !!response.continuationToken,
        requestCharge: response.requestCharge,
      };
    } catch (error) {
      console.error('Cosmos query error:', error);
      throw new Error(`Failed to query documents: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Bulk create operation
   * More efficient for multiple documents
   */
  static async bulkCreate<T extends CosmosDocument>(
    container: Container,
    documents: T[],
    partitionKey: string
  ): Promise<T[]> {
    try {
      const operations = documents.map((doc) => ({
        operationType: 'Create' as const,
        resourceBody: doc,
        partitionKey,
      }));

      const bulkResult = await container.items.bulk(operations as any);
      const responses = Array.isArray(bulkResult) ? bulkResult : (bulkResult as any).result ?? [];
      
      return responses
        .filter((r: any) => r.statusCode >= 200 && r.statusCode < 300)
        .map((r: any) => r.resourceBody as T);
    } catch (error) {
      console.error('Cosmos bulk create error:', error);
      throw new Error(`Failed to bulk create documents: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Count documents matching query
   */
  static async count(
    container: Container,
    querySpec: SqlQuerySpec,
    partitionKey?: string
  ): Promise<number> {
    try {
      const countQuery: SqlQuerySpec = {
        query: `SELECT VALUE COUNT(1) FROM c WHERE ${querySpec.query.replace('SELECT * FROM c WHERE', '')}`,
        parameters: querySpec.parameters,
      };

      const { resources } = await container.items
        .query(countQuery, partitionKey ? { partitionKey } : undefined)
        .fetchAll();

      return resources[0] || 0;
    } catch (error) {
      console.error('Cosmos count error:', error);
      return 0;
    }
  }

  /**
   * Upsert (create or update) a document
   */
  static async upsert<T extends CosmosDocument>(
    container: Container,
    document: T,
    partitionKey: string
  ): Promise<T> {
    try {
      const { resource } = await container.items.upsert(document);
      return resource as unknown as T;
    } catch (error) {
      console.error('Cosmos upsert error:', error);
      throw new Error(`Failed to upsert document: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

/**
 * Helper function to build parameterized queries
 * Prevents SQL injection
 */
export function buildQuery(
  baseQuery: string,
  parameters: Record<string, any>
): SqlQuerySpec {
  return {
    query: baseQuery,
    parameters: Object.entries(parameters).map(([name, value]) => ({
      name: `@${name}`,
      value,
    })),
  };
}
