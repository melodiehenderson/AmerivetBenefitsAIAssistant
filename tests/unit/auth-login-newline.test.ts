/**
 * Unit test for login route - guards against env var newline regression
 * Tests that passwords with \r\n embedded still authenticate correctly
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Subdomain Auth Login - Newline Regression Test', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    // Preserve original env
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    // Restore original env
    process.env = ORIGINAL_ENV;
  });

  it('should authenticate even when env vars contain \\r\\n from Vercel UI', async () => {
    // Simulate Vercel web UI adding line endings
    process.env.EMPLOYEE_PASSWORD = 'amerivet2024!\r\n';
    process.env.ADMIN_PASSWORD = 'admin2024!\r\n';

    // Import route handler dynamically to pick up the corrupted env
    const { POST } = await import('@/app/api/subdomain/auth/login/route');

    // Test employee login
    const empReq = new Request('http://localhost/api/subdomain/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'amerivet2024!' }), // Clean password from client
    });

    const empRes = await POST(empReq);
    expect(empRes.status).toBe(200);
    const empBody = await empRes.json();
    expect(empBody.ok).toBe(true);
    expect(empBody.role).toBe('employee');
    expect(empRes.headers.get('set-cookie')).toContain('amerivet_session=employee');

    // Test admin login
    const adminReq = new Request('http://localhost/api/subdomain/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'admin2024!' }), // Clean password from client
    });

    const adminRes = await POST(adminReq);
    expect(adminRes.status).toBe(200);
    const adminBody = await adminRes.json();
    expect(adminBody.ok).toBe(true);
    expect(adminBody.role).toBe('admin');
    expect(adminRes.headers.get('set-cookie')).toContain('amerivet_session=admin');
  });

  it('should reject wrong password even with newline-corrupted env vars', async () => {
    process.env.EMPLOYEE_PASSWORD = 'amerivet2024!\r\n';
    process.env.ADMIN_PASSWORD = 'admin2024!\r\n';

    const { POST } = await import('@/app/api/subdomain/auth/login/route');

    const req = new Request('http://localhost/api/subdomain/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrongpassword' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('BAD_PASSWORD');
  });

  it('should handle Unicode normalization correctly', async () => {
    // Test NFKC normalization prevents lookalike attacks
    process.env.EMPLOYEE_PASSWORD = 'test™'; // Contains trademark symbol
    process.env.ADMIN_PASSWORD = 'admin2024!';

    const { POST } = await import('@/app/api/subdomain/auth/login/route');

    const req = new Request('http://localhost/api/subdomain/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test™' }), // Same normalized form
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.role).toBe('employee');
  });
});
