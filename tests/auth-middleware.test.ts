import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';

function createRequest(
  path: string,
  headers: Record<string, string> = {},
  cookies: Record<string, string> = {}
) {
  const req = new NextRequest(`https://example.com${path}`, {
    headers: new Headers(headers),
  });
  // Set cookies on the request
  for (const [name, value] of Object.entries(cookies)) {
    req.cookies.set(name, value);
  }
  return req;
}

describe('API auth middleware', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('blocks requests without Authorization header', async () => {
    const req = createRequest('/api/admin/users');
    const res = await middleware(req as any);
    expect(res.status).toBe(307);
  });

  it('blocks requests with insufficient role (employee cookie)', async () => {
    const req = createRequest(
      '/api/admin/users',
      { Authorization: 'Bearer test-token' },
      { amerivet_session: 'employee' }
    );
    const res = await middleware(req as any);
    expect(res.status).toBe(307);
  });
});
