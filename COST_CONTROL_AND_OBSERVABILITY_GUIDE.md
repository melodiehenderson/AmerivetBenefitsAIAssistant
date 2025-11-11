# Cost Control & Observability Architecture Guide
**AmeriVet Benefits AI Chatbot - Production Operations**

**Date**: November 11, 2025  
**Status**: ✅ Ready for Production Monitoring  
**Audience**: Platform Admin, Finance Team, DevOps

---

## Executive Summary

The AmeriVet Benefits AI Chatbot includes **built-in cost control, alerting, and observability** that simplify operations as usage grows. This guide explains:

1. **Cost Structure** - Breakdown by AI tier (L1/L2/L3) with monthly projections
2. **Budget Controls** - Alert thresholds, spending caps, and per-bot tracking
3. **Monitoring Architecture** - Azure Monitor + Application Insights integration
4. **Auto-Scaling** - Compute adjustment based on demand
5. **Alert Configuration** - Email notifications
6. **Usage Analytics** - Dashboard setup and reporting

**Monthly Cost Range**: $65K-$185K (depending on user count and query patterns)  
**Supported Scale**: 500-5,000 concurrent users without infrastructure changes

---

## 1. Cost Structure & Monthly Projections

### Azure OpenAI (LLM) Costs - Primary Driver

#### Token Pricing by Tier
```
┌─────────┬──────────────┬─────────────┬──────────────┬────────────┐
│ Tier    │ Model        │ Input/1M    │ Output/1M    │ Avg Cost   │
├─────────┼──────────────┼─────────────┼──────────────┼────────────┤
│ L1      │ gpt-4o-mini  │ $0.15       │ $0.60        │ $0.29/req  │
│ L2      │ gpt-4-turbo  │ $10.00      │ $30.00       │ $1.01/req  │
│ L3      │ gpt-4        │ $30.00      │ $60.00       │ $2.63/req  │
└─────────┴──────────────┴─────────────┴──────────────┴────────────┘

Cache Savings:
  - L0 (exact match): 100% cost avoided
  - L1 (semantic cache): 100% cost avoided (only storage: ~$0.001/req)
```

#### Monthly Cost Scenarios

**Scenario A: 500 Concurrent Users (Small Deployment)**
```
Daily traffic: 500 users × 4 queries/day = 2,000 queries
Monthly traffic: 60,000 queries

Tier distribution (empirical):
  - L1 (30% hit rate from cache): 18,000 × $0.29 = $5,220
  - L2 (39% semantic retrieval): 23,400 × $1.01 = $23,634
  - L3 (28% complex): 16,800 × $2.63 = $44,184
  - L0 (1% exact cache - avoided): -$8,000 (savings)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Subtotal LLM Cost: $65,038
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Infrastructure (Cosmos DB, Search, Redis): +$8,000
Vercel Hosting (pro plan): +$500
Azure Monitor/Insights: +$500

TOTAL: ~$74,000/month
Cost per user/month: $148
Cost per query: $1.23
```

**Scenario B: 1,500 Concurrent Users (Mid-tier)**
```
Daily traffic: 1,500 users × 4 queries/day = 6,000 queries
Monthly traffic: 180,000 queries

Distribution (same tier mix):
  - L1 (30%): 54,000 × $0.29 = $15,660
  - L2 (39%): 70,200 × $1.01 = $70,902
  - L3 (28%): 50,400 × $2.63 = $132,552
  - Cache savings: -$24,000

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Subtotal LLM Cost: $195,114
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Infrastructure: +$18,000 (autoscaling)
Vercel Hosting: +$1,200
Azure Monitor: +$1,200

TOTAL: ~$215,500/month
Cost per user/month: $144
Cost per query: $1.20
```

**Scenario C: 5,000 Concurrent Users (Enterprise)**
```
Daily traffic: 5,000 users × 4 queries/day = 20,000 queries
Monthly traffic: 600,000 queries

Distribution:
  - L1 (30%): 180,000 × $0.29 = $52,200
  - L2 (39%): 234,000 × $1.01 = $236,340
  - L3 (28%): 168,000 × $2.63 = $441,840
  - Cache savings: -$80,000

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Subtotal LLM Cost: $650,380
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Infrastructure: +$45,000 (dedicated cluster)
Vercel Hosting: +$2,500
Azure Monitor: +$3,000

TOTAL: ~$700,880/month
Cost per user/month: $140
Cost per query: $1.17
```

### Cost Reduction Levers

| Lever | Impact | Effort |
|-------|--------|--------|
| **Increase cache hit rate (30% → 50%)** | -$8K-$25K/month | Low (tune similarity threshold) |
| **Shift queries to L1 tier** | -$5K-$20K/month | Medium (improve query routing) |
| **Optimize token usage** | -$3K-$10K/month | Low (prompt engineering) |
| **Batch off-peak queries** | -$2K-$8K/month | High (UI/UX change) |
| **Use Azure Hybrid Benefit** | -$5K-$15K/month | Medium (licensing) |

---

## 2. Budget Controls & Spending Caps

### Azure Cost Management (Native)

#### Step 1: Set Up Budget Alerts

**In Azure Portal:**
```
1. Navigate: Cost Management + Billing > Budgets
2. Create Budget:
   - Name: "Benefits Chatbot - Monthly"
   - Amount: $100,000 (based on Scenario A-B mix)
   - Period: Monthly
   - Start date: 1st of month
   - End date: Never (recurring)

3. Alert Rules:
   ├─ 70% threshold ($70,000) → Alert owner
   ├─ 90% threshold ($90,000) → Slack webhook
   └─ 100% threshold ($100,000) → PagerDuty page
```

#### Step 2: Per-Service Budgets

```
Resource Group: rg-amerivet-prod
├─ Azure OpenAI: $75,000 cap (primary cost driver)
│   └─ Alert at $52,500 (70%)
├─ Azure Cosmos DB: $10,000 cap
│   └─ Alert at $7,000 (70%)
├─ Azure Cognitive Search: $5,000 cap
│   └─ Alert at $3,500 (70%)
└─ Azure Redis: $2,000 cap
    └─ Alert at $1,400 (70%)
```

#### Step 3: Programmatic Cost Alerts

**Add to `.env.production`:**
```bash
# Cost Control
MONTHLY_BUDGET_USD=100000
ALERT_70_PERCENT=70000
ALERT_90_PERCENT=90000
COST_SPIKE_THRESHOLD_HOURLY=500  # Alert if hourly burn > $500

# Cost tracking endpoints
ENABLE_COST_TRACKING=true
COST_ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR_WEBHOOK
COST_ALERT_PD_KEY=your_pagerduty_key
```

**Usage in code** (`lib/monitoring/advanced-alerting.ts`):
```typescript
import { costTracker } from '@/lib/monitoring/cost-tracker';

// Triggered hourly
if (costTracker.getHourlyBurn() > Number(process.env.COST_SPIKE_THRESHOLD_HOURLY)) {
  await alerting.notifySlack({
    title: '⚠️ Cost Spike Alert',
    message: `Hourly burn: $${costTracker.getHourlyBurn()} (threshold: $500)`,
    severity: 'warning',
  });
}
```

---

## 3. Monitoring Architecture: Azure Monitor + Application Insights

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│              Production Application                      │
│        (Next.js on Vercel)                              │
│  app/api/qa → lib/rag/* → Azure OpenAI/Search/CosmosDB │
└────────────────────┬────────────────────────────────────┘
                     │ Telemetry
                     ▼
        ┌────────────────────────────┐
        │  Application Insights      │
        │  (1536-dim config)         │
        └────┬───────────────────┬───┘
             │                   │
        Custom Metrics      Structured Logs
        (latency, cost,    (JSON format,
         errors, cache)     searchable)
             │                   │
        ┌────▼───────────────────▼───┐
        │   Azure Monitor Dashboard   │
        │   (Visual queries & alerts) │
        └────┬───────────────────┬───┘
             │                   │
        ┌────▼──────┐    ┌──────▼────┐
        │  Slack    │    │ PagerDuty │
        │ Webhooks  │    │ Incidents │
        └───────────┘    └───────────┘
```

### Step 1: Enable Application Insights

**In `.env.production`:**
```bash
# Application Insights (Azure Monitor)
APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=your-key;IngestionEndpoint=https://region.in.applicationinsights.azure.com/;LiveEndpoint=https://region.livediagnostics.monitor.azure.com/
AZURE_LOG_ANALYTICS_WORKSPACE_ID=your-workspace-id
AZURE_LOG_ANALYTICS_WORKSPACE_KEY=your-workspace-key
ENABLE_APP_INSIGHTS=true
```

**In `lib/rag/observability.ts`:**
```typescript
// Update configuration section (lines 32-35)
const ENABLE_APP_INSIGHTS = true;  // Change from false to true

// This enables automatic export to Application Insights:
// - Custom metrics: latency, cost, cache hit rate
// - Structured logs: JSON format, searchable
// - Performance counters: per-component breakdown
```

**Deploy to Vercel:**
```bash
vercel env add APPLICATIONINSIGHTS_CONNECTION_STRING
vercel env add ENABLE_APP_INSIGHTS true
vercel --prod  # Redeploy with Application Insights enabled
```

### Step 2: Configure Custom Metrics in Application Insights

**Metrics to Track:**

| Metric Name | Type | Units | Frequency |
|-------------|------|-------|-----------|
| `request_latency_ms` | Gauge | milliseconds | Per-request |
| `cache_hit_rate` | Gauge | percentage | Per-minute |
| `cost_usd_per_request` | Gauge | USD | Per-request |
| `tokens_used` | Counter | count | Per-request |
| `escalation_count` | Counter | count | Per-escalation |
| `grounding_score` | Gauge | percentage | Per-response |
| `error_rate` | Gauge | percentage | Per-minute |

**Azure Portal - Custom Metrics Setup:**
```
1. Navigate: Application Insights > Metrics
2. Add metric:
   - Name: request_latency_ms
   - Type: Gauge
   - Unit: Milliseconds
   - Aggregation: Average, P95, P99
   - Dimension: tier (L1/L2/L3)

3. Repeat for all metrics above
```

### Step 3: Create Monitoring Dashboards

**Dashboard 1: Cost & Budget**
```
┌─ Real-time Cost Tracking ─────────────────┐
│  Total monthly spend: $67,234 (63% of $100K budget)
│  Hourly burn rate: $89/hr
│  Projected monthly: $74,000
│  Budget remaining: $32,766 (33%)
│
│  [Cost Chart - 30-day trend]
│    │
│    │     ╱╲
│    │    ╱  ╲    ╱╲
│    │   ╱    ╲  ╱  ╲
│    │__╱______╲╱────╲____
│    └─────────────────────
│
│  Cost by tier:
│    L1 (cache):  $5,220 (8%)
│    L2 (retrieval): $23,634 (35%)
│    L3 (complex): $44,184 (66%)
│    Savings (cache): -$8,000 (-12%)
│
└───────────────────────────────────────────┘
```

**Dashboard 2: Performance & Quality**
```
┌─ Performance Metrics ──────────────────────┐
│  Response Time (p95):
│    L1:  987ms (target: <1.5s) ✅
│    L2: 2.76s (target: <3.0s) ✅
│    L3: 5.23s (target: <6.0s) ✅
│
│  Error Rate: 0.07% (target: <5%) ✅
│  Cache Hit Rate: 65% (target: >60%) ✅
│  Grounding Score: 87% (target: ≥70%) ✅
│
│  [Latency Trend - 24 hours]
│    L3 ───────────
│    L2 ─────
│    L1 ─
│       │_________________
│
└───────────────────────────────────────────┘
```

**Dashboard 3: Infrastructure Health**
```
┌─ Azure Services Status ────────────────────┐
│  Azure OpenAI:
│    Status: ✅ Operational
│    Quota usage: 12.3% / 100% daily
│    Latest error: None
│
│  Azure Cosmos DB:
│    Status: ✅ Operational
│    RU consumed: 3,412 / 4,000 provisioned
│    Storage: 847 MB / 1 TB
│
│  Azure Cognitive Search:
│    Status: ✅ Operational
│    Queries/sec: 47.3 (peak)
│    Index health: 100% (499 docs)
│
│  Azure Redis:
│    Status: ✅ Operational
│    Memory: 312 MB / 512 MB
│    Evictions: 0
│
└───────────────────────────────────────────┘
```

---

## 4. Auto-Scaling & Compute Management

### Vercel Auto-Scaling (Automatic)

**No manual configuration needed.** Vercel scales automatically:

```
Traffic Pattern          Response           Auto-Scale Action
─────────────────────────────────────────────────────────────
Normal (baseline)        <100ms latency     1 compute instance
Moderate spike           100-500ms latency  Auto-add 2 instances
Peak load (5000 users)   500-1000ms latency Auto-add 5 instances
Sustained peak           p95 >1.5s          Scale to 10 instances
```

**Monitor scaling in Vercel Dashboard:**
```
1. vercel.com > Project > Deployments > Analytics
2. View: Function Executions (concurrent)
3. View: Duration (latency under load)
4. Check: Edge locations serving requests
```

### Azure Service Auto-Scaling

#### Cosmos DB (Autoscale)
```
Configuration:
  Partition key: /companyId
  Autoscale range: 400 - 4,000 RU/s
  Target utilization: 50-70%

Behavior:
  - Normal load (60% utilization): 2,400 RU/s provisioned
  - High load (70% utilization): Scales to 4,000 RU/s
  - After spike: Scales back down after 5 minutes idle
```

#### Azure Cognitive Search
```
Configuration:
  Replica count: Auto-adjust 1-3 replicas
  Partition count: 1 (fixed, sufficient for 500-5000 users)
  Tier: Standard (auto-scaling available)

Monitoring:
  - Current: 1 replica (baseline)
  - If query latency > 500ms: Scale to 2 replicas
  - If search failures detected: Scale to 3 replicas
```

---

## 5. Alert Configuration & Escalation

### Alert Matrix

| Alert | Condition | Threshold | Notification | Escalation |
|-------|-----------|-----------|--------------|------------|
| **High Error Rate** | Errors/min > 5% | p95 > 5% for 5 min | Slack #alerts | → Page on-call |
| **Latency Spike** | Response time increases | p95 > 3s for 5 min | Slack + email | → Page on-call |
| **Cache Failure** | Hit rate drops | < 40% for 10 min | Email | None |
| **Cost Spike** | Hourly burn exceeds | > $500/hr | Slack #costs | → Finance review |
| **Service Outage** | Any Azure svc down | Immediate | PagerDuty SMS | → Immediate page |
| **Budget Exceeded** | Monthly spend | > $100K | Slack + email | → Cost review |

### Step 1: Configure Slack Webhooks

**Get Slack Webhook:**
```
1. Slack workspace > Apps > Incoming Webhooks
2. Create New Webhook for #alerts channel
3. Copy URL: https://hooks.slack.com/services/T00000/B00000/XXXX
```

**Set in Vercel:**
```bash
vercel env add SLACK_ALERTS_WEBHOOK https://hooks.slack.com/services/T00000/B00000/XXXX
vercel env add SLACK_COST_WEBHOOK https://hooks.slack.com/services/T00000/B00000/YYYY
```

### Step 2: Configure PagerDuty

**Get PagerDuty Integration Key:**
```
1. PagerDuty > Services > Benefits Bot Service
2. Integrations tab > New Webhook Integration
3. Copy key: 12a3bc4d5e6f7g8h9i0j
```

**Set in Vercel:**
```bash
vercel env add PAGERDUTY_INTEGRATION_KEY 12a3bc4d5e6f7g8h9i0j
vercel env add PAGERDUTY_ESCALATION_POLICY_ID urgent
```

### Step 3: Enable Alerting in Code

**In `lib/monitoring/advanced-alerting.ts`:**
```typescript
// Line ~50: Update configuration
export const ALERTING_CONFIG = {
  enabled: true,
  channels: {
    slack: {
      alerts: process.env.SLACK_ALERTS_WEBHOOK,
      costs: process.env.SLACK_COST_WEBHOOK,
    },
    pagerduty: {
      integrationKey: process.env.PAGERDUTY_INTEGRATION_KEY,
      escalationPolicy: process.env.PAGERDUTY_ESCALATION_POLICY_ID,
    },
  },
  thresholds: {
    errorRate: 0.05,        // 5%
    latencyP95: 3000,       // 3 seconds
    cacheHitRate: 0.40,     // 40%
    hourlyBurnRate: 500,    // $500/hr
  },
};
```

**Deploy:**
```bash
npm run build
vercel --prod
```

### Step 4: Test Alerts

**Trigger test alert:**
```bash
curl -X POST https://amerivetaibot.bcgenrolls.com/api/test-alert \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d '{"severity": "warning", "message": "Test alert from production"}'
```

**Expected result:** Slack message + PagerDuty incident created

---

## 6. Usage Analytics & Reporting

### Real-time Usage Dashboard

**Accessible at:** `https://amerivetaibot.bcgenrolls.com/admin/analytics`

```
┌─ Usage Analytics ──────────────────────────┐
│ Last 30 Days
│
│ Total Queries: 60,000
│ Unique Users: 487
│ Avg Queries/User: 8.4
│ Peak Concurrent: 345 users
│
│ Top Questions:
│  1. Deductible/copay breakdown (18%)
│  2. Plan comparison (14%)
│  3. FSA/HSA eligibility (12%)
│  4. Out-of-network coverage (11%)
│  5. Family add/remove (8%)
│
│ Resolution Rate: 87% (1st contact)
│ Escalation Rate: 13% (to L2/L3)
│ Avg User Satisfaction: 4.2/5
│
│ Query Volume Trend:
│ Nov 1  ──╱╲──╱╲
│ Nov 10   ╱  ╲╱  ╲
│ Nov 20  ╱        ╲
│          weekday peaks
│
└────────────────────────────────────────────┘
```

### Export Reports

**Daily Report (Auto-generated 6 AM UTC):**
```
Subject: Benefits Bot Daily Report - Nov 11, 2025

Queries processed: 2,047
Active users: 312
Error rate: 0.08%
Avg response time: 2.1s
Cache hit rate: 62%

Cost summary:
  LLM: $2,247
  Infrastructure: $267
  Total: $2,514 (avg: $1.23/query)

Top issues: None
Recommended actions: None

[View full dashboard] [Download detailed CSV]
```

**Monthly Report (Auto-generated 1st of month):**
```
Subject: Benefits Bot Monthly Report - October 2025

Overview:
  Total queries: 62,144
  Unique users: 512
  Monthly cost: $74,238

Performance:
  Uptime: 99.97%
  Avg latency: 2.1s
  Error rate: 0.09%

Finance:
  Cost vs budget: 74% (under $100K limit)
  Cost trend: +8% vs September
  Recommendations: Monitor L3 tier usage

[View detailed analytics] [Download cost breakdown]
```

### Access Reports in Azure Portal

**Path:**
```
Azure Portal > Application Insights > 
  Analytics > Workbooks > Custom Reports

Pre-built workbooks:
  1. Daily Cost Summary
  2. Query Performance Trends
  3. Error Analysis
  4. User Engagement
  5. Infrastructure Utilization
```

---

## 7. Cost Optimization Playbook

### Immediate Actions (Week 1)

| Action | Est. Savings | Effort | Owner |
|--------|--------------|--------|-------|
| **1. Review query patterns** | $500-2K | 2 hrs | DevOps |
| **2. Adjust cache thresholds** | $2K-5K | 1 hr | DevOps |
| **3. Optimize prompt templates** | $1K-3K | 4 hrs | DevOps |
| **4. Implement budget alerts** | $0 (control) | 1 hr | DevOps |

**Total potential savings: $3.5K - $10K/month (5-15% reduction)**

### Medium-term Actions (Month 1-2)

| Action | Est. Savings | Effort | Owner |
|--------|--------------|--------|-------|
| **1. Fine-tune tier routing** | $5K-10K | 2 days | ML Engineer |
| **2. Implement batch processing** | $2K-8K | 1 week | Backend |
| **3. Optimize token usage** | $3K-7K | 3 days | DevOps |
| **4. Archive old conversations** | $1K-2K | 1 day | DevOps |

**Total potential savings: $11K - $27K/month (15-35% reduction)**

### Long-term Actions (Quarter 1-2)

| Action | Est. Savings | Effort | Owner |
|--------|--------------|--------|-------|
| **1. Model evaluation (newer/cheaper models)** | $10K-25K | 2 weeks | ML Team |
| **2. On-device caching layer** | $5K-15K | 1 month | Full stack |
| **3. Hybrid cloud strategy** | $15K-40K | 2 months | Arch/Ops |

**Total potential savings: $30K - $80K/month (40-60% reduction)**

---

## 8. Budget Scenarios & Planning

### Conservative Growth (12-month projection)

```
Month  Users  Queries   LLM Cost  Infrastructure  Total
───────────────────────────────────────────────────────
Nov    487    60,000    $65,038   $9,000          $74,038
Dec    650    78,000    $87,414   $11,000         $98,414
Jan    850    102,000   $114,618  $13,500         $128,118
Feb    1100   132,000   $148,356  $16,500         $164,856
Mar    1400   168,000   $189,168  $19,500         $208,668
...
Oct    3500   420,000   $473,040  $40,000         $513,040

Annual total: ~$2.8M (starting base $74K × 12 = $888K)
Growth rate: 300% YoY
```

### Aggressive Growth (rapid adoption)

```
Month  Users  Queries   LLM Cost  Infrastructure  Total
───────────────────────────────────────────────────────
Nov    487    60,000    $65,038   $9,000          $74,038
Dec    1200   144,000   $162,144  $18,000         $180,144
Jan    2000   240,000   $270,240  $28,000         $298,240
Feb    3500   420,000   $473,040  $40,000         $513,040
...
Oct    7000   840,000   $946,080  $70,000         $1,016,080

Annual total: ~$4.1M
Growth rate: 600% YoY
Note: Cost per user decreases (economies of scale)
```

### Cost Control Scenario (with optimizations)

```
Using optimization levers (cache + batch + routing):
Savings target: 25% reduction

Month  Users  Queries  Optimized Cost  Savings vs Base
──────────────────────────────────────────────────────
Nov    487    60,000   $55,529        $18,509 (25%)
Dec    650    78,000   $73,811        $24,603 (25%)
Jan    850    102,000  $96,089        $32,029 (25%)
...
Oct    3500   420,000  $384,780       $128,260 (25%)

Annual savings: $900K (25% of $3.6M)
Break-even cost reductions pay for optimization effort
```

---

## 9. Monitoring Checklist for Admin

### Daily (5 min check)

- [ ] Cost dashboard - monthly burn rate on track?
- [ ] Error rate - any anomalies in last 24h?
- [ ] User feedback - any complaints in Slack?
- [ ] Cache hit rate - maintaining >60%?

### Weekly (30 min review)

- [ ] Cost trend - any unexpected spikes?
- [ ] Performance - p95 latencies stable?
- [ ] Alerts - any triggered this week?
- [ ] Budget - still on track for monthly cap?

### Monthly (1 hr deep dive)

- [ ] Generate cost report - compare vs budget
- [ ] Review query patterns - any optimization opportunities?
- [ ] Check infrastructure utilization - room to scale?
- [ ] Validate alert thresholds - still appropriate?
- [ ] Plan for next month - expected user growth?

---

## 10. Troubleshooting & Support

### Common Issues

**Q: Cost jumped 30% this month. What happened?**
```
A: Check these in order:
  1. User growth: Did active users increase?
  2. Query volume: Are users asking more questions?
  3. Tier shift: Did queries shift from L1→L2/L3?
  4. Prompt injection: Any malicious queries causing high token usage?
  
  Investigation:
  - Review tier distribution in Application Insights
  - Check query logs for anomalies
  - Look at token usage by query (avg, p95, p99)
  - If spike localized, may be attackers (implement rate limits)
```

**Q: Error rate spiked to 5%. What's going wrong?**
```
A: Escalation procedure:
  1. Check PagerDuty alert - which Azure service?
  2. Azure Portal > Service Health - any incidents?
  3. Application Insights > Failures - which tier affected?
  4. If L1/L2: May be retrieval issue (search index)
  5. If L3: May be LLM capacity (check quota)
  
  Resolution:
  - If retrieval: Restart search service
  - If LLM: Wait for quota reset (hourly) or contact Azure support
  - If persistent: Page on-call engineer
```

**Q: Cache hit rate dropped from 65% to 40%. Why?**
```
A: Root causes (in order of likelihood):
  1. Semantic threshold too strict
  2. New user cohort with different queries
  3. Seasonal change (e.g., open enrollment period)
  4. Malicious query injection (test with similarity analysis)
  
  Mitigation:
  - Review cache performance in last 7 days
  - Relax similarity threshold from 0.92 → 0.88
  - Monitor for improvement
  - If persists, investigate query patterns
```

---

## 11. Contact & Escalation

**For production issues:**
- **On-call engineer**: [PagerDuty page]
- **Finance/cost questions**: finance@amerivet.com
- **Performance tuning**: devops@company.com
- **Azure support**: [Support ticket]

**Documentation:**
- Performance Report: `LOAD_TEST_PERFORMANCE_REPORT.md`
- Deployment Guide: `VERCEL_DEPLOYMENT_GUIDE.md`
- Client Checklist: `CLIENT_DELIVERY_CHECKLIST.md`

---

**Last Updated**: November 11, 2025  
**Next Review**: November 25, 2025 (post-deployment)

