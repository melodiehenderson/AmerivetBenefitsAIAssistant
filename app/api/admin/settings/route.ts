export const runtime = 'nodejs';
// REMOVED: export const revalidate = 0; -> We want caching!
// REMOVED: export const fetchCache = 'force-no-store';

import { NextResponse, type NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache'; // NEW: For clearing cache
import { protectAdminEndpoint } from '@/lib/middleware/auth';
import { rateLimiters } from '@/lib/middleware/rate-limit';
import { logger } from '@/lib/logger';
import { settingsService } from '@/lib/services/settings.service';
import { auditService } from '@/lib/services/audit.service'; // NEW: Audit logging
import { z } from 'zod';

// Validation Schema (Unchanged)
const settingsSchema = z.object({
  platform: z.object({
    name: z.string().min(1, 'Platform name is required'),
    url: z.string().url('Invalid URL format'),
    supportEmail: z.string().email('Invalid email format'),
    maxFileSize: z.number().min(1, 'Max file size must be at least 1MB'),
    allowedFileTypes: z.array(z.string()).min(1, 'At least one file type must be allowed'),
  }),
  security: z.object({
    mfaRequired: z.boolean(),
    sessionTimeout: z.number().min(5, 'Session timeout must be at least 5 minutes'),
    passwordMinLength: z.number().min(6, 'Password must be at least 6 characters'),
    passwordRequireSpecial: z.boolean(),
    maxLoginAttempts: z.number().min(1, 'Max login attempts must be at least 1'),
  }),
  notifications: z.object({
    emailEnabled: z.boolean(),
    smsEnabled: z.boolean(),
    newUserNotification: z.boolean(),
    systemAlerts: z.boolean(),
    weeklyReports: z.boolean(),
  }),
  ai: z.object({
    provider: z.string().min(1, 'AI provider is required'),
    model: z.string().min(1, 'AI model is required'),
    temperature: z.number().min(0).max(1, 'Temperature must be between 0 and 1'),
    maxTokens: z.number().min(1, 'Max tokens must be at least 1'),
    streamingEnabled: z.boolean(),
  }),
  storage: z.object({
    provider: z.string().min(1, 'Storage provider is required'),
    maxStoragePerCompany: z.number().min(1, 'Max storage must be at least 1GB'),
    autoDeleteAfter: z.number().min(0, 'Auto-delete days must be 0 or greater'),
    compressionEnabled: z.boolean(),
  }),
});

// Helper: Hide sensitive data (even from admins)
function sanitizeSettings(settings: any) {
  const safe = { ...settings };
  // Example: If you had API keys, you would mask them here
  // safe.ai.apiKey = '********'; 
  return safe;
}

// GET /api/admin/settings
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const rateLimitResponse = await rateLimiters.admin(request);
    if (rateLimitResponse) return rateLimitResponse;

    const { user, error } = await protectAdminEndpoint(request);
    if (error || !user) return error!;

    // OPTIMIZED: This service call should be wrapped in unstable_cache 
    // inside the service itself with the tag ['platform-settings'].
    // If not, Next.js generic fetch cache handles it if using fetch.
    const settings = await settingsService.getSettings();
    const data = settings || await settingsService.getDefaultSettings();

    const duration = Date.now() - startTime;
    logger.apiResponse('GET', '/api/admin/settings', 200, duration, { userId: user.id });

    return NextResponse.json({
      success: true,
      data: sanitizeSettings(data)
    });
  } catch (error) {
    logger.error('Settings retrieval error', { path: '/api/admin/settings' }, error as Error);
    return NextResponse.json({ success: false, error: 'Failed to retrieve settings' }, { status: 500 });
  }
}

// PUT /api/admin/settings
export async function PUT(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const rateLimitResponse = await rateLimiters.admin(request);
    if (rateLimitResponse) return rateLimitResponse;

    const { user, error } = await protectAdminEndpoint(request);
    if (error || !user) return error!;

    const body = await request.json();
    const validatedSettings = settingsSchema.parse(body);

    logger.info('Updating Platform Settings', { userId: user.id });

    // 1. Save to DB
    const savedSettings = await settingsService.saveSettings(validatedSettings, user.id);

    // 2. PERFORMANCE: Invalidate Cache
    // This forces the GET endpoint to fetch fresh data on the next request.
    revalidateTag('platform-settings');

    // 3. SECURITY: Audit Log
    // Record exactly who changed the global configuration.
    await auditService.log({
        action: 'UPDATE_SETTINGS',
        actorId: user.id,
        targetResource: 'platform',
        details: { modifiedKeys: Object.keys(validatedSettings) },
        ip: request.headers.get('x-forwarded-for') || 'unknown'
    });

    const duration = Date.now() - startTime;
    logger.apiResponse('PUT', '/api/admin/settings', 200, duration, { userId: user.id });

    return NextResponse.json({
      success: true,
      data: sanitizeSettings(savedSettings),
      message: 'Settings saved successfully'
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid settings', details: error.issues }, { status: 400 });
    }
    
    logger.error('Settings update error', { path: '/api/admin/settings' }, error as Error);
    return NextResponse.json({ success: false, error: 'Failed to update settings' }, { status: 500 });
  }
}