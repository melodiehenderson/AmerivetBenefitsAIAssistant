/**
 * Subdomain dashboard page
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AmeriVetLogo } from '@/components/amerivet-logo';
import { WelcomeVideoModal } from '@/components/welcome-video-modal';
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
  const [showIntroVideo, setShowIntroVideo] = useState(false);
  const router = useRouter();

  useEffect(() => {
    checkAuth();
  }, []);

  // Auto-open on first visit (after auth resolves)
  useEffect(() => {
    if (!isLoading && user) {
      const watched = localStorage.getItem('welcome_video_watched');
      if (!watched) {
        const t = setTimeout(() => setShowIntroVideo(true), 500);
        return () => clearTimeout(t);
      }
    }
  }, [isLoading, user]);

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

  const navigateToAnalytics = () => {
    router.push('/subdomain/analytics');
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {showIntroVideo && (
        <WelcomeVideoModal onClose={() => {
          localStorage.setItem('welcome_video_watched', 'true');
          setShowIntroVideo(false);
        }} />
      )}
      {/* Header */}
      <header className="sticky top-0 z-50 bg-gradient-to-r from-white via-blue-50 to-white shadow-md border-b border-blue-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <AmeriVetLogo alt="AmeriVet Logo" variant="wordmark" width={200} height={60} className="w-40 h-12 mr-4 object-contain" />
              <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Benefits Assistant
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-sm bg-blue-50 px-3 py-2 rounded-lg border border-blue-200">
                <div className="flex items-center gap-2 font-semibold text-gray-800">
                  <User className="w-4 h-4 text-blue-600" />
                  {user?.name || user?.email}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-600 mt-1">
                  <Building className="w-3 h-3 text-purple-600" />
                  {user?.companyId}
                </div>
                <div className="flex items-center gap-2 text-xs text-blue-600 font-semibold mt-1">
                  <Shield className="w-3 h-3" />
                  {user?.roles?.[0] || 'unknown'}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setShowIntroVideo(true)} className="border-blue-300 hover:bg-blue-50">
                ▶ Watch intro
              </Button>
              <Button variant="outline" size="sm" onClick={handleLogout} className="border-blue-300 hover:bg-red-50 hover:text-red-700 hover:border-red-300">
                <LogOut className="w-4 h-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-12">
          <h2 className="text-4xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-blue-600 bg-clip-text text-transparent mb-3">
            Welcome to Benefits Assistant
          </h2>
          <p className="text-gray-600 text-lg max-w-2xl">
            Access your benefits information, compare plans, and get personalized recommendations powered by AI.
          </p>
        </div>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Chat Card */}
          <Card 
            className="group cursor-pointer border-0 bg-white hover:shadow-2xl transition-all duration-300 transform hover:scale-105 hover:-translate-y-1"
            onClick={navigateToChat}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-transparent to-blue-500/10 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <CardHeader className="relative">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center">
                  <div className="p-3 bg-blue-100 group-hover:bg-blue-200 rounded-lg transition-colors">
                    <MessageSquare className="w-6 h-6 text-blue-600" />
                  </div>
                  <div className="ml-3">
                    <CardTitle className="text-lg">AI Chat Assistant</CardTitle>
                    <CardDescription>Ask questions about your benefits</CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="relative">
              <p className="text-sm text-gray-600 mb-4">
                Get instant answers about your health insurance, retirement plans, and other benefits.
              </p>
              <div className="flex items-center text-blue-600 font-semibold text-sm group-hover:translate-x-1 transition-transform">
                Start Chatting <MessageSquare className="w-4 h-4 ml-2" />
              </div>
            </CardContent>
          </Card>

          {/* Calculator Card */}
          <Card 
            className="group cursor-pointer border-0 bg-white hover:shadow-2xl transition-all duration-300 transform hover:scale-105 hover:-translate-y-1"
            onClick={navigateToCalculator}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-green-500/10 via-transparent to-green-500/10 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <CardHeader className="relative">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center">
                  <div className="p-3 bg-green-100 group-hover:bg-green-200 rounded-lg transition-colors">
                    <Calculator className="w-6 h-6 text-green-600" />
                  </div>
                  <div className="ml-3">
                    <CardTitle className="text-lg">Medical Plan Cost Comparison Tool</CardTitle>
                    <CardDescription>Calculate benefit costs and savings</CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="relative">
              <p className="text-sm text-gray-600 mb-4">
                Compare different benefit options and see potential savings tailored to your needs.
              </p>
              <div className="flex items-center text-green-600 font-semibold text-sm group-hover:translate-x-1 transition-transform">
                Calculate Costs <Calculator className="w-4 h-4 ml-2" />
              </div>
            </CardContent>
          </Card>

          {/* Settings Card */}
          <Card 
            className="group cursor-pointer border-0 bg-white hover:shadow-2xl transition-all duration-300 transform hover:scale-105 hover:-translate-y-1"
            onClick={navigateToSettings}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-gray-500/10 via-transparent to-gray-500/10 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <CardHeader className="relative">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center">
                  <div className="p-3 bg-gray-100 group-hover:bg-gray-200 rounded-lg transition-colors">
                    <Settings className="w-6 h-6 text-gray-600" />
                  </div>
                  <div className="ml-3">
                    <CardTitle className="text-lg">Settings</CardTitle>
                    <CardDescription>Manage your preferences</CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="relative">
              <p className="text-sm text-gray-600 mb-4">
                Adjust the text size to suit your reading preference.
              </p>
              <div className="flex items-center text-gray-600 font-semibold text-sm group-hover:translate-x-1 transition-transform">
                Customize <Settings className="w-4 h-4 ml-2" />
              </div>
            </CardContent>
          </Card>

          {user?.roles?.includes('admin') && (
            <Card 
              className="group cursor-pointer border-0 bg-white hover:shadow-2xl transition-all duration-300 transform hover:scale-105 hover:-translate-y-1"
              onClick={navigateToAnalytics}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 via-transparent to-purple-500/10 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <CardHeader className="relative">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center">
                    <div className="p-3 bg-purple-100 group-hover:bg-purple-200 rounded-lg transition-colors">
                      <BarChart3 className="w-6 h-6 text-purple-600" />
                    </div>
                    <div className="ml-3">
                      <CardTitle className="text-lg">Analytics Dashboard</CardTitle>
                      <CardDescription>View insights and reports</CardDescription>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="relative">
                <p className="text-sm text-gray-600 mb-4">
                  Access detailed analytics, user activity, and system performance metrics.
                </p>
                <div className="flex items-center text-purple-600 font-semibold text-sm group-hover:translate-x-1 transition-transform">
                  View Analytics <BarChart3 className="w-4 h-4 ml-2" />
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Quick Tips Section */}
        <div className="mt-12 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-6 border border-blue-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">💡 Quick Tips</h3>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
            <li className="flex items-start">
              <span className="text-blue-600 font-bold mr-3">•</span>
              <span>Use the Chat Assistant to ask questions about specific benefits and get instant answers</span>
            </li>
            <li className="flex items-start">
              <span className="text-purple-600 font-bold mr-3">•</span>
              <span>Compare plan costs with the Calculator to make informed decisions</span>
            </li>
            <li className="flex items-start">
              <span className="text-green-600 font-bold mr-3">•</span>
              <span>Adjust text size in Settings if you prefer larger or smaller text</span>
            </li>
            {user?.roles?.includes('admin') && (
              <li className="flex items-start">
                <span className="text-red-600 font-bold mr-3">•</span>
                <span>Monitor system insights in Analytics to track usage and engagement</span>
              </li>
            )}
          </ul>
        </div>
      </main>
    </div>
  );
}
