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

const MIN_GROUP_THRESHOLD = 3;
const HR_HOURLY_RATE = 26; // USD — median benefits counselor rate at an insurance call center; configurable per tenant later

/** % change from previous to current. Returns null if previous was 0 (no baseline). */
function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Format a 0-23 hour index as a human-readable range: "12 PM–1 PM" */
function formatHourRange(h: number): string {
  const fmt = (hour: number) => {
    if (hour === 0)  return '12 AM';
    if (hour === 12) return '12 PM';
    return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
  };
  return `${fmt(h)}–${fmt((h + 1) % 24)}`;
}

/** Bucket epoch-ms timestamps into rolling 8-week windows, oldest first. */
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

export interface AnalyticsStats {
  // Volume
  totalConversations: number;
  uniqueUsers: number;
  totalQuestions: number;
  activeUsersThisMonth: number;
  // Month-over-month deltas (null = no prior-month baseline yet)
  momConversationsDelta: number | null;
  momQuestionsDelta: number | null;
  momSessionsDelta: number | null;
  // Engagement
  avgMessagesPerConversation: number;
  adoptionRate: number | null;
  estimatedHoursSaved: number;
  estimatedDollarsSaved: number;       // estimatedHoursSaved × HR_HOURLY_RATE
  totalRegisteredUsers: number;
  notYetEngaged: number;
  // Quality
  completionRate: number | null;       // % conversations with messageCount >= 6
  completedConversations: number;
  // Satisfaction
  satisfactionRate: number | null;     // % thumbs-up out of all rated responses
  positiveFeedback: number;            // raw thumbs-up count
  totalFeedback: number;               // total ratings submitted
  // Timing
  peakDay: string | null;              // e.g. "Tuesday"
  peakHour: string | null;             // e.g. "12 PM–1 PM"
  // Escalation
  escalatedConversations: number;
  escalationRate: number | null;
  escalationTopics: { topic: string; escalations: number }[];
  // Trends
  weeklyTrend: { week: string; count: number }[];
  // Content
  planDocumentsIndexed: number | null;
  topTopics: { topic: string; count: number }[];
  fetchedAt: string;
}

export async function GET(_request: NextRequest) {
  const stats: AnalyticsStats = {
    totalConversations: 0,
    uniqueUsers: 0,
    totalQuestions: 0,
    activeUsersThisMonth: 0,
    momConversationsDelta: null,
    momQuestionsDelta: null,
    momSessionsDelta: null,
    avgMessagesPerConversation: 0,
    adoptionRate: null,
    estimatedHoursSaved: 0,
    estimatedDollarsSaved: 0,
    totalRegisteredUsers: 0,
    notYetEngaged: 0,
    completionRate: null,
    completedConversations: 0,
    satisfactionRate: null,
    positiveFeedback: 0,
    totalFeedback: 0,
    peakDay: null,
    peakHour: null,
    escalatedConversations: 0,
    escalationRate: null,
    escalationTopics: [],
    weeklyTrend: [],
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

    // Unique users (sessions)
    const { resources: userIds } = await container.items
      .query('SELECT DISTINCT VALUE c.userId FROM c WHERE IS_DEFINED(c.userId) AND c.userId != null')
      .fetchAll();
    stats.uniqueUsers = userIds.filter(Boolean).length;

    // Total questions
    const { resources: msgRes } = await container.items
      .query('SELECT VALUE SUM(c.messageCount) FROM c WHERE IS_DEFINED(c.messageCount)')
      .fetchAll();
    stats.totalQuestions = Math.round(((msgRes[0] ?? 0) || 0) / 2);

    // Avg messages per conversation
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

    // Topic distribution (privacy-safe, min threshold)
    const { resources: topicRows } = await container.items
      .query(`SELECT c.metadata.currentTopic AS topic, COUNT(1) AS count
              FROM c
              WHERE IS_DEFINED(c.metadata.currentTopic) AND c.metadata.currentTopic != null
              GROUP BY c.metadata.currentTopic`)
      .fetchAll();
    stats.topTopics = (topicRows as { topic: string; count: number }[])
      .filter(r => r.topic && r.count >= MIN_GROUP_THRESHOLD)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Escalation count + rate
    const { resources: escalatedRes } = await container.items
      .query('SELECT VALUE COUNT(1) FROM c WHERE IS_DEFINED(c.escalationCount) AND c.escalationCount > 0')
      .fetchAll();
    stats.escalatedConversations = escalatedRes[0] ?? 0;
    if (stats.totalConversations > 0) {
      stats.escalationRate = Math.round((stats.escalatedConversations / stats.totalConversations) * 100);
    }

    // Escalation topic breakdown
    const { resources: escalTopicRows } = await container.items
      .query(`SELECT c.metadata.currentTopic AS topic, SUM(c.escalationCount) AS escalations
              FROM c
              WHERE IS_DEFINED(c.escalationCount) AND c.escalationCount > 0
              AND IS_DEFINED(c.metadata.currentTopic) AND c.metadata.currentTopic != null
              GROUP BY c.metadata.currentTopic`)
      .fetchAll();
    stats.escalationTopics = (escalTopicRows as { topic: string; escalations: number }[])
      .filter(r => r.topic && r.escalations > 0)
      .sort((a, b) => b.escalations - a.escalations)
      .slice(0, 8);

    // ── Completion rate: conversations with 6+ messages (3+ full exchanges) ──
    const { resources: completedRes } = await container.items
      .query('SELECT VALUE COUNT(1) FROM c WHERE IS_DEFINED(c.messageCount) AND c.messageCount >= 6')
      .fetchAll();
    stats.completedConversations = completedRes[0] ?? 0;
    if (stats.totalConversations > 0) {
      stats.completionRate = Math.round((stats.completedConversations / stats.totalConversations) * 100);
    }

    // ── Month-over-month: fetch last 2 months of conversations in one query ──
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

    stats.momConversationsDelta = pctDelta(thisMonth.length, lastMonth.length);
    stats.momQuestionsDelta     = pctDelta(
      Math.round(thisMonth.reduce((s: number, c: any) => s + (c.messageCount || 0), 0) / 2),
      Math.round(lastMonth.reduce((s: number, c: any) => s + (c.messageCount || 0), 0) / 2),
    );
    stats.momSessionsDelta = pctDelta(
      new Set(thisMonth.map((c: any) => c.userId).filter(Boolean)).size,
      new Set(lastMonth.map((c: any) => c.userId).filter(Boolean)).size,
    );

    // ── Timestamps: last 90 days → weekly trend + peak day/hour ─────────────
    const ninetyDaysAgo  = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const eightWeeksAgo  = Date.now() - 56 * 24 * 60 * 60 * 1000;

    const { resources: allTsRows } = await container.items
      .query({
        query: 'SELECT VALUE c.timestamp FROM c WHERE IS_DEFINED(c.timestamp) AND c.timestamp > @since',
        parameters: [{ name: '@since', value: ninetyDaysAgo }],
      })
      .fetchAll();
    const allTs = (allTsRows as number[]).filter(Boolean);

    stats.weeklyTrend = buildWeeklyTrend(allTs.filter(ts => ts > eightWeeksAgo));

    // Peak day of week and hour of day
    const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const dayCounts  = new Array(7).fill(0);
    const hourCounts = new Array(24).fill(0);
    for (const ts of allTs) {
      const d = new Date(ts);
      dayCounts[d.getDay()]++;
      hourCounts[d.getHours()]++;
    }
    const maxDay  = Math.max(...dayCounts);
    const maxHour = Math.max(...hourCounts);
    if (maxDay  > 0) stats.peakDay  = DAYS[dayCounts.indexOf(maxDay)];
    if (maxHour > 0) stats.peakHour = formatHourRange(hourCounts.indexOf(maxHour));

  } catch (err) {
    logger.error('[AnalyticsStats] Cosmos conversation query failed:', err);
  }

  // ── 2. Cosmos DB: total registered users ────────────────────────────────
  try {
    const usersContainer = await getContainer('Users');
    const { resources: userCountRes } = await usersContainer.items
      .query('SELECT VALUE COUNT(1) FROM c')
      .fetchAll();
    const totalRegistered = userCountRes[0] ?? 0;
    stats.totalRegisteredUsers = totalRegistered;
    stats.notYetEngaged = Math.max(0, totalRegistered - stats.uniqueUsers);
    if (totalRegistered > 0 && stats.uniqueUsers > 0) {
      stats.adoptionRate = Math.round((stats.uniqueUsers / totalRegistered) * 100);
    }
  } catch (err) {
    logger.error('[AnalyticsStats] Cosmos users query failed:', err);
  }

  // ── 3. Derived metrics ───────────────────────────────────────────────────
  stats.estimatedHoursSaved  = Math.round((stats.totalQuestions * 8) / 60 * 10) / 10;
  stats.estimatedDollarsSaved = Math.round(stats.estimatedHoursSaved * HR_HOURLY_RATE);

  // ── 4. Azure Search: plan document count ────────────────────────────────
  try {
    const endpoint  = process.env.AZURE_SEARCH_ENDPOINT;
    const apiKey    = process.env.AZURE_SEARCH_API_KEY || process.env.AZURE_SEARCH_ADMIN_KEY;
    const indexName = process.env.AZURE_SEARCH_INDEX || process.env.AZURE_SEARCH_INDEX_NAME || 'chunks_prod_v1';

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

  // ── 5. Cosmos DB: satisfaction ratings ─────────────────────────────────
  try {
    const feedbackContainer = await getContainer('Feedback');
    const { resources: feedbackRows } = await feedbackContainer.items
      .query({
        query: `SELECT f.feedback, COUNT(1) AS count FROM f
                WHERE f.companyId = @companyId
                GROUP BY f.feedback`,
        parameters: [{ name: '@companyId', value: 'amerivet' }],
      })
      .fetchAll();

    const upCount   = (feedbackRows as { feedback: string; count: number }[]).find(r => r.feedback === 'up')?.count   ?? 0;
    const downCount = (feedbackRows as { feedback: string; count: number }[]).find(r => r.feedback === 'down')?.count ?? 0;
    stats.positiveFeedback = upCount;
    stats.totalFeedback    = upCount + downCount;
    if (stats.totalFeedback > 0) {
      stats.satisfactionRate = Math.round((upCount / stats.totalFeedback) * 100);
    }
  } catch (err) {
    logger.error('[AnalyticsStats] Feedback query failed:', err);
  }

  return NextResponse.json(stats);
}
