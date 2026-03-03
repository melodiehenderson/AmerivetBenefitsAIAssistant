export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

import { NextResponse, type NextRequest } from 'next/server';
import { requireSuperAdmin, requireCompanyAdmin } from '@/lib/auth/unified-auth';
import { rateLimiters } from '@/lib/middleware/rate-limit';
import { logger } from '@/lib/logger';
import { aiConfigService } from '@/lib/services/ai-config.service';
import { z } from 'zod';

const aiConfigSchema = z.object({
  personality: z.string().min(10, 'Personality must be at least 10 characters'),
  tone: z.enum(['formal', 'friendly', 'neutral', 'humorous']),
  responseLength: z.number().min(50).max(500),
  model: z.string().optional(),
  temperature: z.number().min(0).max(1).optional(),
  maxTokens: z.number().min(1).max(4096).optional(),
  systemPrompt: z.string().optional(),
  enabledFeatures: z.array(z.string()).optional(),
});

// GET /api/super-admin/ai-config - Get AI configuration
export const GET = requireCompanyAdmin(async (request: NextRequest) => {
  const startTime = Date.now();
  
  try {
    // Apply rate limiting
    const rateLimitResponse = await rateLimiters.admin(request);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    // Authenticate and authorize
    // Extract user information from headers
    const userId = request.headers.get('x-user-id')!;
    const userCompanyId = request.headers.get('x-company-id')!;
    // Authentication handled by requireCompanyAdmin/requireSuperAdmin
    // Error handling managed by auth middleware

    logger.info('API Request: GET /api/super-admin/ai-config', {
      userId: userId
    });

    const config = await aiConfigService.getAIConfig();
    
    if (!config) {
      // Return default config if none exists
      const defaultConfig = await aiConfigService.getDefaultAIConfig();
      return NextResponse.json({
        success: true,
        data: defaultConfig
      });
    }

    return NextResponse.json({
      success: true,
      data: config
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error('AI config retrieval error', {
      path: request.nextUrl.pathname,
      method: request.method,
      duration
    }, error as Error);
    
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to retrieve AI configuration' 
      },
      { status: 500 }
    );
  }
  });

// POST /api/super-admin/ai-config - Update AI configuration
export const POST = requireCompanyAdmin(async (request: NextRequest) => {
  const startTime = Date.now();
  
  try {
    // Apply rate limiting
    const rateLimitResponse = await rateLimiters.admin(request);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    // Authenticate and authorize
    // Extract user information from headers
    const userId = request.headers.get('x-user-id')!;
    const userCompanyId = request.headers.get('x-company-id')!;
    // Authentication handled by requireCompanyAdmin/requireSuperAdmin
    // Error handling managed by auth middleware

    const body = await request.json();
    const validatedConfig = aiConfigSchema.parse(body);

    logger.info('API Request: POST /api/super-admin/ai-config', {
      userId: userId,
      configKeys: Object.keys(validatedConfig)
    });

    // Validate the configuration
    const validation = await aiConfigService.validateConfig(validatedConfig);
    if (!validation.isValid) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Invalid configuration',
          details: validation.errors
        },
        { status: 400 }
      );
    }

    const savedConfig = await aiConfigService.saveAIConfig(validatedConfig, userId);

    const duration = Date.now() - startTime;
    
    logger.apiResponse('POST', '/api/super-admin/ai-config', 200, duration, {
      userId: userId,
      configId: savedConfig.id
    });

    return NextResponse.json({
      success: true,
      data: savedConfig,
      message: 'AI configuration saved successfully'
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Invalid configuration format', 
          details: error.issues 
        },
        { status: 400 }
      );
    }
    
    logger.error('AI config update error', {
      path: request.nextUrl.pathname,
      method: request.method,
      duration
    }, error as Error);
    
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to update AI configuration' 
      },
      { status: 500 }
    );
  }
  });

// PUT /api/super-admin/ai-config/reset - Reset AI configuration to defaults
export const PUT = requireCompanyAdmin(async (request: NextRequest) => {
  const startTime = Date.now();
  
  try {
    // Apply rate limiting
    const rateLimitResponse = await rateLimiters.admin(request);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    // Authenticate and authorize
    // Extract user information from headers
    const userId = request.headers.get('x-user-id')!;
    const userCompanyId = request.headers.get('x-company-id')!;
    // Authentication handled by requireCompanyAdmin/requireSuperAdmin
    // Error handling managed by auth middleware

    logger.info('API Request: PUT /api/super-admin/ai-config/reset', {
      userId: userId
    });

    const resetConfig = await aiConfigService.resetToDefaults(userId);

    const duration = Date.now() - startTime;
    
    logger.apiResponse('PUT', '/api/super-admin/ai-config/reset', 200, duration, {
      userId: userId,
      configId: resetConfig.id
    });

    return NextResponse.json({
      success: true,
      data: resetConfig,
      message: 'AI configuration reset to defaults'
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error('AI config reset error', {
      path: request.nextUrl.pathname,
      method: request.method,
      duration
    }, error as Error);
    
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to reset AI configuration' 
      },
      { status: 500 }
    );
  }
});

