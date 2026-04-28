/**
 * Analytics Stats API
 * Returns real, privacy-safe usage metrics for the tenant admin dashboard.
 * - Topic data filtered to minimum group size of 3 (HIPAA-safe threshold)
 * - No individual user identifiers returned
 * - Queries Cosmos DB (conversations + users) and Azure Search (document count)
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/azure/cosmos-db';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';
import { logger } from '@/lib/logger';

const MIN_GROUP_THRESHOLD = 3; // Never surface topics discussed by fewer than this many conversations

export interface AnalyticsStats {
  // Volume
  totalConversations: number;
  uniqueUsers: number;
  totalQuestions: number;
  activeUsersThisMonth: number;
  // Engagement
  avgMessagesPerConversation: number;
  adoptionRate: number | null;         // 0–100 percent; null if user count unavailable
  estimatedHoursSaved: number;         // totalQuestions × 8 min ÷ 60
  // Escalation
  escalatedConversations: number;      // conversations where escalationCount > 0
  escalationRate: number | null;       // escalatedConversations / totalConversations × 100
  // Content
  planDocumentsIndexed: number | null;
  // Privacy-safe topic distribution (count >= MIN_GROUP_THRESHOLD only)
  topTopics: { topic: string; count: number }[];
  fetchedAt: string;
}

export async function GET(_request: NextRequest) {
  const stats: AnalyticsStats = {
    totalConversations: 0,
    uniqueUsers: 0,
    totalQuestions: 0,
    activeUsersThisMonth: 0,
    avgMessagesPerConversation: 0,
    adoptionRate: null,
    estimatedHoursSaved: 0,
    escalatedConversations: 0,
    escalationRate: null,
    planDocumentsIndexed: null,
    topTopics: [],
    fetchedAt: new Date().toISOString(),
  };

  // ── 1. Cosmos DB: conversation metrics ──────────────────────────────────
  try {
    const container = await getContainer('Conversations');

    // Total conversations
    const { resources: countRes } = await container.items
      .query('SELECT VALUE COUNT(1) FROM c')
      .fetchAll();
    stats.totalConversations = countRes[0] ?? 0;

    // Unique users
    const { resources: userIds } = await container.items
      .query('SELECT DISTINCT VALUE c.userId FROM c WHERE IS_DEFINED(c.userId) AND c.userId != null')
      .fetchAll();
    stats.uniqueUsers = userIds.filter(Boolean).length;

    // Total questions (each conversation messageCount ÷ 2 ≈ user turns)
    const { resources: msgRes } = await container.items
      .query('SELECT VALUE SUM(c.messageCount) FROM c WHERE IS_DEFINED(c.messageCount)')
      .fetchAll();
    const rawMsgTotal = msgRes[0] ?? 0;
    stats.totalQuestions = Math.round((rawMsgTotal || 0) / 2);

    // Avg messages per conversation (engagement depth)
    const { resources: avgRes } = await container.items
      .query('SELECT VALUE AVG(c.messageCount) FROM c WHERE IS_DEFINED(c.messageCount)')
      .fetchAll();
    stats.avgMessagesPerConversation = Math.round((avgRes[0] ?? 0) * 10) / 10;

    // Active users this calendar month
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const { resources: activeIds } = await container.items
      .query({
        query: `SELECT DISTINCT VALUE c.userId FROM c
                WHERE c.timestamp > @monthStart
                AND IS_DEFINED(c.userId) AND c.userId != null`,
        parameters: [{ name: '@monthStart', value: monthStart.getTime() }],
      })
      .fetchAll();
    stats.activeUsersThisMonth = activeIds.filter(Boolean).length;

    // Privacy-safe topic distribution
    // Only include topics with count >= MIN_GROUP_THRESHOLD
    const { resources: topicRows } = await container.items
      .query(`SELECT c.metadata.currentTopic AS topic, COUNT(1) AS count
              FROM c
              WHERE IS_DEFINED(c.metadata.currentTopic)
              AND c.metadata.currentTopic != null
              GROUP BY c.metadata.currentTopic`)
      .fetchAll();
    stats.topTopics = (topicRows as { topic: string; count: number }[])
      .filter(r => r.topic && r.count >= MIN_GROUP_THRESHOLD)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Escalation metrics
    const { resources: escalatedRes } = await container.items
      .query('SELECT VALUE COUNT(1) FROM c WHERE IS_DEFINED(c.escalationCount) AND c.escalationCount > 0')
      .fetchAll();
    stats.escalatedConversations = escalatedRes[0] ?? 0;
    if (stats.totalConversations > 0) {
      stats.escalationRate = Math.round((stats.escalatedConversations / stats.totalConversations) * 100);
    }
  } catch (err) {
    logger.error('[AnalyticsStats] Cosmos conversation query failed:', err);
  }

  // ── 2. Cosmos DB: total registered users (for adoption rate) ────────────
  try {
    const usersContainer = await getContainer('Users');
    const { resources: userCountRes } = await usersContainer.items
      .query('SELECT VALUE COUNT(1) FROM c')
      .fetchAll();
    const totalRegistered = userCountRes[0] ?? 0;
    if (totalRegistered > 0 && stats.uniqueUsers > 0) {
      stats.adoptionRate = Math.round((stats.uniqueUsers / totalRegistered) * 100);
    }
  } catch (err) {
    logger.error('[AnalyticsStats] Cosmos users query failed:', err);
    // adoptionRate stays null — UI shows "—"
  }

  // ── 3. Derived metrics ───────────────────────────────────────────────────
  // Estimated time saved: assume avg 8 min per question deflected from HR
  stats.estimatedHoursSaved = Math.round((stats.totalQuestions * 8) / 60 * 10) / 10;

  // ── 4. Azure Search: distinct source document count ─────────────────────
  try {
    const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
    const apiKey = process.env.AZURE_SEARCH_API_KEY || process.env.AZURE_SEARCH_ADMIN_KEY;
    const indexName =
      process.env.AZURE_SEARCH_INDEX || process.env.AZURE_SEARCH_INDEX_NAME || 'chunks_prod_v1';

    if (endpoint && apiKey) {
      const client = new SearchClient(endpoint, indexName, new AzureKeyCredential(apiKey));
      const result = await client.search('*', {
        top: 1000,
        select: ['doc_id'] as any,
        filter: "company_id eq 'amerivet'",
        queryType: 'simple',
      });
      const docIds = new Set<string>();
      for await (const r of result.results) {
        const docId = (r.document as any).doc_id;
        if (docId) docIds.add(docId);
      }
      stats.planDocumentsIndexed = docIds.size > 0 ? docIds.size : null;
    }
  } catch (err) {
    logger.error('[AnalyticsStats] Azure Search doc count failed:', err);
  }

  return NextResponse.json(stats);
}
