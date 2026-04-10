// app/(auth)/login/page.tsx
'use client';

import { useAuth } from '@/context/auth-context';
import { AmeriVetLogo } from '@/components/amerivet-logo';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function LoginPage() {
  const { login, account, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (account) {
      router.push('/chat');
    }
  }, [account, router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <div className="w-full max-w-sm p-8 space-y-8 bg-white rounded-lg shadow-lg">
        <div className="text-center">
          <AmeriVetLogo
            alt="Amerivet Logo"
            width={160}
            height={48}
            className="mx-auto mb-4"
          />
          <h1 className="text-2xl font-bold">Welcome</h1>
          <p className="text-muted-foreground">
            Sign in to access your Benefits Assistant.
          </p>
        </div>
        <Button
          onClick={() => {
            // In demo mode, redirect directly to chat
            if (process.env.NEXT_PUBLIC_TEST_MODE === 'true') {
              router.push('/chat');
            } else {
              login();
            }
          }}
          disabled={loading}
          className="w-full"
        >
          {loading ? 'Signing in...' : 'Sign in with Microsoft'}
        </Button>
        {process.env.NEXT_PUBLIC_TEST_MODE === 'true' && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <p className="text-sm text-blue-700">
              <strong>Demo Mode:</strong> Click "Sign in with Microsoft" to enter demo mode
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
