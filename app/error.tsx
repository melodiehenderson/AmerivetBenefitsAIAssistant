'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App error:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <h1 className="text-4xl font-bold">Something went wrong</h1>
      <p className="mt-4 text-muted-foreground max-w-md text-center">
        {error.message || 'An unexpected error occurred. Please try again.'}
      </p>
      <div className="mt-8 flex gap-4">
        <button
          onClick={reset}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
        >
          Try Again
        </button>
        <Link 
          href="/"
          className="rounded-md border border-input px-4 py-2 hover:bg-accent"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
