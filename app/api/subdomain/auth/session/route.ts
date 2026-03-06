import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('amerivet_session');
  const sessionValue = sessionCookie?.value;
  
  const role = sessionValue === 'admin' ? 'admin' : sessionValue === 'employee' ? 'employee' : null;
  
  if (!role) {
    return new Response(
      JSON.stringify({ ok: false, error: 'NOT_AUTHENTICATED' }), 
      { 
        status: 401,
        headers: { 'content-type': 'application/json' }
      }
    );
  }
  
  const permissions = role === 'admin' 
    ? ['*'] 
    : ['VIEW_BENEFITS', 'USE_CHAT', 'COMPARE_PLANS', 'VIEW_DOCUMENTS'];
  
  return new Response(
    JSON.stringify({ ok: true, role, permissions }), 
    { 
      status: 200,
      headers: { 'content-type': 'application/json' }
    }
  );
}
