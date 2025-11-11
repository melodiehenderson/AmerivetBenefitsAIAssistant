# AmeriVet Benefits AI - System Monitoring & Admin Dashboard Guide
**For**: Brandon (AmeriVet Admin)  
**Access**: https://amerivetaibot.bcgenrolls.com/admin/analytics  
**Role Required**: COMPANY_ADMIN or SUPER_ADMIN

---

## Dashboard Overview

The Admin Analytics Dashboard provides real-time visibility into system health, usage, and costs.

### URL Path
```
https://amerivetaibot.bcgenrolls.com/admin/analytics
```

---

## 1. Dashboard Sections (Left to Right)

### Section A: Real-Time Status Cards

**What you see**: Top row of metric cards

#### Card 1: Total Conversations (Today)
```
Display: Large number (e.g., "247")
Trend: Green up arrow if higher than yesterday
Action: Monitor daily; <50 = low engagement, >500 = high load
Alert threshold: >600 = unusual spike, investigate query quality
```

#### Card 2: Active Users (Last 24h)
```
Display: Number of unique users who asked a question
Example: "89 active users"
Trend: Week-over-week comparison
Good range: 80-200 active users (out of 500 total)
Insight: If <50, may indicate low adoption or technical issues
```

#### Card 3: Average Response Time
```
Display: Milliseconds (e.g., "1,847ms")
Target: <2,000ms (2 seconds)
Color coding:
  - Green: <1,500ms ✅
  - Yellow: 1,500-2,500ms ⚠️
  - Red: >2,500ms 🔴
Action if red: Check Azure OpenAI status or search index performance
```

#### Card 4: Error Rate
```
Display: Percentage (e.g., "0.12%")
Target: <1% (ideally <0.5%)
Color coding:
  - Green: <0.5% ✅
  - Yellow: 0.5-1% ⚠️
  - Red: >1% 🔴
Causes if high:
  - Azure OpenAI rate limiting
  - Search index outage
  - Cosmos DB throttling
  - User input validation failures
```

#### Card 5: Cache Hit Rate
```
Display: Percentage (e.g., "67%")
Target: >60% (ideally 65-70%)
What it means: % of queries served from cache (no LLM call)
Color coding:
  - Green: >65% ✅
  - Yellow: 50-65% ⚠️
  - Red: <50% 🔴
If red: 
  - Redis cache may be full or unhealthy
  - Query patterns changed (less repetition)
  - Cache TTL may be too short
Action: Review cache configuration or increase Redis memory
```

#### Card 6: Today's Cost
```
Display: Dollar amount (e.g., "$2,156")
Daily budget: ~$2,630
Color coding:
  - Green: <$2,000 ✅
  - Yellow: $2,000-$2,500 ⚠️
  - Red: >$2,500 🔴
If yellow/red:
  - Check which tier is consuming more (L1/L2/L3)
  - Review query complexity distribution
  - May indicate more complex questions (normal)
```

---

### Section B: Tier Distribution (Pie Chart)

**What you see**: Pie chart showing L1/L2/L3 breakdown

#### Healthy Distribution
```
L1 (Cached): 30% ✅
L2 (Semantic): 39% ✅
L3 (Complex): 28% ✅
```

#### Unhealthy Signs
```
If L1 < 25%: Cache not working well or queries too varied
If L2 > 50%: Too many queries failing cache, needing retrieval
If L3 > 35%: Unusually complex questions (may spike cost)
```

**Action**: 
- Click on pie chart segment to filter by tier
- Review top queries for that tier
- Adjust routing thresholds if needed (engineering team)

---

### Section C: Cost Breakdown (Stacked Bar Chart)

**What you see**: Daily cost by tier (last 7 days)

#### How to read it
```
Blue (L1):     Cached responses ($0.21 each)
Orange (L2):   Semantic retrieval ($1.01 each)
Red (L3):      Complex reasoning ($2.63 each)
```

#### Healthy trend
```
Previous days: Consistent stacked bars
Today: Same pattern or slight increase (proportional to volume)
```

#### Alarm patterns
```
🔴 Sudden spike in red (L3): 
   - Query complexity spiked
   - Routing logic may have changed
   - Action: Review recent queries, check Azure OpenAI status

🔴 All bars increase equally:
   - Traffic increased (may be normal)
   - OR cost inflation from price changes
   - Action: Compare daily query volume vs cost

🟡 Red bar dominates (>40%):
   - Too many complex queries
   - May need routing optimization
   - Action: Review top 10 queries
```

---

### Section D: Top Questions (Table)

**What you see**: List of most frequently asked questions

#### Example
```
1. "What is my medical deductible?" - 487 times
2. "How much does dental cost?" - 312 times
3. "Can I add my spouse mid-year?" - 267 times
...
```

#### What to look for
```
✅ Questions are benefit-related (expected)
✅ Questions diverse (good engagement)
❌ One question repeated >1,000 times (may indicate UI bug)
❌ Questions appear broken/garbled (encoding issue)
❌ Questions contain PII like SSN (data leak risk)
```

#### Action items
```
- Repetitive question? Check if system is prompting correctly
- Irrelevant question? May indicate users confused about interface
- Technical question? May indicate feature request
```

**Click to expand**: See sample response for each top question

---

### Section E: Activity Log (Real-Time Stream)

**What you see**: Last 10 activities with timestamps

#### Example Log
```
10 minutes ago: John Doe asked "What's my HSA contribution limit?"
15 minutes ago: Jane Smith rated response 5/5 ⭐
22 minutes ago: Mike Johnson viewed analytics dashboard
28 minutes ago: Sarah Lee exported monthly report
```

#### Activity Types
```
- "asked": User submitted a question
- "rated": User gave feedback (1-5 stars)
- "viewed": User accessed a page
- "exported": User downloaded a report
- "updated": Admin changed settings
```

#### Monitoring tips
```
✅ Activity log updating in real-time = system is healthy
⚠️ Stale activity (hours old) = no recent users (low engagement or outage?)
🔴 Activity log not updating = system may be down
```

---

## 2. Alerts & Warnings (What to Watch For)

### Alert Banner (Top of Dashboard)

If any of these appear, investigate:

#### 🟡 Yellow Warning
```
"Response time spike detected (p95 >3s)"
→ Check Azure OpenAI quota, search index latency
```

#### 🟡 Yellow Warning
```
"Cache hit rate below target (45%)"
→ Check Redis health, review cache configuration
```

#### 🟡 Yellow Warning
```
"Daily cost trending above budget"
→ Review tier distribution, check for anomalies
```

#### 🔴 Red Alert
```
"Error rate exceeding threshold (5%)"
→ URGENT: Check Azure service status, investigate errors
```

#### 🔴 Red Alert
```
"Daily cost >$3,000 (over 120% of budget)"
→ URGENT: Investigate cause, consider rate limiting
```

---

## 3. Filtering & Drilling Down

### Filter by Date Range
```
Click: "Last 7 days" dropdown
Options:
  - Today
  - Last 7 days (default)
  - Last 30 days
  - Last 90 days
  - Custom date range

Impact: All cards and charts update to show selected range
```

### Filter by Tier
```
Click: Pie chart segment (L1, L2, or L3)
Effect:
  - Top questions filtered to that tier
  - Cost breakdown shows only selected tier
  - Activity log shows that tier's activities
```

### Export Data
```
Button: "Export Report"
Formats:
  - CSV (for Excel analysis)
  - PDF (for sharing with stakeholders)
  - JSON (for integration with other tools)

Contents: All metrics, top questions, activity summary
```

---

## 4. Daily Monitoring Checklist

### Every Morning (8 AM UTC)
- [ ] Check yesterday's total cost (should be ~$2,600 ± 20%)
- [ ] Review error rate (should be <1%)
- [ ] Verify cache hit rate (should be >60%)
- [ ] Scan top questions (should be relevant to benefits)
- [ ] Confirm activity log has recent activities

### Weekly (Monday 9 AM UTC)
- [ ] Review 7-day cost trend (should be stable ± 10%)
- [ ] Check tier distribution (L1: 30%, L2: 39%, L3: 28%)
- [ ] Review top 10 questions (any patterns or concerns?)
- [ ] Check user engagement (active users trend)
- [ ] Download weekly cost report

### Monthly (1st of month)
- [ ] Generate monthly report
- [ ] Compare to previous month (cost, usage, performance)
- [ ] Review top queries (any seasonality?)
- [ ] Plan for next month's budget
- [ ] Check for any system alerts or incidents

---

## 5. Interpreting Metrics

### Response Time Breakdown

**Where does latency come from?**

```
Typical response: 2,000ms total
├─ Cache lookup: 5ms (if L0 hit)
├─ Semantic search: 42ms (for L1 cache check)
├─ Vector search: 156ms (AI Search vector index)
├─ BM25 search: 247ms (full-text search)
├─ RRF merge: 45ms (combining results)
├─ LLM generation: 1,500ms (GPT-4-turbo for L2)
├─ Validation: 150ms (grounding check, PII redaction)
└─ Network round-trip: 50ms
```

**If response time is high (>3s)**:
1. Check which component is slow (usually LLM generation)
2. If LLM slow: Check Azure OpenAI quota/throttling
3. If search slow: Check Search index health
4. If validation slow: Check if PII redaction is working correctly

---

### Grounding Score Explained

**What it means**: % of response that is backed by actual benefits documents

**Example**:
```
User Q: "What's my deductible?"
Response: "Your medical deductible is $1,500 for individual coverage. 
          For family coverage, it's $3,000."

Grounding:
  - "$1,500 for individual" - Found in document ✅ 100%
  - "$3,000 for family" - Found in document ✅ 100%
  - Confidence: 100% grounded
```

**Score ranges**:
```
90-100%: Excellent (fully sourced) ✅
70-90%:  Good (mostly sourced with minor inference)
50-70%:  Fair (significant inference, some risk)
<50%:    Poor (mostly hallucination, escalate)
```

**If grounding is low (<70%)**:
- Response escalated to L3 (human review capability)
- Or response generation retried with more context
- May indicate insufficient documents for query

---

### Cache Hit Rate Importance

**Why it matters**:

```
With caching (65% hit rate):
  100 queries/hour
  65 from cache (5ms response) = $0/cost
  35 new (requires LLM) = Cost for 35
  Average: $0.29/query

Without caching (0% hit rate):
  100 queries/hour
  100 new (all require LLM)
  Average: $1.01/query per 35 new queries
  
Difference: 65% cache hit saves ~$0.72/query
At 1,800 queries/day = $1,296/day savings = $38,880/month savings
```

**If cache hit rate drops**:
1. Check Redis memory usage (may be evicting old entries)
2. Review query patterns (users asking new questions instead of repeats)
3. Check if cache TTL is too short (may be expiring too quickly)
4. Review cache key strategy (may need better normalization)

---

## 6. When to Escalate

### Escalate to Engineering if:

```
🔴 Error rate >5% sustained
   Contact: Engineering on-call team
   Urgency: ASAP (30 minutes)
   
🔴 Response time p95 >5s sustained
   Contact: Engineering
   Urgency: 1 hour
   
🔴 Daily cost >$3,000 (over budget)
   Contact: Engineering + Finance
   Urgency: Immediate (5 minutes)
   
🟡 Cache hit rate <40%
   Contact: Engineering
   Urgency: Business hours (by EOD)
   
🟡 Grounding score <70% average
   Contact: Engineering
   Urgency: Business hours (by EOD)
   
🟡 Search index appears stale (old documents)
   Contact: Engineering
   Urgency: Business hours
```

### What Info to Provide

```
- Exact metric value (e.g., "error rate is 8.2%")
- Time window (e.g., "last 2 hours")
- When it started (e.g., "since 3 PM UTC")
- Recent changes (e.g., "new document batch uploaded")
- Affected users (e.g., "all users" vs "specific department")
```

---

## 7. Common Issues & Solutions

### Issue: Cost spiked to $3,500 today

**Possible causes**:
1. High user engagement (open enrollment day?) = normal
2. More complex questions routed to L3 = investigate
3. Bug causing infinite retries = urgent fix needed
4. DDoS or abuse = rate limiting needed

**How to diagnose**:
1. Check activity log: Is volume normal?
2. Check tier distribution: Is L3 unusually high?
3. Check error rate: Are there many retries?
4. Check top questions: Are they normal?

**Action**:
- If volume up: Update budget, no action needed
- If L3 up: Review recent queries, check routing logic
- If errors up: Investigate and fix bugs
- If suspicious: Enable rate limiting or IP blocking

---

### Issue: Response time slowly increasing over time

**Possible causes**:
1. More users = expected gradual increase
2. Search index growing = slower vector similarity search
3. Cache hit rate declining = more LLM calls
4. Azure service degradation = not in control

**How to diagnose**:
1. Check user count trend: Is it growing?
2. Check cache hit rate: Is it declining?
3. Check document count in index: Is it increasing?
4. Check Azure OpenAI status page: Any incidents?

**Action**:
- If due to growth: Expected; scale resources if needed
- If cache declining: Investigate cache health
- If index growing: Optimize search index performance
- If Azure degradation: Report to Microsoft

---

### Issue: Cache hit rate dropped from 67% to 42%

**Possible causes**:
1. Redis cache memory full (evicting entries)
2. Query patterns changed (less repetition)
3. Cache TTL too short (entries expiring)
4. New users asking unique questions

**How to diagnose**:
1. Check Redis memory usage: Is it at limit?
2. Check cache eviction rate: High evictions = memory issue
3. Check query patterns: More unique vs repeat questions?

**Action**:
- If memory issue: Scale up Redis memory or clear old entries
- If TTL issue: Increase TTL (but risk stale answers)
- If query patterns changed: May be normal (new content, new users)

---

## 8. Quick Reference: Healthy Metrics

### Green Zone (Everything OK)
```
Response Time p95:     <2,000ms ✅
Error Rate:            <1% ✅
Cache Hit Rate:        >60% ✅
Daily Cost:            $2,000-$2,700 ✅
Grounding Score:       >85% ✅
Active Users:          >50 ✅
```

### Yellow Zone (Monitor Closely)
```
Response Time p95:     2,000-3,000ms ⚠️
Error Rate:            1-3% ⚠️
Cache Hit Rate:        50-60% ⚠️
Daily Cost:            $2,700-$3,000 ⚠️
Grounding Score:       75-85% ⚠️
Active Users:          20-50 ⚠️
```

### Red Zone (Take Action)
```
Response Time p95:     >3,000ms 🔴
Error Rate:            >3% 🔴
Cache Hit Rate:        <50% 🔴
Daily Cost:            >$3,000 🔴
Grounding Score:       <75% 🔴
Active Users:          <20 🔴
```

---

## 9. Accessing the Dashboard

### URL
```
https://amerivetaibot.bcgenrolls.com/admin/analytics
```

### Authentication
```
Email: Your AmeriVet corporate email
Password: Your AmeriVet password (Azure AD)
2FA: If enabled on your account, complete MFA challenge
```

### Permissions
```
Required role: COMPANY_ADMIN or SUPER_ADMIN
If you can't access: Contact IT to verify role assignment
```

### First Time Setup
```
1. Go to URL above
2. Click "Sign in with Azure AD"
3. Use AmeriVet credentials
4. Accept permissions (access to analytics data)
5. Dashboard loads (may take 30 seconds first time)
```

---

## 10. Troubleshooting Dashboard Access

### Issue: "Access Denied" error

**Solution**:
1. Verify you have COMPANY_ADMIN role
2. Clear browser cache (Ctrl+Shift+Delete)
3. Try in incognito window
4. Try different browser
5. Contact IT if issue persists

---

### Issue: Dashboard loads but shows "No data"

**Solution**:
1. Check date range selector (may be filtering to wrong dates)
2. Refresh page (F5)
3. Wait 30 seconds (data may be loading)
4. Check if there have been any conversations today
5. Check application logs for errors

---

### Issue: Metrics look incorrect / outdated

**Solution**:
1. Refresh page (F5)
2. Wait 2-3 minutes (dashboard updates every minute)
3. Clear cache and reload
4. Check if there's a data sync issue

If issues persist:
- Check system status at `/api/health`
- Contact engineering team with screenshot

---

## Summary

**The admin dashboard is your central hub for**:
- ✅ Real-time cost tracking
- ✅ System health monitoring
- ✅ Usage analytics
- ✅ Error detection
- ✅ Performance tracking
- ✅ Decision support (data-driven insights)

**Check it**:
- **Daily** (5 minutes): Morning review
- **Weekly** (15 minutes): Trend analysis
- **Monthly** (30 minutes): Full review + reporting

**Key metrics to watch**:
1. Daily cost (budget tracking)
2. Error rate (system health)
3. Cache hit rate (efficiency)
4. Response time (user experience)
5. Active users (engagement)

---

**Version**: 1.0  
**Last Updated**: November 11, 2025  
**For Support**: Contact engineering team
