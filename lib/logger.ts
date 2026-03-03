// lib/logger.ts - Build-safe console logger (no pino dependencies)

const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

export const logger = {
  info: (message: string | object, ...args: any[]) => {
    if (!isBuildPhase) console.log('[INFO]', message, ...args);
  },
  error: (message: string | object, ...args: any[]) => {
    if (!isBuildPhase) console.error('[ERROR]', message, ...args);
  },
  warn: (message: string | object, ...args: any[]) => {
    if (!isBuildPhase) console.warn('[WARN]', message, ...args);
  },
  debug: (message: string | object, ...args: any[]) => {
    if (!isBuildPhase) console.debug('[DEBUG]', message, ...args);
  },
  trace: (message: string | object, ...args: any[]) => {
    if (!isBuildPhase) console.trace('[TRACE]', message, ...args);
  },
  fatal: (message: string | object, ...args: any[]) => {
    if (!isBuildPhase) console.error('[FATAL]', message, ...args);
  },
  // Additional methods for compatibility with existing code
  apiResponse: (method: string, endpoint: string, statusCode: number, duration: number, context?: any) => {
    if (!isBuildPhase) {
      console.log(`[API] ${method} ${endpoint}`, { statusCode, duration, ...context });
    }
  },
};

// Single adapter to forbid wrong call signatures
export const log = {
  info: (msg: string, ctx: Record<string, unknown> = {}) => logger.info(msg, ctx),
  warn: (msg: string, ctx: Record<string, unknown> = {}) => logger.warn(msg, ctx),
  error: (msg: string, err?: Error, ctx: Record<string, unknown> = {}) => {
    logger.error(msg, { ...ctx, error: err?.message, stack: err?.stack });
  },
  debug: (msg: string, ctx: Record<string, unknown> = {}) => logger.debug(msg, ctx),
  http: (msg: string, ctx: Record<string, unknown> = {}) => logger.debug(msg, ctx),
};

export default logger;

// Legacy compatibility
export const logError = (msg: string, err?: unknown, context?: any) => {
  log.error(msg, err instanceof Error ? err : new Error(String(err)), context || {});
};
