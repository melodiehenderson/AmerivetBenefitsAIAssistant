import { NextResponse } from "next/server";
import { getActiveIndexName } from "@/lib/rag/search-health";
import { getRedis } from "@/lib/cache";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function checkOpenAI(): { configured: boolean; missing: string[] } {
  const required = [
    'AZURE_OPENAI_ENDPOINT',
    'AZURE_OPENAI_API_KEY',
    'AZURE_OPENAI_DEPLOYMENT_NAME',
  ];
  const missing = required.filter((k) => !process.env[k]);
  return { configured: missing.length === 0, missing };
}

export async function GET() {
  const started = Date.now();
  try {
    const index = getActiveIndexName();
    let redis = false;
    try {
      const redisClient = getRedis();
      if (redisClient) {
        await redisClient.ping();
        redis = true;
      }
    } catch {
      redis = false;
    }
    const openai = checkOpenAI();
    const commit = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "unknown";

    const allHealthy = redis && openai.configured;
    const payload = {
      status: allHealthy ? "ok" : "degraded",
      services: {
        azureSearch: { index },
        redis: { available: redis },
        openai: openai,
      },
      commit,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(payload, { status: allHealthy ? 200 : 503 });

  } catch (err) {
    log.error("/api/health failed", err as Error);
    return NextResponse.json({ status: "error", message: String(err) }, { status: 500 });
  } finally {
    const ms = Date.now() - started;
    log.http("health", { ms });
  }
}

export async function HEAD() { return new Response(null, { status: 200 }); }

