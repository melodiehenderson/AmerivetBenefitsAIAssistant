import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/azure/cosmos-db';
import { logger } from '@/lib/logger';

interface ActivityLog {
  id: string;
  userId: string;
  userEmail: string;
  action: 'login' | 'document_access' | 'chat_session' | 'qa_query';
  description: string;
  metadata?: {
    documentName?: string;
    messageCount?: number;
    questionAsked?: string;
  };
  timestamp: number;
  companyId: string;
}

interface ActivityResponse {
  action: string;
  description: string;
  timestamp: string;
  timeAgo: string;
}

function getTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return `${diffSecs}s ago`;
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    const userRole = searchParams.get('role') || 'admin';
    const userId = searchParams.get('userId');

    // Try to fetch from Cosmos DB Conversations container
    // Activity logs are embedded in conversation documents
    const container = await getContainer('Conversations');

    let query = `
      SELECT TOP ${Math.min(limit, 50)} 
        c.id,
        c.userId,
        c.userEmail,
        c.timestamp,
        c.messageCount,
        c.companyId
      FROM c
      WHERE c.timestamp > 0
      ORDER BY c.timestamp DESC
    `;

    // If employee, filter to their own conversations
    if (userRole === 'employee' && userId) {
      query = `
        SELECT TOP ${Math.min(limit, 50)} 
          c.id,
          c.userId,
          c.userEmail,
          c.timestamp,
          c.messageCount,
          c.companyId
        FROM c
        WHERE c.userId = @userId AND c.timestamp > 0
        ORDER BY c.timestamp DESC
      `;
    }

    const { resources: conversations } = await container.items
      .query(query, {
        parameters: userRole === 'employee' && userId ? [{ name: '@userId', value: userId }] : [],
      })
      .fetchAll();

    // Transform Cosmos DB data into activity log format
    const activities: ActivityResponse[] = conversations.slice(0, limit).map((conv: any) => {
      const timestamp = conv.timestamp || Date.now();
      const timeAgo = getTimeAgo(timestamp);

      // Determine action type and description based on conversation data
      let action = 'Chat session';
      let description = `${conv.messageCount || 1} messages exchanged`;

      if (conv.userEmail) {
        // First activity in session is usually a login
        if (!conv.id || conv.id.includes('initial')) {
          action = 'User logged in';
          description = conv.userEmail;
        }
      }

      return {
        action,
        description,
        timestamp: new Date(timestamp).toISOString(),
        timeAgo,
      };
    });

    // If no real data, return empty (don't show mock data)
    if (activities.length === 0 && userRole === 'admin') {
      logger.info('[ActivityLog] No activities found in database');
      return NextResponse.json({
        activities: [],
        total: 0,
        message: 'No activity data available',
      });
    }

    return NextResponse.json({
      activities,
      total: conversations.length,
      fetched: activities.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('[ActivityLog] Failed to fetch activity logs', error);

    // Return empty array instead of error - prevents UI breakage
    return NextResponse.json(
      {
        activities: [],
        total: 0,
        error: 'Failed to fetch activities',
      },
      { status: 500 }
    );
  }
}
