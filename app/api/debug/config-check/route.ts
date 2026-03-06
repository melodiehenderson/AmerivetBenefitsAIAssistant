export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getOpenAIConfig, getRedisConfig } from '@/lib/azure/config';

/**
 * Diagnostic endpoint to check Azure configuration parsing
 * Returns sanitized config values to verify parsing is correct
 * NOTE: Public endpoint for debugging - no auth required
 */
export async function GET() {
  try {
    const openaiConfig = getOpenAIConfig();
    const redisConfig = getRedisConfig();

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      openai: {
        endpoint: openaiConfig.endpoint,
        endpointLength: openaiConfig.endpoint.length,
        deploymentName: openaiConfig.deploymentName,
        deploymentNameLength: openaiConfig.deploymentName?.length || 0,
        embeddingDeployment: openaiConfig.embeddingDeployment,
        embeddingDeploymentLength: openaiConfig.embeddingDeployment?.length || 0,
        embeddingDeploymentHex: Buffer.from(openaiConfig.embeddingDeployment || '').toString('hex'),
        apiVersion: openaiConfig.apiVersion,
        apiKeyPresent: !!openaiConfig.apiKey,
        apiKeyLength: openaiConfig.apiKey?.length || 0,
      },
      redis: {
        host: redisConfig.host,
        hostLength: redisConfig.host?.length || 0,
        port: redisConfig.port,
        passwordPresent: !!redisConfig.password,
        passwordLength: redisConfig.password?.length || 0,
        passwordFirstChars: redisConfig.password?.substring(0, 5) || '',
        tlsEnabled: !!redisConfig.tls,
      },
      env: {
        AZURE_OPENAI_EMBEDDING_DEPLOYMENT: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'NOT SET',
        AZURE_OPENAI_EMBEDDING_DEPLOYMENT_LENGTH: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT?.length || 0,
        AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT: process.env.AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT || 'NOT SET',
        REDIS_URL_FORMAT: process.env.REDIS_URL?.substring(0, 30) || 'NOT SET',
        REDIS_URL_LENGTH: process.env.REDIS_URL?.length || 0,
        NODE_ENV: process.env.NODE_ENV,
      }
    });
  } catch (error) {
    return NextResponse.json({
      error: 'Configuration check failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}
