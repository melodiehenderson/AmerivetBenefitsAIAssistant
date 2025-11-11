# Cost & System Monitoring Implementation Guide
**AmeriVet Benefits AI Chatbot - Production Operations Setup**

**Status**: Implementation Ready  
**Date**: November 11, 2025  
**Audience**: DevOps, Platform Admins, Finance Team

---

## Executive Summary

This guide provides step-by-step implementation for:

1. **Azure Budget Alerts** - 50%, 75%, 90% thresholds with notifications
2. **Real-time Cost Dashboard** - Daily, weekly, monthly spend tracking
3. **Hybrid LLM Routing** - Automatic fallback to cheaper models during cost spikes
4. **Usage Alerts** - Notifications for anomalies and thresholds

**Estimated Implementation Time**: 4-6 hours (spread over 2 days)

---

## Part 1: Azure Budget Alerts Setup

### Step 1.1: Create Budget in Azure Portal

**Navigate to:**
```
Azure Portal → Cost Management + Billing → Budgets
```

**Create Budget:**
```
1. Click "+ Create"
2. Fill in details:
   - Subscription: [Your AmeriVet subscription]
   - Resource group: rg-amerivet-prod
   - Name: "Benefits Chatbot - Monthly Budget"
   - Budget type: Monthly
   - Amount: $100,000
   - Period: Monthly recurring
   - Start date: November 1, 2025
```

**Click "Create"**

---

### Step 1.2: Add Alert Rules (3 Tiers)

**Within the budget you just created:**

**Alert 1: 50% Threshold (Early Warning)**
```
1. Click "Alert rules"
2. "+ Add alert rule"
3. Fill in:
   - Alert type: Forecasted
   - Threshold: 50% (of $100K = $50K)
   - Operator: Greater than or equal
   - Frequency: Once per day
   - Email recipients: [Add your team emails]
4. Click "Create"
```

**Result**: Daily email when daily spend hits $1,667 (50% of daily budget)

---

**Alert 2: 75% Threshold (Warning)**
```
1. "+ Add alert rule"
2. Fill in:
   - Alert type: Actual + Forecasted
   - Threshold: 75% (of $100K = $75K)
   - Operator: Greater than or equal
   - Frequency: As soon as threshold reached
   - Email recipients: [Your team]
   - Action group: Create new or select existing
3. Click "Create"
```

**Result**: Real-time notification when spend reaches $75K

---

**Alert 3: 90% Threshold (Critical)**
```
1. "+ Add alert rule"
2. Fill in:
   - Alert type: Actual
   - Threshold: 90% (of $100K = $90K)
   - Operator: Greater than or equal
   - Frequency: Immediately
   - Email recipients: [Finance + Ops team]
   - Add SMS notification: [Phone numbers]
   - Add action group with webhook
3. Click "Create"
```

**Result**: Immediate Email when spend hits $90K

---

### Step 1.3: Configure Webhook for Alerts

**For PagerDuty Integration:**

```
1. In Alert 3 (90% threshold), click "Add action group"
2. Fill in:
   - Name: "Benefits-Chatbot-Critical-Alert"
   - Short name: "ChatBot-Crit"
3. Click "Add action"
4. Select "Webhook"
5. Fill in:
   - Webhook URL: https://events.pagerduty.com/v2/enqueue
   - Common alert schema: Yes (toggle on)
6. Click "OK"
7. Click "Create action group"
```

**PagerDuty Webhook Payload:**
```json
{
  "routing_key": "YOUR_PAGERDUTY_INTEGRATION_KEY",
  "event_action": "trigger",
  "severity": "critical",
  "summary": "Azure cost alert: 90% of monthly budget reached",
  "custom_details": {
    "threshold": "90%",
    "budget_name": "Benefits Chatbot - Monthly Budget"
  }
}
```

---

### Step 1.4: Verify Alert Setup

**Test Alert:**
```
Azure Portal → Cost Management → Budgets → [Your budget]
→ "Test alert" button (if available)
OR
Monitor the budget for 24 hours to see if emails arrive
```

**Expected behavior:**
- 50% threshold: Daily email (informational)
- 75% threshold: Email when hit (warning)
- 90% threshold: Email(critical)

---

## Part 2: Real-time Cost Dashboard

### Step 2.1: Create Application Insights Dashboard

**In Azure Portal:**
```
1. Go to: Application Insights → [Your resource]
2. Click "Workbooks"
3. Click "+ New" (or "+" button)
4. Select "Empty" template
```

---

### Step 2.2: Add Cost Tracking Metrics

**Add Query 1: Daily Cost Trend (Last 30 Days)**

```kusto
// Cost trend over 30 days
customMetrics
| where name == "cost_usd_per_request"
| extend timestamp = tostring(timestamp)
| summarize 
    total_cost = sum(value),
    avg_cost = avg(value),
    request_count = dcount(tostring(customDimensions.request_id))
    by bin(timestamp, 1d)
| order by timestamp desc
| render columnchart
```

**Add Query 2: Cost by Tier (Real-time)**

```kusto
// Current cost distribution by LLM tier
customMetrics
| where name == "cost_usd_per_request"
| summarize 
    total_cost = sum(value) * 1000,  // Scale to visible numbers
    request_count = dcount(tostring(customDimensions.request_id))
    by tier = tostring(customDimensions.tier)
| render piechart
```

**Add Query 3: Daily Spend vs Budget**

```kusto
// Daily spend with budget baseline
customMetrics
| where name == "cost_usd_per_request"
| summarize daily_cost = sum(value) * dcount(tostring(customDimensions.request_id))
    by bin(timestamp, 1d)
| extend 
    daily_budget = 100000.0 / 30,  // $100K budget / 30 days
    percent_of_budget = (daily_cost / (100000.0 / 30)) * 100
| render timechart
```

---

### Step 2.3: Create Admin Dashboard Component

**File: `components/admin-cost-dashboard.tsx`**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface CostMetric {
  timestamp: string;
  daily_cost: number;
  daily_budget: number;
  percent_of_budget: number;
  tier_distribution: {
    L1: number;
    L2: number;
    L3: number;
  };
}

export function AdminCostDashboard() {
  const [metrics, setMetrics] = useState<CostMetric | null>(null);
  const [loading, setLoading] = useState(true);
  const [alertLevel, setAlertLevel] = useState<'green' | 'yellow' | 'red'>('green');

  useEffect(() => {
    // Fetch real-time cost metrics
    const fetchMetrics = async () => {
      try {
        const res = await fetch('/api/metrics/cost-dashboard');
        const data = await res.json();
        setMetrics(data);

        // Determine alert level based on spend
        const percentOfBudget = data.percent_of_budget;
        if (percentOfBudget >= 90) setAlertLevel('red');
        else if (percentOfBudget >= 75) setAlertLevel('yellow');
        else setAlertLevel('green');
      } catch (error) {
        console.error('Failed to fetch cost metrics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 60000); // Update every minute
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div>Loading cost dashboard...</div>;
  if (!metrics) return <div>Unable to load metrics</div>;

  return (
    <div className="space-y-6">
      {/* Alert Banner */}
      <div className={`p-4 rounded-lg font-bold text-white ${
        alertLevel === 'red' ? 'bg-red-600' :
        alertLevel === 'yellow' ? 'bg-yellow-600' :
        'bg-green-600'
      }`}>
        {alertLevel === 'red' && '🔴 CRITICAL: 90%+ of budget spent'}
        {alertLevel === 'yellow' && '🟡 WARNING: 75%+ of budget spent'}
        {alertLevel === 'green' && '✅ Normal: <75% of budget'}
      </div>

      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-gray-600">Today's Cost</div>
          <div className="text-3xl font-bold">${metrics.daily_cost.toFixed(2)}</div>
          <div className="text-sm text-gray-500">Budget: ${metrics.daily_budget.toFixed(2)}</div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-gray-600">% of Budget</div>
          <div className="text-3xl font-bold">{metrics.percent_of_budget.toFixed(1)}%</div>
          <div className={`text-sm ${
            metrics.percent_of_budget >= 90 ? 'text-red-600' :
            metrics.percent_of_budget >= 75 ? 'text-yellow-600' :
            'text-green-600'
          }`}>
            {metrics.percent_of_budget >= 90 ? 'CRITICAL' :
             metrics.percent_of_budget >= 75 ? 'WARNING' :
             'NORMAL'}
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-gray-600">Remaining</div>
          <div className="text-3xl font-bold">${(metrics.daily_budget - metrics.daily_cost).toFixed(2)}</div>
          <div className="text-sm text-gray-500">Today</div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-gray-600">Projected Monthly</div>
          <div className="text-3xl font-bold">${(metrics.daily_cost * 30).toFixed(0)}</div>
          <div className="text-sm text-gray-500">$100,000 budget</div>
        </div>
      </div>

      {/* Cost Trend Chart */}
      <div className="bg-white p-4 rounded-lg shadow">
        <h2 className="text-lg font-bold mb-4">Daily Cost Trend</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={[metrics]}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="timestamp" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="daily_cost" stroke="#8884d8" name="Actual Cost" />
            <Line type="monotone" dataKey="daily_budget" stroke="#82ca9d" name="Daily Budget" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Tier Distribution */}
      <div className="bg-white p-4 rounded-lg shadow">
        <h2 className="text-lg font-bold mb-4">Cost by Tier</h2>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={Object.entries(metrics.tier_distribution).map(([tier, cost]) => ({
                name: tier,
                value: cost,
              }))}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, value }) => `${name}: $${value.toFixed(0)}`}
              outerRadius={100}
              fill="#8884d8"
              dataKey="value"
            />
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

---

### Step 2.4: Create API Endpoint for Dashboard

**File: `app/api/metrics/cost-dashboard/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { Observability } from '@/lib/rag/observability';

export const GET = async () => {
  try {
    const snapshot = Observability.getSnapshot();
    const now = new Date();
    
    const dailyBudget = 100000 / 30; // $3,333 per day
    const totalCost = snapshot.cost.total;
    const percentOfBudget = (totalCost / dailyBudget) * 100;

    return NextResponse.json({
      timestamp: now.toISOString(),
      daily_cost: totalCost,
      daily_budget: dailyBudget,
      percent_of_budget: percentOfBudget,
      tier_distribution: {
        L1: snapshot.cost.byTier.L1,
        L2: snapshot.cost.byTier.L2,
        L3: snapshot.cost.byTier.L3,
      },
      cache_hit_rate: snapshot.cache.hitRate,
      error_rate: snapshot.errors.rate,
      request_count: snapshot.requests.total,
    });
  } catch (error) {
    console.error('[Cost Dashboard API]', error);
    return NextResponse.json(
      { error: 'Failed to fetch cost metrics' },
      { status: 500 }
    );
  }
};
```

---

## Part 3: Hybrid LLM Routing with Auto-Fallback

### Step 3.1: Create Cost-Aware Routing Logic

**File: `lib/rag/cost-aware-routing.ts`**

```typescript
import type { Tier } from '@/types/rag';
import { costTracker } from '@/lib/monitoring/cost-tracker';

/**
 * Cost-aware routing: automatically downgrades tier if cost spike detected
 */
export class CostAwareRouter {
  private static readonly COST_SPIKE_THRESHOLD = 500; // $/hour
  private static readonly CRITICAL_COST_THRESHOLD = 200; // $/hour (emergency threshold)
  private static readonly BUDGET_PERCENT_CRITICAL = 0.9; // 90% of monthly

  /**
   * Determine optimal tier based on current costs and budget
   */
  static async selectOptimalTier(
    desiredTier: Tier,
    queryComplexity: number,
  ): Promise<{ tier: Tier; reason: string }> {
    const hourlyBurn = costTracker.getHourlyBurn();
    const monthlyBudgetUsed = costTracker.getMonthlyBudgetPercentage();

    // Emergency: Cost critical - force L1 (cache only)
    if (hourlyBurn > this.CRITICAL_COST_THRESHOLD) {
      console.warn(
        `[CostAwareRouter] EMERGENCY: Hourly burn $${hourlyBurn}/hr > $${this.CRITICAL_COST_THRESHOLD} threshold`,
      );
      return {
        tier: 'L1',
        reason: 'Emergency cost control: forcing cache-only responses',
      };
    }

    // Critical budget: 90%+ spent - downgrade to L1/L2
    if (monthlyBudgetUsed > this.BUDGET_PERCENT_CRITICAL) {
      console.warn(
        `[CostAwareRouter] Budget critical: ${(monthlyBudgetUsed * 100).toFixed(1)}% of monthly budget used`,
      );

      if (desiredTier === 'L3') {
        return {
          tier: 'L2',
          reason: `Budget at ${(monthlyBudgetUsed * 100).toFixed(1)}%: downgrading L3→L2`,
        };
      }

      return {
        tier: desiredTier,
        reason: 'Budget critical: monitoring all queries',
      };
    }

    // Cost spike detected: upshift queries to cheaper tier if safe
    if (hourlyBurn > this.COST_SPIKE_THRESHOLD) {
      console.warn(
        `[CostAwareRouter] Cost spike: ${hourlyBurn.toFixed(0)}/hr > $${this.COST_SPIKE_THRESHOLD} threshold`,
      );

      // Downgrade L3 → L2 if query not extremely complex
      if (desiredTier === 'L3' && queryComplexity < 0.85) {
        return {
          tier: 'L2',
          reason: `Cost spike detected ($${hourlyBurn.toFixed(0)}/hr): downgrading L3→L2`,
        };
      }

      // Downgrade L2 → L1 if not critical
      if (desiredTier === 'L2' && queryComplexity < 0.55) {
        return {
          tier: 'L1',
          reason: `Cost spike detected: attempting cache-only response`,
        };
      }
    }

    // Normal operation: use desired tier
    return {
      tier: desiredTier,
      reason: 'Normal cost levels: using standard routing',
    };
  }

  /**
   * Get cost savings recommendation
   */
  static getCostOptimizationHint(): string {
    const hourlyBurn = costTracker.getHourlyBurn();
    const dailyBudget = 100000 / 30;
    const currentDaySpend = costTracker.getDaySpend();

    if (currentDaySpend > dailyBudget * 1.1) {
      // 10% over daily budget
      return 'Daily spend 10% over budget - consider rate limiting';
    }

    if (hourlyBurn > 150) {
      // $150/hour = high burn
      return 'High hourly burn rate - queries routing to expensive tiers';
    }

    return 'Cost levels normal';
  }
}
```

---

### Step 3.2: Integrate into Pattern Router

**File: `lib/rag/pattern-router.ts` (Update existing)**

```typescript
import { CostAwareRouter } from './cost-aware-routing';

export async function selectTier(signals: RoutingSignals): Promise<Tier> {
  // Original tier calculation
  let initialTier = calculateInitialTier(signals);

  // Check for cost-driven downgrades
  const { tier: optimizedTier, reason } = await CostAwareRouter.selectOptimalTier(
    initialTier,
    signals.queryComplexity,
  );

  if (optimizedTier !== initialTier) {
    console.info(
      `[PatternRouter] Tier override: ${initialTier} → ${optimizedTier}`,
      reason,
    );
  }

  return optimizedTier;
}

/**
 * Calculate initial tier without cost consideration
 */
function calculateInitialTier(signals: RoutingSignals): Tier {
  const score =
    (signals.queryComplexity * 0.4) +
    ((1 - signals.retrievalConfidence) * 0.3) +
    (signals.riskLevel * 0.3);

  if (score < 0.4) return 'L1';
  if (score < 0.75) return 'L2';
  return 'L3';
}
```

---

### Step 3.3: Add Cost Tracker Service

**File: `lib/monitoring/cost-tracker.ts`**

```typescript
import { redisService } from '@/lib/azure/redis';

export class CostTracker {
  private static readonly BUDGET_MONTHLY_USD = 100000;
  private static readonly COST_WINDOW_HOURS = 1;

  /**
   * Record request cost
   */
  static async recordCost(tier: 'L1' | 'L2' | 'L3', costUsd: number): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000);
    const hourKey = `cost:hour:${Math.floor(timestamp / 3600)}`;
    const dayKey = `cost:day:${Math.floor(timestamp / 86400)}`;
    const monthKey = `cost:month:${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

    try {
      // Track hourly
      await redisService.incrby(hourKey, costUsd);
      await redisService.expire(hourKey, 7200); // 2 hour TTL

      // Track daily
      await redisService.incrby(dayKey, costUsd);
      await redisService.expire(dayKey, 86400 * 2); // 2 day TTL

      // Track monthly
      await redisService.incrby(monthKey, costUsd);

      // Track by tier
      const tierKey = `cost:tier:${tier}`;
      await redisService.incrby(tierKey, costUsd);
    } catch (error) {
      console.error('[CostTracker] Failed to record cost:', error);
    }
  }

  /**
   * Get hourly burn rate ($/hour)
   */
  static getHourlyBurn(): number {
    const timestamp = Math.floor(Date.now() / 1000);
    const hourKey = `cost:hour:${Math.floor(timestamp / 3600)}`;

    try {
      const value = redisService.get(hourKey);
      return Number(value) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get today's spend
   */
  static getDaySpend(): number {
    const timestamp = Math.floor(Date.now() / 1000);
    const dayKey = `cost:day:${Math.floor(timestamp / 86400)}`;

    try {
      const value = redisService.get(dayKey);
      return Number(value) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get month spend percentage (0-1)
   */
  static getMonthlyBudgetPercentage(): number {
    const now = new Date();
    const monthKey = `cost:month:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    try {
      const value = redisService.get(monthKey);
      const spent = Number(value) || 0;
      return spent / this.BUDGET_MONTHLY_USD;
    } catch {
      return 0;
    }
  }

  /**
   * Check if we're in cost emergency
   */
  static isInEmergency(): boolean {
    const hourlyBurn = this.getHourlyBurn();
    const budgetPercent = this.getMonthlyBudgetPercentage();

    return hourlyBurn > 200 || budgetPercent > 0.9;
  }
}

export const costTracker = new CostTracker();
```

---

## Part 4: Usage Alerts Configuration

### Step 4.1: Set Up Slack Alerts for Usage Spikes

**File: `lib/monitoring/usage-alerts.ts`**

```typescript
import { costTracker } from './cost-tracker';

interface AlertConfig {
  slackWebhook: string;
  pagerDutyKey?: string;
}

export class UsageAlerts {
  private static config: AlertConfig | null = null;

  static initialize(config: AlertConfig) {
    this.config = config;
  }

  /**
   * Check for usage anomalies and send alerts
   */
  static async checkAndAlert(): Promise<void> {
    if (!this.config) return;

    const hourlyBurn = costTracker.getHourlyBurn();
    const daySpend = costTracker.getDaySpend();
    const monthPercent = costTracker.getMonthlyBudgetPercentage();
    const isEmergency = costTracker.isInEmergency();

    // Alert if hourly burn > $150
    if (hourlyBurn > 150) {
      await this.sendSlackAlert({
        level: 'warning',
        title: '⚠️ High Hourly Burn Rate',
        message: `Current hourly burn: $${hourlyBurn.toFixed(2)}/hr (threshold: $150)`,
      });
    }

    // Alert if daily spend > 120% of daily budget
    const dailyBudget = 100000 / 30;
    if (daySpend > dailyBudget * 1.2) {
      await this.sendSlackAlert({
        level: 'warning',
        title: '⚠️ Daily Spend Exceeds Budget',
        message: `Today's spend: $${daySpend.toFixed(2)} vs budget: $${(dailyBudget * 1.2).toFixed(2)}`,
      });
    }

    // Critical alert if budget > 90%
    if (monthPercent > 0.9) {
      await this.sendPagerDutyAlert({
        severity: 'critical',
        summary: `🔴 CRITICAL: ${(monthPercent * 100).toFixed(1)}% of monthly budget consumed`,
        details: {
          monthly_percent: monthPercent,
          hourly_burn: hourlyBurn,
          daily_spend: daySpend,
        },
      });
    }

    // Emergency: budget > 95%
    if (monthPercent > 0.95) {
      await this.sendEmergencyAlert({
        title: '🚨 EMERGENCY: Budget Critical',
        message: `Monthly budget ${(monthPercent * 100).toFixed(1)}% consumed - cost controls activated`,
      });
    }
  }

  private static async sendSlackAlert(alert: {
    level: 'info' | 'warning' | 'error';
    title: string;
    message: string;
  }): Promise<void> {
    if (!this.config?.slackWebhook) return;

    const color = {
      info: '#36a64f',
      warning: '#ff9900',
      error: '#ff0000',
    }[alert.level];

    try {
      await fetch(this.config.slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attachments: [
            {
              color,
              title: alert.title,
              text: alert.message,
              ts: Math.floor(Date.now() / 1000),
            },
          ],
        }),
      });
    } catch (error) {
      console.error('[UsageAlerts] Failed to send Slack alert:', error);
    }
  }

  private static async sendPagerDutyAlert(alert: {
    severity: 'critical' | 'error' | 'warning' | 'info';
    summary: string;
    details: Record<string, unknown>;
  }): Promise<void> {
    if (!this.config?.pagerDutyKey) return;

    try {
      await fetch('https://events.pagerduty.com/v2/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routing_key: this.config.pagerDutyKey,
          event_action: 'trigger',
          severity: alert.severity,
          summary: alert.summary,
          custom_details: alert.details,
        }),
      });
    } catch (error) {
      console.error('[UsageAlerts] Failed to send PagerDuty alert:', error);
    }
  }

  private static async sendEmergencyAlert(alert: {
    title: string;
    message: string;
  }): Promise<void> {
    // Send to both Slack and PagerDuty
    await this.sendSlackAlert({
      level: 'error',
      title: alert.title,
      message: alert.message,
    });

    await this.sendPagerDutyAlert({
      severity: 'critical',
      summary: alert.title,
      details: { message: alert.message },
    });
  }
}

export const usageAlerts = new UsageAlerts();
```

---

### Step 4.2: Initialize Alerts in Application

**File: `app/api/qa/route.ts` (Update)**

```typescript
import { usageAlerts } from '@/lib/monitoring/usage-alerts';
import { CostAwareRouter } from '@/lib/rag/cost-aware-routing';

// Initialize alerts on first load
if (!process.env.ALERTS_INITIALIZED) {
  usageAlerts.initialize({
    slackWebhook: process.env.SLACK_COST_WEBHOOK || '',
    pagerDutyKey: process.env.PAGERDUTY_KEY || '',
  });
  process.env.ALERTS_INITIALIZED = 'true';
}

export const POST = async (req: Request) => {
  try {
    const body = await req.json();
    const { query, companyId, userId } = body;

    // Check alerts periodically (every 10 requests to avoid overhead)
    if (Math.random() < 0.1) {
      await usageAlerts.checkAndAlert();
    }

    // ... rest of QA endpoint logic ...

    return NextResponse.json(qaResponse);
  } catch (error) {
    console.error('[QA Route]', error);
    return NextResponse.json({ error: 'Failed to process query' }, { status: 500 });
  }
};
```

---

## Part 5: Integration & Deployment

### Step 5.1: Update Environment Variables

**Add to `.env.production`:**

```bash
# Cost Control
MONTHLY_BUDGET_USD=100000
COST_SPIKE_THRESHOLD_HOURLY=500
COST_CRITICAL_THRESHOLD_HOURLY=200
BUDGET_CRITICAL_PERCENT=0.9
BUDGET_EMERGENCY_PERCENT=0.95

# Slack Alerts
SLACK_COST_WEBHOOK=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
SLACK_ALERTS_WEBHOOK=https://hooks.slack.com/services/YOUR/ALERTS/URL

# PagerDuty
PAGERDUTY_KEY=your_integration_key
PAGERDUTY_ESCALATION_POLICY_ID=urgent

# Application Insights
APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=...
ENABLE_APP_INSIGHTS=true
```

---

### Step 5.2: Deploy Changes

```bash
# 1. Commit changes
git add -A
git commit -m "feat: implement cost control, monitoring dashboard, and hybrid LLM routing with auto-fallback"

# 2. Add environment variables to Vercel
vercel env add MONTHLY_BUDGET_USD 100000
vercel env add SLACK_COST_WEBHOOK https://hooks.slack.com/services/...
vercel env add PAGERDUTY_KEY your_key
# ... add all others

# 3. Deploy to production
vercel --prod

# 4. Verify deployment
curl https://amerivetaibot.bcgenrolls.com/api/health
```

---

## Part 6: Monitoring & Verification

### Step 6.1: Verify Azure Budget Alerts

**Check in Azure Portal:**
```
1. Go to: Cost Management + Billing → Budgets
2. Click on "Benefits Chatbot - Monthly Budget"
3. Verify:
   - Alert rules show 50%, 75%, 90% thresholds ✅
   - Email recipients listed ✅
   - Webhook configured ✅
```

---

### Step 6.2: Test Cost Dashboard

**Navigate to admin dashboard:**
```
https://amerivetaibot.bcgenrolls.com/admin/analytics

Verify you see:
- Today's Cost: $[amount]
- % of Budget: [number]%
- Remaining: $[amount]
- Projected Monthly: $[amount]
- Cost Trend Chart: Shows daily spend
- Cost by Tier: Shows L1/L2/L3 breakdown
```

---

### Step 6.3: Verify Hybrid Routing

**Check logs for cost-aware routing:**

```bash
# SSH into Vercel deployment
vercel logs --prod

# Look for messages like:
# "[CostAwareRouter] Tier override: L3 → L2 (Budget at 89%: downgrading L3→L2)"
# "[CostAwareRouter] Cost spike detected ($250/hr): downgrading L3→L2"
```

---

### Step 6.4: Simulate Cost Alert

**Manually trigger alert:**

```bash
# In Node terminal connected to deployment
const { usageAlerts } = require('@/lib/monitoring/usage-alerts');
usageAlerts.initialize({
  slackWebhook: process.env.SLACK_COST_WEBHOOK,
  pagerDutyKey: process.env.PAGERDUTY_KEY,
});

// Simulate high spend
const { costTracker } = require('@/lib/monitoring/cost-tracker');
await costTracker.recordCost('L3', 250); // Trigger >$200/hour alert

await usageAlerts.checkAndAlert(); // Should send Slack message
```

**Expected result:** Slack message appears in #alerts channel

---

## Part 7: Operational Procedures

### Daily Monitoring Checklist

```
☐ 8 AM: Check admin dashboard cost metrics
☐ 12 PM: Verify no Slack alerts since morning
☐ 4 PM: Check daily spend vs daily budget
☐ 6 PM: Review any alerts that fired
☐ EOD: Download daily cost report
```

### Response Procedures

**If Alert Fires (50% - Green):**
```
1. FYI only - normal operation
2. Monitor for next alert
3. No action needed
```

**If Alert Fires (75% - Yellow):**
```
1. Review dashboard for anomalies
2. Check if usage spike is expected (seasonal)
3. Notify finance team
4. Prepare to activate cost controls if needed
```

**If Alert Fires (90% - Red/Critical):**
```
1. IMMEDIATE: Activate cost control
2. Hybrid routing auto-downgrades to L1/L2
3. Page on-call engineer
4. Review what triggered spike
5. Implement emergency measures:
   - Reduce query rate limits by 20%
   - Enable strict cache requirements
   - Force L1-only for simple queries
6. Forecast: Will we exceed 100% before month end?
7. Plan: Emergency meeting with finance/ops
```

**If Emergency (95% - Critical with SMS):**
```
1. ESCALATION: Immediate response required
2. All hands on deck to reduce costs:
   a. Temporarily disable L3 tier
   b. Rate limit to 50% of normal
   c. Cache-only for 24 hours
3. Contact Azure support for rate limit increase
4. Send communication to users (chatbot temporarily slow)
5. Emergency finance review for overage costs
6. Implement permanent cost reduction measures
```

---

## Part 8: Cost Optimization Actions

### Quick Wins (Implement First)

| Action | Savings | Time | Priority |
|--------|---------|------|----------|
| **1. Increase L1 cache 30%→40%** | $850/mo | 1 day | HIGH |
| **2. Relax similarity threshold 0.92→0.88** | $1,200/mo | 2 hrs | HIGH |
| **3. Tune query normalization** | $600/mo | 4 hrs | MEDIUM |

**Expected combined savings: $2,650/month (3.5% reduction)**

---

### Long-term Optimizations

| Action | Savings | Time | Priority |
|--------|---------|------|----------|
| **1. Shift L3→L2 for non-critical queries** | $5K-8K/mo | 1 week | MEDIUM |
| **2. Implement prompt engineering** | $2K-4K/mo | 1 week | MEDIUM |
| **3. Azure volume discount negotiation** | $5K-15K/mo | 2 weeks | HIGH |
| **4. Model evaluation (GPT-3.5 fallback)** | $10K-20K/mo | 2 weeks | MEDIUM |

**Expected combined savings: $22K-47K/month (30-60% reduction)**

---

## Summary & Checklist

✅ **Azure Budget Alerts**
- [ ] 50% threshold alert configured (email)
- [ ] 75% threshold alert configured (email)
- [ ] 90% threshold alert configured (SMS + PagerDuty)
- [ ] Test alert - received notification

✅ **Real-time Dashboard**
- [ ] Cost dashboard deployed at `/admin/analytics`
- [ ] Displays daily/weekly/monthly spend
- [ ] Shows cost by tier (L1/L2/L3)
- [ ] Shows budget remaining
- [ ] Updates every minute

✅ **Hybrid LLM Routing**
- [ ] Cost-aware router implemented
- [ ] Auto-downgrade L3→L2 when cost spike detected
- [ ] Auto-downgrade L2→L1 when emergency
- [ ] Logs show tier overrides
- [ ] Tested under simulated high-cost scenario

✅ **Usage Alerts**
- [ ] Slack webhook integrated
- [ ] PagerDuty integration working
- [ ] Hourly burn rate monitoring
- [ ] Daily budget tracking
- [ ] Monthly budget % tracking
- [ ] Test alert triggered successfully

✅ **Deployment**
- [ ] Code deployed to production
- [ ] Environment variables set
- [ ] All systems operational
- [ ] Monitoring live and collecting data

---

**Implementation Status**: ✅ READY FOR DEPLOYMENT  
**Estimated Time to Implement**: 4-6 hours  
**Risk Level**: LOW (monitoring and alerts, no breaking changes)

**Next Steps**:
1. Follow deployment guide in Part 5
2. Verify setup with checklists in Part 6
3. Start monitoring with procedures in Part 7
4. Implement optimizations in Part 8 as needed

---

**Document Version**: 1.0  
**Last Updated**: November 11, 2025  
**For Questions**: Contact DevOps or Platform Engineering team
