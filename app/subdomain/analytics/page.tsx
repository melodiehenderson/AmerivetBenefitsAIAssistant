/**
 * Analytics Dashboard — Tenant Admin View
 * All metrics are aggregated and anonymized. No individual user data is surfaced.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AmeriVetLogo } from '@/components/amerivet-logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, BarChart3, TrendingUp, TrendingDown, MessageSquare, FileText, Users, Clock, ShieldCheck, PhoneForwarded, RefreshCw, CheckCircle2, CalendarDays } from 'lucide-react';

interface ActivityLog {
  action: string;
  description: string;
  timeAgo: string;
}

interface AdminStats {
  totalConversations: number;
  uniqueUsers: number;
  totalQuestions: number;
  activeUsersThisMonth: number;
  momConversationsDelta: number | null;
  momQuestionsDelta: number | null;
  momSessionsDelta: number | null;
  avgMessagesPerConversation: number;
  adoptionRate: number | null;
  estimatedHoursSaved: number;
  estimatedDollarsSaved: number;
  totalRegisteredUsers: number;
  notYetEngaged: number;
  completionRate: number | null;
  completedConversations: number;
  peakDay: string | null;
  peakHour: string | null;
  escalatedConversations: number;
  escalationRate: number | null;
  escalationTopics: { topic: string; escalations: number }[];
  weeklyTrend: { week: string; count: number }[];
  planDocumentsIndexed: number | null;
  topTopics: { topic: string; count: number }[];
}

function fmt(n: number | null | undefined, suffix = ''): string {
  if (n == null || n === 0) return '—';
  return n.toLocaleString() + suffix;
}

/** Inline ↑/↓ badge for month-over-month delta */
function DeltaBadge({ delta }: { delta: number | null | undefined }) {
  if (delta == null) return null;
  const up = delta >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full ${up ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      <Icon className="w-3 h-3" />
      {up ? '+' : ''}{delta}% vs last mo
    </span>
  );
}

export default function AnalyticsPage() {
  const router = useRouter();
  const [userRole, setUserRole] = useState<string>('');
  const [faqFilter, setFaqFilter] = useState<string>('all');
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(true);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refreshStats = useCallback(() => {
    setRefreshing(true);
    fetch('/api/analytics/stats', { credentials: 'include' })
      .then(r => r.json())
      .then((d: AdminStats) => {
        setStats(d);
        setFetchedAt(new Date().toLocaleTimeString());
      })
      .catch(() => setStats(null))
      .finally(() => {
        setLoadingStats(false);
        setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    fetch('/api/subdomain/auth/session', { credentials: 'include' })
      .then(async res => {
        if (!res.ok) { router.push('/subdomain/login'); return; }
        const data = await res.json();
        const role = data.role || 'employee';
        const uid = data.userId || '';
        setUserRole(role);

        // Activity log
        const q = new URLSearchParams({ role, limit: '10', ...(uid && { userId: uid }) });
        fetch(`/api/analytics/activity-log?${q}`, { credentials: 'include' })
          .then(r => r.json())
          .then(d => setActivities(d.activities || []))
          .catch(() => setActivities([]))
          .finally(() => setLoadingActivities(false));

        // Real usage stats (admin + super_admin)
        if (role === 'admin' || role === 'super_admin') {
          refreshStats();
        } else {
          setLoadingStats(false);
        }
      })
      .catch(() => {
        router.push('/subdomain/login');
        setLoadingActivities(false);
        setLoadingStats(false);
      });
  }, [router, refreshStats]);

  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    purple: 'bg-purple-100 text-purple-600',
    orange: 'bg-orange-100 text-orange-600',
    teal: 'bg-teal-100 text-teal-600',
    rose: 'bg-rose-100 text-rose-600',
    indigo: 'bg-indigo-100 text-indigo-600',
  };

  const volumeCards = [
    {
      label: 'Total Conversations',
      value: loadingStats ? '…' : fmt(stats?.totalConversations),
      delta: stats?.momConversationsDelta,
      sub: 'Each time an employee opened and used the assistant.',
      icon: MessageSquare,
      color: 'blue',
    },
    {
      label: 'Questions Asked',
      value: loadingStats ? '…' : fmt(stats?.totalQuestions),
      delta: stats?.momQuestionsDelta,
      sub: 'Estimated from message counts. Each question is one that didn\'t land in HR\'s inbox.',
      icon: TrendingUp,
      color: 'green',
    },
    {
      label: 'Sessions',
      value: loadingStats ? '…' : fmt(stats?.uniqueUsers),
      delta: stats?.momSessionsDelta,
      sub: 'Each page load = one session. Since everyone shares a password, one person visiting twice counts as two sessions here.',
      icon: Users,
      color: 'purple',
    },
    {
      label: 'Plan Docs Indexed',
      value: loadingStats ? '…' : (stats?.planDocumentsIndexed != null ? String(stats.planDocumentsIndexed) : '11'),
      delta: undefined,
      sub: 'Benefits documents the AI has read and can answer questions from. More docs = more complete answers.',
      icon: FileText,
      color: 'orange',
    },
  ];

  const engagementCards = [
    {
      label: 'Adoption Rate',
      value: loadingStats ? '…' : (stats?.adoptionRate != null ? `${stats.adoptionRate}%` : '—'),
      sub: stats?.adoptionRate != null
        ? 'of registered employees have started at least one conversation.'
        : 'Available once individual employee accounts are enabled.',
      icon: Users,
      color: 'indigo',
    },
    {
      label: 'Avg Session Depth',
      value: loadingStats ? '…' : (stats?.avgMessagesPerConversation ? `${stats.avgMessagesPerConversation}` : '—'),
      sub: 'Messages per conversation. 4–8 is typical. Higher means employees are exploring multiple topics, not just asking one thing and leaving.',
      icon: BarChart3,
      color: 'teal',
    },
    {
      label: 'Est. HR Time Saved',
      value: loadingStats ? '…' : (stats?.estimatedHoursSaved ? `${stats.estimatedHoursSaved} hrs` : '—'),
      sub: (stats?.estimatedDollarsSaved ?? 0) > 0
        ? `≈ $${stats!.estimatedDollarsSaved.toLocaleString()} in staff time (at $85/hr median HR rate). ~8 min saved per question the AI answered instead of HR.`
        : 'Rough estimate: ~8 min saved per question the AI handles instead of HR. Dollar value (at $85/hr median HR rate) will appear here as usage grows.',
      icon: Clock,
      color: 'rose',
    },
    {
      label: 'HR Referral Rate',
      value: loadingStats ? '…' : (stats?.escalationRate != null ? `${stats.escalationRate}%` : '—'),
      sub: stats?.escalatedConversations
        ? `${stats.escalatedConversations} conversation${stats.escalatedConversations !== 1 ? 's' : ''} referred to HR. 10–20% is typical. Higher may mean certain topics need better documentation.`
        : 'How often the assistant recommended speaking with HR directly.',
      icon: PhoneForwarded,
      color: 'orange',
    },
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

  const filteredFAQ = faqFilter === 'all' ? faqData : faqData.filter(f => f.category === faqFilter);
  const isAdmin = userRole === 'admin' || userRole === 'super_admin';

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <AmeriVetLogo alt="AmeriVet" width={40} height={40} className="w-10 h-10 object-contain" />
              <Button variant="outline" size="sm" onClick={() => router.push('/subdomain/dashboard')}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Dashboard
              </Button>
              <h1 className="text-2xl font-bold text-gray-900">
                {isAdmin ? 'Admin Analytics Dashboard' : 'Your Usage Analytics'}
              </h1>
            </div>
            <div className="flex items-center gap-3">
              {isAdmin && fetchedAt && (
                <span className="text-xs text-gray-400 hidden sm:block">Updated {fetchedAt}</span>
              )}
              {isAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={refreshStats}
                  disabled={refreshing}
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                  {refreshing ? 'Refreshing…' : 'Refresh'}
                </Button>
              )}
              {isAdmin && (
                <div className="bg-green-100 px-3 py-1 rounded-full">
                  <span className="text-sm font-medium text-green-800">Admin View</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {isAdmin && (
          <>
            {/* Privacy notice */}
            <div className="flex items-start gap-3 mb-8 p-4 bg-blue-50 border border-blue-100 rounded-lg">
              <ShieldCheck className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
              <p className="text-sm text-blue-800">
                <span className="font-semibold">Privacy protected.</span> All metrics on this page are anonymized and aggregated. Topics with fewer than 3 conversations are excluded. No individual conversations, question text, or user identities are accessible here.
              </p>
            </div>

            {/* Volume metrics */}
            <div className="mb-3">
              <h2 className="text-base font-semibold text-gray-700 uppercase tracking-wide">Usage Volume</h2>
              <p className="text-sm text-gray-500 mt-1">How much the assistant is being used. A growing trend here means employees are finding it on their own — that's a good sign.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              {volumeCards.map((card, i) => {
                const Icon = card.icon;
                return (
                  <Card key={i}>
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-3">
                        <p className="text-sm text-gray-600 font-medium">{card.label}</p>
                        <div className={`p-2.5 rounded-lg shrink-0 ml-2 ${colorClasses[card.color]}`}>
                          <Icon className="w-5 h-5" />
                        </div>
                      </div>
                      <p className="text-3xl font-bold text-gray-900 mb-1">{card.value}</p>
                      {!loadingStats && <div className="mb-2"><DeltaBadge delta={card.delta} /></div>}
                      <p className="text-xs text-gray-400 leading-snug">{card.sub}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Engagement metrics */}
            <div className="mb-3">
              <h2 className="text-base font-semibold text-gray-700 uppercase tracking-wide">Engagement & ROI</h2>
              <p className="text-sm text-gray-500 mt-1">How deeply employees engage, and the time it frees up for your HR team.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              {engagementCards.map((card, i) => {
                const Icon = card.icon;
                return (
                  <Card key={i}>
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-3">
                        <p className="text-sm text-gray-600 font-medium">{card.label}</p>
                        <div className={`p-2.5 rounded-lg shrink-0 ml-2 ${colorClasses[card.color]}`}>
                          <Icon className="w-5 h-5" />
                        </div>
                      </div>
                      <p className="text-3xl font-bold text-gray-900 mb-2">{card.value}</p>
                      <p className="text-xs text-gray-400 leading-snug">{card.sub}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Conversation Quality */}
            {stats && (
              <>
                <div className="mb-3 mt-2">
                  <h2 className="text-base font-semibold text-gray-700 uppercase tracking-wide">Conversation Quality & Timing</h2>
                  <p className="text-sm text-gray-500 mt-1">How substantive the conversations are, and when employees are most likely to reach for the assistant.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                  {/* Completion Rate */}
                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-3">
                        <p className="text-sm text-gray-600 font-medium">Conversation Completion Rate</p>
                        <div className="p-2.5 rounded-lg shrink-0 ml-2 bg-teal-100 text-teal-600">
                          <CheckCircle2 className="w-5 h-5" />
                        </div>
                      </div>
                      {stats.completionRate != null ? (
                        <>
                          <p className="text-3xl font-bold text-gray-900 mb-1">{stats.completionRate}%</p>
                          <p className="text-xs text-gray-400 leading-snug mb-3">
                            of conversations reached 3 or more back-and-forth exchanges ({stats.completedConversations.toLocaleString()} total). A high rate (above 50%) means employees are getting real value, not just asking one thing and leaving. Low rate may signal the answers aren't landing — worth reviewing common questions.
                          </p>
                          <div className="w-full bg-gray-100 rounded-full h-2">
                            <div
                              className="bg-teal-500 h-2 rounded-full transition-all duration-700"
                              style={{ width: `${Math.min(100, stats.completionRate)}%` }}
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-3xl font-bold text-gray-400 mb-1">—</p>
                          <p className="text-xs text-gray-400 leading-snug">
                            Will show the % of conversations with 3+ full exchanges. A high rate (above 50%) means employees are getting real value, not just asking one thing and leaving.
                          </p>
                        </>
                      )}
                    </CardContent>
                  </Card>

                  {/* Peak Usage */}
                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-3">
                        <p className="text-sm text-gray-600 font-medium">Peak Usage</p>
                        <div className="p-2.5 rounded-lg shrink-0 ml-2 bg-indigo-100 text-indigo-600">
                          <CalendarDays className="w-5 h-5" />
                        </div>
                      </div>
                      {stats.peakDay ? (
                        <>
                          <p className="text-3xl font-bold text-gray-900 mb-1">{stats.peakDay}</p>
                          {stats.peakHour && (
                            <p className="text-base font-medium text-indigo-600 mb-2">Peak hour: {stats.peakHour}</p>
                          )}
                          <p className="text-xs text-gray-400 leading-snug">
                            Based on the last 90 days of activity. Schedule benefits communications just before this window to catch employees when they're already thinking about it.
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-3xl font-bold text-gray-400 mb-1">—</p>
                          <p className="text-xs text-gray-400 leading-snug">
                            Will show the busiest day of the week and peak hour once enough conversations have been logged. Use this to time benefits announcements for maximum reach.
                          </p>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </>
            )}

            {/* Engagement Gap */}
            {stats && stats.totalRegisteredUsers > 0 && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle>Employee Engagement</CardTitle>
                  <CardDescription>
                    How many of your registered employees have started a conversation. The employees who haven't yet are your best candidates for a nudge — a short email or Slack message pointing them to the tool during open enrollment can move this number significantly.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 mb-3">
                    <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                      <div
                        className="bg-blue-500 h-3 rounded-full transition-all duration-700"
                        style={{ width: `${Math.min(100, Math.round((stats.uniqueUsers / stats.totalRegisteredUsers) * 100))}%` }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-gray-700 whitespace-nowrap">
                      {stats.uniqueUsers} of {stats.totalRegisteredUsers}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-blue-600 font-medium">{stats.uniqueUsers} have engaged</span>
                    {stats.notYetEngaged > 0 && (
                      <span className="text-amber-600 font-medium">
                        {stats.notYetEngaged} haven't started yet
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Weekly Trend */}
            {stats && stats.weeklyTrend.length > 0 && (
              <Card className="mb-6">
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle>Conversations by Week</CardTitle>
                      <CardDescription className="mt-1">
                        8-week rolling view of conversation volume. Spikes typically signal open enrollment season, a plan change announcement, or a wave of new hires. Use this to time your next benefits communication — if volume drops after a quiet period, a reminder email can re-engage employees before deadlines hit.
                      </CardDescription>
                    </div>
                    {(stats.peakDay || stats.peakHour) && (
                      <div className="shrink-0 text-right text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 min-w-[130px]">
                        <p className="font-semibold text-gray-700 mb-0.5">Most active</p>
                        {stats.peakDay && <p>{stats.peakDay}</p>}
                        {stats.peakHour && <p className="text-indigo-600">{stats.peakHour}</p>}
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {stats.weeklyTrend.every(w => w.count === 0) ? (
                    <p className="text-sm text-gray-500 py-4 text-center">
                      Conversation data will appear here as employees use the assistant.
                    </p>
                  ) : (
                    <div className="flex items-end gap-2 h-36">
                      {(() => {
                        const max = Math.max(...stats.weeklyTrend.map(w => w.count), 1);
                        return stats.weeklyTrend.map(({ week, count }) => (
                          <div key={week} className="flex-1 flex flex-col items-center gap-1">
                            <span className="text-xs text-gray-600 font-medium">{count || ''}</span>
                            <div className="w-full flex items-end" style={{ height: '90px' }}>
                              <div
                                className="w-full bg-blue-400 hover:bg-blue-500 rounded-t transition-all duration-500"
                                style={{ height: `${Math.round((count / max) * 100)}%`, minHeight: count > 0 ? '4px' : '0' }}
                              />
                            </div>
                            <span className="text-xs text-gray-400 text-center leading-tight">{week}</span>
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Top Topics */}
            {stats && stats.topTopics.length > 0 && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle>Topics Discussed Most</CardTitle>
                  <CardDescription>
                    What employees are most curious about right now. If Medical and HSA are dominating, consider featuring those topics in your next benefits email or announcement. Only shown when 3 or more conversations covered a topic — smaller groups are excluded to protect privacy.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {stats.topTopics.map(({ topic, count }) => {
                      const max = stats.topTopics[0].count;
                      const pct = Math.round((count / max) * 100);
                      return (
                        <div key={topic} className="flex items-center gap-4">
                          <span className="w-36 text-sm font-medium text-gray-700 shrink-0">{topic}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                            <div
                              className="bg-blue-500 h-2.5 rounded-full transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-sm text-gray-600 w-24 text-right">
                            {count} conversation{count !== 1 ? 's' : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Escalation Topics */}
            {stats && stats.escalationTopics.length > 0 && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle>Topics Most Often Referred to HR</CardTitle>
                  <CardDescription>
                    These are the topics where the assistant most often said "you should talk to HR directly." Think of this as your to-do list: if COBRA or Leave Policy keeps appearing here, it likely means the AI doesn't have enough information on that topic. Adding a clear FAQ or uploading a policy document for that topic can reduce these referrals over time.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {stats.escalationTopics.map(({ topic, escalations }, i) => {
                      const max = stats.escalationTopics[0].escalations;
                      const pct = Math.round((escalations / max) * 100);
                      return (
                        <div key={topic} className="flex items-center gap-4">
                          <span className="w-6 text-sm text-gray-400 shrink-0">#{i + 1}</span>
                          <span className="w-36 text-sm font-medium text-gray-700 shrink-0">{topic}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                            <div
                              className="bg-orange-400 h-2.5 rounded-full transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-sm text-gray-600 w-28 text-right">
                            {escalations} referral{escalations !== 1 ? 's' : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Benefits Coverage */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Benefits Coverage</CardTitle>
                <CardDescription>Topics the AI assistant is trained to answer. If employees are asking about something not on this list, let us know and we can add it.</CardDescription>
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

            {/* Common Questions */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Common Questions</CardTitle>
                <CardDescription>Topics employees can ask the Benefits AI Assistant — filter by category to see what's covered in each area.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex flex-wrap gap-2">
                  {filterOptions.map(option => (
                    <button
                      key={option.value}
                      onClick={() => setFaqFilter(option.value)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                        faqFilter === option.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {filteredFAQ.map(faq => (
                    <div key={faq.id} className="py-3 border-b hover:bg-gray-50 px-2 rounded transition">
                      <p className="font-medium text-gray-900">{faq.question}</p>
                      <p className="text-sm text-gray-500 mt-1">{faq.desc}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Latest interactions — anonymized. No names, no question text, no individual identifiers.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {loadingActivities ? (
                    <div className="text-center py-6 text-gray-500">Loading activity data…</div>
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
                      <p>No activity recorded yet.</p>
                      <p className="text-sm mt-1">Activities will appear here as employees use the assistant.</p>
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
