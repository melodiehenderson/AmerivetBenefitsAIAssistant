/**
 * Subdomain dashboard page
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  MessageSquare, 
  BarChart3, 
  Calculator, 
  Settings, 
  LogOut,
  User,
  Building,
  Shield
} from 'lucide-react';

interface User {
  id: string;
  email: string;
  name: string;
  companyId: string;
  roles: string[];
  permissions: string[];
}

export default function SubdomainDashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/subdomain/auth/session', {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Not authenticated');
      }

      const data = await response.json();
      if (data.ok && data.role) {
        // Convert session response to user format
        const userData = {
          id: 'subdomain-user',
          email: 'user@amerivet.com',
          name: data.role === 'admin' ? 'Admin User' : 'Employee User',
          companyId: 'amerivet',
          roles: [data.role],
          permissions: data.permissions,
        };
        console.log('🔐 User authenticated:', userData);
        setUser(userData);
      } else {
        throw new Error('No user data');
      }
    } catch (err) {
      setError('Please log in to access the dashboard');
      router.push('/subdomain/login');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/subdomain/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      router.push('/subdomain/login');
    } catch (err) {
      console.error('Logout error:', err);
      router.push('/subdomain/login');
    }
  };

  const navigateToChat = () => {
    router.push('/subdomain/chat');
  };

  const navigateToCalculator = () => {
    router.push('/subdomain/calculator');
  };

  const navigateToSettings = () => {
    router.push('/subdomain/settings');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <img src="/brand/amerivet-logo.png" alt="AmeriVet Logo" className="w-32 h-10 mr-4 object-contain" />
              <h1 className="text-xl font-semibold text-gray-900">
                Benefits Assistant
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4" />
                  {user?.name || user?.email}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Building className="w-3 h-3" />
                  {user?.companyId}
                </div>
                <div className="flex items-center gap-2 text-xs text-blue-600 font-semibold">
                  <Shield className="w-3 h-3" />
                  Role: {user?.roles?.[0] || 'unknown'}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handleLogout}>
                <LogOut className="w-4 h-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">
            Welcome to Benefits Assistant
          </h2>
          <p className="text-gray-600">
            Access your benefits information, compare plans, and get personalized recommendations.
          </p>
        </div>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={navigateToChat}>
            <CardHeader>
              <div className="flex items-center">
                <MessageSquare className="w-8 h-8 text-blue-600 mr-3" />
                <div>
                  <CardTitle>AI Chat Assistant</CardTitle>
                  <CardDescription>
                    Ask questions about your benefits
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                Get instant answers about your health insurance, retirement plans, and other benefits.
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={navigateToCalculator}>
            <CardHeader>
              <div className="flex items-center">
                <Calculator className="w-8 h-8 text-green-600 mr-3" />
                <div>
                  <CardTitle>Cost Calculator</CardTitle>
                  <CardDescription>
                    Calculate benefit costs and savings
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                Compare different benefit options and see potential savings.
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={navigateToSettings}>
            <CardHeader>
              <div className="flex items-center">
                <Settings className="w-8 h-8 text-gray-600 mr-3" />
                <div>
                  <CardTitle>Settings</CardTitle>
                  <CardDescription>
                    Manage your preferences
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                Customize your experience and notification preferences.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Quick Stats - Admin only */}
        {user?.roles?.includes('admin') && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Stats</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-bold text-blue-600">0</div>
                  <div className="text-sm text-gray-600">Questions Asked</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-bold text-green-600">0</div>
                  <div className="text-sm text-gray-600">Documents Viewed</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-bold text-purple-600">0</div>
                  <div className="text-sm text-gray-600">Calculations Made</div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
