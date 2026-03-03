/**
 * Settings page for subdomain users
 */

'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Settings } from 'lucide-react';

export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [darkMode, setDarkMode] = useState(false);
  const [textSize, setTextSize] = useState<'sm' | 'md' | 'lg'>('md');

  useEffect(() => {
    fetch('/api/subdomain/auth/session', { credentials: 'include' })
      .then(res => !res.ok && router.push('/subdomain/login'))
      .catch(() => router.push('/subdomain/login'));

    // initialize from current theme and stored text size
    if (typeof window === 'undefined') return;
    
    setDarkMode((resolvedTheme || theme) === 'dark');
    const storedSize = localStorage.getItem('text-size') as 'sm' | 'md' | 'lg' | null;
    if (storedSize) {
      setTextSize(storedSize);
      document.documentElement.classList.remove('text-size-sm','text-size-md','text-size-lg');
      document.documentElement.classList.add(`text-size-${storedSize}`);
    }
  }, [router, resolvedTheme, theme]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <img 
                src="/brand/amerivet-logo.png" 
                alt="AmeriVet" 
                className="w-10 h-10 object-contain"
              />
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => router.push('/subdomain/dashboard')}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Dashboard
              </Button>
              <h1 className="text-2xl font-bold text-gray-900">AmeriVet Settings</h1>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Settings className="w-6 h-6 mr-2" />
              Preferences
            </CardTitle>
            <CardDescription>Customize your experience</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <Label>Dark Mode</Label>
                <p className="text-sm text-gray-500">Use dark theme for the app</p>
              </div>
              <Switch checked={darkMode} onCheckedChange={(v) => { setDarkMode(v); setTheme(v ? 'dark' : 'light'); }} />
            </div>

            <div>
              <Label>Text Size</Label>
              <div className="mt-2 max-w-xs">
                <Select value={textSize} onValueChange={(v: 'sm' | 'md' | 'lg') => {
                  setTextSize(v);
                  if (typeof window !== 'undefined') {
                    localStorage.setItem('text-size', v);
                    document.documentElement.classList.remove('text-size-sm','text-size-md','text-size-lg');
                    document.documentElement.classList.add(`text-size-${v}`);
                  }
                }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sm">Small</SelectItem>
                    <SelectItem value="md">Medium</SelectItem>
                    <SelectItem value="lg">Large</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button className="w-full" onClick={() => {
              // persist theme choice as next-themes does automatically; persist text size already stored
              alert('Preferences saved');
            }}>Save Changes</Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
