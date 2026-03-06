/**
 * Azure Search Index Health Monitoring
 * 
 * Validates index health at startup and provides auto-fallback to known-good index.
 * Prevents zero-result regressions by failing fast to logs.
 */

import { SearchIndexClient, AzureKeyCredential } from "@azure/search-documents";
import { log } from "@/lib/logger";

const MIN_HEALTHY_DOC_COUNT = 10; // Threshold for healthy index
const FALLBACK_INDEX = "chunks_prod_v1"; // Known-good production index (499 docs)

let healthCheckAttempted = false;

/**
 * Ensure search index has sufficient documents
 * Auto-fallback to v1 if current index is unhealthy
 */
export async function ensureIndexHealthy(): Promise<void> {
  // Run once per server lifetime
  if (healthCheckAttempted) return;
  healthCheckAttempted = true;

  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const apiKey = process.env.AZURE_SEARCH_API_KEY || process.env.AZURE_SEARCH_ADMIN_KEY;
  const indexName = process.env.AZURE_SEARCH_INDEX || process.env.AZURE_SEARCH_INDEX_NAME || FALLBACK_INDEX;

  if (!endpoint || !apiKey) {
    log.warn("[Search] Missing credentials; skipping health check");
    return;
  }

  try {
    const adminClient = new SearchIndexClient(
      endpoint,
      new AzureKeyCredential(apiKey)
    );

    const stats = await adminClient.getIndexStatistics(indexName);
    const docCount = stats?.documentCount ?? 0;

    if (docCount < MIN_HEALTHY_DOC_COUNT) {
  log.error("[Search] Index UNHEALTHY; forcing fallback to v1", undefined, { index: indexName, docCount, threshold: MIN_HEALTHY_DOC_COUNT });
      
      // Override environment variable for current process
      process.env.AZURE_SEARCH_INDEX = FALLBACK_INDEX;
      
      log.info("[Search] Auto-switched to fallback index", { fallbackIndex: FALLBACK_INDEX });
    } else {
      log.info("[Search] Index health check PASSED", { index: indexName, docCount });
    }

  } catch (err) {
  log.error("[Search] Health check failed; forcing fallback to v1", undefined, { index: indexName, err: String(err) });
    
    // Override to fallback on any stats failure
    process.env.AZURE_SEARCH_INDEX = FALLBACK_INDEX;
  }
}

/**
 * Get current active index name (post-fallback)
 */
export function getActiveIndexName(): string {
  return process.env.AZURE_SEARCH_INDEX || FALLBACK_INDEX;
}

/**
 * Check if using fallback index
 */
export function isUsingFallback(): boolean {
  return getActiveIndexName() === FALLBACK_INDEX;
}
