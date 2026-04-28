/**
 * Platform Stats API — Super Admin Only
 * Returns cross-tenant usage metrics for platform owners (Melodie, Brandon).
 * Aggregates conversation data across all tenants (companyIds) in BenefitsChat.Conversations.
 * - No individual user identifiers returned
 * - Queries Cosmos DB only (no per-tenant Azure Search calls at this level)
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getContainer, CONVERSATIONS_CONTAINER } from '@/lib/azure/cosmos-db';
// HealthLogs and TenantConfigs containers are auto-created by getContainer()
import { logger } from '@/lib/logger';

function buildWeeklyTrend(timestamps: number[]): { week: string; count: number }[] {
  const now = Date.now();
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const start = now - (7 - i) * MS_PER_WEEK;
    const end   = start + MS_PER_WEEK - 1;
    const label = new Date(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { label, start, end, count: 0 };
  });
  for (const ts of timestamps) {
    const bucket = weeks.find(w => ts >= w.start && ts <= w.end);
    if (bucket) bucket.count++;
  }
  return weeks.map(({ label, count }) => ({ week: label, count }));
}

export interface TenantConfig {
  companyId: string;
  displayName: string;
  contractValue: number | null;    // USD annual
  renewalDate: string | null;      // ISO date string e.g. "2026-12-01"
  primaryContact: string | null;   // name or email
  notes: string | null;
}

export interface ServiceUptime {
  name: string;
  uptimePct: number | null;        // % checks with status 'ok' in last 30 days
  totalChecks: number;
}

export interface TenantStats {
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

/** % change from previous to current. Returns null if previous was 0. */
function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export interface PlatformStats {
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
  weeklyTrend: { week: string; count: number }[];   // cross-tenant
  serviceUptime: ServiceUptime[];                   // 30-day uptime per service
  tenants: TenantStats[];
}

export async function GET(_request: NextRequest) {
  // Super admin only — guard at the API level in addition to UI
  const cookieStore = await cookies();
  const session = cookieStore.get('amerivet_session')?.value;
  if (session !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const platform: PlatformStats = {
    fetchedAt: new Date().toISOString(),
    totalTenants: 0,
    platform: {
      totalConversations: 0,
      uniqueUsers: 0,
      totalQuestions: 0,
      escalatedConversations: 0,
    },
    momConversationsDelta: null,
    momQuestionsDelta: null,
    momSessionsDelta: null,
    weeklyTrend: [],
    serviceUptime: [],
    tenants: [],
  };

  try {
    const container = await getContainer(CONVERSATIONS_CONTAINER);

    // ── Per-tenant conversation counts ───────────────────────────────────────
    const { resources: tenantCounts } = await container.items
      .query(`SELECT c.companyId, COUNT(1) AS totalConversations
              FROM c
              WHERE IS_DEFINED(c.companyId)
              GROUP BY c.companyId`)
      .fetchAll();

    // ── Per-tenant message totals ────────────────────────────────────────────
    const { resources: tenantMessages } = await container.items
      .query(`SELECT c.companyId, SUM(c.messageCount) AS totalMessages
              FROM c
              WHERE IS_DEFINED(c.companyId) AND IS_DEFINED(c.messageCount)
              GROUP BY c.companyId`)
      .fetchAll();

    // ── Per-tenant escalation counts ─────────────────────────────────────────
    const { resources: tenantEscalations } = await container.items
      .query(`SELECT c.companyId, COUNT(1) AS escalatedConversations
              FROM c
              WHERE IS_DEFINED(c.companyId)
              AND IS_DEFINED(c.escalationCount) AND c.escalationCount > 0
              GROUP BY c.companyId`)
      .fetchAll();

    // ── Per-tenant unique users (requires client-side aggregation) ────────────
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const { resources: allUserRows } = await container.items
      .query(`SELECT c.companyId, c.userId
              FROM c
              WHERE IS_DEFINED(c.companyId) AND IS_DEFINED(c.userId) AND c.userId != null`)
      .fetchAll();

    const { resources: activeUserRows } = await container.items
      .query({
        query: `SELECT c.companyId, c.userId
                FROM c
                WHERE IS_DEFINED(c.companyId) AND IS_DEFINED(c.userId) AND c.userId != null
                AND c.timestamp > @monthStart`,
        parameters: [{ name: '@monthStart', value: monthStart.getTime() }],
      })
      .fetchAll();

    // ── Aggregate into per-tenant maps ────────────────────────────────────────
    const countMap = new Map<string, number>();
    for (const r of tenantCounts) {
      if (r.companyId) countMap.set(r.companyId, r.totalConversations ?? 0);
    }

    const messagesMap = new Map<string, number>();
    for (const r of tenantMessages) {
      if (r.companyId) messagesMap.set(r.companyId, r.totalMessages ?? 0);
    }

    const escalationMap = new Map<string, number>();
    for (const r of tenantEscalations) {
      if (r.companyId) escalationMap.set(r.companyId, r.escalatedConversations ?? 0);
    }

    // Unique users per tenant
    const usersByTenant = new Map<string, Set<string>>();
    for (const r of allUserRows) {
      if (!r.companyId || !r.userId) continue;
      if (!usersByTenant.has(r.companyId)) usersByTenant.set(r.companyId, new Set());
      usersByTenant.get(r.companyId)!.add(r.userId);
    }

    // Active users this month per tenant
    const activeByTenant = new Map<string, Set<string>>();
    for (const r of activeUserRows) {
      if (!r.companyId || !r.userId) continue;
      if (!activeByTenant.has(r.companyId)) activeByTenant.set(r.companyId, new Set());
      activeByTenant.get(r.companyId)!.add(r.userId);
    }

    // ── Build tenant list ─────────────────────────────────────────────────────
    const allCompanyIds = new Set([
      ...countMap.keys(),
      ...messagesMap.keys(),
    ]);

    for (const companyId of allCompanyIds) {
      const totalConversations = countMap.get(companyId) ?? 0;
      const totalMessages = messagesMap.get(companyId) ?? 0;
      const escalatedConversations = escalationMap.get(companyId) ?? 0;
      const uniqueUsers = usersByTenant.get(companyId)?.size ?? 0;
      const activeUsersThisMonth = activeByTenant.get(companyId)?.size ?? 0;
      const escalationRate = totalConversations > 0
        ? Math.round((escalatedConversations / totalConversations) * 100)
        : null;

      // Churn risk heuristic
      let churnRisk: TenantStats['churnRisk'] = 'no-data';
      if (totalConversations > 0) {
        if ((escalationRate ?? 0) > 30 && activeUsersThisMonth < 3) {
          churnRisk = 'at-risk';
        } else if ((escalationRate ?? 0) > 20 || activeUsersThisMonth === 0) {
          churnRisk = 'watch';
        } else {
          churnRisk = 'healthy';
        }
      }

      platform.tenants.push({
        companyId,
        totalConversations,
        uniqueUsers,
        totalQuestions: Math.round(totalMessages / 2),
        escalatedConversations,
        escalationRate,
        activeUsersThisMonth,
        churnRisk,
        config: null,   // filled in below
      });

      // Platform totals
      platform.platform.totalConversations += totalConversations;
      platform.platform.uniqueUsers += uniqueUsers;
      platform.platform.totalQuestions += Math.round(totalMessages / 2);
      platform.platform.escalatedConversations += escalatedConversations;
    }

    // ── Month-over-month: last 2 months of conversations (platform-wide) ──────
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0).getTime();

    const { resources: recentConvos } = await container.items
      .query({
        query: `SELECT c.timestamp, c.messageCount, c.userId FROM c
                WHERE IS_DEFINED(c.timestamp) AND c.timestamp >= @since`,
        parameters: [{ name: '@since', value: lastMonthStart }],
      })
      .fetchAll();

    const thisMonth = recentConvos.filter((c: any) => c.timestamp >= thisMonthStart);
    const lastMonth = recentConvos.filter((c: any) => c.timestamp >= lastMonthStart && c.timestamp < thisMonthStart);

    platform.momConversationsDelta = pctDelta(thisMonth.length, lastMonth.length);
    platform.momQuestionsDelta = pctDelta(
      Math.round(thisMonth.reduce((s: number, c: any) => s + (c.messageCount || 0), 0) / 2),
      Math.round(lastMonth.reduce((s: number, c: any) => s + (c.messageCount || 0), 0) / 2),
    );
    platform.momSessionsDelta = pctDelta(
      new Set(thisMonth.map((c: any) => c.userId).filter(Boolean)).size,
      new Set(lastMonth.map((c: any) => c.userId).filter(Boolean)).size,
    );

    // Cross-tenant weekly trend
    const eightWeeksAgo = Date.now() - 8 * 7 * 24 * 60 * 60 * 1000;
    const { resources: tsRows } = await container.items
      .query({
        query: 'SELECT VALUE c.timestamp FROM c WHERE IS_DEFINED(c.timestamp) AND c.timestamp > @since',
        parameters: [{ name: '@since', value: eightWeeksAgo }],
      })
      .fetchAll();
    platform.weeklyTrend = buildWeeklyTrend((tsRows as number[]).filter(Boolean));

    // Sort tenants by conversation volume desc
    platform.tenants.sort((a, b) => b.totalConversations - a.totalConversations);
    platform.totalTenants = platform.tenants.length;

  } catch (err) {
    logger.error('[PlatformStats] Cosmos query failed:', err);
  }

  // ── 30-day uptime from HealthLogs ──────────────────────────────────────
  try {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const healthContainer = await getContainer('HealthLogs');
    const { resources: healthLogs } = await healthContainer.items
      .query({
        query: 'SELECT c.services FROM c WHERE c.timestamp > @since',
        parameters: [{ name: '@since', value: thirtyDaysAgo }],
      })
      .fetchAll();

    if (healthLogs.length > 0) {
      // Build per-service totals
      const totals = new Map<string, { ok: number; total: number }>();
      for (const log of healthLogs as { services: { name: string; status: string }[] }[]) {
        for (const svc of log.services ?? []) {
          if (!totals.has(svc.name)) totals.set(svc.name, { ok: 0, total: 0 });
          const t = totals.get(svc.name)!;
          t.total++;
          if (svc.status === 'ok') t.ok++;
        }
      }
      platform.serviceUptime = Array.from(totals.entries()).map(([name, { ok, total }]) => ({
        name,
        uptimePct: total > 0 ? Math.round((ok / total) * 100) : null,
        totalChecks: total,
      }));
    }
  } catch (err) {
    logger.error('[PlatformStats] HealthLogs uptime query failed:', err);
  }

  // ── Tenant configs ─────────────────────────────────────────────────────
  try {
    const configContainer = await getContainer('TenantConfigs');
    const { resources: configs } = await configContainer.items
      .query('SELECT * FROM c')
      .fetchAll();

    const configMap = new Map<string, TenantConfig>();
    for (const c of configs as TenantConfig[]) {
      if (c.companyId) configMap.set(c.companyId, c);
    }

    // Seed default amerivet config if not yet in Cosmos
    if (!configMap.has('amerivet')) {
      const defaultConfig: TenantConfig = {
        companyId: 'amerivet',
        displayName: 'AmeriVet Partners',
        contractValue: null,
        renewalDate: null,
        primaryContact: null,
        notes: null,
      };
      configMap.set('amerivet', defaultConfig);
      // Upsert so it exists for next time
      configContainer.items.upsert({ id: 'amerivet', ...defaultConfig }).catch(() => {});
    }

    // Attach config to each tenant
    for (const tenant of platform.tenants) {
      tenant.config = configMap.get(tenant.companyId) ?? null;
    }
  } catch (err) {
    logger.error('[PlatformStats] TenantConfig query failed:', err);
  }

  return NextResponse.json(platform);
}
