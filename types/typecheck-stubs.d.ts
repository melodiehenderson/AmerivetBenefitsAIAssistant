// Ambient stubs for typecheck-only to avoid resolving heavy internal libs
// This keeps Step 2 typecheck focused on the health endpoints.

declare module '@/lib/*' {
  const anyValue: any;
  export default anyValue;
  // Allow named exports as any for typecheck-only
  export const log: any;
  export const logger: any;
  export const getActiveIndexName: any;
  export const isCacheAvailable: any;
}

// Lightweight Node globals for typecheck-only runs
declare const process: any;
