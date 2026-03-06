export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Acknowledge Alert API
 * Individual alert acknowledgment endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { alertingSystem } from '@/lib/monitoring/advanced-alerting';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ alertId: string }> }
) {
  try {
    const { alertId } = await params;
    const body = await request.json();
    const { acknowledgedBy } = body;

    if (!acknowledgedBy) {
      return NextResponse.json(
        { error: 'Missing acknowledgedBy field' },
        { status: 400 }
      );
    }

    const system = alertingSystem.current;
    if (!system) {
      return NextResponse.json(
        { error: 'Alerting system not initialized' },
        { status: 503 }
      );
    }

    const acknowledged = system.acknowledgeAlert(alertId, acknowledgedBy);
    
    if (!acknowledged) {
      return NextResponse.json(
        { error: 'Alert not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ 
      success: true,
      message: 'Alert acknowledged successfully'
    });
  } catch (error) {
    console.error('Failed to acknowledge alert:', error);
    return NextResponse.json(
      { error: 'Failed to acknowledge alert' },
      { status: 500 }
    );
  }
}