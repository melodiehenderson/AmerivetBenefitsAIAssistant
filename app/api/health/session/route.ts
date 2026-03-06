import { NextRequest, NextResponse } from "next/server";
import { redisService } from "@/lib/azure/redis";
import { getOrCreateSession, updateSession, clearSession } from "@/lib/rag/session-store";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const started = Date.now();

  const sessionId = req.nextUrl.searchParams.get("sessionId") ?? `health-${crypto.randomUUID()}`;
  const testKey = `rag:health:${sessionId}`;

  const result: {
    status: "ok" | "degraded" | "error";
    redis: {
      available: boolean;
      ping: string | null;
      pingMs: number | null;
      roundTripOk: boolean;
      roundTripMs: number | null;
    };
    sessionStore: {
      ok: boolean;
      ms: number | null;
    };
    timestamp: string;
  } = {
    status: "ok",
    redis: {
      available: false,
      ping: null,
      pingMs: null,
      roundTripOk: false,
      roundTripMs: null,
    },
    sessionStore: {
      ok: false,
      ms: null,
    },
    timestamp: new Date().toISOString(),
  };

  try {
    // Redis health
    const pingStart = Date.now();
    const ping = await redisService.ping();
    const pingMs = Date.now() - pingStart;

    result.redis.ping = ping;
    result.redis.pingMs = pingMs;
    result.redis.available = ping === "PONG";

    if (result.redis.available) {
      const rtStart = Date.now();
      try {
        await redisService.set(testKey, JSON.stringify({ ok: true, at: Date.now() }), 60);
        const value = await redisService.get(testKey);
        await redisService.del(testKey);
        result.redis.roundTripOk = Boolean(value);
      } catch (e) {
        log.warn("[health/session] Redis roundtrip failed", { err: String(e) });
        result.redis.roundTripOk = false;
      } finally {
        result.redis.roundTripMs = Date.now() - rtStart;
      }
    }

    // Session-store health (should never throw; validates basic read/write path)
    const sessionStart = Date.now();
    try {
      const session = await getOrCreateSession(sessionId);
      await updateSession(sessionId, { ...session, turn: (session.turn ?? 0) + 1 });
      await clearSession(sessionId);
      result.sessionStore.ok = true;
    } catch (e) {
      log.warn("[health/session] Session store check failed", { err: String(e) });
      result.sessionStore.ok = false;
    } finally {
      result.sessionStore.ms = Date.now() - sessionStart;
    }

    if (!result.redis.available || !result.redis.roundTripOk) {
      result.status = "degraded";
    }

    if (!result.sessionStore.ok) {
      result.status = "degraded";
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    log.error("/api/health/session failed", err as Error);
    return NextResponse.json(
      { status: "error", message: String(err), timestamp: new Date().toISOString() },
      { status: 500 }
    );
  } finally {
    log.http("health.session", { ms: Date.now() - started });
  }
}
