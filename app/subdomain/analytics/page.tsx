/**
 * Analytics Dashboard for subdomain users
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AmeriVetLogo } from '@/components/amerivet-logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, BarChart3, TrendingUp, MessageSquare, FileText, Calculator as CalcIcon, X } from 'lucide-react';

interface ActivityLog {
  action: string;
  description: string;
  timeAgo: string;
}

interface IndexedDocument {
  docId: string;
  title: string;
  fileName: string;
  chunkCount: number;
}

export default function AnalyticsPage() {
  const router = useRouter();
  const [userRole, setUserRole] = useState<string>('');
  const [userId, setUserId] = useState<string>('');
  const [faqFilter, setFaqFilter] = useState<string>('all');
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(true);
  const [indexedDocs, setIndexedDocs] = useState<IndexedDocument[]>([]);
  const [docsExpanded, setDocsExpanded] = useState(false);

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
        setUserId(data.userId || '');

        // Fetch indexed plan documents from search index
        fetch('/api/admin/indexed-documents', { credentials: 'include' })
          .then(res => res.json())
          .then(d => setIndexedDocs(d.documents || []))
          .catch(() => setIndexedDocs([]));
        
        // Fetch real activity logs from database
        const query = new URLSearchParams({
          role: data.role || 'employee',
          limit: '10',
          ...(data.userId && { userId: data.userId }),
        });
        
        fetch(`/api/analytics/activity-log?${query}`, { credentials: 'include' })
          .then(res => res.json())
          .then(data => {
            setActivities(data.activities || []);
          })
          .catch(err => {
            console.error('Failed to fetch activity logs:', err);
            setActivities([]);
          })
          .finally(() => setLoadingActivities(false));
      })
      .catch(() => {
        router.push('/subdomain/login');
        setLoadingActivities(false);
      });
  }, [router]);

  const employeeStats = [
    { label: 'Questions Asked', value: '0', icon: MessageSquare, color: 'blue' },
    { label: 'Documents Viewed', value: '0', icon: FileText, color: 'green' },
    { label: 'Calculations Made', value: '0', icon: CalcIcon, color: 'purple' },
    { label: 'Sessions This Month', value: '1', icon: TrendingUp, color: 'orange' },
  ];

  const adminStats = [
    { label: 'Benefit Topics Covered', value: '8', icon: MessageSquare, color: 'blue' },
    { label: 'Plan Documents Indexed', value: indexedDocs.length ? String(indexedDocs.length) : '11', icon: FileText, color: 'green' },
    { label: 'Active Users', value: userRole === 'admin' ? '—' : '0', icon: TrendingUp, color: 'purple' },
    { label: 'QA Engine', value: 'Live', icon: BarChart3, color: 'orange' },
  ];

  const faqData = [
    { id: 1, question: 'What medical plans does AmeriVet offer?', category: 'medical', desc: 'BCBSTX Standard HSA, Enhanced HSA, Kaiser Standard HMO' },
    { id: 2, question: 'How does the HSA work?', category: 'hsa', desc: 'Employer seed, contribution limits, rollover rules' },
    { id: 3, question: 'What does AmeriVet contribute to my HSA?', category: 'hsa', desc: 'Employer HSA seed amounts by coverage tier' },
    { id: 4, question: 'What dental plan is available?', category: 'dental', desc: 'BCBSTX Dental PPO — preventive, basic, major services' },
    { id: 5, question: 'What is the vision plan?', category: 'vision', desc: 'VSP Vision Plus — exams, frames, contacts' },
    { id: 6, question: 'What life insurance does AmeriVet provide?', category: 'life', desc: 'Basic Life & AD&D (employer-paid) + Voluntary Term Life' },
    { id: 7, question: 'What disability coverage is available?', category: 'disability', desc: 'Short-Term and Long-Term Disability through Unum' },
    { id: 8, question: 'What is Critical Illness insurance?', category: 'supplemental', desc: 'Allstate Critical Illness — lump sum for serious diagnoses' },
    { id: 9, question: 'When does coverage start as a new hire?', category: 'enrollment', desc: 'Coverage effective date for new employees' },
    { id: 10, question: 'How do I enroll in benefits?', category: 'enrollment', desc: 'Workday enrollment portal and deadlines' },
    { id: 11, question: 'What is Kaiser and is it available in my state?', category: 'medical', desc: 'Kaiser HMO availability by geography' },
    { id: 12, question: 'How do premiums compare across plans?', category: 'costs', desc: 'Employee premium by plan and coverage tier' },
  ];

  const filterOptions = [
    { label: 'All', value: 'all' },
    { label: 'Medical', value: 'medical' },
    { label: 'HSA', value: 'hsa' },
    { label: 'Dental', value: 'dental' },
    { label: 'Vision', value: 'vision' },
    { label: 'Life', value: 'life' },
    { label: 'Disability', value: 'disability' },
    { label: 'Supplemental', value: 'supplemental' },
    { label: 'Enrollment', value: 'enrollment' },
    { label: 'Costs', value: 'costs' },
  ];

  const filteredFAQ = faqFilter === 'all'
    ? faqData
    : faqData.filter(faq => faq.category === faqFilter);

  const stats = userRole === 'admin' ? adminStats : employeeStats;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <AmeriVetLogo
                alt="AmeriVet"
                width={40}
                height={40}
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
              <h1 className="text-2xl font-bold text-gray-900">
                {userRole === 'admin' ? 'Admin Analytics Dashboard' : 'Your Usage Analytics'}
              </h1>
            </div>
            {userRole === 'admin' && (
              <div className="flex items-center space-x-3">
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
            {/* Indexed Plan Documents */}
            <Card className="mb-6">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Plan Documents Indexed</CardTitle>
                    <CardDescription>Source documents powering the AI assistant</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setDocsExpanded(v => !v)}>
                    {docsExpanded ? 'Collapse' : 'View all'}
                  </Button>
                </div>
              </CardHeader>
              {docsExpanded && (
                <CardContent className="pt-0">
                  {indexedDocs.length === 0 ? (
                    <p className="text-sm text-gray-500">Loading documents…</p>
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {indexedDocs.map(doc => (
                        <li key={doc.docId} className="py-2.5 flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{doc.title || doc.fileName || doc.docId}</p>
                            {doc.fileName && doc.fileName !== doc.title && (
                              <p className="text-xs text-gray-400 truncate">{doc.fileName}</p>
                            )}
                          </div>
                          <span className="shrink-0 text-xs text-gray-400">{doc.chunkCount} chunks</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              )}
            </Card>

            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Benefits Coverage</CardTitle>
                <CardDescription>Topics the AI assistant is trained to answer</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {['Medical', 'Dental', 'Vision', 'Life Insurance', 'Disability', 'Critical Illness', 'Accident / AD&D', 'HSA / FSA'].map(topic => (
                    <span key={topic} className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full border border-blue-100">
                      ✓ {topic}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Common Questions</CardTitle>
                <CardDescription>Topics employees can ask the Benefits AI Assistant — filter by category</CardDescription>
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
                        className="py-3 border-b hover:bg-gray-50 px-2 rounded cursor-pointer transition"
                      >
                        <p className="font-medium text-gray-900">{faq.question}</p>
                        <p className="text-sm text-gray-500 mt-1">{faq.desc}</p>
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
                  {loadingActivities ? (
                    <div className="text-center py-6 text-gray-500">
                      <p>Loading activity data...</p>
                    </div>
                  ) : activities.length > 0 ? (
                    activities.map((activity, idx) => (
                      <div
                        key={idx}
                        className={`flex items-center justify-between py-2 ${idx < activities.length - 1 ? 'border-b' : ''}`}
                      >
                        <div>
                          <p className="font-medium text-gray-900">{activity.action}</p>
                          <p className="text-sm text-gray-500">{activity.description}</p>
                        </div>
                        <span className="text-sm text-gray-500">{activity.timeAgo}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-6 text-gray-500">
                      <p>No activity recorded yet</p>
                      <p className="text-sm mt-1">Activities will appear here as users interact with the system</p>
                    </div>
                  )}
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
                <p className="text-sm mt-1">Start using the AI Chat Assistant or Medical Plan Cost Comparison Tool to see your usage stats</p>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
