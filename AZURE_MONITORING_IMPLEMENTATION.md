# Azure Monitoring & Alerting Implementation Guide

**Date**: November 11, 2025  
**Status**: Ready for Implementation  
**Scope**: Cost monitoring, system alerts, and hybrid LLM routing for Benefits AI Chatbot

---

## Table of Contents

1. [Application Insights Setup](#application-insights-setup)
2. [Azure Budget Alerts](#azure-budget-alerts)
3. [Real-Time Cost Dashboard](#real-time-cost-dashboard)
4. [Hybrid LLM Routing with Auto-Fallback](#hybrid-llm-routing-with-auto-fallback)
5. [Alert Notifications](#alert-notifications)
6. [Verification & Testing](#verification--testing)
7. [Troubleshooting](#troubleshooting)

---

## Application Insights Setup

### ✅ Step 1: Application Insights Resource Already Exists

Your Application Insights resource is already provisioned and configured:

**Resource Details**:
- **Name**: `amerivet-appinsights`
- **Resource Group**: `benefits-chatbot-project`
- **Location**: Central US
- **Log Analytics Workspace**: `amerivet-law-prod`
- **Status**: ✅ Active and receiving data

**No action needed** – resource is ready to use.

### ✅ Step 2: Connection String Retrieved

Your connection string is:
```
InstrumentationKey=814f8e1f-cfdb-42f0-adda-cbfe217f6e03;IngestionEndpoint=https://centralus-2.in.applicationinsights.azure.com/;LiveEndpoint=https://centralus.livediagnostics.monitor.azure.com/;ApplicationId=bc1c4307-fe59-436c-b975-ccf528adc91a
```

**No action needed** – copy this value for the next step.

### Step 3: Add Connection String to Vercel Environment Variables

**In Vercel Dashboard** (https://vercel.com):
1. Go to your project → **Settings** → **Environment Variables**
2. Add a new variable:
   - **Name**: `APPLICATIONINSIGHTS_CONNECTION_STRING`
   - **Value**: 
     ```
     InstrumentationKey=814f8e1f-cfdb-42f0-adda-cbfe217f6e03;IngestionEndpoint=https://centralus-2.in.applicationinsights.azure.com/;LiveEndpoint=https://centralus.livediagnostics.monitor.azure.com/;ApplicationId=bc1c4307-fe59-436c-b975-ccf528adc91a
     ```
   - **Environments**: Production (check ✓)
3. Click **Save**

### Step 4: Enable Application Insights in Code

**File**: `lib/rag/observability.ts`

Locate this line (around line 15-20):
```typescript
const ENABLE_APP_INSIGHTS = process.env.ENABLE_APP_INSIGHTS === 'true' || false;
```

Change it to:
```typescript
const ENABLE_APP_INSIGHTS = process.env.ENABLE_APP_INSIGHTS === 'true' || process.env.NEXT_PUBLIC_ENVIRONMENT === 'production';
```

This enables Application Insights automatically in production.

### Step 5: Deploy to Vercel

After making the code change:
1. Commit the change locally:
   ```
   (In VS Code Terminal)
   git add lib/rag/observability.ts
   git commit -m "feat: enable Application Insights in production"
   ```

2. Push to your branch:
   ```
   git push origin your-branch-name
   ```

3. Vercel will automatically deploy. Wait for deployment to complete (~3-5 minutes).

### Step 6: Verify Application Insights is Receiving Data

**In Azure Portal** → Your Application Insights resource (`amerivet-appinsights`):
1. The dashboard shows:
   - **Failed requests**: 0 (good - no errors)
   - **Server response time**: ~40-80ms average
   - **Server requests**: Active traffic showing
   - **Availability**: High (>95%)

✅ **Status**: Application Insights is already receiving and tracking data!

---

## Azure Budget Alerts

### Step 1: Create Budget

**In Azure Portal**:
1. Navigate to **Cost Management + Billing**
2. Click **Budgets** (left sidebar)
3. Click **+ Create** (or **+ Add** if you have existing budgets)

### Step 2: Configure Budget Details

**On the "Create Budget" page**:
1. **Scope**: Select your subscription or resource group
2. **Name**: `Benefits-AI-Monthly-Budget`
3. **Reset Period**: `Monthly`
4. **Creation Date**: Today's date
5. **Expiration Date**: Leave blank (ongoing)
6. **Budget Amount**: `$74,038` (or your monthly budget limit)
7. Click **Next**

### Step 3: Set Alert Thresholds

**On the "Set Alerts" page**:

Create three alerts by clicking **+ Add alert condition** three times:

#### Alert 1: 50% Threshold
- **Alert Type**: `Forecasted`
- **Percentage of budget**: `50`
- **Who should be notified?**: Add email addresses (comma-separated)
- **Action Group**: Click **Create** or select existing
  - **Action Group Name**: `benefits-ai-alerts-50`
  - **Short name**: `AlertsAI50`
  - Leave other fields default
  - Click **Create**

#### Alert 2: 75% Threshold
- **Alert Type**: `Forecasted`
- **Percentage of budget**: `75`
- **Who should be notified?**: Add email addresses
- **Action Group**: Create new or select `benefits-ai-alerts-50` (can reuse)

#### Alert 3: 90% Threshold
- **Alert Type**: `Actual`
- **Percentage of budget**: `90`
- **Who should be notified?**: Add email addresses
- **Action Group**: Create new or select existing

### Step 4: Review and Create

1. Click **Review + Create**
2. Verify all settings
3. Click **Create**

✅ **Budget alerts are now active**. You'll receive email notifications at 50%, 75%, and 90% spend.

---

## Real-Time Cost Dashboard

### Step 1: Create Azure Portal Dashboard

**In Azure Portal**:
1. Click **+ Create a resource** (top left)
2. Search for **Dashboard**
3. Click **Dashboard** → **Create**
4. **Name**: `Benefits-AI-Cost-Dashboard`
5. **Resource Group**: Same as your resources
6. Click **Create**

### Step 2: Add Cost Analysis Widget

**On your new dashboard**:
1. Click **+ Add tile** (top right)
2. Select **Cost Analysis**
3. Configure:
   - **Title**: `Monthly Spend`
   - **Chart Type**: `Line`
   - **Time Range**: `Last 30 days`
   - **Granularity**: `Daily`
   - **Filter by**: Your subscription/resource group
4. Click **Apply**
5. Resize tile to fill upper half of dashboard

### Step 3: Add Cost by Service Widget

1. Click **+ Add tile**
2. Select **Cost Analysis**
3. Configure:
   - **Title**: `Cost by Service`
   - **Chart Type**: `Pie` or `Bar`
   - **Group by**: `Service Name`
   - **Filter by**: Your subscription/resource group
4. Click **Apply**
5. Resize and position below the first widget

### Step 4: Add Application Insights Performance Widget

1. Click **+ Add tile**
2. Search for **Application Insights**
3. Select your Application Insights resource
4. Choose metric: **Average Response Time**
5. Click **Apply**

### Step 5: Save Dashboard

1. Click **Done editing** (top)
2. Your dashboard is now saved and accessible from **Dashboards** in the portal

### Step 6: Share Dashboard (Optional)

**To share with team**:
1. Click **Share** (top menu)
2. Click **Publish to resource group**
3. Team members can access via **Dashboards** → **Browse shared dashboards**

---

## Hybrid LLM Routing with Auto-Fallback

This section implements automatic fallback to cheaper models when cost thresholds are exceeded.

### Step 1: Update Pattern Router

**File**: `lib/rag/pattern-router.ts`

Find the function `selectTier()` (around line 200-250). Add cost-aware logic:

After the existing tier selection logic, add this auto-fallback section:

```typescript
// After existing tier selection, add:
export async function selectTierWithFallback(
  signals: TierSignals,
  costTracker: any,
): Promise<Tier> {
  const baseTier = selectTier(signals);
  
  // Check current spend
  const currentCost = costTracker.getDailyCost();
  const dailyBudget = 74038 / 30; // ~$2,468 per day
  const costPercentage = (currentCost / dailyBudget) * 100;
  
  // Auto-fallback logic
  if (costPercentage >= 90 && baseTier === 'L3') {
    // At 90% spend, fallback L3 → L2
    console.log(`[Cost Alert] 90% daily budget reached. Fallback: L3 → L2`);
    return 'L2';
  }
  
  if (costPercentage >= 75 && baseTier === 'L3') {
    // At 75% spend, consider fallback
    // Use L3 only if confidence is very high
    if (signals.coverage >= 0.95) {
      return 'L3'; // High confidence, proceed with L3
    }
    return 'L2';
  }
  
  return baseTier;
}
```

### Step 2: Update QA API Route

**File**: `app/api/qa/route.ts`

Find the line that calls `selectTier()` (around line 120-150). Change it to:

```typescript
// OLD:
const tier = selectTier(signals);

// NEW:
const tier = await selectTierWithFallback(signals, costTracker);
```

Also add the import at the top:
```typescript
import { selectTierWithFallback } from '@/lib/rag/pattern-router';
```

### Step 3: Update Observability Tracking

**File**: `lib/rag/observability.ts`

Find the `trackCost()` function and add a return value:

```typescript
export function trackCost(tier: Tier, model: string, inputTokens: number, outputTokens: number) {
  const cost = calculateTierCost(tier, model, inputTokens, outputTokens);
  
  // ... existing tracking code ...
  
  // Add this:
  DAILY_COST_ACCUMULATED += cost;
  
  return {
    cost,
    dailyTotal: DAILY_COST_ACCUMULATED,
    percentage: (DAILY_COST_ACCUMULATED / (74038 / 30)) * 100,
  };
}

// Add this helper
export function getDailyCost() {
  return DAILY_COST_ACCUMULATED;
}

// At module top, add:
let DAILY_COST_ACCUMULATED = 0;
```

### Step 4: Add Cost Tracker Object

**File**: `lib/rag/observability.ts`

Add this export at the end of the file:

```typescript
export const costTracker = {
  getDailyCost: getDailyCost,
  getPercentage: () => (getDailyCost() / (74038 / 30)) * 100,
  reset: () => {
    DAILY_COST_ACCUMULATED = 0;
  },
};
```

### Step 5: Test Hybrid Routing Locally (Optional)

In development, you can verify the logic works:

1. Open `app/api/qa/route.ts`
2. Add test logging before the tier selection:
   ```typescript
   console.log('[DEBUG] Cost percentage:', costTracker.getPercentage());
   console.log('[DEBUG] Base tier selected:', tier);
   ```
3. Run your app: `npm run dev`
4. Make a query and check the console for the debug output

---

## Alert Notifications

### Step 1: Configure Email Notifications

Email notifications are already configured through Azure Budget Alerts (Step 3 above). Budget alerts automatically send emails to specified recipients.

### Step 2: Configure Slack Notifications (Optional)

**In Slack Workspace**:
1. Go to your Slack workspace settings
2. Navigate to **Apps & Integrations**
3. Search for **Incoming Webhooks**
4. Click **Create New Webhook**
5. Select your channel (e.g., `#alerts` or `#cost-monitoring`)
6. Copy the **Webhook URL** (looks like: `https://hooks.slack.com/services/T00000000/B00000000/...`)

**In Azure Portal** → Cost Management:
1. Go to **Cost Management + Billing** → **Budgets**
2. Click your budget → **Edit**
3. Under Alert Thresholds, add Action Group:
   - **Action Group Type**: `Webhook`
   - **Webhook URL**: Paste the Slack webhook URL
   - **Use common alert schema**: Enabled

### Step 3: Configure PagerDuty Notifications (Optional)

If you use PagerDuty:

1. In PagerDuty, go to **Settings** → **Integrations**
2. Create a new integration:
   - **Vendor**: `Microsoft Azure`
   - **Service**: Your service
   - Copy the **Integration Key**

2. In Azure Portal → Cost Management:
   - Add another Action Group with PagerDuty integration
   - Paste the Integration Key

---

## Verification & Testing

### Test 1: Verify Application Insights Data Collection

**Steps**:
1. Go to your app: https://amerivetaibot.bcgenrolls.com
2. Make 5-10 queries through the chat interface
3. In Azure Portal → Application Insights → **Live Metrics**
4. You should see:
   - **Incoming Requests** = 5-10
   - **Response Time** = Average ~1-3s
   - **Failed Requests** = 0 or very low

✅ **Pass**: Data is flowing to Application Insights

### Test 2: Verify Budget Alerts Setup

**Steps**:
1. In Azure Portal → Cost Management + Billing → **Budgets**
2. Click your budget
3. Verify:
   - Budget amount is set
   - Alert thresholds at 50%, 75%, 90% are configured
   - Email addresses are listed

✅ **Pass**: Budget is configured and will send alerts

### Test 3: Verify Cost Dashboard

**Steps**:
1. In Azure Portal → **Dashboards**
2. Click your cost dashboard
3. Verify:
   - Monthly spend chart is visible
   - Cost by service breakdown shows your services
   - Application Insights performance metrics are displayed

✅ **Pass**: Dashboard is accessible and showing data

### Test 4: Monitor Hybrid Routing (After Deployment)

**Steps**:
1. Deploy your code changes to Vercel (see Application Insights Setup Step 5)
2. Wait 24 hours or simulate high usage
3. In Azure Portal → Application Insights → **Logs**
4. Run this query:
   ```kusto
   traces
   | where message contains "Cost Alert"
   | summarize count() by message
   ```
5. If you see `Cost Alert` messages, fallback is working

✅ **Pass**: Hybrid routing is monitoring costs

---

## Monitoring Schedule

### Daily Checklist
- ✅ Check Application Insights Live Metrics (< 1 minute)
- ✅ Review daily cost in dashboard (~2 minutes)
- ✅ Check error rate (should be < 0.1%)

### Weekly Checklist
- ✅ Review cost trends (should be relatively flat week-to-week)
- ✅ Check tier distribution (L1 should be 65%+, L3 should be <10%)
- ✅ Verify alert configuration is still active

### Monthly Checklist
- ✅ Compare actual spend to budget
- ✅ Review performance metrics (latency, errors, cache hit rate)
- ✅ Check if auto-fallback was triggered (review logs)
- ✅ Plan for next month's budget if needed

---

## Troubleshooting

### Issue: Application Insights Not Receiving Data

**Symptoms**: Live Metrics shows no data after 10 minutes

**Solution**:
1. Verify connection string is correct in Vercel env vars:
   - Go to Vercel → Settings → Environment Variables
   - Check `APPLICATIONINSIGHTS_CONNECTION_STRING` value
2. Verify code change was deployed:
   - Go to Vercel → Deployments
   - Check latest deployment status (should be "Ready")
3. Check Application Insights resource status:
   - In Azure Portal, verify resource is not in a failed state
4. Trigger a test request:
   - Visit your app and make a query
   - Wait 2 minutes
   - Check Live Metrics again

### Issue: Budget Alerts Not Sending

**Symptoms**: Not receiving email alerts at thresholds

**Solution**:
1. Verify alert emails in budget configuration:
   - Go to Azure Portal → Cost Management → Budgets
   - Click budget and check email addresses
2. Verify Action Group is created:
   - Go to Cost Management + Billing → **Budgets**
   - Click the budget and check **Alert Conditions**
   - Each condition should have an Action Group assigned
3. Test alert manually:
   - Click the budget → **Edit**
   - Click on an alert condition
   - Click **Test** (if available)

### Issue: Hybrid Routing Not Triggering

**Symptoms**: Auto-fallback to cheaper models not happening

**Solution**:
1. Verify daily usage is high enough:
   - Check dashboard: daily spend should be > $1,234 (50% of budget)
2. Verify code changes were deployed:
   - Check git log: `git log --oneline | head -5`
   - Should see your commits for pattern-router and api route changes
3. Check Application Insights logs:
   - Go to Azure Portal → Application Insights → **Logs**
   - Run: `traces | where message contains "Cost"` 
   - If no results, fallback logic hasn't triggered yet

### Issue: High Response Times

**Symptoms**: Latency > 5 seconds

**Solution**:
1. Check which tier is being used:
   - Go to Application Insights → **Logs**
   - Run: `traces | where message contains "Tier"` 
2. If L3 (gpt-4): Expected 4-6 seconds
3. If L1 (gpt-4o-mini): Check if there's degradation
   - May indicate Azure OpenAI quota issues
   - Contact Azure support if persists

---

## Key Reference URLs

- **Azure Portal**: https://portal.azure.com
- **Vercel Dashboard**: https://vercel.com
- **Application Insights Docs**: https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview
- **Azure Cost Management**: https://learn.microsoft.com/en-us/azure/cost-management-billing/
- **App Health Dashboard**: https://amerivetaibot.bcgenrolls.com/admin/analytics

---

## Next Steps

1. ✅ Follow Steps 1-6 in "Application Insights Setup" section
2. ✅ Follow "Azure Budget Alerts" section
3. ✅ Create real-time dashboard (if not using existing)
4. ✅ Implement hybrid routing code changes (optional but recommended)
5. ✅ Run verification tests
6. ✅ Set monitoring schedule
7. 📅 Check alerts daily for first week

**Estimated Time**: 1-2 hours for complete setup

**Support**: For questions, refer to troubleshooting section or check copilot-instructions.md

---

**Document Version**: 1.0  
**Last Updated**: November 11, 2025  
**Status**: Ready for Implementation
