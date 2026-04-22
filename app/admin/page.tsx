'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../context/auth-context';
import { useRouter } from 'next/navigation';
import { logger } from '../../lib/logger';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Badge } from '../../components/ui/badge';
import { AmeriVetLogo } from '../../components/amerivet-logo';
import {
  MessageSquare,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
  Activity,
  FileText,
  Settings,
  BarChart3,
  Zap,
  XCircle,
} from 'lucide-react';

interface PipelineTrace {
  id: string;
  query: string;
  success: boolean;
  gate: { passed: boolean; reason?: string };
  handler?: string;
  durationMs?: number;
  timestamp?: string;
  createdAt?: string;
}

const BENEFIT_TOPICS = [
  'Medical',
  'Dental',
  'Vision',
  'Life Insurance',
  'Disability',
  'Critical Illness',
  'Accident / AD&D',
  'HSA / FSA',
];

const PLAN_DOCUMENTS = [
  { name: 'BCBSTX Standard HSA', type: 'Medical' },
  { name: 'BCBSTX Enhanced HSA', type: 'Medical' },
  { name: 'Kaiser Standard HMO', type: 'Medical' },
  { name: 'BCBSTX Dental PPO', type: 'Dental' },
  { name: 'VSP Vision Plus', type: 'Vision' },
  { name: 'Unum Basic Life & AD&D', type: 'Life' },
  { name: 'Unum Voluntary Term Life', type: 'Life' },
  { name: 'Unum Short-Term Disability', type: 'Disability' },
  { name: 'Unum Long-Term Disability', type: 'Disability' },
  { name: 'Allstate Critical Illness', type: 'Supplemental' },
  { name: 'Unum Accident / AD&D', type: 'Supplemental' },
];

export default function AdminDashboard() {
  const { account, loading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('overview');
  const [traces, setTraces] = useState<PipelineTrace[]>([]);
  const [tracesLoading, setTracesLoading] = useState(false);
  const [qaStatus, setQaStatus] = useState<'checking' | 'live' | 'error'>('checking');

  useEffect(() => {
    if (!loading && !account) {
      router.push('/login');
    }
  }, [account, loading, router]);

  // Ping the QA engine to confirm it's live
  useEffect(() => {
    if (!account) return;
    fetch('/api/qa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'ping', sessionId: 'admin-healthcheck', companyId: 'amerivet' }),
    })
      .then((r) => setQaStatus(r.ok ? 'live' : 'error'))
      .catch(() => setQaStatus('error'));
  }, [account]);

  // Load pipeline traces when Activity tab is opened
  useEffect(() => {
    if (activeTab !== 'activity' || traces.length > 0) return;
    setTracesLoading(true);
    fetch('/api/admin/pipeline-traces?limit=20')
      .then((r) => r.json())
      .then((d) => setTraces(d.traces || []))
      .catch((e) => logger.error('Failed to load traces', e))
      .finally(() => setTracesLoading(false));
  }, [activeTab]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
      </div>
    );
  }

  if (!account) return null;

  const qaStatusBadge = {
    checking: <Badge variant="outline" className="text-gray-500 border-gray-300">Checking…</Badge>,
    live: <Badge className="bg-green-50 text-green-700 border border-green-300">Live</Badge>,
    error: <Badge variant="destructive">Unreachable</Badge>,
  }[qaStatus];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AmeriVetLogo variant="wordmark" width={140} />
          <span className="text-gray-300">|</span>
          <span className="text-sm font-medium text-gray-600">Benefits AI — Admin</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">Signed in as {account.name || account.username}</span>
          <Button variant="outline" size="sm" onClick={() => router.push('/chat')}>
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
            Open Chat
          </Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-2">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activity">Pipeline Traces</TabsTrigger>
            <TabsTrigger value="content">Content</TabsTrigger>
            <TabsTrigger value="links">Quick Links</TabsTrigger>
          </TabsList>

          {/* ── OVERVIEW ── */}
          <TabsContent value="overview" className="space-y-6">
            {/* Status row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-500">QA Engine</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-gray-400" />
                  {qaStatusBadge}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-500">Benefit Topics</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-gray-900">{BENEFIT_TOPICS.length}</div>
                  <p className="text-xs text-gray-500 mt-0.5">All indexed and active</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-500">Plan Documents</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-gray-900">{PLAN_DOCUMENTS.length}</div>
                  <p className="text-xs text-gray-500 mt-0.5">Medical, dental, vision, supplemental</p>
                </CardContent>
              </Card>
            </div>

            {/* Topics coverage */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Benefits Coverage</CardTitle>
                <CardDescription>Topics the assistant is trained to answer</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {BENEFIT_TOPICS.map((topic) => (
                    <span
                      key={topic}
                      className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full border border-blue-100"
                    >
                      <CheckCircle className="w-3 h-3" />
                      {topic}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Carrier roster */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Indexed Plan Documents</CardTitle>
                <CardDescription>AmeriVet 2024 benefits package</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="divide-y">
                  {PLAN_DOCUMENTS.map((doc) => (
                    <div key={doc.name} className="flex items-center justify-between py-2.5">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-800">{doc.name}</span>
                      </div>
                      <Badge variant="outline" className="text-xs">{doc.type}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── PIPELINE TRACES ── */}
          <TabsContent value="activity" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent Pipeline Traces</CardTitle>
                <CardDescription>Last 20 questions routed through the QA engine</CardDescription>
              </CardHeader>
              <CardContent>
                {tracesLoading ? (
                  <div className="flex items-center gap-2 py-8 justify-center text-sm text-gray-500">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
                    Loading traces…
                  </div>
                ) : traces.length === 0 ? (
                  <p className="text-sm text-gray-500 py-8 text-center">
                    No traces yet — traces appear after questions are asked in the chat.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {traces.map((t) => {
                      const passed = t.success && t.gate.passed;
                      const ts = t.timestamp || t.createdAt;
                      return (
                        <div
                          key={t.id}
                          className="flex items-start gap-3 p-3 rounded-lg border bg-white hover:bg-gray-50 transition-colors"
                        >
                          {passed
                            ? <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                            : <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-800 truncate">{t.query}</p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {t.handler ? `Handler: ${t.handler}` : 'LLM path'}
                              {t.durationMs ? ` · ${t.durationMs}ms` : ''}
                              {ts ? ` · ${new Date(ts).toLocaleString()}` : ''}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={passed ? 'text-green-700 border-green-200 bg-green-50' : 'text-red-600 border-red-200 bg-red-50'}
                          >
                            {passed ? 'passed' : t.gate.reason || 'blocked'}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── CONTENT ── */}
          <TabsContent value="content" className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Manage Documents</CardTitle>
                  <CardDescription>Upload or remove plan PDFs</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button variant="outline" className="w-full justify-start" onClick={() => router.push('/admin/documents')}>
                    <FileText className="w-4 h-4 mr-2" />
                    View all documents
                  </Button>
                  <Button variant="outline" className="w-full justify-start" onClick={() => router.push('/admin/documents/upload')}>
                    <Zap className="w-4 h-4 mr-2" />
                    Upload new document
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Manage FAQs</CardTitle>
                  <CardDescription>Curated Q&A pairs for common questions</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button variant="outline" className="w-full justify-start" onClick={() => router.push('/admin/faqs' as any)}>
                    <MessageSquare className="w-4 h-4 mr-2" />
                    View FAQ library
                  </Button>
                  <Button variant="outline" className="w-full justify-start" onClick={() => router.push('/admin/settings')}>
                    <Settings className="w-4 h-4 mr-2" />
                    Admin settings
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── QUICK LINKS ── */}
          <TabsContent value="links" className="space-y-4">
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
              {[
                { label: 'Benefits Chat', href: '/chat', desc: 'Open the employee-facing assistant', icon: <MessageSquare className="w-5 h-5 text-blue-600" /> },
                { label: 'Cost Calculator', href: '/benefits/compare', desc: 'Medical plan cost comparison tool', icon: <BarChart3 className="w-5 h-5 text-green-600" /> },
                { label: 'Pipeline Monitor', href: '/admin/pipeline', desc: 'Full trace viewer with filters', icon: <Activity className="w-5 h-5 text-purple-600" /> },
                { label: 'Document Library', href: '/admin/documents', desc: 'View indexed plan documents', icon: <FileText className="w-5 h-5 text-orange-600" /> },
                { label: 'Admin Settings', href: '/admin/settings', desc: 'Company and system settings', icon: <Settings className="w-5 h-5 text-gray-600" /> },
                { label: 'Enrollment Portal', href: 'https://wd5.myworkday.com/amerivet/login.html', desc: 'AmeriVet Workday enrollment', icon: <ExternalLink className="w-5 h-5 text-red-500" />, external: true },
              ].map(({ label, href, desc, icon, external }) => (
                <Card
                  key={label}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => external ? window.open(href, '_blank') : router.push(href as any)}
                >
                  <CardContent className="pt-5 pb-4 flex items-start gap-3">
                    <div className="mt-0.5">{icon}</div>
                    <div>
                      <div className="font-medium text-sm text-gray-900">{label}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{desc}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
