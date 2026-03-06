'use client';

import { useEffect } from 'react';

export default function SubdomainError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Log full context to Vercel logs without leaking secrets
    // Helps diagnose server-render errors on /subdomain/* pages
    // eslint-disable-next-line no-console
    console.error('[subdomain:error]', {
      message: error?.message,
      stack: error?.stack,
      digest: (error as any)?.digest,
      env: {
        NODE_ENV: process.env.NODE_ENV,
        NEXT_PUBLIC_ENVIRONMENT: process.env.NEXT_PUBLIC_ENVIRONMENT,
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      },
    });
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
      <div className="max-w-lg w-full text-center">
        <h1 className="text-3xl font-semibold mb-2">Something went wrong</h1>
        <p className="text-gray-600 mb-6">We hit an unexpected error loading this page.</p>
        <div className="text-left mb-6 p-4 rounded bg-gray-100 text-sm text-gray-700 overflow-x-auto">
          <div className="font-mono whitespace-pre-wrap break-words">
            {error?.message || 'Unknown error'}
          </div>
        </div>
        <button
          onClick={() => reset()}
          className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

