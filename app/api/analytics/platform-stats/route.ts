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
import { logger } from '@/lib/logger';

export interface TenantStats {
  companyId: string;
  totalConversations: number;
  uniqueUsers: number;
  totalQuestions: number;
  escalatedConversations: number;
  escalationRate: number | null;
  activeUsersThisMonth: number;
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

      platform.tenants.push({
        companyId,
        totalConversations,
        uniqueUsers,
        totalQuestions: Math.round(totalMessages / 2),
        escalatedConversations,
        escalationRate,
        activeUsersThisMonth,
      });

      // Platform totals
      platform.platform.totalConversations += totalConversations;
      platform.platform.uniqueUsers += uniqueUsers;
      platform.platform.totalQuestions += Math.round(totalMessages / 2);
      platform.platform.escalatedConversations += escalatedConversations;
    }

    // Sort tenants by conversation volume desc
    platform.tenants.sort((a, b) => b.totalConversations - a.totalConversations);
    platform.totalTenants = platform.tenants.length;

  } catch (err) {
    logger.error('[PlatformStats] Cosmos query failed:', err);
  }

  return NextResponse.json(platform);
}
