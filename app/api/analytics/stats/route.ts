/**
 * Analytics Stats API
 * Returns real usage metrics for the tenant admin dashboard.
 * Queries Cosmos DB (conversations) and Azure Search (document count).
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/azure/cosmos-db';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';
import { logger } from '@/lib/logger';

export interface AnalyticsStats {
  totalConversations: number;
  uniqueUsers: number;
  totalQuestions: number;
  activeUsersThisMonth: number;
  planDocumentsIndexed: number | null; // null = couldn't fetch
  topTopics: { topic: string; count: number }[];
  fetchedAt: string;
}

export async function GET(_request: NextRequest) {
  const stats: AnalyticsStats = {
    totalConversations: 0,
    uniqueUsers: 0,
    totalQuestions: 0,
    activeUsersThisMonth: 0,
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

    // Unique users (DISTINCT VALUE supported in Cosmos SQL)
    const { resources: userIds } = await container.items
      .query('SELECT DISTINCT VALUE c.userId FROM c WHERE IS_DEFINED(c.userId) AND c.userId != null')
      .fetchAll();
    stats.uniqueUsers = userIds.filter(Boolean).length;

    // Total questions: sum of per-conversation message counts
    // messageCount field = number of messages; ~half are user turns
    const { resources: msgRes } = await container.items
      .query('SELECT VALUE SUM(c.messageCount) FROM c WHERE IS_DEFINED(c.messageCount)')
      .fetchAll();
    const rawTotal = msgRes[0] ?? 0;
    // Divide by 2 to approximate user questions (each exchange = 1 user + 1 bot)
    stats.totalQuestions = Math.round((rawTotal || 0) / 2);

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

    // Topic distribution (requires metadata.currentTopic to be set)
    const { resources: topicRows } = await container.items
      .query(`SELECT c.metadata.currentTopic AS topic, COUNT(1) AS count
              FROM c
              WHERE IS_DEFINED(c.metadata.currentTopic)
              AND c.metadata.currentTopic != null
              GROUP BY c.metadata.currentTopic`)
      .fetchAll();
    stats.topTopics = (topicRows as { topic: string; count: number }[])
      .filter(r => r.topic)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  } catch (err) {
    logger.error('[AnalyticsStats] Cosmos query failed:', err);
    // Leave counts at 0 — UI shows "—" for nullish values
  }

  // ── 2. Azure Search: distinct source document count ─────────────────────
  try {
    const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
    const apiKey = process.env.AZURE_SEARCH_API_KEY || process.env.AZURE_SEARCH_ADMIN_KEY;
    const indexName =
      process.env.AZURE_SEARCH_INDEX || process.env.AZURE_SEARCH_INDEX_NAME || 'chunks_prod_v1';

    if (endpoint && apiKey) {
      const client = new SearchClient(endpoint, indexName, new AzureKeyCredential(apiKey));

      // Fetch doc_id values (up to 1000 chunks) and count distinct source docs
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
    // null signals to the UI to fall back to known value
  }

  return NextResponse.json(stats);
}
