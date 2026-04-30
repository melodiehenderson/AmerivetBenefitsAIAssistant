/**
 * Platform Health API — Super Admin Only
 * Pings Azure OpenAI, Redis, and Azure Search and reports
 * live status + latency for each. Used by the platform owner dashboard.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getContainer } from '@/lib/azure/cosmos-db';
import { logger } from '@/lib/logger';

export interface ServiceHealth {
  name: string;
  status: 'ok' | 'degraded' | 'down';
  latencyMs: number | null;
  detail?: string;
}

export interface HealthReport {
  fetchedAt: string;
  overall: 'ok' | 'degraded' | 'down';
  services: ServiceHealth[];
}

async function pingWithTimeout<T>(
  label: string,
  fn: () => Promise<T>,
  timeoutMs = 5000,
): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), timeoutMs),
      ),
    ]);
    return { name: label, status: 'ok', latencyMs: Date.now() - start };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    const isTimeout = err?.message === 'timeout';
    return {
      name: label,
      status: isTimeout ? 'degraded' : 'down',
      latencyMs: isTimeout ? latencyMs : null,
      detail: isTimeout ? 'Responded slowly (>5s)' : String(err?.message ?? 'unreachable'),
    };
  }
}

export async function GET(_request: NextRequest) {
  // Super admin only
  const cookieStore = await cookies();
  const session = cookieStore.get('amerivet_session')?.value;
  if (session !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const results = await Promise.allSettled([

    // ── Azure OpenAI ──────────────────────────────────────────────────────────
    pingWithTimeout('Azure OpenAI', async () => {
      const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
      const apiKey   = process.env.AZURE_OPENAI_API_KEY;
      const deploy   = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4o';
      if (!endpoint || !apiKey) throw new Error('env vars not set');
      // Minimal completion — 1 token, no streaming
      const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploy}/chat/completions?api-version=2024-02-01`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }),

    // ── Redis ─────────────────────────────────────────────────────────────────
    pingWithTimeout('Redis', async () => {
      const { getRedis } = await import('@/lib/azure/redis');
      const client = await getRedis();
      if (!client) throw new Error('client unavailable');
      const pong = await (client as any).ping();
      if (pong !== 'PONG') throw new Error(`unexpected: ${pong}`);
    }),

    // ── Azure Search ──────────────────────────────────────────────────────────
    pingWithTimeout('Azure Search', async () => {
      const endpoint  = process.env.AZURE_SEARCH_ENDPOINT;
      const apiKey    = process.env.AZURE_SEARCH_API_KEY || process.env.AZURE_SEARCH_ADMIN_KEY;
      const indexName = process.env.AZURE_SEARCH_INDEX || process.env.AZURE_SEARCH_INDEX_NAME || 'chunks_prod_v1';
      if (!endpoint || !apiKey) throw new Error('env vars not set');
      const { SearchClient, AzureKeyCredential } = await import('@azure/search-documents');
      const client = new SearchClient(endpoint, indexName, new AzureKeyCredential(apiKey));
      const result = await client.search('*', { top: 1 });
      // Just need the iterator to not throw
      for await (const _ of result.results) { break; }
    }),

  ]);

  const services: ServiceHealth[] = results.map(r =>
    r.status === 'fulfilled' ? r.value : {
      name: 'unknown',
      status: 'down' as const,
      latencyMs: null,
      detail: String((r as PromiseRejectedResult).reason),
    }
  );

  const overall: HealthReport['overall'] =
    services.every(s => s.status === 'ok')       ? 'ok'       :
    services.some(s => s.status === 'down')       ? 'down'     :
    'degraded';

  const report: HealthReport = {
    fetchedAt: new Date().toISOString(),
    overall,
    services,
  };

  logger.info('[Health] Platform health check complete', { overall });

  // ── Persist health log for 30-day uptime tracking (fire-and-forget) ────
  const now = Date.now();
  getContainer('HealthLogs')
    .then(container => container.items.create({
      id: `health-${now}`,
      timestamp: now,
      overall,
      services: services.map(s => ({ name: s.name, status: s.status, latencyMs: s.latencyMs ?? null })),
    }))
    .catch(err => logger.error('[Health] Failed to persist health log:', err));

  return NextResponse.json(report);
}
