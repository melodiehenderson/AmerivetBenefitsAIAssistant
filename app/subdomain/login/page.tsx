/**
 * Subdomain login page with shared password authentication
 */

'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Lock, Eye, EyeOff } from 'lucide-react';

// Centralized API helper
async function api(path: string, body: unknown) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let d: any = {};
  try {
    d = JSON.parse(t);
  } catch {
    // JSON parse failed
  }
  if (!r.ok || !(d as any).ok) {
    throw new Error((d as any).error ?? `HTTP_${r.status}`);
  }
  return d;
}

export default function SubdomainLoginPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const submittingRef = useRef(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    // Guard against multiple clicks
    if (submittingRef.current) return;
    submittingRef.current = true;
    
    setIsLoading(true);
    setError('');

    try {
      const form = new FormData(e.currentTarget);
      const password = String(form.get('password') ?? '');

      const data = await api('/api/subdomain/auth/login', { password });

      console.log('[LOGIN] Success', { role: data.role });

      // Redirect to dashboard on success
      router.push('/subdomain/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
      submittingRef.current = false;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          {/* Logo Image */}
          <div className="mx-auto mb-4">
            <img src="/brand/amerivet-logo.png" alt="AmeriVet Logo" className="w-32 h-16 mx-auto object-contain" />
          </div>
          <CardTitle className="text-2xl font-bold">Benefits AI Assistant</CardTitle>
          <CardDescription>
            Your personal assistant for health benefits Q&amp;A
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="password" className="flex items-center gap-2">
                <Lock className="w-4 h-4" />
                Shared Password *
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••••••"
                  required
                  className="w-full pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Signing In...
                </>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
