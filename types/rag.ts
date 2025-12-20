/**
 * Core type definitions for Production RAG System
 * Bootstrap Step 4: Types, Interfaces, and Schemas
 */
// ============================================================================
// API Request/Response Types
// ============================================================================
export type Tier = "L1" | "L2" | "L3";
export type LLMTier = Tier;  // Alias for backward compatibility
export type Persona = "employee" | "hr" | "admin";
export interface QARequest {
  companyId: string;
  userId: string;
  query: string;
  context?: {
    persona?: Persona;
    planYear?: number;
    locale?: string;
    sessionId?: string;
  };
  forceTier?: Tier;
  stream?: boolean;
}

export interface QAResponse {
  answer: string;
  citations: Citation[];
  tier: Tier;
  fromCache: boolean;
  usage: UsageMetrics;
  metadata?: ResponseMetadata;
}

export interface Citation {
  chunkId: string;
  docId: string;
  title: string;
  section?: string;
  url?: string;
  relevanceScore: number;
  excerpt?: string;
  text?: string;                              // Cited text snippet (for validation)
}

export interface UsageMetrics {
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  cost?: number;
}

export interface ResponseMetadata {
  retrievalCount: number;
  groundingScore: number;
  escalated: boolean;
  cacheKey?: string;
  retrievalMethod?: "vector" | "bm25" | "hybrid";
  rawRetrievalCount?: number;    // Total chunks before deduplication
  dedupeCount?: number;          // Unique chunks after deduplication
  citationCount?: number;        // Citations shown to user
  shownCount?: number;           // Alternative name for citationCount
  usedCount?: number;            // Alternative name for dedupeCount
  rerankedCount?: number;        // Chunks after reranking
  distinctDocIds?: number;       // Number of distinct documents in reranked chunks
  rerankTokens?: number;         // Total tokens in reranked context
  // Retrieval expansion diagnostics
  distinctDocCountInitial?: number;
  distinctDocCountFinal?: number;
  expansionUsed?: boolean;
  droppedPlanYearFilter?: boolean;
  bm25WideSweep?: boolean;
  expansionPhases?: Array<{ phase: 'expand' | 'noYear' | 'bm25Wide'; chunks: number; distinctDocs: number }>;
  // Adaptive reranker diagnostics
  rerankerAdaptiveApplied?: boolean;
  rerankerDistinctDocsAfterAdaptive?: number;
}

// ============================================================================
// Conversation Quality Tracking
// ============================================================================

export interface ConversationQuality {
  conversationId: string;
  responseTime: number;                       // Total response time in ms
  groundingScore: number;                     // Percentage of grounded tokens (0-100)
  userSatisfactionRating?: number;            // 1-5 stars (optional, post-conversation)
  escalationCount: number;                    // Number of tier escalations
  resolvedFirstContact: boolean;              // Whether query was resolved without escalation
  tier: Tier;                                 // Final tier used
  cacheHit: boolean;                          // Whether response came from cache
  timestamp: number;                          // Unix timestamp in ms
  companyId: string;                          // Multi-tenant tracking
  userId: string;                             // User identifier
  queryLength: number;                        // Length of original query in characters
  answerLength: number;                       // Length of generated answer in characters
}

export interface UserSatisfactionSurvey {
  surveyId: string;
  conversationId: string;
  userId: string;
  companyId: string;
  csatRating: number;                         // Customer Satisfaction (1-5 stars)
  npsScore: number;                           // Net Promoter Score (0-10)
  feedback?: string;                          // Optional text feedback
  timestamp: number;                          // Unix timestamp in ms
  tags?: string[];                            // Optional categorization (e.g., ["helpful", "fast"])
}

// ============================================================================
// Document & Chunk Types
// ============================================================================

export interface Document {
  id: string;
  companyId: string;
  title: string;
  type: DocumentType;
  source: string;
  metadata: DocumentMetadata;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export type DocumentType =
  | "pdf"
  | "docx"
  | "html"
  | "json"
  | "faq"
  | "policy"
  | "handbook";

export interface DocumentMetadata {
  author?: string;
  version?: string;
  effectiveDate?: Date;
  expirationDate?: Date;
  benefitYear?: number;
  carrier?: string;
  planType?: string;
  tags?: string[];
  permissions?: string[];
}

export interface Chunk {
  id: string;
  docId: string;
  companyId: string;
  sectionPath: string;
  content: string;
  vector?: number[];
  title: string;
  position: number;
  windowStart: number;
  windowEnd: number;
  metadata: ChunkMetadata;
  createdAt: Date;
  score?: number; // Overall relevance score for confidence gate (0-1)
}

export interface ChunkMetadata {
  tokenCount: number;
  sectionHeaders?: string[];
  benefitYear?: number;
  carrier?: string;
  docType?: DocumentType;
  relevanceScore?: number;
  bm25Score?: number;
  vectorScore?: number;
  rrfScore?: number;
}

// ============================================================================
// Chunking Configuration
// ============================================================================

export interface ChunkingConfig {
  windowSize: number;        // 800-1200 tokens
  stride: number;            // 120-200 tokens
  preserveHeaders: boolean;
  minChunkSize: number;
  maxChunkSize: number;
  overlapTokens: number;
}

export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  windowSize: 1000,
  stride: 150,
  preserveHeaders: true,
  minChunkSize: 400,
  maxChunkSize: 1200,
  overlapTokens: 100,
};

// ============================================================================
// Retrieval Types
// ============================================================================

export interface RetrievalContext {
  companyId: string;
  planYear?: number;
  persona?: Persona;
  locale?: string;
  filters?: SearchFilters;
  state?: string;
  dept?: string;
  category?: string; // New: Filter by benefit category (Medical, Dental, Voluntary, etc.)
}

export interface SearchFilters {
  benefitYear?: number;
  carrier?: string;
  docType?: DocumentType;
  tags?: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
}

export interface RetrievalResult {
  chunks: Chunk[];
  method: "vector" | "bm25" | "hybrid";
  totalResults: number;
  latencyMs: number;
  scores: {
    vector?: number[];
    bm25?: number[];
    rrf?: number[];
  };
  // Diagnostics & coverage expansion metadata
  distinctDocCountInitial?: number;          // Distinct docIds before expansion/guard logic
  distinctDocCountFinal?: number;            // Distinct docIds after any expansion phases
  expansionUsed?: boolean;                   // True if an additional breadth expansion phase ran
  droppedPlanYearFilter?: boolean;           // True if planYear filter was removed to increase coverage
  bm25WideSweep?: boolean;                   // True if final BM25-only wide sweep fallback was used
  expansionPhases?: Array<{
    phase: 'expand' | 'noYear' | 'bm25Wide';
    chunks: number;
    distinctDocs: number;
  }>;                                        // Ordered list of expansion phases with resulting counts
}

export interface HybridSearchConfig {
  vectorK: number;           // Top K for vector search (default: 24)
  bm25K: number;             // Top K for BM25 search (default: 24)
  rrfK: number;              // RRF parameter (default: 60)
  finalTopK: number;         // Final merged results (default: 12)
  rerankedTopK: number;      // After re-ranking (default: 8)
  enableReranking: boolean;
}

export const DEFAULT_HYBRID_CONFIG: HybridSearchConfig = {
  vectorK: 24,
  bm25K: 24,
  rrfK: 60,
  finalTopK: 12,
  rerankedTopK: 8,
  enableReranking: false, // Enable when cross-encoder available
};

// ============================================================================
// Query Understanding Types
// ============================================================================

export interface QueryIntent {
  type: IntentType;
  entities: Entity[];
  complexity: number;        // 0-1 score
  requiresTools: boolean;
  riskScore: number;         // 0-1 score
  confidence: number;
}

export type IntentType =
  | "faq"              // Simple FAQ lookup
  | "comparison"       // Compare plans/benefits
  | "calculation"      // Cost/coverage calculation
  | "eligibility"      // Enrollment/eligibility check
  | "procedure"        // How-to/process question
  | "definition"       // Term definition
  | "troubleshooting"  // Issue resolution
  | "general";         // General inquiry

export interface Entity {
  type: EntityType;
  value: string;
  confidence: number;
  span: [number, number];
}

export type EntityType =
  | "benefit_type"
  | "plan_name"
  | "carrier"
  | "date"
  | "amount"
  | "person"
  | "location"
  | "procedure_code";

// ============================================================================
// Routing & Tier Selection Types
// ============================================================================

export interface RoutingSignals {
  queryLength: number;
  hasOperators: boolean;
  needsTools: boolean;
  coverage: number;           // 0-1
  evidenceScore: number;      // 0-1
  riskScore: number;          // 0-1
  complexityScore: number;    // 0-1
  multiDocSynthesis: boolean;
}

export interface TierConfig {
  model: string;
  maxTokens: number;
  contextTokens: number;
  temperature: number;
  timeoutMs: number;
  cacheTTL: number;           // seconds
}

export const TIER_CONFIGS: Record<Tier, TierConfig> = {
  L1: {
    model: "gpt-4o-mini",
    maxTokens: 1200,
    contextTokens: 800,
    temperature: 0.2,
    timeoutMs: 1500,
    cacheTTL: 6 * 3600,       // 6 hours
  },
  L2: {
    model: "gpt-4-turbo",
    maxTokens: 2400,
    contextTokens: 1600,
    temperature: 0.2,
    timeoutMs: 3000,
    cacheTTL: 12 * 3600,      // 12 hours
  },
  L3: {
    model: "gpt-4",
    maxTokens: 4000,
    contextTokens: 3000,
    temperature: 0.2,
    timeoutMs: 6000,
    cacheTTL: 24 * 3600,      // 24 hours
  },
};

// ============================================================================
// Cache Types
// ============================================================================

export interface CacheEntry {
  answer: string;
  citations: Citation[];
  tier: Tier;
  timestamp: number;
  chunkIds: string[];
  queryHash: string;
  companyId: string;
}

export interface SemanticCacheEntry {
  queryVector: number[];
  query: string;
  answer: CacheEntry;
  similarity?: number;
  timestamp: number;
}

export type CacheKeyType = "exact" | "semantic";

export interface CacheStrategy {
  l0Enabled: boolean;         // Exact match
  l1Enabled: boolean;         // Semantic match
  l1Threshold: number;        // Similarity threshold (default: 0.92)
  maxRecentQueries: number;   // For L1 cache (default: 1000)
  ttlStrategy: "tier" | "fixed";
  defaultTTL: number;         // seconds
}

export const DEFAULT_CACHE_STRATEGY: CacheStrategy = {
  l0Enabled: true,
  l1Enabled: true,
  l1Threshold: 0.92,
  maxRecentQueries: 1000,
  ttlStrategy: "tier",
  defaultTTL: 12 * 3600,
};

// ============================================================================
// Validation & Guardrails Types
// ============================================================================

export interface GroundingResult {
  ok: boolean;
  score: number;              // 0-1 (% sentences mapped)
  unmappedSentences: string[];
  mappedCount: number;
  totalSentences: number;
}

/**
 * Extended Grounding Metrics
 * Token-level grounding analysis with chunk mapping
 */
export interface GroundingMetrics {
  score: number;                              // 0-1 (% of tokens grounded)
  isPassing: boolean;                         // score >= threshold
  totalTokens: number;
  groundedTokens: number;
  chunkMapping: Record<string, number>;       // chunkId -> grounded token count
  ungroundedSpans: string[];                  // Sample of ungrounded tokens
}

export interface PIIDetectionResult {
  hasPII: boolean;
  redactedText: string;
  findings: PIIFinding[];
}

export interface PIIFinding {
  type: PIIType;
  value: string;
  span: [number, number];
  confidence: number;
}

export type PIIType =
  | "ssn"
  | "credit_card"
  | "email"
  | "phone"
  | "address"
  | "date_of_birth"
  | "medical_id";

export interface ValidationResult {
  grounding: GroundingResult;
  pii: PIIDetectionResult;
  citationsValid: boolean;
  shouldEscalate: boolean;
  issues: string[];
  // Extended validation fields (for validation.ts module)
  valid?: boolean;                            // Overall validation status
  citations?: {                               // Citation validation details
    valid: boolean;
    invalidCitations: Array<{ citation: Citation; reason: string }>;
  };
  piiDetected?: boolean;
  piiCategories?: string[];
  redactedResponse?: string;
  errors?: string[];
  requiresEscalation?: boolean;
  currentTier?: Tier;
}

// ============================================================================
// LLM Generation Types
// ============================================================================

export interface GenerationRequest {
  model: string;
  systemPrompt: string;
  context: string;
  query: string;
  maxTokens: number;
  temperature: number;
  citations: Citation[];
}

export interface GenerationResult {
  text: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: string;
  model: string;
}

// ============================================================================
// Observability Types
// ============================================================================

export interface QAMetrics {
  requestId: string;
  companyId: string;
  userId: string;
  tier: Tier;
  fromCache: boolean;
  cacheType?: CacheKeyType;
  latency: {
    total: number;
    retrieval: number;
    generation: number;
    validation: number;
  };
  usage: UsageMetrics;
  retrieval: {
    method: string;
    count: number;
    coverage: number;
  };
  grounding: {
    score: number;
    passed: boolean;
  };
  escalated: boolean;
  errors?: string[];
  timestamp: Date;
}

export interface HealthCheckResult {
  status: "healthy" | "degraded" | "unhealthy";
  services: {
    redis: ServiceHealth;
    azureSearch: ServiceHealth;
    azureOpenAI: ServiceHealth;
    cosmosDB?: ServiceHealth;
  };
  timestamp: Date;
}

export interface ServiceHealth {
  status: "up" | "down" | "degraded";
  latencyMs?: number;
  lastCheck: Date;
  errorMessage?: string;
}

// ============================================================================
// Error Types
// ============================================================================

export class RAGError extends Error {
  constructor(
    message: string,
    public code: string,
    public tier?: Tier,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = "RAGError";
  }
}

export class RetrievalError extends RAGError {
  constructor(message: string, retryable = true) {
    super(message, "RETRIEVAL_ERROR", undefined, retryable);
    this.name = "RetrievalError";
  }
}

export class GenerationError extends RAGError {
  constructor(message: string, tier: Tier, retryable = true) {
    super(message, "GENERATION_ERROR", tier, retryable);
    this.name = "GenerationError";
  }
}

export class ValidationError extends RAGError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", undefined, false);
    this.name = "ValidationError";
  }
}

export class CacheError extends RAGError {
  constructor(message: string) {
    super(message, "CACHE_ERROR", undefined, true);
    this.name = "CacheError";
  }
}

// ============================================================================
// Utility Types
// ============================================================================

export interface TimeoutConfig {
  retrieval: number;
  L1: number;
  L2: number;
  L3: number;
}

export const DEFAULT_TIMEOUTS: TimeoutConfig = {
  retrieval: 2000,
  L1: 1500,
  L2: 3000,
  L3: 6000,
};

export interface TokenBudget {
  max: number;
  context: number;
  response: number;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, error?: Error, meta?: Record<string, unknown>): void;
}
