import { NextResponse } from "next/server";
import { getActiveIndexName } from "@/lib/rag/search-health";
import { isCacheAvailable } from "@/lib/cache";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const started = Date.now();
  try {
    const index = getActiveIndexName();
    const redis = isCacheAvailable();
    const commit = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "unknown";

    const payload = {
      status: "ok",
      services: {
        azureSearch: { index },
        redis: { available: redis },
      },
      commit,
      timestamp: new Date().toISOString(),
    } as const;

    return NextResponse.json(payload, { status: 200 });

  } catch (err) {
    log.error("/api/health failed", err as Error);
    return NextResponse.json({ status: "error", message: String(err) }, { status: 500 });
  } finally {
    const ms = Date.now() - started;
    log.http("health", { ms });
  }
}

export async function HEAD() { return new Response(null, { status: 200 }); }

