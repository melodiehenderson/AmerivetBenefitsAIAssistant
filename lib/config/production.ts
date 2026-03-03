import { z } from 'zod';

// Production configuration schema
export const productionConfigSchema = z.object({
  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  
  // Database - Azure Cosmos DB
  AZURE_COSMOS_ENDPOINT: z.string().url('Invalid Azure Cosmos DB endpoint'),
  AZURE_COSMOS_KEY: z.string().min(1, 'Azure Cosmos DB key is required'),
  
  // Authentication
  NEXTAUTH_SECRET: z.string().min(32, 'NextAuth secret must be at least 32 characters'),
  NEXTAUTH_URL: z.string().url('Invalid NextAuth URL'),
  
  // AI Services - Azure OpenAI
  AZURE_OPENAI_ENDPOINT: z.string().url('Invalid Azure OpenAI endpoint'),
  AZURE_OPENAI_API_KEY: z.string().min(1, 'Azure OpenAI API key is required'),
  AZURE_OPENAI_API_VERSION: z.string().default('2024-02-15-preview'),
  AZURE_OPENAI_DEPLOYMENT_NAME: z.string().default('gpt-4'),
  
  // Redis
  REDIS_URL: z.string().url('Invalid Redis URL'),
  REDIS_PASSWORD: z.string().optional(),
  
  // Email - Azure Communication Services
  AZURE_COMMUNICATION_CONNECTION_STRING: z.string().optional(),
  FROM_EMAIL: z.string().email('Invalid from email').optional(),
  
  // Security
  CORS_ORIGIN: z.string().url('Invalid CORS origin'),
  RATE_LIMIT_MAX: z.coerce.number().min(1).default(100),
  RATE_LIMIT_WINDOW: z.coerce.number().min(1).default(900000), // 15 minutes
  
  // Monitoring
  SENTRY_DSN: z.string().url('Invalid Sentry DSN').optional(),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  
  // Firebase (optional, only if Firebase services are used)
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().email('Invalid Firebase client email').optional(),
  FIREBASE_API_KEY: z.string().optional(),
  
  // Performance
  MAX_FILE_SIZE: z.coerce.number().min(1).default(52428800), // 50MB
  CHUNK_SIZE: z.coerce.number().min(1).default(1000),
  CACHE_TTL: z.coerce.number().min(1).default(3600), // 1 hour
  
  // Feature Flags
  ENABLE_ANALYTICS: z.coerce.boolean().default(true),
  ENABLE_LLM_ROUTING: z.coerce.boolean().default(true),
  ENABLE_DOCUMENT_PROCESSING: z.coerce.boolean().default(true),
  ENABLE_RATE_LIMITING: z.coerce.boolean().default(true),
});

export type ProductionConfig = z.infer<typeof productionConfigSchema>;

// Validate production configuration
export function validateProductionConfig(): ProductionConfig {
  try {
    // Support alternative env names for rate limiting that may exist in env files
    const RL_MAX = process.env.RATE_LIMIT_MAX ?? process.env.RATE_LIMIT_REQUESTS_PER_MINUTE;
    const RL_WINDOW = process.env.RATE_LIMIT_WINDOW ?? String(15 * 60 * 1000);

    const config = {
      NODE_ENV: process.env.NODE_ENV,
      AZURE_COSMOS_ENDPOINT: process.env.AZURE_COSMOS_ENDPOINT,
      AZURE_COSMOS_KEY: process.env.AZURE_COSMOS_KEY,
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
      NEXTAUTH_URL: process.env.NEXTAUTH_URL,
      AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT,
      AZURE_OPENAI_API_KEY: process.env.AZURE_OPENAI_API_KEY,
      AZURE_OPENAI_API_VERSION: process.env.AZURE_OPENAI_API_VERSION,
      AZURE_OPENAI_DEPLOYMENT_NAME: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
      REDIS_URL: process.env.REDIS_URL,
      REDIS_PASSWORD: process.env.REDIS_PASSWORD,
      AZURE_COMMUNICATION_CONNECTION_STRING: process.env.AZURE_COMMUNICATION_CONNECTION_STRING,
      FROM_EMAIL: process.env.FROM_EMAIL,
      CORS_ORIGIN: process.env.CORS_ORIGIN,
      RATE_LIMIT_MAX: RL_MAX,
      RATE_LIMIT_WINDOW: RL_WINDOW,
      SENTRY_DSN: process.env.SENTRY_DSN,
      LOG_LEVEL: process.env.LOG_LEVEL,
      MAX_FILE_SIZE: process.env.MAX_FILE_SIZE,
      CHUNK_SIZE: process.env.CHUNK_SIZE,
      CACHE_TTL: process.env.CACHE_TTL,
      ENABLE_ANALYTICS: process.env.ENABLE_ANALYTICS,
      ENABLE_LLM_ROUTING: process.env.ENABLE_LLM_ROUTING,
      ENABLE_DOCUMENT_PROCESSING: process.env.ENABLE_DOCUMENT_PROCESSING,
      ENABLE_RATE_LIMITING: process.env.ENABLE_RATE_LIMITING,
      FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
      FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
      FIREBASE_API_KEY: process.env.FIREBASE_API_KEY,
    };

    return productionConfigSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.issues.map(err => err.path.join('.')).join(', ');
      throw new Error(`Production configuration validation failed. Missing or invalid: ${missingVars}`);
    }
    throw error;
  }
}

// Get production configuration
export const productionConfig = validateProductionConfig();

// Security headers configuration
export const securityHeadersConfig = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://www.googletagmanager.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' https://api.openai.com https://generativelanguage.googleapis.com https://api.anthropic.com",
    "frame-ancestors 'none'",
  ].join('; '),
};

// Rate limiting configuration
export const rateLimitConfig = {
  windowMs: productionConfig.RATE_LIMIT_WINDOW,
  max: productionConfig.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
};

// CORS configuration
export const corsConfig = {
  origin: productionConfig.CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

// Database connection configuration
export const databaseConfig = {
  projectId: productionConfig.FIREBASE_PROJECT_ID,
  privateKey: (productionConfig.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  clientEmail: productionConfig.FIREBASE_CLIENT_EMAIL,
  apiKey: productionConfig.FIREBASE_API_KEY,
};

// Redis configuration
export const redisConfig = {
  url: productionConfig.REDIS_URL,
  password: productionConfig.REDIS_PASSWORD,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  keepAlive: 30000,
};

// Logging configuration
export const loggingConfig = {
  level: productionConfig.LOG_LEVEL,
  enableConsole: true,
  enableFile: true,
  filePath: '/var/log/app/application.log',
  maxFileSize: '10MB',
  maxFiles: 5,
};

// Monitoring configuration
export const monitoringConfig = {
  sentryDsn: productionConfig.SENTRY_DSN,
  enablePerformanceMonitoring: true,
  enableErrorTracking: true,
  sampleRate: 0.1,
  tracesSampleRate: 0.1,
};

// Feature flags
export const featureFlags = {
  analytics: productionConfig.ENABLE_ANALYTICS,
  llmRouting: productionConfig.ENABLE_LLM_ROUTING,
  documentProcessing: productionConfig.ENABLE_DOCUMENT_PROCESSING,
  rateLimiting: productionConfig.ENABLE_RATE_LIMITING,
};

// Performance configuration
export const performanceConfig = {
  maxFileSize: productionConfig.MAX_FILE_SIZE,
  chunkSize: productionConfig.CHUNK_SIZE,
  cacheTtl: productionConfig.CACHE_TTL,
  enableCompression: true,
  enableCaching: true,
  cacheStrategy: 'stale-while-revalidate',
};
