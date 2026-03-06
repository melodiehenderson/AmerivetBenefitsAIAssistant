# AmeriVet Benefits AI Chatbot - Final Handover Guide

**Project:** AmeriVet Benefits AI Assistant  
**Version:** 1.0 Production  
**Date:** January 16, 2026  
**Prepared by:** Development Team  

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Summary](#2-architecture-summary)
3. [Key Features Implemented](#3-key-features-implemented)
4. [Environment & Deployment](#4-environment--deployment)
5. [Configuration Guide](#5-configuration-guide)
6. [Maintenance Guide](#6-maintenance-guide)
7. [Troubleshooting](#7-troubleshooting)
8. [Future Enhancement Opportunities](#8-future-enhancement-opportunities)

---

## 1. Project Overview

### Purpose
The AmeriVet Benefits AI Chatbot is a production-grade conversational assistant that helps AmeriVet employees understand and select their benefits during open enrollment. It provides personalized guidance on Medical, Dental, Vision, Life Insurance, Disability, and supplemental benefits.

### Key URLs
| Environment | URL |
|-------------|-----|
| Production | https://amerivet.bcgenrolls.com |
| Enrollment Portal | https://wd5.myworkday.com/amerivet/login.htmld |

### Tech Stack
- **Frontend:** Next.js 15 (App Router), React 19, TypeScript, TailwindCSS, shadcn/ui
- **Backend:** Next.js API Routes, tRPC
- **AI/RAG:** Azure OpenAI (GPT-4), Azure AI Search (vector + BM25 hybrid retrieval)
- **Data:** Azure Cosmos DB, Azure Blob Storage, Redis Cache
- **Hosting:** Vercel (serverless)

---

## 2. Architecture Summary

### High-Level Flow
```
User Query → Session Management → Intent Classification → 
  ↓
[Hardcoded Intercepts] → (if matched, return immediately)
  ↓
[RAG Pipeline] → Hybrid Retrieval → Re-ranking → LLM Generation → Validation
  ↓
Response with Citations
```

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Chat API | `app/api/qa/route.ts` | Main conversation handler |
| Session Store | `lib/rag/session-store.ts` | User session persistence |
| Hybrid Retrieval | `lib/rag/hybrid-retrieval.ts` | Vector + BM25 document search |
| Validation Pipeline | `lib/rag/validation-pipeline.ts` | Grounding checks, PII redaction |
| Azure OpenAI | `lib/azure/openai.ts` | LLM integration |
| Azure AI Search | `lib/azure/search.ts` | Document index queries |

### Session State
The chatbot maintains per-user session state including:
- `userName`, `userAge`, `userState` - Demographics
- `currentTopic` - Active benefit category
- `decisionsTracker` - Selected/declined benefits with status
- `coverageTier` - Employee Only, +Spouse, +Children, +Family
- `medicalNeeds` - Anticipated procedures (surgery, pregnancy, etc.)

---

## 3. Key Features Implemented

### 3.1 Smart Conversation Flow
- **Name Collection:** Asks for name first, stores in session
- **Demographics:** Collects age + state for accurate pricing
- **Topic Focus:** Stays on current benefit until user changes
- **Opt-Out Detection:** Recognizes "no vision needed", "skip dental", etc.

### 3.2 Life Insurance (Critical Business Logic)

**Carrier Mapping (HARDCODED - Cannot be changed by LLM):**
| Product | Carrier |
|---------|---------|
| Basic Life ($25k free) | UNUM |
| Voluntary Life (term) | UNUM |
| Whole Life (permanent) | ALLSTATE |

**Key Rules:**
- Allstate ONLY offers Whole Life (permanent)
- UNUM ONLY offers Basic + Voluntary (term)
- Recommended split: 20% Whole Life + 80% Voluntary Life

**Intercepts:** Questions like "Who is this with?", "I thought it was Allstate" trigger hardcoded responses to prevent LLM hallucination.

### 3.3 Medical Plans
| Plan | Employee Only | +Spouse | +Children | +Family |
|------|---------------|---------|-----------|---------|
| HSA High Deductible | $250/mo | $450/mo | $375/mo | $625/mo |
| PPO Standard | $380/mo | $684/mo | $570/mo | $950/mo |
| PPO Premium | $520/mo | $936/mo | $780/mo | $1,300/mo |
| Kaiser HMO* | $300/mo | $540/mo | $450/mo | $750/mo |

*Kaiser available in: WA, CA, OR, CO, GA, HI, MD, VA, DC

### 3.4 Dental Plans
| Plan | Employee Only | +Spouse | +Children | +Family |
|------|---------------|---------|-----------|---------|
| DHMO | $15/mo | $28/mo | $25/mo | $38/mo |
| DPPO | $29/mo | $57/mo | $72/mo | $114/mo |

### 3.5 Vision Plan
| Plan | Employee Only | +Spouse | +Children | +Family |
|------|---------------|---------|-----------|---------|
| VSP Vision Plus | $12/mo | $23/mo | $20/mo | $32/mo |

### 3.6 Anti-Hallucination Measures
1. **Hardcoded Intercepts:** Life insurance carriers, pricing tables
2. **Validation Pipeline:** Grounding score checks (≥70%)
3. **System Prompt Rules:** Explicit "NEVER say" instructions
4. **Non-US Rejection:** Detects Canada, Mexico, UK, etc. and asks for US state

### 3.7 Decision Tracker
Tracks user preferences with status:
- ✅ `selected` - User chose a plan
- ❌ `declined` - User opted out ("no vision needed")
- 🔄 `interested` - User wants more info

Summary command shows all decisions with emoji indicators.

### 3.8 Branding
- **AmeriVet Logo:** Favicon at `app/icon.png`
- **Welcome Message:** Branded intro with benefit categories
- **Enrollment Links:** Point to `https://wd5.myworkday.com/amerivet/login.htmld`

---

## 4. Environment & Deployment

### Vercel Deployment
```bash
# Preview deployment
vercel

# Production deployment
vercel --prod
```

### Required Environment Variables
Set these in Vercel Dashboard → Settings → Environment Variables:

```
# Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_API_KEY=your-key
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4

# Azure AI Search
AZURE_SEARCH_ENDPOINT=https://your-search.search.windows.net
AZURE_SEARCH_API_KEY=your-key
AZURE_SEARCH_INDEX_NAME=chunks_prod_v1

# Azure Cosmos DB
AZURE_COSMOS_ENDPOINT=https://your-cosmos.documents.azure.com:443/
AZURE_COSMOS_KEY=your-key

# Redis (Session Cache)
REDIS_URL=redis://...

# Auth
NEXTAUTH_SECRET=your-secret
NEXTAUTH_URL=https://amerivet.bcgenrolls.com
```

### SSL Certificates
Vercel handles SSL automatically for custom domains. If you see certificate warnings, they resolve within 24 hours.

---

## 5. Configuration Guide

### Updating Pricing
Pricing is hardcoded in `app/api/qa/route.ts` in the system prompt section (~lines 780-830). Search for:
- `=== MEDICAL PLAN PRICING ===`
- `=== DENTAL PLAN PRICING ===`
- `=== VISION PLAN PRICING ===`

### Adding New Benefits
1. Add to `ALL_BENEFITS` array (~line 32)
2. Add pricing section in system prompt
3. Add category detection in `extractCategory()` function (~line 680)
4. Add intercept handler if carrier accuracy is critical

### Changing Carriers
Life insurance carriers are hardcoded in two places:
1. `ALL_BENEFITS` array
2. Life insurance intercept handlers (~lines 1520-1660)

**WARNING:** Do NOT rely on system prompt alone for carrier accuracy. Always use hardcoded intercepts for business-critical facts.

### Kaiser State Availability
Edit `KAISER_STATES` set at ~line 20:
```typescript
const KAISER_STATES = new Set(['WA', 'CA', 'OR', 'CO', 'GA', 'HI', 'MD', 'VA', 'DC']);
```

---

## 6. Maintenance Guide

### Daily Operations
- **Monitor:** Check Vercel dashboard for errors
- **Logs:** Available at Vercel → Deployments → Functions tab

### Weekly Tasks
- Review conversation logs for common issues
- Check Azure OpenAI usage/quota

### Monthly Tasks
- Review Azure costs (OpenAI, AI Search, Cosmos DB)
- Update benefit documents if plan details change
- Test key conversation flows

### Document Updates
When benefit documents change:
1. Update documents in Azure Blob Storage
2. Re-run ingestion pipeline: `python ingest_real_documents_sdk.py`
3. Verify index in Azure AI Search portal

### Cache Management
Sessions are stored in Redis with automatic TTL. Manual flush:
```bash
# If needed, clear Redis cache
redis-cli FLUSHDB
```

---

## 7. Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Bot shows asterisks | Markdown not rendering | Check frontend MessageBubble component |
| Wrong carrier info | LLM hallucination | Add/update hardcoded intercept |
| Medical pricing shown unprompted | Intent misclassification | Check `extractCategory()` logic |
| Session lost | Redis timeout / cold start | Client-side session backup handles this |
| "Canada" accepted | Non-US detection missing | Added in latest deployment |

### Debug Endpoints
- Health check: `/api/health`
- Session debug: Check browser localStorage for session context

### Error Logs
```bash
# View Vercel function logs
vercel logs --follow
```

---

## 8. Future Enhancement Opportunities

### Short-Term (1-3 months)
1. **Analytics Dashboard:** Track most-asked questions, drop-off points
2. **Spanish Language Support:** Multilingual responses
3. **PDF Export:** Generate personalized benefits summary PDF
4. **Email Summary:** Send conversation recap to user's email

### Medium-Term (3-6 months)
1. **Cost Calculator Integration:** Deeper integration with cost tool
2. **Dependent Management:** Track spouse/children details for family planning
3. **Plan Comparison Tool:** Side-by-side visual comparison
4. **Mobile App:** React Native companion app

### Long-Term (6-12 months)
1. **Voice Interface:** Integrate with phone IVR
2. **Predictive Recommendations:** ML-based plan suggestions
3. **Multi-Employer Support:** White-label for other companies
4. **Integration with HRIS:** Pull employee data automatically

---

## Appendix A: File Structure

```
app/
├── api/qa/route.ts          # Main chat endpoint (2000+ lines)
├── layout.tsx               # Root layout with metadata
├── icon.png                 # AmeriVet favicon
├── (chat)/                  # Chat UI pages
└── admin/                   # Admin dashboards

lib/
├── rag/
│   ├── session-store.ts     # Session management
│   ├── hybrid-retrieval.ts  # Document search
│   └── validation-pipeline.ts
├── azure/
│   ├── openai.ts            # Azure OpenAI client
│   ├── search.ts            # Azure AI Search client
│   └── cosmos-db.ts         # Cosmos DB client
└── services/                # Business logic services

components/
├── chat.tsx                 # Main chat component
├── message-bubble.tsx       # Message rendering
└── ...

docs/
├── HANDOVER_GUIDE.md        # This document
├── COSINE_SIMILARITY.md     # Technical docs
└── ...
```

---

## Appendix B: Key Code Locations

| Feature | File | Lines (approx) |
|---------|------|----------------|
| Life Insurance Intercept | `app/api/qa/route.ts` | 1500-1660 |
| Pricing Tables | `app/api/qa/route.ts` | 780-870 |
| Intent Classification | `app/api/qa/route.ts` | 565-640 |
| Session State Types | `lib/rag/session-store.ts` | 1-80 |
| Non-US Country Detection | `app/api/qa/route.ts` | 250-280 |
| Kaiser States | `app/api/qa/route.ts` | 20 |

---

## Appendix C: Contact & Support

### Development Team
- Primary: [Your contact info]
- Backup: [Backup contact]

### Vendor Contacts
- **Vercel Support:** support@vercel.com
- **Azure Support:** Azure Portal → Support + Troubleshooting

### Emergency Procedures
1. **Site Down:** Check Vercel status page, then Azure services
2. **Wrong Info Displayed:** Deploy hotfix to intercept handlers
3. **High Costs:** Check Azure OpenAI token usage, implement rate limiting

---

*Document Version: 1.0*  
*Last Updated: January 16, 2026*
