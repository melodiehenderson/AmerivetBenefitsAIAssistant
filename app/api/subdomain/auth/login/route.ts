export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { checkRateLimit } from '@/lib/auth/rate-limiter';

function json(status: number, body: unknown, extra?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...(extra ?? {}) },
  });
}

export async function OPTIONS(req: Request) {
  // Restrict CORS to the app's own origin; never use wildcard on auth endpoints
  const origin = req.headers.get('origin') || '';
  const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.DOMAIN_ROOT || '';
  const corsOrigin = origin && allowedOrigin && origin.endsWith(new URL(allowedOrigin).hostname)
    ? origin
    : allowedOrigin || origin; // fallback for dev

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '600',
    },
  });
}

// Explicitly reject GET so 405 is intentional and JSON
export async function GET() {
  return json(405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
}

// Dual-password POST (employee/admin)
export async function POST(req: Request) {
  try {
    // Rate limiting by IP + User-Agent (disabled in unit tests)
    if (process.env.NODE_ENV !== 'test') {
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
                || req.headers.get('x-real-ip') 
                || 'unknown';
      const ua = req.headers.get('user-agent') || 'unknown';
      const identifier = `${ip}:${ua.slice(0, 50)}`; // Limit UA length

      const rateLimit = checkRateLimit(identifier);
      if (!rateLimit.allowed) {
        return json(429, { 
          ok: false, 
          error: 'TOO_MANY_ATTEMPTS', 
          message: 'Too many login attempts. Please try again in 15 minutes.' 
        }, {
          'Retry-After': '900', // 15 minutes in seconds
        });
      }
    }

    const { password } = await req.json().catch(() => ({}));
    if (!password) return json(400, { ok: false, error: 'MISSING_PASSWORD' });

    // Read from environment variables (no hardcoded passwords)
    // Aggressive sanitization: strip literal \r\n text, control chars, and whitespace
    // that Vercel CLI / PowerShell piping may inject into env vars
    const sanitize = (v: string) =>
      v.replace(/\\r\\n$|\\n$|\\r$/g, '').replace(/[\x00-\x1f\x7f]/g, '').trim().normalize('NFKC');
    const EMP   = sanitize(process.env.EMPLOYEE_PASSWORD    ?? '');
    const ADM   = sanitize(process.env.ADMIN_PASSWORD       ?? '');
    const SUPADM = sanitize(process.env.SUPER_ADMIN_PASSWORD ?? '');

    if (!EMP || !ADM) {
      return json(500, { ok: false, error: 'SERVER_MISCONFIG' });
    }

    // timing-safe compare
    const safeEq = async (a: string, b: string) => {
      const A = Buffer.from(a.normalize('NFKC'));
      const B = Buffer.from(b);
      if (A.length !== B.length) return false;
      const crypto = await import('crypto');
      return crypto.timingSafeEqual(A, B);
    };

    // Check super_admin first (most privileged)
    if (SUPADM && await safeEq(password, SUPADM)) {
      const cookie = [
        `amerivet_session=super_admin`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        'Secure',
        'Max-Age=1800',
      ].join('; ');
      return json(200, { ok: true, role: 'super_admin', permissions: ['*'] }, { 'Set-Cookie': cookie });
    }

    if (await safeEq(password, ADM)) {
      // set cookie (secure, 30 min)
      const cookie = [
        `amerivet_session=admin`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        'Secure',
        'Max-Age=1800',
      ].join('; ');
      return json(200, { ok: true, role: 'admin', permissions: ['*'] }, { 'Set-Cookie': cookie });
    }

    if (await safeEq(password, EMP)) {
      const cookie = [
        `amerivet_session=employee`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        'Secure',
        'Max-Age=1800',
      ].join('; ');
      return json(
        200,
        { ok: true, role: 'employee', permissions: ['VIEW_BENEFITS','USE_CHAT','COMPARE_PLANS','VIEW_DOCUMENTS'] },
        { 'Set-Cookie': cookie },
      );
    }

    return json(401, { ok: false, error: 'BAD_PASSWORD' });
  } catch (e) {
    return json(500, { ok: false, error: 'INTERNAL_ERROR' });
  }
}

