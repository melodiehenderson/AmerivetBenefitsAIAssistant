export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Resolve Alert API
 * Individual alert resolution endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { alertingSystem } from '@/lib/monitoring/advanced-alerting';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ alertId: string }> }
) {
  try {
    const { alertId } = await params;

    const system = alertingSystem.current;
    if (!system) {
      return NextResponse.json(
        { error: 'Alerting system not initialized' },
        { status: 503 }
      );
    }

    const resolved = system.resolveAlert(alertId);
    
    if (!resolved) {
      return NextResponse.json(
        { error: 'Alert not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ 
      success: true,
      message: 'Alert resolved successfully'
    });
  } catch (error) {
    console.error('Failed to resolve alert:', error);
    return NextResponse.json(
      { error: 'Failed to resolve alert' },
      { status: 500 }
    );
  }
}
