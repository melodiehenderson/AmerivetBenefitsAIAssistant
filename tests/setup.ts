/**
 * Test Setup Configuration
 * Global test configuration and utilities
 */

import { beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';
// --- ensure encoders exist (Node env quirk in some libs)
import { TextEncoder, TextDecoder } from 'node:util';
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;

// Force environment variables for ALL tests to prevent constructor crashes
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';
process.env.AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY || 'test-azure-key';
process.env.AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || 'https://test.openai.azure.com';

// In tests we intentionally avoid real Azure clients (Search/Cosmos/etc.)
// to keep the suite hermetic and prevent background initialization errors.
process.env.DISABLE_AZURE = process.env.DISABLE_AZURE || '1';

// Mock for window.crypto needed by Playwright in a Node environment
// Set up global window object if it doesn't exist
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {} as any;
}

// Mock crypto for both window and globalThis
const cryptoMock = {
  getRandomValues: (arr: any) => {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  },
  randomUUID: () => 'mock-uuid-' + Math.random().toString(36).substr(2, 9),
  random: () => Math.random(),
};

Object.defineProperty(globalThis.window, 'crypto', {
  value: cryptoMock,
  configurable: true,
});

Object.defineProperty(globalThis, 'crypto', {
  value: cryptoMock,
  configurable: true,
});

// 1) Hard-stub azure config so validation never runs
vi.mock('@/lib/azure/config', () => ({
  getAzureConfig: () => ({
    tenantId: 't', clientId: 'c', clientSecret: 's',
    subscriptionId: 'sub', resourceGroup: 'rg', location: 'loc',
    adB2CTenantName: 'b2c', adB2CClientId: 'b2cId', adB2CClientSecret: 'b2cSecret',
    adB2CSignupSigninPolicy: 'p1', adB2CResetPasswordPolicy: 'p2', adB2CEditProfilePolicy: 'p3',
    cosmosEndpoint: 'https://cosmos', cosmosKey: 'key', cosmosDatabase: 'db',
    cosmosContainerUsers: 'users', cosmosContainerCompanies: 'companies',
    cosmosContainerBenefits: 'benefits', cosmosContainerChats: 'chats',
    cosmosContainerDocuments: 'docs', cosmosContainerFaqs: 'faqs',
    cosmosContainerDocumentChunks: 'chunks',
    storageAccountName: 'sa', storageAccountKey: 'sakey', storageConnectionString: 'conn',
    storageContainerDocuments: 'docs', storageContainerImages: 'imgs',
    redisHost: 'host', redisPassword: 'pwd', redisUrl: 'redis://host',
    openaiEndpoint: 'https://openai', openaiApiKey: 'key', openaiApiVersion: '2024-06-01',
    openaiDeploymentName: 'gpt', openaiEmbeddingDeployment: 'emb',
    searchEndpoint: 'https://search', searchApiKey: 'key', searchIndexName: 'idx',
    functionsEndpoint: 'https://fn', functionsMasterKey: 'mk',
    applicationInsightsConnectionString: 'insights',
    logAnalyticsWorkspaceId: 'law', logAnalyticsSharedKey: 'shared',
    keyVaultUrl: 'https://kv', keyVaultClientId: 'kvcid', keyVaultClientSecret: 'kvsec',
    jwtSecret: 'jwt', encryptionKey: '01234567890123456789012345678901',
    rateLimitRedisUrl: 'redis://host', resendApiKey: 'resend'
  }),
  getOpenAIConfig: () => ({
    endpoint: (process.env.AZURE_OPENAI_ENDPOINT || 'https://test.openai.azure.com').trim(),
    apiKey: (process.env.AZURE_OPENAI_API_KEY || 'test-azure-key').trim(),
    apiVersion: (process.env.AZURE_OPENAI_API_VERSION || '2024-02-01').trim(),
    deploymentName: (process.env.AZURE_OPENAI_DEPLOYMENT_NAME || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4').trim(),
    embeddingDeployment: (process.env.AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT || process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-3-large').trim(),
  }),
}));

// 2) Mock azure openai to avoid touching config indirectly
vi.mock('@/lib/azure/openai', () => ({
  azureOpenAIService: {
    generateChatCompletion: vi.fn().mockResolvedValue({ content: 'ok', usage: { tokens: 1 } }),
    generateText: vi.fn().mockResolvedValue('ok'),
    createChatCompletion: vi.fn().mockResolvedValue({ content: 'ok', usage: { tokens: 1 } }),
    // Critical for hybrid-retrieval and ingestion tests
    generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0.1)),
    generateEmbeddings: vi.fn().mockResolvedValue([new Array(1536).fill(0.1)]),
  }
}));

// 3) Mock redis limiter (edge/redis not needed in unit tests)
vi.mock('@/lib/rate-limit/redis-limiter', () => ({
  redisRateLimiter: { check: async () => ({ allowed: true }) },
  rateLimitConfigs: {}
}));

// 4) Mock logger so tests don't blow up on logging (provide default and named)
vi.mock('@/lib/logger', () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    auditEvent: vi.fn(),
  };
  return { logger, log: logger, logError: vi.fn(), default: logger };
});

// 5) Mock Application Insights SDK to prevent it from initializing in tests
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

// If your code wraps it, also mock your analytics service to be safe:
vi.mock('@/lib/services/analytics', () => ({
  analytics: {
    init: vi.fn(),
    trackLLMEvent: vi.fn(),
    trackError: vi.fn(),
  },
}));

// Mock Azure services (Cosmos)
vi.mock('@/lib/azure/cosmos', () => {
  // simple in-memory container mock
  const store = new Map<string, any>();
  const container = {
    item: (id: string) => ({
      read: async () => ({ resource: store.get(id) || null }),
      replace: async (resource: any) => {
        store.set(id, resource);
        return { resource };
      },
      delete: vi.fn(),
    }),
    items: {
      create: async (resource: any) => {
        store.set(resource.id, resource);
        return { resource };
      },
      query: vi.fn(() => ({
        fetchAll: async () => ({ resources: Array.from(store.values()) })
      })),
    },
  };

  return {
    getClient: vi.fn(async () => ({
      database: vi.fn(() => ({
        container: vi.fn(() => container)
      }))
    })),
    getRepositories: vi.fn(() => ({
      users: { create: vi.fn(), get: vi.fn(), list: vi.fn(), update: vi.fn(), delete: vi.fn(), query: vi.fn() },
      companies: { create: vi.fn(), get: vi.fn(), list: vi.fn(), update: vi.fn(), delete: vi.fn(), query: vi.fn() },
      documents: { create: vi.fn(), get: vi.fn(), list: vi.fn(), update: vi.fn(), delete: vi.fn(), query: vi.fn() },
      chats: { create: vi.fn(), get: vi.fn(), list: vi.fn(), update: vi.fn(), delete: vi.fn(), query: vi.fn() },
      searchIndex: { create: vi.fn(), get: vi.fn(), list: vi.fn(), update: vi.fn(), delete: vi.fn(), query: vi.fn() },
      benefits: { create: vi.fn(), get: vi.fn(), list: vi.fn(), update: vi.fn(), delete: vi.fn(), query: vi.fn() },
      faqs: { create: vi.fn(), get: vi.fn(), list: vi.fn(), update: vi.fn(), delete: vi.fn(), query: vi.fn() },
      documentChunks: { create: vi.fn(), get: vi.fn(), list: vi.fn(), update: vi.fn(), delete: vi.fn(), query: vi.fn() },
      messages: { create: vi.fn(), get: vi.fn(), list: vi.fn(), update: vi.fn(), delete: vi.fn(), query: vi.fn() },
      notifications: { create: vi.fn(), get: vi.fn(), list: vi.fn(), update: vi.fn(), delete: vi.fn(), query: vi.fn() },
    })),
  };
});

// --- mock RAG retrieval to “empty” (satisfy any RAG callers)
vi.mock('@/lib/rag/retrieve', () => ({
  retrieveRelevantChunks: vi.fn().mockResolvedValue([]),
}));

// --- mock AI chat runner to a plain 200 Response (unused by our route, harmless)
vi.mock('@/lib/ai/chat', () => ({
  streamChat: vi.fn().mockResolvedValue(
    new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
  ),
  runChat: vi.fn().mockResolvedValue(
    new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
  ),
}));

// If some libs expect StreamingTextResponse from 'ai', provide a stub
vi.mock('ai', () => ({
  StreamingTextResponse: class extends Response {
    constructor(_stream: any, init?: any) {
      super('ok', { status: 200, ...(init || {}) });
    }
  },
}));

// Mock Azure storage
vi.mock('@/lib/azure/storage', () => ({
  getStorageServices: vi.fn(() => ({
    documents: {
      uploadFile: vi.fn(),
      downloadFile: vi.fn(),
      deleteFile: vi.fn(),
      getFileUrl: vi.fn()
    }
  }))
}));

// 2) Mock token validation globally so route tests stop 401-ing
vi.mock('@/lib/azure/token-validation', () => ({
  validateToken: vi.fn().mockResolvedValue({
    valid: true,
    user: {
      id: 'u1',
      email: 'user@example.com',
      name: 'Test User',
      roles: ['employee'],
      companyId: 'c1',
      permissions: ['view_benefits', 'chat_with_ai']
    }
  }),
}));

// 3) If some utils branch on process.env, stub minimal vars here
vi.stubEnv('NODE_ENV', 'test');

// --- Web Crypto polyfills for jsdom / playwright-core ---
import nodeCrypto from 'node:crypto';

// If crypto missing, provide WebCrypto from Node
if (typeof globalThis.crypto === 'undefined') {
  // @ts-ignore
  globalThis.crypto = nodeCrypto.webcrypto;
}

// Some libs expect non-standard `crypto.random`
if (!(globalThis.crypto as any).random) {
  (globalThis.crypto as any).random = Math.random;
}

// Ensure getRandomValues exists (jsdom has it; Node webcrypto does too, but backfill just in case)
if (!(globalThis.crypto as any).getRandomValues) {
  (globalThis.crypto as any).getRandomValues = (arr: Uint8Array) => nodeCrypto.randomFillSync(arr);
}

// Ensure randomUUID exists
if (!(globalThis.crypto as any).randomUUID) {
  (globalThis.crypto as any).randomUUID = () => nodeCrypto.randomUUID();
}

// Global test setup
beforeAll(() => {
  // Setup test environment
  process.env.AZURE_COSMOS_ENDPOINT = 'https://test.documents.azure.com:443/';
  process.env.AZURE_COSMOS_KEY = 'test-key';
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.AZURE_AD_B2C_CLIENT_ID = 'test-client-id';
  process.env.AZURE_AD_B2C_CLIENT_SECRET = 'test-client-secret';
});

afterAll(() => {
  // Cleanup after all tests
});

beforeEach(() => {
  // Setup before each test
});

afterEach(() => {
  // Cleanup after each test
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// Test utilities
export const createMockUser = (overrides = {}) => ({
  id: 'test-user-id',
  email: 'test@example.com',
  name: 'Test User',
  roles: ['employee'],
  companyId: '-id',
  permissions: ['view_benefits', 'chat_with_ai'],
  metadata: {},
  ...overrides
});

export const createMockCompany = (overrides = {}) => ({
  id: 'amerivet',
  name: 'Test Company',
  domain: 'test.com',
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  version: 1,
  ...overrides
});

export const createMockDocument = (overrides = {}) => ({
  id: 'test-document-id',
  title: 'Test Document',
  content: 'Test content',
  fileName: 'test.pdf',
  mimeType: 'application/pdf',
  fileSize: 1024,
  companyId: 'amerivet',
  uploadedBy: 'test-user-id',
  category: 'benefits',
  tags: ['test'],
  metadata: {},
  status: 'processed',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  version: 1,
  ...overrides
});

// Mock fetch for API tests
global.fetch = vi.fn();

// Mock crypto for UUID generation
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: () => 'test-uuid-' + Math.random().toString(36).substr(2, 9)
  }
});
