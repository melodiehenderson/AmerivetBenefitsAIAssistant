/**
 * Platform Owner Dashboard — super_admin only
 * Cross-tenant view for Melodie and Brandon.
 * Shows platform-wide totals and a card per tenant.
 */

'use client';

import { useState, useEffect } from 'react';
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
  TrendingUp,
  Users,
} from 'lucide-react';

interface TenantStats {
  companyId: string;
  totalConversations: number;
  uniqueUsers: number;
  totalQuestions: number;
  escalatedConversations: number;
  escalationRate: number | null;
  activeUsersThisMonth: number;
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
  weeklyTrend: { week: string; count: number }[];
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

function tenantLabel(companyId: string): string {
  const labels: Record<string, string> = {
    amerivet: 'AmeriVet Partners',
  };
  return labels[companyId] ?? companyId;
}

export default function PlatformPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [healthLoading, setHealthLoading] = useState(true);

  useEffect(() => {
    fetch('/api/subdomain/auth/session', { credentials: 'include' })
      .then(async res => {
        if (!res.ok) { router.push('/subdomain/login'); return; }
        const data = await res.json();
        if (data.role !== 'super_admin') {
          router.push('/subdomain/dashboard');
          return;
        }
        setAuthorized(true);

        // Fetch platform stats and health in parallel
        fetch('/api/analytics/platform-stats', { credentials: 'include' })
          .then(r => r.json())
          .then((d: PlatformStats) => setStats(d))
          .catch(() => setStats(null))
          .finally(() => setLoading(false));

        fetch('/api/analytics/health', { credentials: 'include' })
          .then(r => r.json())
          .then((d: HealthReport) => setHealth(d))
          .catch(() => setHealth(null))
          .finally(() => setHealthLoading(false));
      })
      .catch(() => {
        router.push('/subdomain/login');
        setLoading(false);
        setHealthLoading(false);
      });
  }, [router]);

  if (!authorized && !loading) return null;

  const platformCards = stats ? [
    { label: 'Total Tenants', value: fmt(stats.totalTenants), icon: Building2, color: 'bg-indigo-100 text-indigo-600' },
    { label: 'Platform Conversations', value: fmt(stats.platform.totalConversations), icon: MessageSquare, color: 'bg-blue-100 text-blue-600' },
    { label: 'Platform Users', value: fmt(stats.platform.uniqueUsers), icon: Users, color: 'bg-purple-100 text-purple-600' },
    { label: 'Questions Answered', value: fmt(stats.platform.totalQuestions), icon: TrendingUp, color: 'bg-green-100 text-green-600' },
    { label: 'HR Referrals (all tenants)', value: fmt(stats.platform.escalatedConversations), icon: PhoneForwarded, color: 'bg-orange-100 text-orange-600' },
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
            <div className="mb-3">
              <h2 className="text-base font-semibold text-gray-700 uppercase tracking-wide">Platform Totals</h2>
              <p className="text-sm text-gray-500 mt-0.5">Aggregated across all tenants</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-10">
              {platformCards.map((card, i) => {
                const Icon = card.icon;
                return (
                  <Card key={i}>
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs text-gray-500 mb-1">{card.label}</p>
                          <p className="text-2xl font-bold text-gray-900">{card.value}</p>
                        </div>
                        <div className={`p-2.5 rounded-lg ${card.color}`}>
                          <Icon className="w-5 h-5" />
                        </div>
                      </div>
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
                  <CardDescription>Rolling 8-week volume across all tenants</CardDescription>
                </CardHeader>
                <CardContent>
                  {(!stats.weeklyTrend || stats.weeklyTrend.every(w => w.count === 0)) ? (
                    <p className="text-sm text-gray-500 py-4 text-center">
                      Conversation data will appear here as employees use the assistant.
                    </p>
                  ) : (
                    <div className="flex items-end gap-2 h-32">
                      {(() => {
                        const max = Math.max(...stats.weeklyTrend.map(w => w.count), 1);
                        return stats.weeklyTrend.map(({ week, count }) => (
                          <div key={week} className="flex-1 flex flex-col items-center gap-1">
                            <span className="text-xs text-gray-600 font-medium">{count || ''}</span>
                            <div className="w-full flex items-end" style={{ height: '80px' }}>
                              <div
                                className="w-full bg-indigo-400 rounded-t transition-all duration-500"
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
            <div className="mb-3">
              <h2 className="text-base font-semibold text-gray-700 uppercase tracking-wide">System Health</h2>
              <p className="text-sm text-gray-500 mt-0.5">Live status of platform services</p>
            </div>
            <Card className="mb-10">
              <CardContent className="p-6">
                {healthLoading ? (
                  <p className="text-sm text-gray-500">Pinging services…</p>
                ) : !health ? (
                  <p className="text-sm text-gray-500">Health data unavailable.</p>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      {health.overall === 'ok' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                      {health.overall === 'degraded' && <AlertTriangle className="w-5 h-5 text-amber-500" />}
                      {health.overall === 'down' && <XCircle className="w-5 h-5 text-red-500" />}
                      <span className={`text-sm font-semibold ${
                        health.overall === 'ok' ? 'text-green-700' :
                        health.overall === 'degraded' ? 'text-amber-700' : 'text-red-700'
                      }`}>
                        {health.overall === 'ok' ? 'All systems operational' :
                         health.overall === 'degraded' ? 'Some services degraded' :
                         'Service disruption detected'}
                      </span>
                    </div>
                    {health.services.map(svc => (
                      <div key={svc.name} className="flex items-center justify-between py-2 border-t">
                        <div className="flex items-center gap-3">
                          {svc.status === 'ok'       && <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />}
                          {svc.status === 'degraded' && <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />}
                          {svc.status === 'down'     && <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
                          <span className="text-sm font-medium text-gray-900">{svc.name}</span>
                          {svc.detail && (
                            <span className="text-xs text-gray-400">{svc.detail}</span>
                          )}
                        </div>
                        <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                          svc.status === 'ok'       ? 'bg-green-50 text-green-700' :
                          svc.status === 'degraded' ? 'bg-amber-50 text-amber-700' :
                          'bg-red-50 text-red-700'
                        }`}>
                          {svc.latencyMs != null ? `${svc.latencyMs}ms` : svc.status}
                        </span>
                      </div>
                    ))}
                    <p className="text-xs text-gray-400 pt-1">
                      Checked at {new Date(health.fetchedAt).toLocaleTimeString()}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Per-tenant breakdown */}
            <div className="mb-3">
              <h2 className="text-base font-semibold text-gray-700 uppercase tracking-wide">Tenants</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {stats?.totalTenants === 0
                  ? 'No tenant data yet — conversations will appear here once employees start chatting.'
                  : `${stats?.totalTenants} active tenant${stats?.totalTenants !== 1 ? 's' : ''}`}
              </p>
            </div>

            <div className="space-y-4">
              {stats?.tenants.map(tenant => (
                <Card key={tenant.companyId} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg">{tenantLabel(tenant.companyId)}</CardTitle>
                        <CardDescription className="font-mono text-xs">{tenant.companyId}</CardDescription>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push('/subdomain/analytics')}
                      >
                        Full Analytics
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                      <div>
                        <p className="text-xs text-gray-500">Conversations</p>
                        <p className="text-xl font-semibold text-gray-900">{fmt(tenant.totalConversations)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Unique Users</p>
                        <p className="text-xl font-semibold text-gray-900">{fmt(tenant.uniqueUsers)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Active This Month</p>
                        <p className="text-xl font-semibold text-gray-900">{fmt(tenant.activeUsersThisMonth)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Questions Answered</p>
                        <p className="text-xl font-semibold text-gray-900">{fmt(tenant.totalQuestions)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">HR Referrals</p>
                        <p className="text-xl font-semibold text-gray-900">{fmt(tenant.escalatedConversations)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Referral Rate</p>
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

            {stats?.fetchedAt && (
              <p className="text-xs text-gray-400 mt-6 text-right">
                Data as of {new Date(stats.fetchedAt).toLocaleString()}
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
