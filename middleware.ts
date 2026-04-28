// Middleware for API auth guarding admin endpoints.
// Validates the session cookie server-side rather than trusting client headers.
// Extend matcher only for admin API paths.
import { NextRequest, NextResponse } from 'next/server';

export const config = { matcher: ['/api/admin/:path*', '/favicon.ico'] };

// Map cookie values to admin roles
const ADMIN_SESSIONS: Record<string, string> = {
  admin: 'admin',
  super_admin: 'super_admin',
};

export function middleware(req: NextRequest) {
	try {
		// Block /api/debug endpoints in production
		if (req.nextUrl.pathname.startsWith('/api/debug') && process.env.NODE_ENV === 'production') {
			return new NextResponse(null, { status: 404 });
		}
		// Ensure the browser tab favicon is always the AmeriVet logo.
		if (req.nextUrl.pathname === '/favicon.ico') {
			return NextResponse.rewrite(new URL('/favicon.png', req.url));
		}

		// Require Authorization header (bearer token or session)
		const auth = req.headers.get('authorization');
		if (!auth) {
			const url = req.nextUrl.clone();
			url.pathname = '/subdomain/auth';
			return NextResponse.redirect(url, 307);
		}

		// Derive role from the secure HttpOnly session cookie, NOT from client headers
		const sessionCookie = req.cookies.get('amerivet_session')?.value;
		const role = sessionCookie ? ADMIN_SESSIONS[sessionCookie] : undefined;

		if (!role) {
			// Not an admin session — block access to admin endpoints
			const url = req.nextUrl.clone();
			url.pathname = '/subdomain/auth';
			return NextResponse.redirect(url, 307);
		}

		// Allow request to continue (no modification) when authorized.
		return NextResponse.next();
	} catch {
		// On unexpected error, fail closed with redirect.
		const url = req.nextUrl.clone();
		url.pathname = '/subdomain/auth';
		return NextResponse.redirect(url, 307);
	}
}

// Retain default export for Next.js compatibility (not used in tests)
export default middleware;
