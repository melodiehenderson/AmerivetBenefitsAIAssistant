import { z } from 'zod';
import { isBuild } from '@/lib/runtime/is-build';

// Azure configuration schema
const azureConfigSchema = z.object({
  // Azure Core
  tenantId: z.string().min(1, 'Azure tenant ID is required'),
  clientId: z.string().min(1, 'Azure client ID is required'),
  clientSecret: z.string().min(1, 'Azure client secret is required'),
  subscriptionId: z.string().min(1, 'Azure subscription ID is required'),
  resourceGroup: z.string().min(1, 'Azure resource group is required'),
  location: z.string().min(1, 'Azure location is required'),

  // Azure AD B2C
  adB2CTenantName: z.string().min(1, 'Azure AD B2C tenant name is required'),
  adB2CClientId: z.string().min(1, 'Azure AD B2C client ID is required'),
  adB2CClientSecret: z.string().min(1, 'Azure AD B2C client secret is required'),
  adB2CSignupSigninPolicy: z.string().min(1, 'Azure AD B2C signup/signin policy is required'),
  adB2CResetPasswordPolicy: z.string().min(1, 'Azure AD B2C reset password policy is required'),
  adB2CEditProfilePolicy: z.string().min(1, 'Azure AD B2C edit profile policy is required'),

  // Azure Cosmos DB
  cosmosEndpoint: z.string().url('Invalid Cosmos DB endpoint URL'),
  cosmosKey: z.string().min(1, 'Cosmos DB key is required'),
  cosmosDatabase: z.string().min(1, 'Cosmos DB database name is required'),
  cosmosContainerUsers: z.string().min(1, 'Cosmos DB users container name is required'),
  cosmosContainerCompanies: z.string().min(1, 'Cosmos DB companies container name is required'),
  cosmosContainerBenefits: z.string().min(1, 'Cosmos DB benefits container name is required'),
  cosmosContainerChats: z.string().min(1, 'Cosmos DB chats container name is required'),
  cosmosContainerDocuments: z.string().min(1, 'Cosmos DB documents container name is required'),
  cosmosContainerFaqs: z.string().min(1, 'Cosmos DB FAQs container name is required'),
  cosmosContainerDocumentChunks: z.string().min(1, 'Cosmos DB document chunks container name is required'),

  // Azure Blob Storage
  storageAccountName: z.string().min(1, 'Storage account name is required'),
  storageAccountKey: z.string().min(1, 'Storage account key is required'),
  storageConnectionString: z.string().min(1, 'Storage connection string is required'),
  storageContainerDocuments: z.string().min(1, 'Documents container name is required'),
  storageContainerImages: z.string().min(1, 'Images container name is required'),

  // Azure Cache for Redis
  redisHost: z.string().min(1, 'Redis host is required'),
  redisPort: z.number().min(1).max(65535, 'Invalid Redis port'),
  redisPassword: z.string().min(1, 'Redis password is required'),
  redisSsl: z.boolean().default(true),
  redisUrl: z.string().url('Invalid Redis URL'),

  // Azure OpenAI Service
  openaiEndpoint: z.string().url('Invalid OpenAI endpoint URL'),
  openaiApiKey: z.string().min(1, 'OpenAI API key is required'),
  openaiApiVersion: z.string().min(1, 'OpenAI API version is required'),
  openaiDeploymentName: z.string().min(1, 'OpenAI deployment name is required'),
  openaiEmbeddingDeployment: z.string().min(1, 'OpenAI embedding deployment name is required'),

  // Azure Search
  searchEndpoint: z.string().url('Invalid search endpoint URL'),
  searchApiKey: z.string().min(1, 'Search API key is required'),
  searchIndexName: z.string().min(1, 'Search index name is required'),

  // Azure Functions
  functionsEndpoint: z.string().url('Invalid functions endpoint URL'),
  functionsMasterKey: z.string().min(1, 'Functions master key is required'),

  // Azure Monitor
  applicationInsightsConnectionString: z.string().min(1, 'Application Insights connection string is required'),
  logAnalyticsWorkspaceId: z.string().min(1, 'Log Analytics workspace ID is required'),
  logAnalyticsSharedKey: z.string().min(1, 'Log Analytics shared key is required'),

  // Azure Key Vault
  keyVaultUrl: z.string().url('Invalid Key Vault URL'),
  keyVaultClientId: z.string().min(1, 'Key Vault client ID is required'),
  keyVaultClientSecret: z.string().min(1, 'Key Vault client secret is required'),

  // Application
  appUrl: z.string().url('Invalid app URL'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Security
  jwtSecret: z.string().min(32, 'JWT secret must be at least 32 characters'),
  encryptionKey: z.string().length(32, 'Encryption key must be exactly 32 characters'),

  // Rate Limiting
  rateLimitRedisUrl: z.string().url('Invalid rate limit Redis URL'),

  // File Upload
  maxFileSize: z.number().positive('Max file size must be positive'),
  allowedFileTypes: z.string().min(1, 'Allowed file types must be specified'),

  // Email
  resendApiKey: z.string().min(1, 'Resend API key is required'),

  // Development
  useEmulator: z.boolean().default(false),
  debugMode: z.boolean().default(false),
});

let cached: z.infer<typeof azureConfigSchema> | null = null;

// Parse and validate environment variables
const parseAzureConfig = (): z.infer<typeof azureConfigSchema> => {
  if (cached) return cached;
  
  // Build mode: return minimal stub without strict validation
  if (isBuild) {
    cached = {} as AzureConfig;
    return cached;
  }
  
  // Development mode: return defaults without strict validation
  const isDev = process.env.NODE_ENV !== 'production';
  
  if (isDev) {
    return {
      // Azure Core
      tenantId: process.env.AZURE_TENANT_ID || 'test-tenant',
      clientId: process.env.AZURE_CLIENT_ID || 'test-client',
      clientSecret: process.env.AZURE_CLIENT_SECRET || 'test-secret',
      subscriptionId: process.env.AZURE_SUBSCRIPTION_ID || 'test-sub',
      resourceGroup: process.env.AZURE_RESOURCE_GROUP || 'test-rg',
      location: process.env.AZURE_LOCATION || 'eastus',

      // Azure AD B2C
      adB2CTenantName: process.env.AZURE_AD_B2C_TENANT_NAME || 'test-b2c',
      adB2CClientId: process.env.AZURE_AD_B2C_CLIENT_ID || 'test-b2c-client',
      adB2CClientSecret: process.env.AZURE_AD_B2C_CLIENT_SECRET || 'test-b2c-secret',
      adB2CSignupSigninPolicy: process.env.AZURE_AD_B2C_SIGNUP_SIGNIN_POLICY || 'test-policy',
      adB2CResetPasswordPolicy: process.env.AZURE_AD_B2C_RESET_PASSWORD_POLICY || 'test-reset',
      adB2CEditProfilePolicy: process.env.AZURE_AD_B2C_EDIT_PROFILE_POLICY || 'test-edit',

      // Azure Cosmos DB
      cosmosEndpoint: process.env.AZURE_COSMOS_ENDPOINT || 'https://test.documents.azure.com:443/',
      cosmosKey: process.env.AZURE_COSMOS_KEY || 'test-key',
      cosmosDatabase: process.env.AZURE_COSMOS_DATABASE || 'test-db',
      cosmosContainerUsers: process.env.AZURE_COSMOS_CONTAINER_USERS || 'users',
      cosmosContainerCompanies: process.env.AZURE_COSMOS_CONTAINER_COMPANIES || 'companies',
      cosmosContainerBenefits: process.env.AZURE_COSMOS_CONTAINER_BENEFITS || 'benefits',
      cosmosContainerChats: process.env.AZURE_COSMOS_CONTAINER_CHATS || 'chats',
      cosmosContainerDocuments: process.env.AZURE_COSMOS_CONTAINER_DOCUMENTS || 'documents',
      cosmosContainerFaqs: process.env.AZURE_COSMOS_CONTAINER_FAQS || 'faqs',
      cosmosContainerDocumentChunks: process.env.AZURE_COSMOS_CONTAINER_DOCUMENT_CHUNKS || 'chunks',

      // Azure Blob Storage
      storageAccountName: process.env.AZURE_STORAGE_ACCOUNT_NAME || 'teststorage',
      storageAccountKey: process.env.AZURE_STORAGE_ACCOUNT_KEY || 'test-key',
  // Avoid embedding any default storage connection string with AccountKey in source.
  // Require it to be provided via environment variable.
  storageConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING || '',
      storageContainerDocuments: process.env.AZURE_STORAGE_CONTAINER_DOCUMENTS || 'documents',
      storageContainerImages: process.env.AZURE_STORAGE_CONTAINER_IMAGES || 'images',

      // Azure Cache for Redis
      redisHost: process.env.AZURE_REDIS_HOST || 'localhost',
      redisPort: parseInt(process.env.AZURE_REDIS_PORT || '6379'),
      redisPassword: process.env.AZURE_REDIS_PASSWORD || 'test-password',
      redisSsl: process.env.AZURE_REDIS_SSL === 'true',
      redisUrl: process.env.AZURE_REDIS_URL || 'redis://localhost:6379',

      // Azure OpenAI Service
      // Trim here as well because dev .env files often include Windows CR/LF characters.
      openaiEndpoint: (process.env.AZURE_OPENAI_ENDPOINT || 'https://test.openai.azure.com/').trim(),
      openaiApiKey: (process.env.AZURE_OPENAI_API_KEY || 'test-key').trim(),
      openaiApiVersion: (process.env.AZURE_OPENAI_API_VERSION || '2024-02-01').trim(),
      openaiDeploymentName: (process.env.AZURE_OPENAI_DEPLOYMENT_NAME || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4').trim(),
      // Prefer canonical plural var, fall back to singular for compatibility
      openaiEmbeddingDeployment: (process.env.AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT || process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-3-large').trim(),

      // Azure Cognitive Search
      searchEndpoint: process.env.AZURE_SEARCH_ENDPOINT || 'https://test.search.windows.net',
      searchApiKey: process.env.AZURE_SEARCH_API_KEY || 'test-key',
  // Prefer canonical AZURE_SEARCH_INDEX, fall back to legacy *_NAME
  searchIndexName: process.env.AZURE_SEARCH_INDEX || process.env.AZURE_SEARCH_INDEX_NAME || 'test-index',

      // Azure Functions
      functionsEndpoint: process.env.AZURE_FUNCTIONS_ENDPOINT || 'https://test.azurewebsites.net',
      functionsMasterKey: process.env.AZURE_FUNCTIONS_MASTER_KEY || 'test-key',

      // Application Insights
      applicationInsightsConnectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING || 'InstrumentationKey=00000000-0000-0000-0000-000000000000',
      logAnalyticsWorkspaceId: process.env.AZURE_LOG_ANALYTICS_WORKSPACE_ID || 'test-workspace',
      logAnalyticsSharedKey: process.env.AZURE_LOG_ANALYTICS_SHARED_KEY || 'test-key',

      // Azure Key Vault
      keyVaultUrl: process.env.AZURE_KEY_VAULT_URL || 'https://test.vault.azure.net/',
      keyVaultClientId: process.env.AZURE_KEY_VAULT_CLIENT_ID || 'test-client',
      keyVaultClientSecret: process.env.AZURE_KEY_VAULT_CLIENT_SECRET || 'test-secret',

      // JWT and Encryption
      jwtSecret: process.env.JWT_SECRET || 'test-jwt-secret',
      encryptionKey: process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef',

      // Rate Limiting
      rateLimitRedisUrl: process.env.RATE_LIMIT_REDIS_URL || 'redis://localhost:6379',

      // File Upload
      maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760'),
      allowedFileTypes: process.env.ALLOWED_FILE_TYPES || 'pdf,doc,docx,txt',

      // Email Service
      resendApiKey: process.env.RESEND_API_KEY || 'test-resend-key',

      // Development
      useEmulator: process.env.USE_EMULATOR === 'true',
      debugMode: process.env.DEBUG_MODE === 'true',
    } as z.infer<typeof azureConfigSchema>;
  }

  // Production mode: RELAXED validation (only validate RAG-critical vars)
  // Skip strict Zod validation to avoid crashing on missing Azure vars
  const rawConfig = {
    // Azure Core (optional - not needed for RAG)
    tenantId: process.env.AZURE_TENANT_ID || 'not-set',
    clientId: process.env.AZURE_CLIENT_ID || 'not-set',
    clientSecret: process.env.AZURE_CLIENT_SECRET || 'not-set',
    subscriptionId: process.env.AZURE_SUBSCRIPTION_ID || 'not-set',
    resourceGroup: process.env.AZURE_RESOURCE_GROUP || 'not-set',
    location: process.env.AZURE_LOCATION || 'eastus',

    // Azure AD B2C (optional)
    adB2CTenantName: process.env.AZURE_AD_B2C_TENANT_NAME || 'not-set',
    adB2CClientId: process.env.AZURE_AD_B2C_CLIENT_ID || 'not-set',
    adB2CClientSecret: process.env.AZURE_AD_B2C_CLIENT_SECRET || 'not-set',
    adB2CSignupSigninPolicy: process.env.AZURE_AD_B2C_SIGNUP_SIGNIN_POLICY || 'not-set',
    adB2CResetPasswordPolicy: process.env.AZURE_AD_B2C_RESET_PASSWORD_POLICY || 'not-set',
    adB2CEditProfilePolicy: process.env.AZURE_AD_B2C_EDIT_PROFILE_POLICY || 'not-set',

    // Azure Cosmos DB (optional)
    cosmosEndpoint: (process.env.AZURE_COSMOS_ENDPOINT || 'https://not-set.documents.azure.com').trim(),
    cosmosKey: (process.env.AZURE_COSMOS_KEY || 'not-set').trim(),
    cosmosDatabase: process.env.AZURE_COSMOS_DATABASE || 'BenefitsChat',
    cosmosContainerUsers: process.env.AZURE_COSMOS_CONTAINER_USERS || 'Users',
    cosmosContainerCompanies: process.env.AZURE_COSMOS_CONTAINER_COMPANIES || 'Companies',
    cosmosContainerBenefits: process.env.AZURE_COSMOS_CONTAINER_BENEFITS || 'Benefits',
    cosmosContainerChats: process.env.AZURE_COSMOS_CONTAINER_CHATS || 'Conversations',
    cosmosContainerDocuments: process.env.AZURE_COSMOS_CONTAINER_DOCUMENTS || 'Documents',
    cosmosContainerFaqs: process.env.AZURE_COSMOS_CONTAINER_FAQS || 'FAQs',
    cosmosContainerDocumentChunks: process.env.AZURE_COSMOS_CONTAINER_DOCUMENT_CHUNKS || 'DocumentChunks',

    // Azure Blob Storage (optional)
    storageAccountName: process.env.AZURE_STORAGE_ACCOUNT_NAME || 'not-set',
    storageAccountKey: process.env.AZURE_STORAGE_ACCOUNT_KEY || 'not-set',
    storageConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING || '',
    storageContainerDocuments: process.env.AZURE_STORAGE_CONTAINER_DOCUMENTS || 'documents',
    storageContainerImages: process.env.AZURE_STORAGE_CONTAINER_IMAGES || 'images',

    // Azure Cache for Redis (REQUIRED for cache)
    // Parse Redis URL properly to extract host, port, and password
    redisHost: (() => {
      if (process.env.AZURE_REDIS_HOST) return process.env.AZURE_REDIS_HOST;
      if (process.env.REDIS_URL) {
        // Handle various Redis URL formats:
        // redis://host:port
        // rediss://:password@host:port
        // https://:password@host:port (incorrect but handle gracefully)
        try {
          const url = new URL(process.env.REDIS_URL.replace('rediss://', 'https://').replace('redis://', 'http://'));
          return url.hostname;
        } catch {
          // Fallback regex for malformed URLs
          const match = process.env.REDIS_URL.match(/@([^:@]+)/);
          return match ? match[1] : 'localhost';
        }
      }
      return 'localhost';
    })(),
    redisPort: process.env.AZURE_REDIS_PORT ? parseInt(process.env.AZURE_REDIS_PORT, 10) : 6380,
    redisPassword: (() => {
      if (process.env.AZURE_REDIS_PASSWORD) return process.env.AZURE_REDIS_PASSWORD;
      if (process.env.REDIS_URL) {
        // Extract password from URL: redis://:password@host or rediss://:password@host
        try {
          const url = new URL(process.env.REDIS_URL.replace('rediss://', 'https://').replace('redis://', 'http://'));
          return url.password || '';
        } catch {
          // Fallback regex: extract between first : and @
          const match = process.env.REDIS_URL.match(/:\/\/:([^@]+)@/);
          return match ? match[1] : '';
        }
      }
      return '';
    })(),
    redisSsl: process.env.AZURE_REDIS_SSL !== 'false',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

    // Azure OpenAI Service (REQUIRED for RAG)
    // CRITICAL: .trim() to remove whitespace/CRLF from env var values (Windows line endings)
    openaiEndpoint: (process.env.AZURE_OPENAI_ENDPOINT || '').trim(),
    openaiApiKey: (process.env.AZURE_OPENAI_API_KEY || '').trim(),
    openaiApiVersion: (process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview').trim(),
    openaiDeploymentName: (process.env.AZURE_OPENAI_DEPLOYMENT_NAME || process.env.AZURE_OPENAI_DEPLOYMENT || '').trim(),
    openaiEmbeddingDeployment: (process.env.AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT || process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || '').trim(),

    // Azure Search (REQUIRED for RAG)
    searchEndpoint: (process.env.AZURE_SEARCH_ENDPOINT || '').trim(),
    searchApiKey: (process.env.AZURE_SEARCH_API_KEY || process.env.AZURE_SEARCH_ADMIN_KEY || '').trim(),
    searchIndexName: (process.env.AZURE_SEARCH_INDEX || process.env.AZURE_SEARCH_INDEX_NAME || 'chunks_prod_v1').trim(),

    // Azure Functions (optional)
    functionsEndpoint: process.env.AZURE_FUNCTIONS_ENDPOINT || 'https://not-set.azurewebsites.net',
    functionsMasterKey: process.env.AZURE_FUNCTIONS_MASTER_KEY || 'not-set',

    // Azure Monitor (optional)
    applicationInsightsConnectionString: process.env.AZURE_APPLICATION_INSIGHTS_CONNECTION_STRING || '',
    logAnalyticsWorkspaceId: process.env.AZURE_LOG_ANALYTICS_WORKSPACE_ID || 'not-set',
    logAnalyticsSharedKey: process.env.AZURE_LOG_ANALYTICS_SHARED_KEY || 'not-set',

    // Azure Key Vault (optional)
    keyVaultUrl: process.env.AZURE_KEY_VAULT_URL || 'https://not-set.vault.azure.net',
    keyVaultClientId: process.env.AZURE_KEY_VAULT_CLIENT_ID || 'not-set',
    keyVaultClientSecret: process.env.AZURE_KEY_VAULT_CLIENT_SECRET || 'not-set',

    // Application
    appUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    nodeEnv: (process.env.NODE_ENV || 'development') as 'development' | 'production' | 'test',
    logLevel: (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error',

    // Security
    jwtSecret: process.env.JWT_SECRET || 'not-set-change-in-production',
    encryptionKey: process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef',

    // Rate Limiting
    rateLimitRedisUrl: process.env.RATE_LIMIT_REDIS_URL || process.env.REDIS_URL || 'redis://localhost:6379',

    // File Upload
    maxFileSize: process.env.MAX_FILE_SIZE ? parseInt(process.env.MAX_FILE_SIZE, 10) : 10485760,
    allowedFileTypes: process.env.ALLOWED_FILE_TYPES || 'pdf,doc,docx,txt',

    // Email
    resendApiKey: process.env.RESEND_API_KEY || 'not-set',

    // Development
    useEmulator: process.env.AZURE_USE_EMULATOR === 'true',
    debugMode: process.env.AZURE_DEBUG_MODE === 'true',
  };

  // SKIP Zod validation in production - just return the config with defaults
  // This prevents crashes when optional Azure vars are missing
  cached = rawConfig as z.infer<typeof azureConfigSchema>;
  return cached;
};

export const azureConfig = parseAzureConfig();
export type AzureConfig = z.infer<typeof azureConfigSchema>;

// Helper functions for common configurations
export const getCosmosDbConfig = () => ({
  endpoint: azureConfig.cosmosEndpoint,
  key: azureConfig.cosmosKey,
  databaseId: azureConfig.cosmosDatabase,
});

export const getBlobStorageConfig = () => ({
  connectionString: azureConfig.storageConnectionString,
  accountName: azureConfig.storageAccountName,
  accountKey: azureConfig.storageAccountKey,
});

export const getRedisConfig = () => ({
  host: azureConfig.redisHost,
  port: azureConfig.redisPort,
  password: azureConfig.redisPassword,
  tls: azureConfig.redisSsl ? {} : undefined,
});

export const getOpenAIConfig = () => ({
  endpoint: azureConfig.openaiEndpoint,
  apiKey: azureConfig.openaiApiKey,
  apiVersion: azureConfig.openaiApiVersion,
  deploymentName: azureConfig.openaiDeploymentName,
  embeddingDeployment: azureConfig.openaiEmbeddingDeployment,
});

export const getSearchConfig = () => ({
  endpoint: azureConfig.searchEndpoint,
  apiKey: azureConfig.searchApiKey,
  indexName: azureConfig.searchIndexName,
});

export const getAdB2CConfig = () => ({
  tenantName: azureConfig.adB2CTenantName,
  clientId: azureConfig.adB2CClientId,
  clientSecret: azureConfig.adB2CClientSecret,
  signupSigninPolicy: azureConfig.adB2CSignupSigninPolicy,
  resetPasswordPolicy: azureConfig.adB2CResetPasswordPolicy,
  editProfilePolicy: azureConfig.adB2CEditProfilePolicy,
});
