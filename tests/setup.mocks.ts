import { vi } from 'vitest';

vi.mock('@/lib/azure/config', () => ({
  parseAzureConfig: () => ({
    tenantId: 't', clientId: 'c', clientSecret: 's',
    subscriptionId: 'sub', resourceGroup: 'rg', location: 'eastus',
    adB2CTenantName: 'b2c', adB2CClientId: 'b2c-cid', adB2CClientSecret: 'b2c-secret',
    adB2CSignupSigninPolicy: 'p1', adB2CResetPasswordPolicy: 'p2', adB2CEditProfilePolicy: 'p3',
    cosmosEndpoint: 'http://localhost', cosmosKey: 'key', cosmosDatabase: 'db',
    cosmosContainerUsers: 'users', cosmosContainerCompanies: 'companies',
    cosmosContainerBenefits: 'benefits', cosmosContainerChats: 'chats',
    cosmosContainerDocuments: 'documents', cosmosContainerFaqs: 'faqs',
    cosmosContainerDocumentChunks: 'docchunks',
    storageAccountName: 'sa', storageAccountKey: 'sakey',
    storageConnectionString: 'UseDevelopmentStorage=true',
    storageContainerDocuments: 'docs', storageContainerImages: 'imgs',
    redisHost: 'localhost', redisPassword: 'pw', redisUrl: 'redis://localhost:6379',
    openaiEndpoint: 'http://localhost', openaiApiKey: 'test', openaiApiVersion: '2024-02-01',
    openaiDeploymentName: 'gpt', openaiEmbeddingDeployment: 'emb',
    searchEndpoint: 'http://localhost', searchApiKey: 'search-key', searchIndexName: 'idx',
    functionsEndpoint: 'http://localhost', functionsMasterKey: 'func-key',
    applicationInsightsConnectionString:
      'InstrumentationKey=00000000-0000-0000-0000-000000000000',
    logAnalyticsWorkspaceId: 'law', logAnalyticsSharedKey: 'law-key',
    keyVaultUrl: 'http://localhost', keyVaultClientId: 'kv-client', keyVaultClientSecret: 'kv-secret',
    jwtSecret: 'jwt',
    encryptionKey: '0123456789abcdef0123456789abcdef', // 32 chars
    rateLimitRedisUrl: 'redis://localhost:6379', resendApiKey: 'resend-key',
  }),
}));

vi.mock('@/lib/azure/cosmos', () => ({
  cosmosClient: {
    database: vi.fn().mockReturnValue({ container: vi.fn().mockReturnValue({}) }),
  },
  getRepositories: vi.fn().mockReturnValue({
    documentChunks: { query: vi.fn().mockResolvedValue([]) },
    chats: { query: vi.fn().mockResolvedValue([]) },
    documents: { query: vi.fn().mockResolvedValue([]) },
  }),
}));

vi.mock('@microsoft/applicationinsights-web', () => {
  class ApplicationInsights {
    constructor(_: any) {}
    loadAppInsights() {}
    trackEvent() {}
    trackException() {}
    trackPageView() {}
    flush() {}
  }
  return { ApplicationInsights };
});
