import type { CosmosClient, Database, Container, ItemResponse } from '@azure/cosmos';
import { getCosmosDbConfig } from './config';
import { logger } from '@/lib/logger';

function isBuild(): boolean {
  return process.env.NEXT_PHASE === 'phase-production-build';
}

// Lazy client initialization
let client: CosmosClient | null = null;

async function getCosmosClient(): Promise<CosmosClient | null> {
  if (isBuild()) {
    return null; // Return null during build instead of throwing
  }
  
  if (client) return client;

  const { CosmosClient: CosmosClientClass } = await import('@azure/cosmos');
  const cosmosConfig = getCosmosDbConfig();
  
  client = new CosmosClientClass({
    endpoint: cosmosConfig.endpoint,
    key: cosmosConfig.key,
  });
  
  return client;
}

let database: Database;
let containers: {
  users: Container;
  companies: Container;
  benefits: Container;
  chats: Container;
  documents: Container;
  faqs: Container;
  documentChunks: Container;
  messages: Container;
  notifications: Container;
  searchIndex: Container;
};

// Initialize database and containers
export const initializeCosmosDb = async () => {
  try {
    const { azureConfig } = await import('./config');
    const cosmosConfig = getCosmosDbConfig();
    const cosmosClient = await getCosmosClient();
    
    if (!cosmosClient) {
      logger.warn('Cosmos DB client unavailable');
      return { database: null, containers: {} as any };
    }
    
    database = cosmosClient.database(cosmosConfig.databaseId);
    
    // Create containers if they don't exist
    containers = {
      users: await database.containers.createIfNotExists({
        id: azureConfig.cosmosContainerUsers,
        partitionKey: '/id',
        indexingPolicy: {
          includedPaths: [
            { path: '/*' }
          ],
          excludedPaths: [
            { path: '/"_etag"/?' }
          ]
        }
      }).then(result => result.container),
      
      companies: await database.containers.createIfNotExists({
        id: azureConfig.cosmosContainerCompanies,
        partitionKey: '/id',
        indexingPolicy: {
          includedPaths: [
            { path: '/*' }
          ],
          excludedPaths: [
            { path: '/"_etag"/?' }
          ]
        }
      }).then(result => result.container),
      
      benefits: await database.containers.createIfNotExists({
        id: azureConfig.cosmosContainerBenefits,
        partitionKey: '/companyId',
        indexingPolicy: {
          includedPaths: [
            { path: '/*' }
          ],
          excludedPaths: [
            { path: '/"_etag"/?' }
          ]
        }
      }).then(result => result.container),
      
      chats: await database.containers.createIfNotExists({
        id: azureConfig.cosmosContainerChats,
        partitionKey: '/userId',
        indexingPolicy: {
          includedPaths: [
            { path: '/*' }
          ],
          excludedPaths: [
            { path: '/"_etag"/?' }
          ]
        }
      }).then(result => result.container),
      
      documents: await database.containers.createIfNotExists({
        id: azureConfig.cosmosContainerDocuments,
        partitionKey: '/companyId',
        indexingPolicy: {
          includedPaths: [
            { path: '/*' }
          ],
          excludedPaths: [
            { path: '/"_etag"/?' }
          ]
        }
      }).then(result => result.container),
      
      faqs: await database.containers.createIfNotExists({
        id: azureConfig.cosmosContainerFaqs,
        partitionKey: '/companyId',
        indexingPolicy: {
          includedPaths: [
            { path: '/*' }
          ],
          excludedPaths: [
            { path: '/"_etag"/?' }
          ]
        }
      }).then(result => result.container),
      
      documentChunks: await database.containers.createIfNotExists({
        id: azureConfig.cosmosContainerDocumentChunks,
        partitionKey: '/companyId',
        indexingPolicy: {
          includedPaths: [
            { path: '/*' }
          ],
          excludedPaths: [
            { path: '/"_etag"/?' }
          ]
        }
      }).then(result => result.container),
      
      messages: await database.containers.createIfNotExists({
        id: 'messages',
        partitionKey: '/chatId',
        indexingPolicy: {
          includedPaths: [
            { path: '/*' }
          ],
          excludedPaths: [
            { path: '/"_etag"/?' }
          ]
        }
      }).then(result => result.container),
      
      notifications: await database.containers.createIfNotExists({
        id: 'notifications',
        partitionKey: '/userId',
        indexingPolicy: {
          includedPaths: [
            { path: '/*' }
          ],
          excludedPaths: [
            { path: '/"_etag"/?' }
          ]
        }
      }).then(result => result.container),
      
      searchIndex: await database.containers.createIfNotExists({
        id: 'search-index',
        partitionKey: '/id',
        indexingPolicy: {
          includedPaths: [
            { path: '/*' }
          ],
          excludedPaths: [
            { path: '/"_etag"/?' }
          ]
        }
      }).then(result => result.container),
    };

    logger.info({
      database: cosmosConfig.databaseId,
      containers: Object.keys(containers)
    }, 'Cosmos DB initialized successfully');

    return { database, containers };
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to initialize Cosmos DB');
    throw error;
  }
};

// Generic repository class for Cosmos DB operations
export class CosmosRepository<T extends { id: string }> {
  constructor(private container: Container) {}

  async create(item: T): Promise<ItemResponse<T>> {
    try {
      const response = await this.container.items.create(item);
      logger.info({
        container: this.container.id,
        itemId: item.id,
        statusCode: response.statusCode
      }, 'Item created in Cosmos DB');
      return response;
    } catch (error) {
      logger.error({
        container: this.container.id,
        itemId: item.id,
        error: error instanceof Error ? error.message : String(error)
      }, 'Failed to create item in Cosmos DB');
      throw error;
    }
  }

  async getById(id: string, partitionKey?: string): Promise<T | null> {
    try {
      const response = await this.container.item(id, partitionKey || id).read<T>();
      if (response.statusCode === 404) {
        return null;
      }
      return response.resource || null;
    } catch (error) {
      if ((error as any).code === 404) {
        return null;
      }
      logger.error({
        container: this.container.id,
        itemId: id,
        err: error as Error
      }, 'Failed to get item from Cosmos DB');
      throw error;
    }
  }

  async update(id: string, item: Partial<T>, partitionKey?: string): Promise<ItemResponse<T>> {
    try {
      const response = await this.container.item(id, partitionKey || id).replace({
        ...item,
        id,
        _ts: Date.now() / 1000
      });
      logger.info({
        container: this.container.id,
        itemId: id,
        statusCode: response.statusCode
      }, 'Item updated in Cosmos DB');
      return response as unknown as ItemResponse<T>;
    } catch (error) {
      logger.error({
        container: this.container.id,
        itemId: id,
        err: error as Error
      }, 'Failed to update item in Cosmos DB');
      throw error;
    }
  }

  async delete(id: string, partitionKey?: string): Promise<ItemResponse<T>> {
    try {
      const response = await this.container.item(id, partitionKey || id).delete();
      logger.info({
        container: this.container.id,
        itemId: id,
        statusCode: response.statusCode
      }, 'Item deleted from Cosmos DB');
      return response as unknown as ItemResponse<T>;
    } catch (error) {
      logger.error('Failed to delete item from Cosmos DB', {
        container: this.container.id,
        itemId: id
      }, error as Error);
      throw error;
    }
  }

  async query<TResult = T>(
    options: { query: string; parameters?: Array<{ name: string; value: any }> }
  ): Promise<TResult[]> {
    try {
      const { resources } = await this.container.items
        .query<TResult>({
          query: options.query,
          parameters: options.parameters
        })
        .fetchAll();
      
      logger.info({
        container: this.container.id,
        query: options.query,
        resultCount: resources.length
      }, 'Query executed in Cosmos DB');

      return resources;
    } catch (error) {
      logger.error({
        container: this.container.id,
        query: options.query,
        err: error as Error
      }, 'Failed to execute query in Cosmos DB');
      throw error;
    }
  }

  async list<TResult = T>(
    partitionKey?: string,
    limit?: number
  ): Promise<TResult[]> {
    try {
      const query = this.container.items.query<TResult>('SELECT * FROM c');
      
      if (partitionKey) {
        // query = query.query('c.partitionKey = @partitionKey', { partitionKey });
      }
      
      if (limit) {
        // query = query.take(limit);
      }

      const { resources } = await query.fetchAll();
      
      logger.info({
        container: this.container.id,
        partitionKey,
        limit,
        resultCount: resources.length
      }, 'List query executed in Cosmos DB');

      return resources;
    } catch (error) {
      logger.error('Failed to list items from Cosmos DB', {
        container: this.container.id,
        partitionKey
      }, error as Error);
      throw error;
    }
  }

  // Alias for getById for backward compatibility
  async get(id: string, partitionKey?: string): Promise<T | null> {
    return this.getById(id, partitionKey);
  }

  // Count method
  async count(): Promise<number> {
    try {
      const { resources } = await this.container.items
        .query('SELECT VALUE COUNT(1) FROM c')
        .fetchAll();
      return resources[0] || 0;
    } catch (error) {
      logger.error('Failed to count items in Cosmos DB', {
        container: this.container.id
      }, error as Error);
      throw error;
    }
  }
}

// Initialize repositories
let repositories: {
  users: CosmosRepository<any>;
  companies: CosmosRepository<any>;
  benefits: CosmosRepository<any>;
  chats: CosmosRepository<any>;
  documents: import('@/lib/db/cosmos/repositories/document.repository').DocumentRepository;
  faqs: CosmosRepository<any>;
  documentChunks: CosmosRepository<any>;
  messages: CosmosRepository<any>;
  notifications: CosmosRepository<any>;
  searchIndex: CosmosRepository<any>;
};

export const getRepositories = async () => {
  if (!repositories) {
    const { containers } = await initializeCosmosDb();
    const { getDocumentRepository } = await import('@/lib/db/cosmos/repositories/document.repository');
    
    repositories = {
      users: new CosmosRepository(containers.users),
      companies: new CosmosRepository(containers.companies),
      benefits: new CosmosRepository(containers.benefits),
      chats: new CosmosRepository(containers.chats),
      documents: getDocumentRepository(), // Use factory function instead of singleton
      faqs: new CosmosRepository(containers.faqs),
      documentChunks: new CosmosRepository(containers.documentChunks),
      messages: new CosmosRepository(containers.messages),
      notifications: new CosmosRepository(containers.notifications),
      searchIndex: new CosmosRepository(containers.searchIndex),
    };
  }
  return repositories;
};

// Export getter for advanced operations
export async function getClient(): Promise<CosmosClient | null> {
  return getCosmosClient();
}

// Synchronous export for backward compatibility - returns mock during build
export const cosmosClient = isBuild() ? null : ({
  database: (name: string) => ({
    container: (containerName: string) => null
  })
}) as any;

export { database, containers };
