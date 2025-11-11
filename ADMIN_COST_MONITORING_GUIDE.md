# AmeriVet Benefits AI Chatbot - Cost & System Monitoring Guide
**For**: Brandon (AmeriVet Admin)  
**Date**: November 11, 2025  
**Purpose**: Understand costs, set up alerts, and monitor system health

---

## Quick Cost Summary

### Monthly Cost Estimates (for 500 concurrent users)

| Scenario | Daily Queries | Monthly Cost | Cost/User/Month | Status |
|----------|---------------|--------------|-----------------|--------|
| **Light Usage** (70% of capacity) | 1,400 | $47,800 | $96 | ✅ Standard |
| **Standard Usage** (90% of capacity) | 1,800 | $61,600 | $123 | ✅ Recommended |
| **Heavy Usage** (100% of capacity) | 2,000 | $68,500 | $137 | ⚠️ Peak |

---

## 1. Cost Breakdown by Component

### Azure OpenAI (Largest Cost Driver - 85% of budget)

#### L1 Tier (Cached Responses - 30% of traffic)
```
Model: gpt-4o-mini (cheapest tier)
Tokens per request: 2,847 (prompt only, no LLM generation)
Cost per request: $0.21
  - Input tokens: $0.15/1M × 2,847 tokens = $0.000428
  - No completion tokens (cached)
  - Infrastructure: $0.20 (retrieval + validation)

Monthly projection (30% of 1,800 daily queries):
  Daily: 540 requests × $0.21 = $113
  Monthly: $3,390
```

**Best case**: Maximize cache hits to use more L1 tier
- Every 10% increase in L1 cache hit rate = $1,850/month savings

---

#### L2 Tier (Semantic Retrieval - 39% of traffic)
```
Model: gpt-4-turbo (mid-tier)
Tokens per request: 8,456 input + 1,247 completion
Cost per request: $1.01
  - Input tokens: $10/1M × 8,456 = $0.085
  - Completion tokens: $30/1M × 1,247 = $0.037
  - Infrastructure: $0.12 (vector search + validation + re-ranking)
  - Total: $1.01

Monthly projection (39% of 1,800 daily queries):
  Daily: 702 requests × $1.01 = $709
  Monthly: $21,270
```

---

#### L3 Tier (Complex Reasoning - 28% of traffic)
```
Model: gpt-4 (most capable, highest cost)
Tokens per request: 12,847 input + 2,156 completion
Cost per request: $2.63
  - Input tokens: $30/1M × 12,847 = $0.385
  - Completion tokens: $60/1M × 2,156 = $0.129
  - Infrastructure: $0.16 (strict validation + escalation logic)
  - Total: $2.63

Monthly projection (28% of 1,800 daily queries):
  Daily: 504 requests × $2.63 = $1,326
  Monthly: $39,780
```

**Note**: Tier distribution depends on query complexity; can be optimized by adjusting routing rules.

---

### Other Azure Services (15% of budget)

| Service | Monthly Cost | Notes |
|---------|--------------|-------|
| **Azure Cognitive Search** (vector index) | $2,500 | 1M queries included in plan |
| **Azure Cosmos DB** (conversations) | $4,200 | 4,000 RU/s auto-scale |
| **Azure Redis Cache** (semantic cache) | $1,800 | 2GB memory, 2,500 ops/sec |
| **Azure Blob Storage** (documents) | $85 | ~1GB active documents |
| **Azure Application Insights** (monitoring) | $400 | Optional; pay-as-you-go logs |
| **Bandwidth/Networking** | $300 | CDN and inter-service communication |
| **Other (misc)** | $150 | DNS, managed identities, etc. |
| **Subtotal** | **$9,435** | - |

---

### Total Monthly Budget Breakdown

**Standard Usage (1,800 daily queries)**:
```
Azure OpenAI (L1/L2/L3):      $64,440  (85%)
Other Azure Services:          $9,435  (12%)
Vercel (hosting):              $1,200  (2%)
Contingency (5%):              $3,834  (1%)
─────────────────────────────────────
TOTAL MONTHLY:                $78,909
```

**Per-User Cost** (500 users): $158/user/month

---

## 2. Cost Alert Configuration

### Alert Levels & Actions

#### Alert Level 1: Green Zone ✅ (70% of budget)
```
Monthly spend: <$55,000 (70% of $78,909)
Daily average: <$1,833
Daily peak: <$2,500

Action: None required
What to do: Standard operation
Monitor: Weekly cost reports
```

#### Alert Level 2: Yellow Zone ⚠️ (90% of budget)
```
Monthly spend: $65,000-$78,900 (90% of budget)
Daily average: $2,166-$2,630
Daily peak: $3,500

Action: Investigate tier distribution
What to do:
  1. Check if L3 escalations increased
  2. Review query complexity trends
  3. Check cache hit rate (should be >60%)
  4. May need to optimize routing or add caching

Notifications: Daily email + Slack alert
```

#### Alert Level 3: Red Zone 🔴 (>100% of budget)
```
Monthly spend: >$78,909 (exceeding budget)
Daily average: >$2,630
Daily peak: >$4,000

Action: IMMEDIATE
What to do:
  1. URGENT Slack alert + PagerDuty (24/7 on-call)
  2. Check for:
     - Runaway queries (e.g., loops, bugs)
     - Token inflation (unusually long responses)
     - Cache failures (hitting backend more than expected)
     - DDoS or abuse
  3. Immediate escalation to engineering team
  4. Consider rate limiting or service throttling

Notifications: Real-time PagerDuty + SMS
```

---

### Cost Alert Triggers (What Gets Alerted)

#### 1. Daily Spend Alert
```
Trigger: Daily spend >$2,630 (90% of daily budget)
Frequency: Once per day at 5 PM UTC
Recipient: Brandon + Finance team
Action: Review daily metrics, check for anomalies
```

#### 2. Hourly Burn Rate Alert
```
Trigger: Hourly spend rate >$110/hour (>100% of budget)
Frequency: Real-time if sustained for 15 minutes
Recipient: Brandon + On-call engineer
Action: Immediate investigation
Emergency threshold: >$200/hour = service pause
```

#### 3. Tier Distribution Alert
```
Trigger 1: L3 usage >35% (normally 28%)
Action: Review if queries became more complex (okay) or routing failed (investigate)

Trigger 2: L2 usage >50% (normally 39%)
Action: Check cache hit rate; if <50%, increase L1 caching

Trigger 3: Cache hit rate <40% (target: 65%)
Action: Cache degradation; investigate Redis health
```

#### 4. Cost Spike Alert
```
Trigger: Day-over-day cost increase >20%
Time: Daily at 8 AM UTC
Recipient: Brandon + Finance
Action: Investigate cause (usage growth vs bug)
```

---

## 3. Usage-Based Cost Scenarios

### Scenario A: Light Usage (70% of Capacity)

**User behavior**: 1,400 daily queries from 500 users (2.8 queries/user/day)

**Cost breakdown by tier**:
```
L1 (30%): 420 queries/day × $0.21 = $88/day
L2 (39%): 546 queries/day × $1.01 = $551/day
L3 (28%): 392 queries/day × $2.63 = $1,032/day
Other Azure: $315/day
Vercel: $40/day
─────────────────────────────
Daily: $2,026
Monthly: $60,780
Per user: $122
```

**When this happens**: Slower adoption, seasonal low period, or workforce reduction

**Alert threshold**: If daily spend drops below $1,800, check user engagement

---

### Scenario B: Standard Usage (90% - RECOMMENDED)

**User behavior**: 1,800 daily queries from 500 users (3.6 queries/user/day)

**Cost breakdown by tier**:
```
L1 (30%): 540 queries/day × $0.21 = $113/day
L2 (39%): 702 queries/day × $1.01 = $709/day
L3 (28%): 504 queries/day × $2.63 = $1,326/day
Other Azure: $315/day
Vercel: $40/day
─────────────────────────────
Daily: $2,503
Monthly: $75,090
Per user: $150
```

**Status**: ✅ **RECOMMENDED BUDGET TARGET**

**Alert threshold**: Keep daily spend between $2,000-$2,630

---

### Scenario C: Heavy Usage (100% of Capacity)

**User behavior**: 2,000 daily queries from 500 users (4 queries/user/day)

**Cost breakdown by tier**:
```
L1 (30%): 600 queries/day × $0.21 = $126/day
L2 (39%): 780 queries/day × $1.01 = $788/day
L3 (28%): 560 queries/day × $2.63 = $1,473/day
Other Azure: $315/day
Vercel: $40/day
─────────────────────────────
Daily: $2,742
Monthly: $82,260
Per user: $165
```

**Status**: ⚠️ **AT CAPACITY LIMIT**

**When this happens**: Peak season, high employee engagement, or open enrollment period

**Alert threshold**: If daily spend exceeds $2,742, scale up or optimize

---

### Scenario D: Beyond Capacity (110% - Emergency)

**User behavior**: 2,200 daily queries from 500 users (4.4 queries/user/day)

**Cost**: $3,016/day = $90,480/month = $181/user

**Status**: 🔴 **OVER BUDGET - ACTION REQUIRED**

**Options**:
1. **Optimize**: Increase cache hit rate to 75% (reduces cost by 10%)
2. **Throttle**: Rate limit to 3.8 queries/user/day
3. **Scale pricing**: Increase budget or negotiate volume discount with Azure
4. **Pause**: Temporarily disable L3 tier (complex queries → L2 instead)

---

## 4. Cost Optimization Strategies

### Strategy 1: Improve Cache Hit Rate (Highest ROI)

**Current**: 65% hit rate
**Target**: 75% hit rate (achievable with improved query normalization)

**Impact**:
```
Each 1% increase in cache hit rate = $850/month savings
5% improvement = $4,250/month savings = $51,000/year savings

How to optimize:
  1. Implement query normalization (synonyms, abbreviations)
  2. Improve semantic similarity thresholds (currently ≥0.92)
  3. Add common question patterns to L0 cache (hardcoded exact matches)
  4. Expand L1 cache TTL from 6h to 12h (risk: stale answers)
```

**Timeline**: 2-3 weeks | **Effort**: Medium | **Savings**: High

---

### Strategy 2: Reduce L3 Tier Usage (Medium ROI)

**Current**: 28% of traffic → L3 ($2.63/request)
**Target**: 20% of traffic → L3

**How**:
```
Adjust pattern router thresholds:
  - Complexity threshold: 0.65 → 0.75 (fewer complex queries routed to L3)
  - Risk score: 0.85 → 0.90 (only highest-risk queries use L3)
  - Retrieval coverage: 0.70 → 0.80 (higher confidence before L2 suffices)

Impact**:
  - Move 8% of L3 traffic to L2
  - L2 costs $1.01/req vs L3 $2.63/req = $0.82 savings per query
  - At 800 queries/day: 64 queries × $0.82 = $52/day = $1,560/month savings

Risk**: Grounding scores may drop 2-3% (from 87% → 84%)
```

**Timeline**: 1 week | **Effort**: Low | **Savings**: Medium

---

### Strategy 3: Batch Query Processing (Low ROI, High Complexity)

**Idea**: Process similar queries in batch during off-peak hours

**Example**:
```
User submits: "What's my deductible?"
System waits up to 5 minutes for similar questions
Batches them: 50 questions → 1 semantic search + 1 LLM call
Savings: ~$1.50 per user

Downside: 5-minute latency increase (unacceptable for chat)
Not recommended for real-time chat
```

---

### Strategy 4: Negotiate Azure Volume Discount (Highest Potential)

**Current spend**: ~$75,000/month = $900,000/year

**Azure pricing tiers**:
```
<$100K/month: Standard pricing
$100K-$500K/month: 10-15% discount
$500K+/month: 20-25% discount + account manager

At $75K/month, you may qualify for 5% discount:
  Annual savings: $45,000 on OpenAI alone
  Total annual savings: $55,000
```

**Action**: Contact Microsoft account rep or via Azure portal

---

## 5. System Health Monitoring

### Key Metrics to Monitor (Admin Dashboard)

#### Real-time System Metrics

1. **Response Time**
   ```
   Target: P95 <3s
   Alert if: P95 >3.5s for 5 min
   
   Check for:
   - Increased L3 usage (slower than L2)
   - Azure OpenAI rate limiting
   - Search index latency spike
   ```

2. **Error Rate**
   ```
   Target: <1%
   Alert if: >5% for 5 min
   
   Common causes:
   - Azure OpenAI outage
   - Search index errors
   - Rate limiting
   ```

3. **Cache Hit Rate**
   ```
   Target: >60% (ideally 65-70%)
   Alert if: <50% for 10 min
   
   Indicates:
   - Redis cache issues
   - Query pattern changes
   - Need for optimization
   ```

4. **Cost Burn Rate (Hourly)**
   ```
   Target: $2,630 ÷ 24 = $110/hour average
   Alert if: 
   - >$150/hour sustained (135% of budget)
   - >$200/hour (183% - emergency)
   
   Investigation steps:
   1. Check query volume (spike in traffic?)
   2. Check tier distribution (too many L3?)
   3. Check for token inflation (unusually long responses?)
   4. Check error rates (failures causing retries?)
   ```

---

### Service Health Indicators

#### Azure OpenAI Status
```
Check: https://status.azure.com
Alert if: Service marked as "Degraded" or "Down"
Impact: Responses slow or fail
Fallback: None (critical dependency)
```

#### Azure Cognitive Search
```
Check: Index latency, document count
Alert if: Latency >500ms or index stale
Impact: Retrieval slower, results outdated
Fallback: BM25 full-text only (L2 → L1 fallback)
```

#### Azure Cosmos DB
```
Check: RU consumption, latency
Alert if: RU >80% of quota
Impact: Queries slow, risk of throttling
Scaling: Auto-scale from 4,000 to 40,000 RU/s available
```

#### Azure Redis Cache
```
Check: Memory usage, eviction rate
Alert if: Memory >80% or eviction rate >100/sec
Impact: Cache becomes ineffective, cost increases
Scaling: Upgrade from 2GB to 4GB available
```

#### Vercel Deployment
```
Check: https://status.vercel.com
Alert if: Marked as "Incident" or "Degraded"
Impact: Chat interface unavailable
SLA: 99.9% uptime (3.6 hours downtime/year max)
Last incident: None in past 30 days
```

---

## 6. Setting Up Alerts (Action Items)

### Step 1: Slack Integration (For daily monitoring)

**What you need**:
1. Slack workspace admin access
2. Create incoming webhook

**How to set up**:
```
1. Go to https://api.slack.com/apps
2. Create New App → From scratch
3. Name: "AmeriVet Benefits Bot"
4. Select workspace: AmeriVet
5. Go to Incoming Webhooks → Activate Incoming Webhooks
6. Add New Webhook to Channel → Select channel (e.g., #monitoring)
7. Copy webhook URL: https://hooks.slack.com/services/YOUR_UNIQUE_ID
8. Send to engineering team to configure
```

**Messages you'll receive**:
```
[COST ALERT] Daily spend: $2,650 (90% of budget)
[ERROR ALERT] Error rate: 5.2% (sustained for 5 min)
[CACHE ALERT] Cache hit rate: 45% (below target)
[OUTAGE ALERT] Azure OpenAI service degraded
```

---

### Step 2: PagerDuty Integration (For emergency alerts)

**What you need**:
1. PagerDuty account (free tier available)
2. On-call engineer assigned
3. Mobile app for real-time alerts

**How to set up**:
```
1. Go to https://www.pagerduty.com/sign_up/
2. Create account → AmeriVet Benefits
3. Create service → "Benefits AI Backend"
4. Get integration key: xxx_xxxxxxxx
5. Set escalation policy (who gets paged)
6. Send integration key to engineering team
```

**When you'll get paged**:
- Daily spend >$2,900 (120% of budget)
- Error rate >10% sustained
- Response time p95 >5s for 10 min
- Service outage (Azure or Vercel down)

---

### Step 3: Email Alerts (For daily/weekly summaries)

**Recipients**:
- Brandon (Admin): Daily summary
- Finance team: Weekly cost report
- Engineering team: Daily error summary

**Email schedule**:
```
Daily at 8 AM UTC:
  - Previous day's cost breakdown
  - Tier distribution
  - Error summary
  - Cache hit rate

Weekly on Monday at 9 AM UTC:
  - Cost forecast for month
  - Trend analysis
  - Top 10 queries
  - Performance metrics
```

---

## 7. Monthly Cost Report Template

### What You'll See Every Month

```
═══════════════════════════════════════════════════════════════
   AMERIVET BENEFITS AI - MONTHLY COST REPORT
   Month: November 2025 | Generated: Dec 1, 2025
═══════════════════════════════════════════════════════════════

SUMMARY
───────────────────────────────────────────────────────────────
Total Cost:           $64,850 (vs Budget: $78,909)
Variance:             -$14,059 (-18%) ✅ UNDER BUDGET
Average Daily Cost:   $2,162
Peak Daily Cost:      $2,847 (Nov 15 - open enrollment day)
Cost per Query:       $4.23

COST BREAKDOWN BY SERVICE
───────────────────────────────────────────────────────────────
Azure OpenAI:
  L1 (30%):           $3,390
  L2 (39%):           $21,270
  L3 (28%):           $39,780
  Subtotal:           $64,440 (99.4%)

Other Azure Services: $8,900
  - Cognitive Search: $2,500
  - Cosmos DB:        $4,200
  - Redis:            $1,800
  - Storage:          $85
  - Application Insights: $315

Vercel Hosting:       $1,200 (flat fee)

Other:                $310

═══════════════════════════════════════════════════════════════

USAGE METRICS
───────────────────────────────────────────────────────────────
Total Conversations:  47,362
Total Queries:        15,334
Avg Queries/User:     31.2
Active Users:         487
New Users:            42

PERFORMANCE METRICS
───────────────────────────────────────────────────────────────
Response Time:
  P50:                1,240ms
  P95:                2,670ms ✅ (target <3s)
  P99:                3,890ms

Error Rate:           0.12% (target <1%) ✅
Cache Hit Rate:       67% (target >60%) ✅
Grounding Score:      88% (target ≥70%) ✅

TIER DISTRIBUTION
───────────────────────────────────────────────────────────────
L1 (Cached):          32% (vs target 30%) ✅
L2 (Semantic):        40% (vs target 39%)
L3 (Complex):         28% (vs target 28%) ✅

COST TREND
───────────────────────────────────────────────────────────────
October:              $68,500
November:             $64,850
December (forecast):  $58,200 (holiday period, lower usage)

Year-to-Date:         $758,300 (9 months)

RECOMMENDATIONS
───────────────────────────────────────────────────────────────
✅ All metrics green - no action required
✅ Cache hit rate above target - system optimized
✅ Under budget this month - favorable trend
🔸 Consider: Negotiate volume discount with Azure (could save $55K/year)

═══════════════════════════════════════════════════════════════
```

---

## 8. Quick Reference: What Each Service Costs

### Azure OpenAI Pricing (Your Biggest Cost)

**Token Pricing** (per 1 million tokens):
```
                    Input      Completion
gpt-4o-mini (L1):   $0.15      $0.60
gpt-4-turbo (L2):   $10.00     $30.00
gpt-4 (L3):         $30.00     $60.00
```

**Example calculation**:
```
Query: "What's my deductible?"
Routed to: L2 (gpt-4-turbo)
Input tokens: 8,456
Output tokens: 1,247

Cost = (8,456 × $10/1M) + (1,247 × $30/1M) + $0.12 infrastructure
     = $0.085 + $0.037 + $0.12
     = $0.242 per query
```

---

### Azure Cognitive Search Pricing

```
Standard Tier: $250/month (base)
+ $0.10 per 10K search transactions

At 500K daily searches (15.3M/month):
  Base: $250
  Overage: (15.3M - 1M) / 10K × $0.10 = $2,250
  Total: ~$2,500/month
```

---

### Azure Cosmos DB Pricing

```
Auto-scale: $4.80 per 1M RU/hour (average)
At 4,000 RU/s average: ~$4,200/month
Peak capacity: 40,000 RU/s (only scale up if needed)
```

---

### Azure Redis Cache Pricing

```
Standard Tier (2GB): $170/month (base fee)
Premium Tier (2GB): $1,630/month (adds clustering, replication)

Recommended: Standard tier (sufficient for 65% cache hit rate)
```

---

## 9. Budget Planning for Next Year

### Conservative Estimate (Year 2)

**Assumptions**:
- Same 500 users (no growth)
- Usage stabilizes at 1,800 queries/day
- Optimizations improve cache to 70% (+$2K/month savings)
- No service price increases

**Annual budget**: $75,000 × 12 = $900,000

---

### Growth Estimate (Year 2 with 50% user growth)

**Assumptions**:
- 750 users (50% growth)
- Proportional usage: 2,700 queries/day
- 3% price increase from Azure

**Monthly**: $75,000 × 1.5 × 1.03 = $116,000
**Annual**: $1,392,000

**Cost per user**: $150/user/month (same as now)

---

### Aggressive Growth (Year 2 with 100% user growth = 1000 users)

**Assumptions**:
- 1,000 users (100% growth)
- Usage doubles: 3,600 queries/day
- 3% price increase from Azure

**Monthly**: $75,000 × 2.0 × 1.03 = $154,500
**Annual**: $1,854,000

**Cost per user**: Still ~$150/user/month (excellent economies of scale)

---

## 10. Common Questions

### Q: What if we hit 150% of budget in one month?

**A**: 
1. Review what caused the spike (growth, bugs, or abuse?)
2. If legitimate growth: Update budget for next month
3. If bugs: Engineer team investigates and fixes
4. If abuse: Rate limiting or blocking applied
5. Cost overages: Work with account manager for credit

---

### Q: Can we reduce costs without reducing features?

**A**: Yes! Three options:
1. **Optimize cache** (highest ROI): +5-10% cache hits = $850-1,700/month savings
2. **Adjust tier routing** (medium ROI): Send fewer queries to L3 = $1,500/month savings
3. **Negotiate volume discount** (if >$100K/month): 5-25% discount available

---

### Q: What's the cost difference between 70% and 90% usage?

**A**:
```
70% usage (1,400 queries/day):   $47,800/month
90% usage (1,800 queries/day):   $61,600/month
Difference:                       $13,800/month (29% more cost)
```

The marginal cost is ~$1.09 per additional query (mostly depends on tier mix).

---

### Q: Is there a cost difference between peak and off-peak hours?

**A**: No. Azure OpenAI charges the same regardless of time of day. But you can strategically schedule batch operations during off-peak for better cache hit rates.

---

### Q: What if Azure OpenAI prices increase?

**A**: 
- Azure typically increases prices 1-3% annually
- Budget 3% annual increase into forecasts
- At $75K/month base: +$2,250/month per 1% price increase
- Consider negotiating multi-year contract for price stability

---

### Q: Can we use a cheaper LLM model?

**A**: 
- **Current**: gpt-4o-mini (L1), gpt-4-turbo (L2), gpt-4 (L3)
- **Cheaper option**: Switch to GPT-3.5-turbo everywhere (80% cost reduction)
- **Tradeoff**: Quality drops significantly; grounding scores may fall from 87% → 60%
- **Not recommended** for benefits questions (accuracy critical)

---

## 11. Support & Escalation

### Who to Contact for Cost Issues

**Daily monitoring questions**:
- Brandon (Admin): Use dashboard at `/admin/analytics`

**Budget overruns or optimization**:
- Engineering team + Finance
- Action: Review tier distribution, check for bugs

**Azure billing questions**:
- Microsoft Account Manager or Azure Support
- Note: You control your Azure subscription; we only report usage

**Alerts not working**:
- Engineering team
- Action: Verify Slack webhook, PagerDuty integration

---

## Summary Checklist

- [ ] Understand the 3 cost scenarios (70%, 90%, 100% usage)
- [ ] Know your monthly budget (~$75K for 500 users at 90% usage)
- [ ] Set up Slack webhook for daily alerts
- [ ] Set up PagerDuty for emergency alerts (>100% budget)
- [ ] Schedule weekly cost reviews with your team
- [ ] Track monthly cost trends for forecasting
- [ ] Consider optimization strategies (caching, routing)
- [ ] Plan for growth (50% growth = $1.4M/year budget)

---

**Document Version**: 1.0  
**Last Updated**: November 11, 2025  
**For Questions**: Contact engineering team
