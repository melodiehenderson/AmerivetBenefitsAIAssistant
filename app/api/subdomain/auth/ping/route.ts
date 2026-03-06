import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, method: 'GET', ts: Date.now() });
}

export async function POST(request: NextRequest) {
  const bodyText = await request.text();
  let body: any = null;
  try { body = bodyText ? JSON.parse(bodyText) : null; } catch { body = bodyText; }
  return NextResponse.json({ ok: true, method: 'POST', body, ts: Date.now() });
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin') || '*';
  const res = new NextResponse(null, { status: 204 });
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Vary', 'Origin');
  res.headers.set('Access-Control-Allow-Credentials', 'true');
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return res;
}
