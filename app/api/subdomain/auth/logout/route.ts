/**
 * Logout endpoint - clears amerivet_session cookie
 * Returns JSON always (never empty body, never 204)
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Helper: always return JSON with correct content-type
function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// OPTIONS for CORS preflight
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// GET not allowed
export async function GET() {
  return json(405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
}

// POST clears the session cookie
export async function POST() {
  // Set cookie to deleted with Max-Age=0
  const cookie = [
    'amerivet_session=deleted',
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Max-Age=0', // Expire immediately
  ].join('; ');

  return new Response(JSON.stringify({ ok: true, message: 'LOGGED_OUT' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie,
    },
  });
}
