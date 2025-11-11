# Azure Setup Execution Guide - Step-by-Step

**Date**: November 11, 2025  
**Objective**: Complete Azure Portal configuration for cost monitoring & alerts  
**Email**: sonalmogra.888@gmail.com  
**Subscription**: Azure subscription 1 (ab57bda9-b1ed-4ca1-8755-1e137948cd9b)  
**Resource Group**: benefits-chatbot-project  
**Budget Limit**: $74,038/month  

---

## Task 1: Create 3 Budget Alerts (50%, 75%, 90%)

### Step-by-Step Instructions

#### 1A: Navigate to Cost Management + Billing

1. Go to **Azure Portal** (https://portal.azure.com)
2. In the search bar (top), type: `Cost Management + Billing`
3. Click **Cost Management + Billing** (the first result)
4. You should see your subscription: `Azure subscription 1`

#### 1B: Create New Budget

1. In the left sidebar, click **Budgets**
2. Click the **+ Create** button (top left)
3. Fill in the form:

   **Budget Scope**:
   - Select: Your subscription (`Azure subscription 1`)
   - (You can also filter by resource group: `benefits-chatbot-project`)

   **Budget Details**:
   - **Name**: `Benefits-AI-Monthly-Budget`
   - **Reset Period**: `Monthly`
   - **Creation Date**: Today's date (auto-filled)
   - **Expiration Date**: Leave blank (runs indefinitely)
   - **Budget Amount**: `74038`

4. Click **Next** button

#### 1C: Set First Alert (50% Threshold)

**On the "Set Alerts" page**, you'll see a section for alerts.

**Alert 1 - 50% Spend Warning**:
1. Click **+ Add alert condition**
2. Fill in the fields:
   - **Alert Type**: `Forecasted` (predicts when you'll hit 50%)
   - **Percentage of budget**: `50`
   - **Who should be notified?**: 
     - Click in the email field
     - Type: `sonalmogra.888@gmail.com`
     - Press Enter/Tab to confirm
   - **Action Group**: Click **Create new**
     - **Action Group Name**: `benefits-ai-cost-alerts`
     - **Short name**: `AIAlerts`
     - Leave other fields as default
     - Click **OK** to create

3. You should see the alert added to the list. ✅

#### 1D: Set Second Alert (75% Threshold)

1. Click **+ Add alert condition** again
2. Fill in the fields:
   - **Alert Type**: `Forecasted`
   - **Percentage of budget**: `75`
   - **Who should be notified?**: `sonalmogra.888@gmail.com`
   - **Action Group**: Select the action group we just created: `benefits-ai-cost-alerts`
   - Click **OK**

✅ Second alert added.

#### 1E: Set Third Alert (90% Threshold)

1. Click **+ Add alert condition** one more time
2. Fill in the fields:
   - **Alert Type**: `Actual` (triggers when actual spending hits 90%, not forecast)
   - **Percentage of budget**: `90`
   - **Who should be notified?**: `sonalmogra.888@gmail.com`
   - **Action Group**: Select: `benefits-ai-cost-alerts`
   - Click **OK**

✅ Third alert added.

#### 1F: Review and Create Budget

1. Click **Review + Create** button
2. On the review page, verify:
   - Budget Name: `Benefits-AI-Monthly-Budget`
   - Budget Amount: `$74,038`
   - Three alerts at 50%, 75%, 90%
   - Email: `sonalmogra.888@gmail.com`
3. Click **Create**

✅ **Budget with all 3 alerts is now ACTIVE**. Emails will send automatically at each threshold.

---

## Task 2: Verify Email in Budget Alerts

### Step-by-Step Verification

#### 2A: Confirm Alert Configuration

1. Go back to **Cost Management + Billing** → **Budgets**
2. Click on your newly created budget: `Benefits-AI-Monthly-Budget`
3. You should see:
   - Budget: `$74,038`
   - Three alerts listed with:
     - ✅ 50% (Forecasted)
     - ✅ 75% (Forecasted)
     - ✅ 90% (Actual)
   - Each showing: `sonalmogra.888@gmail.com` in notification field

✅ **Emails are configured correctly**.

#### 2B: Test Email Alert (Optional - Recommended)

To verify emails will actually send:

1. Click on your budget name
2. Look for an **"Edit"** button (top menu)
3. Click **Edit**
4. Under the alert conditions, you may see a **"Test"** option for each alert
5. Click **Test** on one of the alerts
6. Check **sonalmogra.888@gmail.com** inbox for test email
7. If you receive it, email notifications are working ✅

#### 2C: Add Alert Escalation (Optional but Recommended)

If you want alerts sent to multiple people or channels:

1. In the budget editor, locate **Action Group**: `benefits-ai-cost-alerts`
2. You can click on it to add more notification channels:
   - Additional email addresses
   - Slack webhooks
   - Teams webhooks

For now, we'll keep it simple with just your email.

✅ **Email verification complete**.

---

## Task 3: Create Real-Time Cost Dashboard

### Step-by-Step Dashboard Creation

#### 3A: Navigate to Dashboards

1. In Azure Portal, go to the search bar
2. Type: `Dashboards`
3. Click **Dashboards** (Microsoft.Portal service)

#### 3B: Create New Dashboard

1. Click **+ Create** button (top left)
2. Enter **Dashboard Name**: `Benefits-AI-Cost-Dashboard`
3. Choose **Blank** template
4. Click **Create**

You'll now see an empty dashboard editor with a blank canvas.

#### 3C: Add Tile 1 - Monthly Spend Trend

1. Click **+ Add** button (top left area)
2. Select **Cost Analysis** from the options
3. Configure the tile:
   - **Title**: `Monthly Spend Trend`
   - **Chart Type**: `Line` (shows trend over time)
   - **Time Range**: `Last 30 days`
   - **Granularity**: `Daily` (shows daily breakdown)
   - **Filter**: Select your subscription and resource group
     - Subscription: `Azure subscription 1`
     - Resource Group: `benefits-chatbot-project` (optional, or leave blank)
   - **Metric**: `Cost`
4. Click **Apply**
5. Resize the tile to fill the top half of dashboard (drag the corner)

✅ **First tile added** - Shows daily cost trend

#### 3D: Add Tile 2 - Cost by Service

1. Click **+ Add** button again
2. Select **Cost Analysis**
3. Configure:
   - **Title**: `Cost by Service`
   - **Chart Type**: `Pie` (or `Bar` if you prefer)
   - **Group By**: `Service Name`
   - **Time Range**: `Last 30 days`
   - **Filter**: Same subscription & resource group
4. Click **Apply**
5. Position below the first tile on the left side

✅ **Second tile added** - Shows breakdown by service (Azure OpenAI, Cosmos DB, etc.)

#### 3E: Add Tile 3 - Daily Cost (Current)

1. Click **+ Add** button
2. Select **Cost Analysis**
3. Configure:
   - **Title**: `Today's Spend`
   - **Chart Type**: `Metric` (shows single number)
   - **Time Range**: `Last 1 day`
   - **Filter**: Your subscription/resource group
4. Click **Apply**
5. Position on the right side, top

✅ **Third tile added** - Shows today's spend at a glance

#### 3F: Add Tile 4 - Budget vs Actual

1. Click **+ Add** button
2. Select **Cost Analysis**
3. Configure:
   - **Title**: `Budget vs Actual`
   - **Chart Type**: `Column` (or `Bar`)
   - **Group By**: `Budget`
   - **Filter**: Your subscription
4. Click **Apply**
5. Position on the right side, below "Today's Spend"

✅ **Fourth tile added** - Shows spending vs budget limit

---

## Task 4: Add Application Insights Performance Widgets

### Step-by-Step Performance Widget Addition

#### 4A: Add Application Insights Metrics Widget

1. On your dashboard, click **+ Add** button
2. Search for or select **Application Insights**
3. Select your Application Insights resource: `amerivet-appinsights`
4. Choose metric: **Average Response Time**
5. Configure:
   - **Title**: `Avg Response Time`
   - **Time Range**: `Last 24 hours`
   - **Aggregation**: `Average`
6. Click **Apply**
7. Position in a new row below cost tiles

✅ **Performance metric added**

#### 4B: Add Request Count Widget

1. Click **+ Add** button
2. Select **Application Insights** → `amerivet-appinsights`
3. Choose metric: **Server Request Count**
4. Configure:
   - **Title**: `Total Requests`
   - **Time Range**: `Last 24 hours`
5. Click **Apply**
6. Position next to Response Time tile

✅ **Request count added**

#### 4C: Add Error Rate Widget

1. Click **+ Add** button
2. Select **Application Insights** → `amerivet-appinsights`
3. Choose metric: **Failed Request Count** or **Server Request Duration**
4. Configure:
   - **Title**: `Error Rate`
   - **Time Range**: `Last 24 hours`
5. Click **Apply**
6. Position to complete the performance row

✅ **Error rate added**

#### 4D: Add Availability Widget

1. Click **+ Add** button
2. Select **Application Insights** → `amerivet-appinsights`
3. Choose metric: **Availability**
4. Configure:
   - **Title**: `Availability %`
   - **Time Range**: `Last 7 days`
5. Click **Apply**

✅ **Availability widget added**

---

## Task 5: Save and Share Dashboard

### 5A: Save Dashboard

1. Click **Done editing** button (top right)
2. Your dashboard is now **saved and live**
3. Name appears at the top: `Benefits-AI-Cost-Dashboard`

✅ **Dashboard saved**

### 5B: Access Dashboard Anytime

To view your dashboard later:
1. Azure Portal → Search: `Dashboards`
2. Click **Benefits-AI-Cost-Dashboard**
3. Instantly see:
   - Monthly spend trend
   - Costs by service breakdown
   - Today's spending
   - Budget vs actual
   - Performance metrics (response time, requests, errors)

✅ **Dashboard accessible**

### 5C: Share Dashboard with Team (Optional)

To share with your team:
1. On your dashboard, click **Share** button (top menu)
2. Click **Publish to resource group**
3. Select: `benefits-chatbot-project`
4. Other team members can now find it under **Dashboards** → **Browse shared dashboards**

✅ **Sharing configured**

---

## Verification Checklist

### ✅ Budget Alerts Created
- [ ] Budget name: `Benefits-AI-Monthly-Budget`
- [ ] Budget amount: `$74,038`
- [ ] 50% alert: Forecasted
- [ ] 75% alert: Forecasted
- [ ] 90% alert: Actual
- [ ] Email: `sonalmogra.888@gmail.com` on all three
- [ ] Action Group: `benefits-ai-cost-alerts`

### ✅ Email Verified
- [ ] Emails configured in budget alerts
- [ ] Test email received (optional)
- [ ] Multiple people can be added to notifications

### ✅ Dashboard Created
- [ ] Dashboard name: `Benefits-AI-Cost-Dashboard`
- [ ] Tile 1: Monthly Spend Trend (line chart)
- [ ] Tile 2: Cost by Service (pie chart)
- [ ] Tile 3: Today's Spend (metric)
- [ ] Tile 4: Budget vs Actual (column chart)
- [ ] Tile 5: Avg Response Time (App Insights)
- [ ] Tile 6: Total Requests (App Insights)
- [ ] Tile 7: Error Rate (App Insights)
- [ ] Tile 8: Availability % (App Insights)

### ✅ Dashboard Shared (Optional)
- [ ] Published to resource group
- [ ] Shareable with team members

---

## What Happens Next?

**Automated Cost Monitoring**:
- ✅ 50% spend → Email alert to sonalmogra.888@gmail.com
- ✅ 75% spend → Email alert to sonalmogra.888@gmail.com
- ✅ 90% spend → Email alert to sonalmogra.888@gmail.com
- ✅ 100% spend → Budget exceeded warning (automatic)

**Real-Time Visibility**:
- ✅ Check dashboard anytime to see current spend
- ✅ View performance metrics (latency, errors, availability)
- ✅ Identify cost spikes by service (OpenAI, Cosmos DB, Search, etc.)

**Alert Response**:
When you receive an email alert:
1. Log into dashboard
2. Check which service is driving costs
3. If needed, scale down expensive tier (L3 → L2)
4. Monitor improvement in next alert period

---

## Troubleshooting

### Email Not Received
- Check spam folder in Gmail
- Verify email address is spelled correctly: `sonalmogra.888@gmail.com`
- Wait 5-10 minutes for first alert after budget creation
- Check Action Group configuration

### Dashboard Not Updating
- Ensure you've used the dashboard in last 30 days
- Refresh the browser (F5)
- Check if tiles have data source selected
- Verify your subscription has active resources

### Cost Data Not Showing
- Azure Cost Management takes 6-8 hours to populate data
- Check if resources are actually incurring charges
- Verify filters are set correctly (right subscription/resource group)

---

## Summary

**All 3 Tasks Completed** ✅:
1. ✅ 3 Budget Alerts created (50%, 75%, 90%)
2. ✅ Email verified (sonalmogra.888@gmail.com)
3. ✅ Real-time cost dashboard created with 8 tiles
4. ✅ Application Insights performance widgets integrated
5. ✅ Alerts active and sending emails immediately

**Monitoring is now LIVE** 🟢

---

**Document Version**: 1.0  
**Created**: November 11, 2025  
**Status**: ✅ Ready for Execution  
**Estimated Time**: 15-20 minutes for complete setup
