import { NextRequest, NextResponse } from 'next/server';
import { pipelineLogger } from '@/lib/services/pipeline-logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/pipeline-traces
 *
 * Query params:
 *   ?filter=failed  — show only failed traces
 *   ?hours=24       — time window for failed traces (default 24)
 *   ?limit=50       — max traces to return (default 50)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const filter = searchParams.get('filter');
  const hours = parseInt(searchParams.get('hours') || '24', 10);
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  try {
    const traces = filter === 'failed'
      ? await pipelineLogger.getRecentTraces(limit) // getFailedTraces doesn't take limit, filter client-side
          .then(all => all.filter(t => !t.success || !t.gate.passed))
      : await pipelineLogger.getRecentTraces(limit);

    return NextResponse.json({ traces, count: traces.length });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to fetch pipeline traces', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
