/**
 * Analytics Dashboard for subdomain users
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, BarChart3, TrendingUp, MessageSquare, FileText, Calculator as CalcIcon, X } from 'lucide-react';

export default function AnalyticsPage() {
  const router = useRouter();
  const [userRole, setUserRole] = useState<string>('');
  const [faqFilter, setFaqFilter] = useState<string>('all');

  useEffect(() => {
    // Check auth and get role
    fetch('/api/subdomain/auth/session', { credentials: 'include' })
      .then(async res => {
        if (!res.ok) {
          router.push('/subdomain/login');
          return;
        }
        const data = await res.json();
        setUserRole(data.role || 'employee');
      })
      .catch(() => router.push('/subdomain/login'));
  }, [router]);

  const employeeStats = [
    { label: 'Questions Asked', value: '0', icon: MessageSquare, color: 'blue' },
    { label: 'Documents Viewed', value: '0', icon: FileText, color: 'green' },
    { label: 'Calculations Made', value: '0', icon: CalcIcon, color: 'purple' },
    { label: 'Sessions This Month', value: '1', icon: TrendingUp, color: 'orange' },
  ];

  const adminStats = [
    { label: 'Total Users', value: '24', icon: MessageSquare, color: 'blue' },
    { label: 'Active Sessions', value: '3', icon: TrendingUp, color: 'green' },
    { label: 'Documents Available', value: '12', icon: FileText, color: 'purple' },
    { label: 'Avg Response Time', value: '1.2s', icon: BarChart3, color: 'orange' },
  ];

  // FAQ data with categories
  const faqData = [
    { id: 1, question: 'What are my plan options?', category: 'all', count: 156, desc: 'Health insurance, retirement plans' },
    { id: 2, question: 'What are the HSA plan details?', category: 'hsa', count: 89, desc: 'Health Savings Account specifics' },
    { id: 3, question: 'How does PPO coverage work?', category: 'ppo', count: 76, desc: 'Preferred Provider Organization info' },
    { id: 4, question: 'What is DHMO?', category: 'dhmo', count: 63, desc: 'Dental Health Maintenance Organization' },
    { id: 5, question: 'How much does it cost?', category: 'all', count: 134, desc: 'Premiums, deductibles, out-of-pocket' },
    { id: 6, question: 'What are dental plan options?', category: 'dental', count: 98, desc: 'Dental coverage and providers' },
    { id: 7, question: 'Tell me about vision benefits', category: 'vision', count: 54, desc: 'Eye care and vision coverage' },
    { id: 8, question: "What's the difference between plans?", category: 'all', count: 98, desc: 'Plan comparison and coverage details' },
    { id: 9, question: 'How do I enroll?', category: 'enrollment', count: 87, desc: 'Enrollment process and deadlines' },
    { id: 10, question: 'What is open enrollment?', category: 'enrollment', count: 71, desc: 'Open enrollment timeline and changes' },
    { id: 11, question: 'Can I contact a benefits counselor?', category: 'support', count: 62, desc: 'Support and assistance options' },
    { id: 12, question: 'What retirement options do I have?', category: 'retirement', count: 58, desc: '401k, pension, and retirement plans' },
    { id: 13, question: 'How do I submit a claim?', category: 'claims', count: 45, desc: 'Claim submission process' },
    { id: 14, question: 'What is my deductible?', category: 'costs', count: 82, desc: 'Out-of-pocket costs and deductibles' },
    { id: 15, question: 'Can I change plans mid-year?', category: 'enrollment', count: 41, desc: 'Plan changes and life events' },
  ];

  const filterOptions = [
    { label: 'All', value: 'all' },
    { label: 'HSA', value: 'hsa' },
    { label: 'PPO', value: 'ppo' },
    { label: 'DHMO', value: 'dhmo' },
    { label: 'Dental', value: 'dental' },
    { label: 'Vision', value: 'vision' },
    { label: 'Retirement', value: 'retirement' },
    { label: 'Enrollment', value: 'enrollment' },
    { label: 'Claims', value: 'claims' },
    { label: 'Costs', value: 'costs' },
    { label: 'Support', value: 'support' },
  ];

  const filteredFAQ = faqFilter === 'all' 
    ? faqData 
    : faqData.filter(faq => faq.category === faqFilter || faq.category === 'all');

  const stats = userRole === 'admin' ? adminStats : employeeStats;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Button variant="ghost" onClick={() => router.push('/subdomain/dashboard')} className="mr-4">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <h1 className="text-2xl font-bold text-gray-900">
                {userRole === 'admin' ? 'Admin Analytics Dashboard' : 'Your Usage Analytics'}
              </h1>
            </div>
            {userRole === 'admin' && (
              <div className="flex items-center space-x-3">
                <Button variant="outline" size="sm" onClick={() => router.push('/subdomain/documents-admin')}>
                  Manage Documents
                </Button>
                <div className="bg-green-100 px-3 py-1 rounded-full">
                  <span className="text-sm font-medium text-green-800">Admin View</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Overview</h2>
          <p className="text-gray-600">
            {userRole === 'admin'
              ? 'Real-time system metrics and user activity monitoring'
              : 'Track your benefit usage and engagement'}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {stats.map((stat, index) => {
            const Icon = stat.icon;
            const colorClasses = {
              blue: 'bg-blue-100 text-blue-600',
              green: 'bg-green-100 text-green-600',
              purple: 'bg-purple-100 text-purple-600',
              orange: 'bg-orange-100 text-orange-600',
            };

            return (
              <Card key={index}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600 mb-1">{stat.label}</p>
                      <p className="text-3xl font-bold text-gray-900">{stat.value}</p>
                    </div>
                    <div className={`p-3 rounded-lg ${colorClasses[stat.color as keyof typeof colorClasses]}`}>
                      <Icon className="w-6 h-6" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {userRole === 'admin' && (
          <>
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>System Performance</CardTitle>
                <CardDescription>AI response quality and system health</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">Average Grounding Score</span>
                      <span className="font-semibold text-green-600">94%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-green-600 h-2 rounded-full" style={{ width: '94%' }}></div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">Cache Hit Rate</span>
                      <span className="font-semibold text-blue-600">78%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-blue-600 h-2 rounded-full" style={{ width: '78%' }}></div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">User Satisfaction</span>
                      <span className="font-semibold text-purple-600">92%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-purple-600 h-2 rounded-full" style={{ width: '92%' }}></div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="mb-6">
              <CardHeader>
                <CardTitle>FAQ - Frequently Asked Questions</CardTitle>
                <CardDescription>Most common questions from users - filter by topic</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4">
                  <div className="flex flex-wrap gap-2">
                    {filterOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => setFaqFilter(option.value)}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                          faqFilter === option.value
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {filteredFAQ.length === 0 ? (
                    <p className="text-gray-500 py-4 text-center">No FAQs found for this category</p>
                  ) : (
                    filteredFAQ.map((faq) => (
                      <div
                        key={faq.id}
                        className="flex items-center justify-between py-3 border-b hover:bg-gray-50 px-2 rounded cursor-pointer transition"
                      >
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">{faq.question}</p>
                          <p className="text-sm text-gray-500">{faq.desc}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-blue-600">{faq.count}</p>
                          <p className="text-xs text-gray-500">asked</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Latest user interactions and system events</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between py-2 border-b">
                    <div>
                      <p className="font-medium text-gray-900">User logged in</p>
                      <p className="text-sm text-gray-500">employee@amerivet.com</p>
                    </div>
                    <span className="text-sm text-gray-500">2 min ago</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b">
                    <div>
                      <p className="font-medium text-gray-900">Document accessed</p>
                      <p className="text-sm text-gray-500">Medical Plan Summary 2025</p>
                    </div>
                    <span className="text-sm text-gray-500">15 min ago</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <p className="font-medium text-gray-900">Chat session completed</p>
                      <p className="text-sm text-gray-500">5 messages exchanged</p>
                    </div>
                    <span className="text-sm text-gray-500">1 hour ago</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {userRole === 'employee' && (
          <Card>
            <CardHeader>
              <CardTitle>Your Activity</CardTitle>
              <CardDescription>Recent interactions with the Benefits Assistant</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-gray-500">
                <BarChart3 className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                <p>No activity recorded yet</p>
                <p className="text-sm mt-1">Start using the AI Chat Assistant or Cost Calculator to see your usage stats</p>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
