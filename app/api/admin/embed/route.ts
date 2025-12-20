export const dynamic = 'force-dynamic';

import { type NextRequest, NextResponse } from 'next/server';
import { protectCompanyEndpoint } from '@/lib/middleware/auth'; // CHANGED: Allow all employees, not just admins
import { rateLimiters } from '@/lib/middleware/rate-limit';
import { logger } from '@/lib/logger';

// 1. CONFIG: Define allowed origins (Env vars + Defaults)
const DEFAULT_ORIGINS = [
  'https://www.workday.com', 
  'https://impl.workday.com', 
  'https://wd5.myworkday.com' // Example tenant
];

const ALLOWED_ORIGINS = new Set([
  ...DEFAULT_ORIGINS,
  ...(process.env.ALLOWED_EMBED_ORIGINS?.split(',') || [])
]);

// Helper to validate origin securely
function getCorsHeaders(origin: string | null) {
  // If the incoming origin is in our whitelist, we allow it specifically.
  // Otherwise, we return null (block it).
  const isAllowed = origin && Array.from(ALLOWED_ORIGINS).some(allowed => 
    origin === allowed || origin.endsWith('.workday.com') || origin.endsWith('.myworkday.com')
  );

  if (isAllowed && origin) {
    return {
      'Access-Control-Allow-Origin': origin, // Reflect the specific origin
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Company-ID',
      'Access-Control-Allow-Credentials': 'true', // Required for cookies/auth tokens in iframes
    };
  }
  return {};
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const origin = request.headers.get('origin');
  
  try {
    // Apply rate limiting
    const rateLimitResponse = await rateLimiters.api(request); // Use general API limit, not Admin
    if (rateLimitResponse) return rateLimitResponse;

    // 2. AUTH FIX: Use an endpoint that allows regular employees
    const { user, error } = await protectCompanyEndpoint(request);
    if (error || !user) return error!;

    logger.info('Embed config requested', { userId: user.id, companyId: user.companyId });

    const duration = Date.now() - startTime;
    logger.apiResponse('GET', '/api/embed/config', 200, duration, { userId: user.id });

    // 3. SECURE RESPONSE: Apply Dynamic CORS headers
    const corsHeaders = getCorsHeaders(origin);

    return NextResponse.json({
      success: true,
      data: {
        embed: {
          // Frontend can use this to validate parent window
          validAncestors: Array.from(ALLOWED_ORIGINS),
          user: {
            id: user.id,
            companyId: user.companyId,
            role: user.roles[0] || 'employee', // Default to employee
          },
          features: {
            enableChat: true,
            enableUpload: user.roles.includes('admin') // Feature flags based on role
          }
        },
      }
    }, {
      headers: corsHeaders
    });

  } catch (error) {
    logger.error('Embed config error', { path: '/api/embed/config' }, error as Error);
    return NextResponse.json(
      { success: false, error: 'Failed to load configuration' },
      { status: 500 }
    );
  }
}

// 4. OPTIONS HANDLER (Strict Preflight)
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  if (Object.keys(corsHeaders).length === 0) {
    return new NextResponse(null, { status: 403 }); // Block unknown origins
  }

  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}