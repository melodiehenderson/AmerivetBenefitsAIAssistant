# Deployment Guide - Benefits AI Chatbot Enhancements

## Overview
This guide walks you through deploying the 7 issue fixes + 5 enhancements to staging and production.

**Version:** 3.2.0  
**Date:** March 2, 2026  
**Changes:** 7 issue fixes + 5 enhancements (RAG routing, context extraction, analytics)

---

## 📋 Pre-Deployment Checklist

### 1. Environment Variables

Add these to your `.env` file (or staging environment):

```bash
# ✅ NEW: Enable RAG-enhanced routing
USE_RAG_ROUTER=true

# Optional: Enable smart routing as fallback
USE_SMART_ROUTER=false

# Model configuration
SMART_ROUTER_MODEL=gpt-4o-mini
```

**Full `.env` template:**
```bash
# Copy from .env.example and add:
cp .env.example .env

# Then edit .env and ensure these are set:
USE_RAG_ROUTER=true
USE_SMART_ROUTER=false
SMART_ROUTER_MODEL=gpt-4o-mini
```

---

## 🚀 Step 1: Deploy to Staging

### Option A: Vercel Deployment

```bash
# 1. Install Vercel CLI (if not already installed)
npm i -g vercel

# 2. Login to Vercel
vercel login

# 3. Link to your project
vercel link

# 4. Deploy to staging (preview)
vercel --env production

# 5. Set environment variables in Vercel dashboard
# Go to: Project Settings → Environment Variables
# Add:
#   USE_RAG_ROUTER = true
#   USE_SMART_ROUTER = false
#   SMART_ROUTER_MODEL = gpt-4o-mini

# 6. Promote to production after testing
vercel --prod
```

### Option B: Docker Deployment

```bash
# 1. Build Docker image
docker build -t benefits-ai-chatbot:3.2.0 .

# 2. Run with environment variables
docker run -d \
  -p 3000:3000 \
  -e USE_RAG_ROUTER=true \
  -e USE_SMART_ROUTER=false \
  -e SMART_ROUTER_MODEL=gpt-4o-mini \
  -e AZURE_OPENAI_ENDPOINT=... \
  -e AZURE_COSMOS_ENDPOINT=... \
  benefits-ai-chatbot:3.2.0
```

### Option C: Direct Server Deployment

```bash
# 1. Pull latest code
git pull origin main

# 2. Install dependencies
npm ci

# 3. Build application
npm run build

# 4. Set environment variables
export USE_RAG_ROUTER=true
export USE_SMART_ROUTER=false
export SMART_ROUTER_MODEL=gpt-4o-mini

# 5. Start production server
npm start
```

---

## 🧪 Step 2: Test Enhancements Manually

### Test Script: Quick Verification

Run these tests in the chat interface:

#### **Test 1: Premium Display Consistency (Issue #1)**
```
User: What are the plan costs?
Expected: All prices show $X.XX/month ($Y.YY/year) format
```

#### **Test 2: Category Filtering (Issue #2)**
```
User: What medical plans are available?
Expected: Only medical plans mentioned (no accident/life/disability)
```

#### **Test 3: All Benefits Calculation (Issue #3)**
```
User: I want to enroll in all benefits. How much per paycheck?
Expected: Shows breakdown + total cost calculation
```

#### **Test 4: Cost Projection (Issue #4)**
```
User: Help me calculate healthcare costs for next year. Family4+, moderate usage.
Expected: Provides cost projection with usage assumptions
```

#### **Test 5: Maternity Comparison (Issue #5)**
```
User: I'm planning to have a baby. Which plan is better?
Expected: Detailed comparison with OOP, premiums, recommendations
```

#### **Test 6: Geographic Consistency (Issue #6)**
```
1. Set state to Texas in onboarding
2. Ask: What plans are available?
Expected: No mentions of other states (Indiana, etc.)
```

#### **Test 7: Orthodontics Validation (Issue #7)**
```
User: Does dental cover orthodontics?
Expected: Consistent answers, grounded in retrieved documents
```

#### **Test 8: RAG Routing (Enhancement #8)**
```
User: What are my dental benefits?
Expected: Response cites specific document sources
Check logs for: "RAG chat response generated"
```

#### **Test 9: Context Extraction (Enhancement #9)**
```
User: Family4+ moderate usage Kaiser network
Expected: Cost projection uses family tier, moderate usage, Kaiser
```

---

## 📊 Step 3: Monitor Analytics

### View Analytics Logs

```bash
# Check application logs for analytics events
# Look for these log messages:

# Chat response tracked
"Chat response tracked" { userId, conversationId, model }

# Satisfaction rating tracked
"Satisfaction rating tracked" { userId, conversationId, rating }

# Issue fixes applied
"Issue fixes applied" { conversationId, issue1_..., issue7_... }
```

### Analytics Events to Monitor

| Event Type | What to Look For | Success Metric |
|------------|------------------|----------------|
| `chat_response` | Model usage, latency | <500ms avg latency |
| `satisfaction_rating` | User ratings | >4.0 average |
| `escalation` | Human help requests | <5% escalation rate |
| `feature_usage` | Feature adoption | Increasing usage |

### Access Analytics Data

```typescript
// In production, query analytics from your database
// Example query for satisfaction metrics:

const metrics = await analyticsTracker.calculateMetrics(conversationId);
console.log('Average Rating:', metrics.averageRating);
console.log('Total Responses:', metrics.totalResponses);
console.log('Escalation Rate:', metrics.escalationRate);
console.log('Average Latency:', metrics.averageLatencyMs);
```

---

## ✅ Step 4: Production Deployment

### Pre-Production Validation

```bash
# 1. Run type checking
npm run typecheck

# 2. Run linting
npm run lint

# 3. Run tests
npm test

# 4. Build verification
npm run build

# 5. Verify production config
npm run verify:production
```

### Production Deployment

```bash
# 1. Tag the release
git tag -a v3.2.0 -m "7 issue fixes + 5 enhancements"
git push origin v3.2.0

# 2. Deploy to production
vercel --prod

# OR for Docker:
docker push benefits-ai-chatbot:3.2.0

# 3. Update production environment variables
# Ensure USE_RAG_ROUTER=true is set in production
```

### Post-Deployment Monitoring

**First 24 Hours:**
- [ ] Monitor error logs for any RAG router failures
- [ ] Check average response latency (<500ms target)
- [ ] Verify chunk validation is working (check logs)
- [ ] Monitor escalation rates (<5% target)

**First Week:**
- [ ] Track satisfaction ratings (>4.0 target)
- [ ] Monitor feature usage trends
- [ ] Review analytics for issue fix effectiveness
- [ ] Check for any geographic inconsistency reports

---

## 🔧 Troubleshooting

### Issue: RAG Router Not Working

**Symptoms:** Responses don't cite sources, validation not happening

**Solution:**
```bash
# 1. Check environment variable
echo $USE_RAG_ROUTER  # Should output: true

# 2. Check logs for RAG initialization
grep "RAG" logs/app.log

# 3. Verify Azure Search credentials
echo $AZURE_SEARCH_ENDPOINT
echo $AZURE_SEARCH_ADMIN_KEY
```

### Issue: High Latency

**Symptoms:** Responses taking >1000ms

**Solution:**
```bash
# 1. Check RAG router latency in logs
grep "latencyMs" logs/app.log | awk '{sum+=$NF; count++} END {print sum/count}'

# 2. If too high, temporarily disable RAG
USE_RAG_ROUTER=false
USE_SMART_ROUTER=true

# 3. Or reduce RAG retrieval count
# Edit lib/rag/hybrid-retrieval.ts, reduce vectorK and bm25K
```

### Issue: Context Extraction Not Working

**Symptoms:** Cost projections use default values

**Solution:**
```bash
# 1. Check conversation history is being passed
# Look for this in logs:
"Storing conversation history for context extraction"

# 2. Verify pattern matching
# Test with explicit phrases:
# "Family4+" → should extract "Employee + Family"
# "moderate usage" → should extract "moderate"
```

### Issue: Analytics Not Tracking

**Symptoms:** No analytics events in logs

**Solution:**
```bash
# 1. Check analytics import in chat route
grep "trackEnhancedChatResponse" app/api/chat/route.ts

# 2. Verify logger configuration
# Analytics uses logger.info(), ensure log level allows it
echo $LOG_LEVEL  # Should be: info or debug
```

---

## 📈 Success Metrics

### Week 1 Targets

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Response Latency | - | <500ms | Analytics logs |
| Satisfaction Rating | - | >4.0 | User ratings |
| Escalation Rate | - | <5% | Escalation events |
| Hallucination Reports | High | -50% | Support tickets |
| Geographic Errors | Frequent | -90% | User reports |

### Month 1 Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| User Retention | +20% | Analytics dashboard |
| Feature Adoption | >60% | Feature usage events |
| Cost Projection Accuracy | >85% | User feedback |
| Maternity Comparison Satisfaction | >4.5 | Ratings |

---

## 🔄 Rollback Plan

If issues occur in production:

### Quick Rollback (5 minutes)

```bash
# 1. Disable RAG router
USE_RAG_ROUTER=false
USE_SMART_ROUTER=true

# 2. Restart application
npm run build && npm start

# 3. Or revert Vercel deployment
vercel rollback
```

### Full Rollback (15 minutes)

```bash
# 1. Revert to previous git tag
git checkout v3.1.0

# 2. Rebuild and redeploy
npm ci && npm run build
npm start

# 3. Or deploy previous Docker image
docker pull benefits-ai-chatbot:3.1.0
docker stop benefits-ai-chatbot
docker run benefits-ai-chatbot:3.1.0
```

---

## 📞 Support

### During Deployment

If you encounter issues:

1. **Check logs first:**
   ```bash
   tail -f logs/app.log
   ```

2. **Verify environment variables:**
   ```bash
   env | grep USE_RAG
   env | grep AZURE
   ```

3. **Run diagnostic tests:**
   ```bash
   npm run verify
   ```

4. **Check Azure services:**
   - Azure OpenAI: Status dashboard
   - Azure Search: Index health
   - Cosmos DB: Connection status

---

## 📝 Deployment Sign-Off

### Staging Deployment

- [ ] Environment variables set
- [ ] Code deployed successfully
- [ ] All 9 manual tests passed
- [ ] Analytics events visible
- [ ] No critical errors in logs

**Signed by:** _______________  
**Date:** _______________

### Production Deployment

- [ ] Staging validation complete
- [ ] Type check passed
- [ ] Lint passed
- [ ] Tests passed
- [ ] Build successful
- [ ] Production deployment complete
- [ ] Post-deployment monitoring active

**Signed by:** _______________  
**Date:** _______________

---

## 🎉 Post-Deployment

After successful deployment:

1. **Update documentation:**
   - README.md with new features
   - CHANGELOG.md with version 3.2.0 notes
   - User guide with new capabilities

2. **Notify stakeholders:**
   - Product team about new features
   - Support team about issue fixes
   - Customers about improvements

3. **Celebrate!** 🎊
   - 7 critical issues fixed
   - 5 enhancements delivered
   - Improved user experience
   - Better analytics and monitoring

---

**Good luck with your deployment!** 🚀
