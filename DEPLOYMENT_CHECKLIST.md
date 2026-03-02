# 🚀 Deployment Checklist - Benefits AI Chatbot v3.2.0

## ✅ Pre-Deployment Verification

### 1. Environment Variables in Vercel

Add these **NEW** variables to your Vercel project:

```bash
# Go to: Vercel Dashboard → Project → Settings → Environment Variables

# Router Configuration (NEW)
USE_RAG_ROUTER=true
USE_SMART_ROUTER=false
SMART_ROUTER_MODEL=gpt-4o-mini
OPENAI_API_KEY=your-openai-key

# Ensure these existing variables are set:
AZURE_OPENAI_ENDPOINT=...
AZURE_OPENAI_API_KEY=...
AZURE_COSMOS_ENDPOINT=...
AZURE_COSMOS_KEY=...
AZURE_SEARCH_ENDPOINT=...
AZURE_SEARCH_ADMIN_KEY=...
ENROLLMENT_URL=...
```

**Scopes:**
- Production: ✅ All variables
- Preview/Staging: ✅ All variables (for testing)

---

## 🧪 Step 1: Local Testing (Optional)

If you want to test locally before deploying:

```bash
# Create a minimal .env.local (secrets from Vercel)
cat > .env.local << EOF
USE_RAG_ROUTER=true
USE_SMART_ROUTER=false
SMART_ROUTER_MODEL=gpt-4o-mini
# Copy other variables from Vercel dashboard
EOF

# Run development server
npm run dev
```

**Test the 7 fixes manually:**

| # | Test Question | Expected Result |
|---|---------------|-----------------|
| 1 | "What are the plan costs?" | `$86.84/month ($1,042.08/year)` - consistent 2 decimals |
| 2 | "What medical plans are available?" | Only medical plans (no accident/life insurance) |
| 3 | "I want to enroll in all benefits, how much per paycheck?" | Shows total: medical + dental + vision breakdown |
| 4 | "Help me calculate healthcare costs for next year. Family4+, moderate usage." | Cost projection with usage assumptions |
| 5 | "I'm planning to have a baby. Which plan is better for maternity?" | Detailed maternity comparison with OOP, premiums |
| 6 | (Set state to Texas) "What plans are available?" | No mentions of Indiana or other states |
| 7 | "Does the dental plan cover orthodontics?" | Consistent answer grounded in documents |

---

## 🚀 Step 2: Deploy to Vercel

### Option A: Git Push Deployment (Recommended)

```bash
# 1. Commit all changes
git add .
git commit -m "feat: Fix 7 critical issues + add RAG routing, context extraction, analytics

- Issue #1: Standardize premium display formatting
- Issue #2: Add category filtering to prevent wrong benefit types
- Issue #3: Implement all benefits cost calculation
- Issue #4: Enable cost projection for usage-based modeling
- Issue #5: Enhance maternity comparison with plan details
- Issue #6: Enforce state consistency in responses
- Issue #7: Add chunk validation to prevent hallucinations
- Enhancement #8: RAG-enhanced routing with validation
- Enhancement #9: Context extraction for cost modeling
- Enhancement #10-11: Unit + integration tests
- Enhancement #12: Analytics tracking system"

# 2. Push to trigger Vercel deployment
git push origin main
```

### Option B: Vercel CLI Deployment

```bash
# Install Vercel CLI (if not already installed)
npm i -g vercel

# Login
vercel login

# Deploy to preview
vercel

# Deploy to production
vercel --prod
```

---

## ⚙️ Step 3: Configure Vercel Environment Variables

**Via Vercel Dashboard:**

1. Go to: `https://vercel.com/dashboard`
2. Select your project
3. Click **Settings** → **Environment Variables**
4. Add these **NEW** variables:

| Variable | Value | Environments |
|----------|-------|--------------|
| `USE_RAG_ROUTER` | `true` | Production, Preview |
| `USE_SMART_ROUTER` | `false` | Production, Preview |
| `SMART_ROUTER_MODEL` | `gpt-4o-mini` | Production, Preview |
| `OPENAI_API_KEY` | `your-key` | Production, Preview |

5. Click **Save**

**Via Vercel CLI:**

```bash
vercel env add USE_RAG_ROUTER true production preview
vercel env add USE_SMART_ROUTER false production preview
vercel env add SMART_ROUTER_MODEL gpt-4o-mini production preview
vercel env add OPENAI_API_KEY your-key production preview
```

---

## 🧪 Step 4: Post-Deployment Testing

### Automated Tests

```bash
# Run unit tests for new handlers
npm test -- tests/unit/simple-chat-router.test.ts

# Run integration tests for all 7 fixes
npm test -- tests/integration/issue-fixes.test.ts
```

### Manual Testing in Production

Visit your production URL and test:

1. **Premium Display (Issue #1)**
   ```
   User: "What are the plan costs?"
   ✅ Expected: "$86.84/month ($1,042.08/year)" - always 2 decimals
   ❌ Before: "$87/month" or "$1,042.08 annually" - inconsistent
   ```

2. **Category Filtering (Issue #2)**
   ```
   User: "What medical plans are available?"
   ✅ Expected: Only medical plans (BCBSTX, Kaiser)
   ❌ Before: Sometimes showed Accident Insurance
   ```

3. **All Benefits Calculation (Issue #3)**
   ```
   User: "I want to enroll in all benefits. How much per paycheck?"
   ✅ Expected: Breakdown + total cost calculation
   ❌ Before: Redirected to Workday without calculating
   ```

4. **Cost Projection (Issue #4)**
   ```
   User: "Help me calculate healthcare costs for next year. Family4+, moderate usage, Kaiser."
   ✅ Expected: Cost projection with usage assumptions
   ❌ Before: Redirected to enrollment portal
   ```

5. **Maternity Comparison (Issue #5)**
   ```
   User: "I'm planning to have a baby. Which plan is better?"
   ✅ Expected: Detailed comparison with OOP, premiums, recommendations
   ❌ Before: Generic PPO recommendation only
   ```

6. **Geographic Consistency (Issue #6)**
   ```
   1. Set state to Texas in onboarding
   2. Ask: "What plans are available?"
   ✅ Expected: Only Texas-relevant information
   ❌ Before: Mentioned Indiana
   ```

7. **Orthodontics Validation (Issue #7)**
   ```
   User: "Does the dental plan cover orthodontics?"
   ✅ Expected: Consistent answer based on retrieved documents
   ❌ Before: Inconsistent answers
   ```

---

## 📊 Step 5: Monitor Analytics

### Check Deployment Logs

```bash
# In Vercel Dashboard: Project → Activity → Deployment

# Look for successful build:
✅ Build completed
✅ Deployment ready
```

### Monitor Runtime Logs

```bash
# In Vercel Dashboard: Project → Functions → Logs

# Look for these log messages:
"Chat response tracked" - Analytics working
"RAG chat response generated" - RAG router active
"Issue fixes applied" - Fixes being used
```

### Analytics Events to Track

| Event | What to Look For | Success Metric |
|-------|------------------|----------------|
| `chat_response` | Model usage, latency | <500ms avg |
| `satisfaction_rating` | User ratings | >4.0 average |
| `escalation` | Human help requests | <5% rate |
| `feature_usage` | Feature adoption | Increasing |

---

## ✅ Step 6: Verification Checklist

### Code Quality

- [ ] `npm run typecheck` passes ✅
- [ ] `npm run lint` passes ✅
- [ ] `npm run build` succeeds

### Functionality

- [ ] All 7 manual tests pass
- [ ] RAG router enabled (`USE_RAG_ROUTER=true`)
- [ ] Analytics tracking active
- [ ] No console errors in browser

### Performance

- [ ] Response latency <500ms
- [ ] No memory leaks
- [ ] Azure Search queries successful

### Documentation

- [ ] `FIX_SUMMARY.md` reviewed
- [ ] `OPTION4_ENHANCEMENTS_SUMMARY.md` reviewed
- [ ] `DEPLOYMENT_GUIDE.md` reviewed

---

## 🔄 Rollback Plan

If issues occur in production:

### Quick Rollback (5 minutes)

**Via Vercel Dashboard:**
1. Go to: Project → Deployments
2. Find previous successful deployment
3. Click **⋯** → **Promote to Production**

**Via Vercel CLI:**
```bash
vercel rollback
```

**Disable RAG Router (if needed):**
```bash
# In Vercel: Settings → Environment Variables
USE_RAG_ROUTER=false
USE_SMART_ROUTER=true

# Redeploy
vercel --prod
```

---

## 📈 Success Metrics (Week 1)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Response Latency | <500ms | Vercel Analytics |
| Satisfaction Rating | >4.0 | User ratings |
| Escalation Rate | <5% | Escalation events |
| Hallucination Reports | -50% | Support tickets |
| Geographic Errors | -90% | User reports |

---

## 🎉 Post-Deployment

After successful deployment:

1. **Update Stakeholders**
   - Product team: New features available
   - Support team: Issue fixes deployed
   - Customers: Improved experience

2. **Monitor for 24-48 Hours**
   - Watch Vercel logs
   - Check analytics dashboard
   - Review user feedback

3. **Celebrate!** 🎊
   - 7 critical issues fixed
   - 5 enhancements delivered
   - Improved user experience

---

## 📞 Support

**Documentation:**
- `FIX_SUMMARY.md` - Details on 7 fixes
- `OPTION4_ENHANCEMENTS_SUMMARY.md` - Enhancement details
- `DEPLOYMENT_GUIDE.md` - Full deployment guide

**Vercel Resources:**
- [Vercel Docs](https://vercel.com/docs)
- [Environment Variables](https://vercel.com/docs/environment-variables)
- [Deployment Logs](https://vercel.com/docs/deployments/logs)

**Azure Resources:**
- Check Azure OpenAI status
- Verify Azure Search index health
- Monitor Cosmos DB connections

---

**Ready to deploy!** 🚀

Next steps:
1. Add environment variables to Vercel
2. Push code to trigger deployment
3. Test the 7 fixes in production
4. Monitor analytics

Need help? Check the logs or reach out to the team!
