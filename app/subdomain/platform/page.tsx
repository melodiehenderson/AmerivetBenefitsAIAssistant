/**
 * Platform Owner Dashboard — super_admin only
 * Cross-tenant view for Melodie and Brandon.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AmeriVetLogo } from '@/components/amerivet-logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  MessageSquare,
  PhoneForwarded,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Users,
} from 'lucide-react';

interface TenantConfig {
  companyId: string;
  displayName: string;
  contractValue: number | null;
  renewalDate: string | null;
  primaryContact: string | null;
  notes: string | null;
}

interface ServiceUptime {
  name: string;
  uptimePct: number | null;
  totalChecks: number;
}

interface TenantStats {
  companyId: string;
  totalConversations: number;
  uniqueUsers: number;
  totalQuestions: number;
  escalatedConversations: number;
  escalationRate: number | null;
  activeUsersThisMonth: number;
  churnRisk: 'healthy' | 'watch' | 'at-risk' | 'no-data';
  config: TenantConfig | null;
}

interface PlatformStats {
  fetchedAt: string;
  totalTenants: number;
  platform: {
    totalConversations: number;
    uniqueUsers: number;
    totalQuestions: number;
    escalatedConversations: number;
  };
  momConversationsDelta: number | null;
  momQuestionsDelta: number | null;
  momSessionsDelta: number | null;
  weeklyTrend: { week: string; count: number }[];
  serviceUptime: ServiceUptime[];
  tenants: TenantStats[];
}

interface ServiceHealth {
  name: string;
  status: 'ok' | 'degraded' | 'down';
  latencyMs: number | null;
  detail?: string;
}

interface HealthReport {
  fetchedAt: string;
  overall: 'ok' | 'degraded' | 'down';
  services: ServiceHealth[];
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

function tenantLabel(companyId: string): string {
  const labels: Record<string, string> = {
    amerivet: 'AmeriVet Partners',
  };
  return labels[companyId] ?? companyId;
}

/** Plain-English latency label with qualitative rating. */
function latencyLabel(ms: number | null): { text: string; quality: 'great' | 'good' | 'slow' | 'down' } {
  if (ms == null) return { text: 'no response', quality: 'down' };
  if (ms < 400)   return { text: `${ms}ms — excellent`, quality: 'great' };
  if (ms < 1500)  return { text: `${ms}ms — good`, quality: 'good' };
  if (ms < 3500)  return { text: `${ms}ms — acceptable`, quality: 'slow' };
  return           { text: `${ms}ms — slow`, quality: 'down' };
}

/** What each backend service does, in plain English. */
const SERVICE_DESCRIPTIONS: Record<string, string> = {
  'Azure OpenAI':  'The AI model that reads employee questions and writes responses. Response time here directly affects how fast employees get answers.',
  'Redis':         'Session memory — keeps track of where each conversation left off between messages. If this goes down, the bot loses conversation context mid-chat.',
  'Azure Search':  'The document index the bot searches before every answer. If this is slow, answers take longer. If it\'s down, the bot can\'t access benefits plan documents.',
};

export default function PlatformPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [healthLoading, setHealthLoading] = useState(true);
  const [statsUpdatedAt, setStatsUpdatedAt] = useState<string | null>(null);
  const [healthUpdatedAt, setHealthUpdatedAt] = useState<string | null>(null);
  const [refreshingStats, setRefreshingStats] = useState(false);
  const [refreshingHealth, setRefreshingHealth] = useState(false);

  const fetchStats = useCallback(() => {
    setRefreshingStats(true);
    fetch('/api/analytics/platform-stats', { credentials: 'include' })
      .then(r => r.json())
      .then((d: PlatformStats) => { setStats(d); setStatsUpdatedAt(new Date().toLocaleTimeString()); })
      .catch(() => setStats(null))
      .finally(() => { setLoading(false); setRefreshingStats(false); });
  }, []);

  const fetchHealth = useCallback(() => {
    setRefreshingHealth(true);
    fetch('/api/analytics/health', { credentials: 'include' })
      .then(r => r.json())
      .then((d: HealthReport) => { setHealth(d); setHealthUpdatedAt(new Date().toLocaleTimeString()); })
      .catch(() => setHealth(null))
      .finally(() => { setHealthLoading(false); setRefreshingHealth(false); });
  }, []);

  useEffect(() => {
    fetch('/api/subdomain/auth/session', { credentials: 'include' })
      .then(async res => {
        if (!res.ok) { router.push('/subdomain/login'); return; }
        const data = await res.json();
        if (data.role !== 'super_admin') { router.push('/subdomain/dashboard'); return; }
        setAuthorized(true);
        fetchStats();
        fetchHealth();
      })
      .catch(() => {
        router.push('/subdomain/login');
        setLoading(false);
        setHealthLoading(false);
      });
  }, [router, fetchStats, fetchHealth]);

  if (!authorized && !loading) return null;

  const platformCards = stats ? [
    { label: 'Active Tenants', value: fmt(stats.totalTenants), delta: undefined, sub: 'Companies on the platform', icon: Building2, color: 'bg-indigo-100 text-indigo-600' },
    { label: 'Total Conversations', value: fmt(stats.platform.totalConversations), delta: stats.momConversationsDelta, sub: 'Across all tenants', icon: MessageSquare, color: 'bg-blue-100 text-blue-600' },
    { label: 'Total Sessions', value: fmt(stats.platform.uniqueUsers), delta: stats.momSessionsDelta, sub: 'Session-based; not deduplicated across page loads', icon: Users, color: 'bg-purple-100 text-purple-600' },
    { label: 'Questions Answered', value: fmt(stats.platform.totalQuestions), delta: stats.momQuestionsDelta, sub: 'Estimated from message counts', icon: TrendingUp, color: 'bg-green-100 text-green-600' },
    { label: 'HR Referrals', value: fmt(stats.platform.escalatedConversations), delta: undefined, sub: 'Times the bot recommended speaking with HR', icon: PhoneForwarded, color: 'bg-orange-100 text-orange-600' },
  ] : [];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <AmeriVetLogo alt="AmeriVet" width={40} height={40} className="w-10 h-10 object-contain" />
              <Button variant="outline" size="sm" onClick={() => router.push('/subdomain/dashboard')}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Dashboard
              </Button>
              <h1 className="text-2xl font-bold text-gray-900">Platform Overview</h1>
            </div>
            <div className="bg-indigo-100 px-3 py-1 rounded-full">
              <span className="text-sm font-medium text-indigo-800">Platform Owner</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="text-center py-20 text-gray-500">Loading platform data…</div>
        ) : (
          <>
            {/* Platform totals */}
            <div className="flex items-end justify-between mb-3">
              <div>
                <h2 className="text-base font-semibold text-gray-700 uppercase tracking-wide">Platform Totals</h2>
                <p className="text-sm text-gray-500 mt-0.5">Aggregated across all tenants. Use this to track overall platform health at a glance.</p>
              </div>
              <div className="flex items-center gap-2">
                {statsUpdatedAt && <span className="text-xs text-gray-400 hidden sm:block">Updated {statsUpdatedAt}</span>}
                <Button variant="outline" size="sm" onClick={fetchStats} disabled={refreshingStats}>
                  <RefreshCw className={`w-4 h-4 mr-2 ${refreshingStats ? 'animate-spin' : ''}`} />
                  {refreshingStats ? 'Refreshing…' : 'Refresh'}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-10">
              {platformCards.map((card, i) => {
                const Icon = card.icon;
                return (
                  <Card key={i}>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between mb-2">
                        <p className="text-xs text-gray-500 font-medium">{card.label}</p>
                        <div className={`p-2 rounded-lg shrink-0 ml-1 ${card.color}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                      </div>
                      <p className="text-2xl font-bold text-gray-900 mb-1">{card.value}</p>
                      {card.delta != null && <div className="mb-1"><DeltaBadge delta={card.delta} /></div>}
                      <p className="text-xs text-gray-400 leading-snug">{card.sub}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Weekly trend — cross-tenant */}
            {stats && (
              <Card className="mb-8">
                <CardHeader>
                  <CardTitle>Platform Conversations by Week</CardTitle>
                  <CardDescription>
                    8-week rolling view across all tenants. Spikes may indicate open enrollment at a specific client — check the tenant cards below to see which company drove the volume.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {(!stats.weeklyTrend || stats.weeklyTrend.every(w => w.count === 0)) ? (
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
                                className="w-full bg-indigo-400 hover:bg-indigo-500 rounded-t transition-all duration-500"
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

            {/* System Health */}
            <div className="flex items-end justify-between mb-3">
              <div>
                <h2 className="text-base font-semibold text-gray-700 uppercase tracking-wide">System Health</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  Live status of the three services that power every employee conversation.
                  This runs a real ping each time — hit Refresh to re-check at any moment.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {healthUpdatedAt && <span className="text-xs text-gray-400 hidden sm:block">Checked {healthUpdatedAt}</span>}
                <Button variant="outline" size="sm" onClick={fetchHealth} disabled={refreshingHealth}>
                  <RefreshCw className={`w-4 h-4 mr-2 ${refreshingHealth ? 'animate-spin' : ''}`} />
                  {refreshingHealth ? 'Checking…' : 'Re-check'}
                </Button>
              </div>
            </div>
            <Card className="mb-10">
              <CardContent className="p-6">
                {healthLoading ? (
                  <p className="text-sm text-gray-500">Pinging services…</p>
                ) : !health ? (
                  <p className="text-sm text-gray-500">Health data unavailable.</p>
                ) : (
                  <>
                    <div className="flex items-center gap-2 mb-4">
                      {health.overall === 'ok'       && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                      {health.overall === 'degraded' && <AlertTriangle className="w-5 h-5 text-amber-500" />}
                      {health.overall === 'down'     && <XCircle className="w-5 h-5 text-red-500" />}
                      <span className={`text-sm font-semibold ${
                        health.overall === 'ok'       ? 'text-green-700' :
                        health.overall === 'degraded' ? 'text-amber-700' : 'text-red-700'
                      }`}>
                        {health.overall === 'ok'       ? 'All systems operational' :
                         health.overall === 'degraded' ? 'Some services degraded' :
                         'Service disruption detected'}
                      </span>
                    </div>

                    <div className="space-y-1">
                      {health.services.map(svc => {
                        const lbl = latencyLabel(svc.latencyMs);
                        const desc = SERVICE_DESCRIPTIONS[svc.name];
                        const latencyColor =
                          lbl.quality === 'great' ? 'bg-green-50 text-green-700' :
                          lbl.quality === 'good'  ? 'bg-green-50 text-green-700' :
                          lbl.quality === 'slow'  ? 'bg-amber-50 text-amber-700' :
                          'bg-red-50 text-red-700';
                        return (
                          <div key={svc.name} className="py-3 border-t first:border-t-0">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex items-start gap-3 min-w-0">
                                <div className="mt-0.5 shrink-0">
                                  {svc.status === 'ok'       && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                                  {svc.status === 'degraded' && <AlertTriangle className="w-4 h-4 text-amber-500" />}
                                  {svc.status === 'down'     && <XCircle className="w-4 h-4 text-red-500" />}
                                </div>
                                <div>
                                  <p className="text-sm font-medium text-gray-900">{svc.name}</p>
                                  {desc && <p className="text-xs text-gray-400 mt-0.5 leading-snug">{desc}</p>}
                                  {svc.detail && svc.status !== 'ok' && (
                                    <p className="text-xs text-red-500 mt-0.5">{svc.detail}</p>
                                  )}
                                </div>
                              </div>
                              <span className={`text-xs font-mono px-2 py-1 rounded-full whitespace-nowrap shrink-0 ${latencyColor}`}>
                                {lbl.text}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* 30-day uptime */}
                    {stats?.serviceUptime && stats.serviceUptime.length > 0 && (
                      <div className="mt-4 pt-3 border-t">
                        <p className="text-xs text-gray-500 font-medium mb-2">30-day uptime (based on manual re-checks)</p>
                        <div className="flex flex-wrap gap-4">
                          {stats.serviceUptime.map(svc => (
                            <div key={svc.name} className="text-xs">
                              <span className="text-gray-600">{svc.name}: </span>
                              <span className={`font-semibold ${
                                svc.uptimePct == null ? 'text-gray-400' :
                                svc.uptimePct >= 99 ? 'text-green-600' :
                                svc.uptimePct >= 95 ? 'text-amber-600' : 'text-red-500'
                              }`}>
                                {svc.uptimePct != null ? `${svc.uptimePct}%` : '—'}
                              </span>
                              <span className="text-gray-400"> ({svc.totalChecks} checks)</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Latency legend */}
                    <div className="mt-4 pt-3 border-t flex flex-wrap gap-x-4 gap-y-1">
                      <p className="text-xs text-gray-400 w-full mb-1 font-medium">Response time guide:</p>
                      <span className="text-xs text-green-600">Under 400ms — excellent (nearly instant)</span>
                      <span className="text-xs text-green-600">400–1,500ms — good (typical cloud speed)</span>
                      <span className="text-xs text-amber-600">1,500–3,500ms — acceptable (noticeable but fine)</span>
                      <span className="text-xs text-red-500">Over 3,500ms — slow (may affect experience)</span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Per-tenant breakdown */}
            <div className="mb-3">
              <h2 className="text-base font-semibold text-gray-700 uppercase tracking-wide">Tenants</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {stats?.totalTenants === 0
                  ? 'No tenant data yet — conversations will appear here once employees start chatting.'
                  : `${stats?.totalTenants} active tenant${stats?.totalTenants !== 1 ? 's' : ''}. Click "Full Analytics" to drill into the HR admin view for any tenant.`}
              </p>
            </div>

            <div className="space-y-4">
              {stats?.tenants.map(tenant => (
                <Card key={tenant.companyId} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <CardTitle className="text-lg">{tenantLabel(tenant.companyId)}</CardTitle>
                          {/* Churn risk badge */}
                          {tenant.churnRisk === 'at-risk' && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">⚠ At Risk</span>
                          )}
                          {tenant.churnRisk === 'watch' && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Watch</span>
                          )}
                          {tenant.churnRisk === 'healthy' && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Healthy</span>
                          )}
                        </div>
                        <CardDescription className="font-mono text-xs">{tenant.companyId}</CardDescription>
                        {/* Contract fields */}
                        {tenant.config && (
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-xs text-gray-500">
                            {tenant.config.contractValue != null && (
                              <span>Contract: <span className="font-medium text-gray-700">${tenant.config.contractValue.toLocaleString()}/yr</span></span>
                            )}
                            {tenant.config.renewalDate && (
                              <span>Renews: <span className="font-medium text-gray-700">{new Date(tenant.config.renewalDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span></span>
                            )}
                            {tenant.config.primaryContact && (
                              <span>Contact: <span className="font-medium text-gray-700">{tenant.config.primaryContact}</span></span>
                            )}
                            {!tenant.config.contractValue && !tenant.config.renewalDate && !tenant.config.primaryContact && (
                              <span className="text-gray-400 italic">Contract details not yet configured</span>
                            )}
                          </div>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push('/subdomain/analytics')}
                        className="shrink-0"
                      >
                        Full Analytics
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                      <div>
                        <p className="text-xs text-gray-400">Conversations</p>
                        <p className="text-xl font-semibold text-gray-900">{fmt(tenant.totalConversations)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">Sessions</p>
                        <p className="text-xl font-semibold text-gray-900">{fmt(tenant.uniqueUsers)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">Active This Month</p>
                        <p className="text-xl font-semibold text-gray-900">{fmt(tenant.activeUsersThisMonth)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">Questions Answered</p>
                        <p className="text-xl font-semibold text-gray-900">{fmt(tenant.totalQuestions)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">HR Referrals</p>
                        <p className="text-xl font-semibold text-gray-900">{fmt(tenant.escalatedConversations)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">Referral Rate</p>
                        <p className="text-xl font-semibold text-gray-900">
                          {tenant.escalationRate != null ? `${tenant.escalationRate}%` : '—'}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {(!stats?.tenants || stats.tenants.length === 0) && (
                <Card>
                  <CardContent className="py-12 text-center text-gray-500">
                    <BarChart3 className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p>No tenant data yet.</p>
                    <p className="text-sm mt-1">Conversations will appear here as employees use the assistant.</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
