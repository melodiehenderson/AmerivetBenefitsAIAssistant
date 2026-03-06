import { isBuild } from '@/lib/runtime/is-build';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Wraps API route handlers to safely bypass during build time.
 * Prevents service imports and DB connections from executing during Next.js build.
 */
export function withBuildBypass<T extends (req: NextRequest) => Promise<NextResponse>>(
  handler: T
): T {
  return (async (request: NextRequest) => {
    if (isBuild) {
      return NextResponse.json(
        { error: 'Service not available during build' },
        { status: 503 }
      );
    }
    return handler(request);
  }) as T;
}
