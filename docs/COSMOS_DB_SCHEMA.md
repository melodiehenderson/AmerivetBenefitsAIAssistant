# Firestore Schema Design for Benefits AI Assistant
**Version:** 1.0  
**Date:** October 31, 2025  
**Status:** Production-Ready Schema

---

## Overview

Multi-tenant Firestore database schema optimized for:
- **Analytics** (conversation quality, user satisfaction, performance metrics)
- **Document Management** (version control, audit trails)
- **Multi-Tenancy** (company isolation with shared infrastructure)
- **Query Performance** (composite indexes, cursor-based pagination)

---

## Collections

### 1. `companies`
Company/employer root collection for multi-tenant isolation.

```typescript
interface Company {
  id: string;                    // Auto-generated document ID
  name: string;                  // Company name
  domain: string;                // Email domain (e.g., "amerivet.com")
  plan: 'basic' | 'premium' | 'enterprise';
  settings: {
    enabledFeatures: string[];   // Feature flags
    llmTierDefaults: {
      maxL1Percentage: number;   // Cost optimization
      maxL3Percentage: number;
    };
    branding: {
      logoUrl?: string;
      primaryColor?: string;
      secondaryColor?: string;
    };
  };
  metadata: {
    employeeCount: number;
    industry: string;
    contactEmail: string;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
  status: 'active' | 'suspended' | 'trial';
}
```

**Indexes:**
- `domain` (ascending)
- `status` (ascending) + `createdAt` (descending)

---

### 2. `users`
User accounts with role-based access control.

```typescript
interface User {
  id: string;                    // Azure AD B2C user ID
  email: string;
  name: string;
  companyId: string;             // Foreign key to companies
  roles: string[];               // ['employee', 'admin', 'super_admin']
  permissions: string[];         // Granular permissions
  profile: {
    avatarUrl?: string;
    department?: string;
    jobTitle?: string;
    enrollmentStatus: 'pending' | 'active' | 'declined';
  };
  preferences: {
    locale: string;              // 'en-US', 'es-ES'
    notifications: boolean;
    theme: 'light' | 'dark' | 'auto';
  };
  metadata: {
    lastLoginAt?: Timestamp;
    loginCount: number;
    conversationCount: number;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
  status: 'active' | 'inactive' | 'deleted';
}
```

**Indexes:**
- `companyId` (ascending) + `status` (ascending)
- `email` (ascending)
- `companyId` (ascending) + `roles` (array-contains) + `createdAt` (descending)

---

### 3. `documents`
Benefit documents with version control.

```typescript
interface Document {
  id: string;
  companyId: string;
  title: string;
  type: 'pdf' | 'docx' | 'html' | 'markdown';
  category: 'handbook' | 'policy' | 'faq' | 'plan_summary' | 'form';
  content: {
    raw: string;                 // Original content
    processed: string;           // Cleaned/normalized
    chunks: number;              // Number of chunks created
  };
  version: {
    current: number;             // Current version number
    history: VersionHistory[];   // Version changelog
    isLatest: boolean;
  };
  metadata: {
    author: string;              // User ID who created
    benefitYear?: number;        // 2025, 2026, etc.
    carrier?: string;
    planType?: string;
    effectiveDate?: Timestamp;
    expirationDate?: Timestamp;
    tags: string[];
    fileSize: number;            // Bytes
    mimeType: string;
  };
  permissions: {
    roles: string[];             // Roles that can access
    visibility: 'public' | 'internal' | 'restricted';
  };
  analytics: {
    viewCount: number;
    downloadCount: number;
    citationCount: number;       // Times cited in QA responses
    lastAccessedAt?: Timestamp;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;             // User ID
  updatedBy: string;             // User ID
  status: 'draft' | 'published' | 'archived' | 'deleted';
}

interface VersionHistory {
  version: number;
  timestamp: Timestamp;
  author: string;                // User ID
  changelog: string;
  contentHash: string;           // SHA-256 of content
  changes: {
    added: number;               // Lines/chunks added
    modified: number;
    deleted: number;
  };
}
```

**Indexes:**
- `companyId` (ascending) + `status` (ascending) + `createdAt` (descending)
- `companyId` (ascending) + `category` (ascending) + `status` (ascending)
- `companyId` (ascending) + `version.isLatest` (ascending) + `updatedAt` (descending)
- `metadata.benefitYear` (ascending) + `companyId` (ascending)

---

### 4. `chunks`
Document chunks for RAG retrieval (embedded content).

```typescript
interface Chunk {
  id: string;                    // chunk-{docId}-{index}
  docId: string;                 // Foreign key to documents
  companyId: string;
  content: string;               // Text chunk
  embedding: number[];           // 3072-dim vector (text-embedding-3-large)
  metadata: {
    sectionPath: string;         // "Benefits > Medical > PPO Plans"
    sectionHeaders: string[];
    position: number;            // Chunk index in document
    tokenCount: number;
    windowStart: number;
    windowEnd: number;
    benefitYear?: number;
    carrier?: string;
    planType?: string;
  };
  indexing: {
    lastIndexedAt: Timestamp;
    indexVersion: string;        // For reindexing tracking
  };
  createdAt: Timestamp;
}
```

**Indexes:**
- `companyId` (ascending) + `docId` (ascending)
- `companyId` (ascending) + `metadata.benefitYear` (ascending)
- Vector index on `embedding` field (for Azure AI Search or Firestore Vector Search)

**Note:** For production, consider migrating chunk embeddings to **Azure AI Search** or **Pinecone** for better vector search performance.

---

### 5. `conversations`
Complete conversation threads with quality metrics.

```typescript
interface Conversation {
  id: string;                    // conversation-{timestamp}-{random}
  companyId: string;
  userId: string;
  sessionId: string;             // Groups multiple conversations
  messages: Message[];
  quality: ConversationQuality;  // Imported from types/rag.ts
  summary: {
    intent: string;              // 'lookup', 'compare', 'eligibility'
    topics: string[];            // ['dental', 'deductible']
    resolved: boolean;
    resolutionType: 'answered' | 'escalated' | 'needs_human';
  };
  metadata: {
    userAgent: string;
    ipAddress: string;
    locale: string;
    source: 'web' | 'mobile' | 'api';
  };
  createdAt: Timestamp;
  completedAt?: Timestamp;
  status: 'active' | 'completed' | 'abandoned';
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Timestamp;
  metadata?: {
    tier?: 'L1' | 'L2' | 'L3';
    latency?: number;
    citationCount?: number;
    tokens?: {
      prompt: number;
      completion: number;
    };
  };
}

// ConversationQuality defined in types/rag.ts
```

**Indexes:**
- `companyId` (ascending) + `userId` (ascending) + `createdAt` (descending)
- `companyId` (ascending) + `status` (ascending) + `createdAt` (descending)
- `companyId` (ascending) + `quality.tier` (ascending) + `createdAt` (descending)
- `quality.resolvedFirstContact` (ascending) + `companyId` (ascending)

---

### 6. `user_surveys`
User satisfaction ratings (CSAT/NPS).

```typescript
// UserSatisfactionSurvey defined in types/rag.ts
interface UserSurvey extends UserSatisfactionSurvey {
  createdAt: Timestamp;
  source: 'inline' | 'post_conversation' | 'email';
}
```

**Indexes:**
- `companyId` (ascending) + `userId` (ascending) + `timestamp` (descending)
- `conversationId` (ascending)
- `companyId` (ascending) + `npsScore` (ascending) + `timestamp` (descending)
- `tags` (array-contains) + `companyId` (ascending)

---

### 7. `analytics_daily`
Pre-aggregated daily metrics for fast dashboard loading.

```typescript
interface DailyAnalytics {
  id: string;                    // {companyId}-{YYYY-MM-DD}
  companyId: string;
  date: string;                  // 'YYYY-MM-DD'
  metrics: {
    conversations: {
      total: number;
      byTier: Record<Tier, number>;
      escalated: number;
      cached: number;
      avgResponseTime: number;
      p95ResponseTime: number;
    };
    quality: {
      avgGroundingScore: number;
      belowThreshold: number;
      avgEscalationCount: number;
      firstContactResolutionRate: number;
    };
    satisfaction: {
      avgCSAT: number;
      avgNPS: number;
      surveyCount: number;
      promoters: number;
      passives: number;
      detractors: number;
    };
    cost: {
      total: number;
      byTier: Record<Tier, number>;
      avgPerConversation: number;
    };
    topTopics: Array<{ topic: string; count: number }>;
    peakHours: Array<{ hour: number; count: number }>;
  };
  createdAt: Timestamp;
  generatedAt: Timestamp;
}
```

**Indexes:**
- `companyId` (ascending) + `date` (descending)
- `date` (ascending) (for platform-wide analytics)

---

### 8. `audit_logs`
Security and compliance audit trail.

```typescript
interface AuditLog {
  id: string;
  companyId: string;
  userId: string;
  action: 'create' | 'update' | 'delete' | 'view' | 'download' | 'export';
  resource: {
    type: 'document' | 'user' | 'conversation' | 'settings';
    id: string;
    before?: any;                // Previous state
    after?: any;                 // New state
  };
  metadata: {
    ipAddress: string;
    userAgent: string;
    requestId: string;
  };
  timestamp: Timestamp;
  severity: 'info' | 'warning' | 'critical';
}
```

**Indexes:**
- `companyId` (ascending) + `timestamp` (descending)
- `userId` (ascending) + `timestamp` (descending)
- `resource.type` (ascending) + `action` (ascending) + `timestamp` (descending)
- `severity` (ascending) + `timestamp` (descending)

---

## Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Helper functions
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function belongsToCompany(companyId) {
      return isAuthenticated() && request.auth.token.companyId == companyId;
    }
    
    function hasRole(role) {
      return isAuthenticated() && role in request.auth.token.roles;
    }
    
    function isSuperAdmin() {
      return hasRole('super_admin') || hasRole('platform_admin');
    }
    
    function isCompanyAdmin(companyId) {
      return belongsToCompany(companyId) && (hasRole('company_admin') || hasRole('hr_admin'));
    }
    
    // Companies
    match /companies/{companyId} {
      allow read: if belongsToCompany(companyId) || isSuperAdmin();
      allow write: if isSuperAdmin();
    }
    
    // Users
    match /users/{userId} {
      allow read: if isAuthenticated() && (
        request.auth.uid == userId ||
        belongsToCompany(resource.data.companyId) ||
        isSuperAdmin()
      );
      allow create: if isSuperAdmin();
      allow update: if isAuthenticated() && (
        request.auth.uid == userId ||
        isCompanyAdmin(resource.data.companyId) ||
        isSuperAdmin()
      );
      allow delete: if isSuperAdmin();
    }
    
    // Documents
    match /documents/{docId} {
      allow read: if isAuthenticated() && (
        belongsToCompany(resource.data.companyId) ||
        isSuperAdmin()
      );
      allow write: if isAuthenticated() && (
        isCompanyAdmin(resource.data.companyId) ||
        isSuperAdmin()
      );
    }
    
    // Chunks (read-only for regular users)
    match /chunks/{chunkId} {
      allow read: if isAuthenticated() && (
        belongsToCompany(resource.data.companyId) ||
        isSuperAdmin()
      );
      allow write: if isSuperAdmin(); // Only admins can reindex
    }
    
    // Conversations
    match /conversations/{conversationId} {
      allow read: if isAuthenticated() && (
        request.auth.uid == resource.data.userId ||
        isCompanyAdmin(resource.data.companyId) ||
        isSuperAdmin()
      );
      allow create: if isAuthenticated() && belongsToCompany(request.resource.data.companyId);
      allow update: if isAuthenticated() && request.auth.uid == resource.data.userId;
    }
    
    // User Surveys
    match /user_surveys/{surveyId} {
      allow read: if isAuthenticated() && (
        request.auth.uid == resource.data.userId ||
        isCompanyAdmin(resource.data.companyId) ||
        isSuperAdmin()
      );
      allow create: if isAuthenticated() && belongsToCompany(request.resource.data.companyId);
    }
    
    // Analytics (read-only except for system)
    match /analytics_daily/{analyticsId} {
      allow read: if isAuthenticated() && (
        belongsToCompany(resource.data.companyId) ||
        isSuperAdmin()
      );
      allow write: if false; // Only backend can write
    }
    
    // Audit Logs (read-only for admins)
    match /audit_logs/{logId} {
      allow read: if isAuthenticated() && (
        isCompanyAdmin(resource.data.companyId) ||
        isSuperAdmin()
      );
      allow write: if false; // Only backend can write
    }
  }
}
```

---

## Query Patterns

### Cursor-Based Pagination Example

```typescript
// Get conversations for a user with pagination
async function getConversations(
  companyId: string,
  userId: string,
  pageSize: number = 20,
  lastDoc?: DocumentSnapshot
) {
  let query = db
    .collection('conversations')
    .where('companyId', '==', companyId)
    .where('userId', '==', userId)
    .orderBy('createdAt', 'desc')
    .limit(pageSize);
  
  if (lastDoc) {
    query = query.startAfter(lastDoc);
  }
  
  const snapshot = await query.get();
  const conversations = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  }));
  
  return {
    conversations,
    nextCursor: snapshot.docs[snapshot.docs.length - 1],
    hasMore: snapshot.docs.length === pageSize,
  };
}
```

### Analytics Aggregation

```typescript
// Daily analytics aggregation (run via Cloud Function)
async function generateDailyAnalytics(companyId: string, date: string) {
  const startOfDay = new Date(date);
  const endOfDay = new Date(date);
  endOfDay.setDate(endOfDay.getDate() + 1);
  
  const conversations = await db
    .collection('conversations')
    .where('companyId', '==', companyId)
    .where('createdAt', '>=', startOfDay)
    .where('createdAt', '<', endOfDay)
    .get();
  
  // Aggregate metrics...
  const metrics = aggregateMetrics(conversations.docs);
  
  await db.collection('analytics_daily').doc(`${companyId}-${date}`).set({
    companyId,
    date,
    metrics,
    createdAt: Timestamp.now(),
    generatedAt: Timestamp.now(),
  });
}
```

---

## Migration Strategy

### Phase 1: Schema Setup (Week 1)
1. Create Firestore collections with indexes
2. Deploy security rules
3. Test with sample data

### Phase 2: Data Migration (Week 2)
1. Migrate existing documents → `documents` collection
2. Generate chunks → `chunks` collection
3. Backfill analytics → `analytics_daily`

### Phase 3: Integration (Week 3)
1. Update QA endpoint to save conversations
2. Wire satisfaction surveys to `user_surveys`
3. Implement daily analytics aggregation (Cloud Function)

### Phase 4: Optimization (Week 4)
1. Monitor query performance
2. Add missing indexes
3. Implement caching layer (Redis)
4. Set up Firestore backups

---

## Performance Targets

- **Conversation Creation:** <100ms (p95)
- **Document Retrieval:** <200ms (p95)
- **Analytics Query:** <500ms (p95)
- **Survey Submission:** <150ms (p95)

---

## Backup & Disaster Recovery

- **Firestore Automatic Backups:** Daily snapshots (30-day retention)
- **Export Schedule:** Weekly full exports to Cloud Storage
- **Retention Policy:** 90 days for operational data, 7 years for compliance (audit logs)

---

## Cost Optimization

- Pre-aggregate analytics (avoid scanning large collections)
- Implement TTL for temporary data
- Use batch writes for bulk operations
- Cache frequently accessed documents in Redis
- Archive old conversations after 1 year

---

**Next Steps:**
1. ✅ Create Firestore project
2. ✅ Deploy schema and security rules
3. ⚠️ Implement client SDK wrappers
4. ⚠️ Set up Cloud Functions for aggregation
5. ⚠️ Integrate with existing RAG pipeline
