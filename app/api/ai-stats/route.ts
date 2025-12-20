export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/unified-auth';
import { USER_ROLES } from '@/lib/constants/roles';
import { getContainer } from '@/lib/azure/cosmos-db'; // Ensure you have this helper
import { logger } from '@/lib/logger';

// Interface for our aggregated stats
interface AIStats {
  totalRequests: number;
  totalTokens: number;
  averageResponseTime: number; // in ms
  averageTokensPerRequest: number;
  modelUsage: Record<string, number>; // e.g. { 'gpt-4': 50, 'gpt-3.5': 200 }
  period: string;
}

export const GET = withAuth([USER_ROLES.SUPER_ADMIN, USER_ROLES.PLATFORM_ADMIN])(async (req) => {
  const startTime = Date.now();
  
  try {
    // 1. Connect to the 'Conversations' or 'AuditLogs' container
    // This assumes you store chat completion logs in Cosmos DB
    const container = await getContainer('Conversations');

    // 2. DEFINE TIME WINDOW: Stats for the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateIso = thirtyDaysAgo.toISOString();

    // 3. EXECUTE PARALLEL QUERIES
    // We run two queries: one for general metrics, one for model distribution.
    
    // Query A: General Metrics (Count, Latency, Tokens)
    // Note: Adjust field names (c.usage.totalTokens, c.duration) to match your actual schema
    const metricsQuery = {
      query: `
        SELECT 
            COUNT(1) as totalRequests, 
            SUM(c.usage.totalTokens) as totalTokens, 
            AVG(c.metadata.durationMs) as avgDuration
        FROM c 
        WHERE c.type = 'message' 
        AND c.role = 'assistant' 
        AND c.createdAt >= @startDate
      `,
      parameters: [{ name: '@startDate', value: dateIso }]
    };

    // Query B: Model Usage Distribution (Group By)
    const distributionQuery = {
      query: `
        SELECT c.model, COUNT(1) as count 
        FROM c 
        WHERE c.type = 'message' 
        AND c.role = 'assistant' 
        AND c.createdAt >= @startDate
        GROUP BY c.model
      `,
      parameters: [{ name: '@startDate', value: dateIso }]
    };

    // Run both simultaneously
    const [metricsResult, distResult] = await Promise.all([
      container.items.query(metricsQuery).fetchAll(),
      container.items.query(distributionQuery).fetchAll()
    ]);

    // 4. PROCESS RESULTS
    const rawMetrics = metricsResult.resources[0] || {};
    const rawDist = distResult.resources;

    // Format Model Usage: [ { model: 'gpt-4', count: 10 } ] -> { 'gpt-4': 10 }
    const modelUsageMap: Record<string, number> = {};
    rawDist.forEach((item: any) => {
      if (item.model) modelUsageMap[item.model] = item.count;
    });

    // Safely calculate averages
    const totalRequests = rawMetrics.totalRequests || 0;
    const totalTokens = rawMetrics.totalTokens || 0;
    
    const stats: AIStats = {
      totalRequests,
      totalTokens,
      averageResponseTime: Math.round(rawMetrics.avgDuration || 0),
      averageTokensPerRequest: totalRequests > 0 ? Math.round(totalTokens / totalRequests) : 0,
      modelUsage: modelUsageMap,
      period: '30d'
    };

    const duration = Date.now() - startTime;
    logger.info('AI Stats Aggregated', { duration, totalRequests });

    return NextResponse.json({ 
      success: true, 
      data: stats 
    });

  } catch (error) {
    logger.error('Failed to fetch AI stats', error as Error);
    
    // Fallback: Return empty stats instead of 500ing the whole dashboard
    return NextResponse.json({ 
      success: false, 
      data: {
        totalRequests: 0,
        averageResponseTime: 0,
        totalTokens: 0,
        modelUsage: {},
        error: 'Live stats temporarily unavailable'
      }
    });
  }
});