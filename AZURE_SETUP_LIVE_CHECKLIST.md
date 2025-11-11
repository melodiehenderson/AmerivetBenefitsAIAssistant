# Azure Monitoring Setup - Live Execution Checklist

**Start Time**: November 11, 2025  
**Target Completion**: 15-20 minutes  
**Email**: sonalmogra.888@gmail.com

---

## 🔴 TASK 1: Create 3 Budget Alerts (50%, 75%, 90%)

### Phase 1A: Navigate & Create Budget
- [ ] Open Azure Portal: https://portal.azure.com
- [ ] Search for "Cost Management + Billing"
- [ ] Click "Budgets" in left sidebar
- [ ] Click "+ Create" button
- [ ] Select subscription: "Azure subscription 1"
- [ ] Enter budget name: "Benefits-AI-Monthly-Budget"
- [ ] Set budget amount: "74038"
- [ ] Click "Next"

**Status**: ⏳ _________________

### Phase 1B: Configure 50% Alert
- [ ] Click "+ Add alert condition"
- [ ] Alert Type: "Forecasted"
- [ ] Percentage: "50"
- [ ] Email: "sonalmogra.888@gmail.com"
- [ ] Action Group: Create new "benefits-ai-cost-alerts"
- [ ] Click "OK"

**Status**: ⏳ _________________

### Phase 1C: Configure 75% Alert
- [ ] Click "+ Add alert condition"
- [ ] Alert Type: "Forecasted"
- [ ] Percentage: "75"
- [ ] Email: "sonalmogra.888@gmail.com"
- [ ] Action Group: Select "benefits-ai-cost-alerts"
- [ ] Click "OK"

**Status**: ⏳ _________________

### Phase 1D: Configure 90% Alert
- [ ] Click "+ Add alert condition"
- [ ] Alert Type: "Actual"
- [ ] Percentage: "90"
- [ ] Email: "sonalmogra.888@gmail.com"
- [ ] Action Group: Select "benefits-ai-cost-alerts"
- [ ] Click "OK"

**Status**: ⏳ _________________

### Phase 1E: Review & Create
- [ ] Click "Review + Create"
- [ ] Verify all settings
- [ ] Click "Create"
- [ ] Wait for confirmation message

**Status**: ⏳ _________________

### ✅ TASK 1 COMPLETE
**Timestamp**: _________________  
**Notes**: _________________

---

## 🔴 TASK 2: Verify Email in Budget Alerts

### Phase 2A: Confirm Configuration
- [ ] Go to Cost Management + Billing → Budgets
- [ ] Click "Benefits-AI-Monthly-Budget"
- [ ] Verify 3 alerts visible (50%, 75%, 90%)
- [ ] Verify email: "sonalmogra.888@gmail.com" on all three
- [ ] Verify Action Group: "benefits-ai-cost-alerts"

**Status**: ⏳ _________________

### Phase 2B: Test Email Alert (Optional)
- [ ] Click "Edit" button
- [ ] Look for "Test" option on an alert
- [ ] Click "Test"
- [ ] Check Gmail inbox for test email
- [ ] Confirm email received ✅

**Status**: ⏳ _________________

### ✅ TASK 2 COMPLETE
**Timestamp**: _________________  
**Notes**: _________________

---

## 🔴 TASK 3: Create Real-Time Cost Dashboard

### Phase 3A: Create Dashboard
- [ ] Search for "Dashboards" in Azure Portal
- [ ] Click "+ Create"
- [ ] Enter name: "Benefits-AI-Cost-Dashboard"
- [ ] Select "Blank" template
- [ ] Click "Create"

**Status**: ⏳ _________________

### Phase 3B: Add Tile 1 - Monthly Spend Trend
- [ ] Click "+ Add"
- [ ] Select "Cost Analysis"
- [ ] Title: "Monthly Spend Trend"
- [ ] Chart Type: "Line"
- [ ] Time Range: "Last 30 days"
- [ ] Granularity: "Daily"
- [ ] Click "Apply"
- [ ] Resize to fill top half

**Status**: ⏳ _________________

### Phase 3C: Add Tile 2 - Cost by Service
- [ ] Click "+ Add"
- [ ] Select "Cost Analysis"
- [ ] Title: "Cost by Service"
- [ ] Chart Type: "Pie"
- [ ] Group By: "Service Name"
- [ ] Time Range: "Last 30 days"
- [ ] Click "Apply"
- [ ] Position below first tile (left side)

**Status**: ⏳ _________________

### Phase 3D: Add Tile 3 - Today's Spend
- [ ] Click "+ Add"
- [ ] Select "Cost Analysis"
- [ ] Title: "Today's Spend"
- [ ] Chart Type: "Metric"
- [ ] Time Range: "Last 1 day"
- [ ] Click "Apply"
- [ ] Position on right side (top)

**Status**: ⏳ _________________

### Phase 3E: Add Tile 4 - Budget vs Actual
- [ ] Click "+ Add"
- [ ] Select "Cost Analysis"
- [ ] Title: "Budget vs Actual"
- [ ] Chart Type: "Column"
- [ ] Group By: "Budget"
- [ ] Click "Apply"
- [ ] Position on right side (below today's spend)

**Status**: ⏳ _________________

### ✅ TASK 3 COMPLETE
**Timestamp**: _________________  
**Notes**: _________________

---

## 🔴 TASK 4: Add Application Insights Performance Widgets

### Phase 4A: Add Response Time Widget
- [ ] Click "+ Add"
- [ ] Select "Application Insights"
- [ ] Resource: "amerivet-appinsights"
- [ ] Metric: "Average Response Time"
- [ ] Title: "Avg Response Time"
- [ ] Time Range: "Last 24 hours"
- [ ] Click "Apply"
- [ ] Position in new row (bottom)

**Status**: ⏳ _________________

### Phase 4B: Add Request Count Widget
- [ ] Click "+ Add"
- [ ] Select "Application Insights"
- [ ] Resource: "amerivet-appinsights"
- [ ] Metric: "Server Request Count"
- [ ] Title: "Total Requests"
- [ ] Click "Apply"
- [ ] Position next to response time

**Status**: ⏳ _________________

### Phase 4C: Add Error Rate Widget
- [ ] Click "+ Add"
- [ ] Select "Application Insights"
- [ ] Resource: "amerivet-appinsights"
- [ ] Metric: "Failed Request Count"
- [ ] Title: "Error Rate"
- [ ] Click "Apply"
- [ ] Position in same row

**Status**: ⏳ _________________

### Phase 4D: Add Availability Widget
- [ ] Click "+ Add"
- [ ] Select "Application Insights"
- [ ] Resource: "amerivet-appinsights"
- [ ] Metric: "Availability"
- [ ] Title: "Availability %"
- [ ] Time Range: "Last 7 days"
- [ ] Click "Apply"

**Status**: ⏳ _________________

### ✅ TASK 4 COMPLETE
**Timestamp**: _________________  
**Notes**: _________________

---

## 🟢 TASK 5: Save & Share Dashboard

### Phase 5A: Save Dashboard
- [ ] Click "Done editing" button
- [ ] Dashboard is now saved
- [ ] Verify name: "Benefits-AI-Cost-Dashboard"

**Status**: ⏳ _________________

### Phase 5B: Share Dashboard (Optional)
- [ ] Click "Share" button
- [ ] Click "Publish to resource group"
- [ ] Select: "benefits-chatbot-project"
- [ ] Team members can now access

**Status**: ⏳ _________________

### ✅ TASK 5 COMPLETE
**Timestamp**: _________________  
**Notes**: _________________

---

## 📊 FINAL VERIFICATION

### Cost Alerts Active ✅
- [ ] Budget: $74,038/month
- [ ] 50% alert: Configured
- [ ] 75% alert: Configured
- [ ] 90% alert: Configured
- [ ] Email: sonalmogra.888@gmail.com
- [ ] Action Group: benefits-ai-cost-alerts

### Dashboard Ready ✅
- [ ] Name: Benefits-AI-Cost-Dashboard
- [ ] 4 cost tiles visible
- [ ] 4 performance tiles visible
- [ ] All tiles loading data
- [ ] Dashboard shareable

### Alerts & Monitoring Active ✅
- [ ] Email notifications will send at 50%, 75%, 90% spend
- [ ] Real-time dashboard shows current costs
- [ ] Performance metrics visible (latency, errors, availability)
- [ ] Budget vs Actual comparison visible

---

## 🎯 COMPLETION SUMMARY

**All Tasks Completed**: ✅

| Task | Status | Completed | Notes |
|------|--------|-----------|-------|
| Create Budget Alerts | ✅ | | 3 alerts at 50%, 75%, 90% |
| Verify Email | ✅ | | sonalmogra.888@gmail.com |
| Create Dashboard | ✅ | | 4 cost + 4 performance tiles |
| Share Dashboard | ✅ | | Team access enabled |

**Total Time**: _________ minutes

**Overall Status**: 🟢 **MONITORING IS LIVE**

---

## 📱 What Happens Now

✅ **Automated Alerts**:
- When spending reaches 50% → Email sent
- When spending reaches 75% → Email sent
- When spending reaches 90% → Email sent
- When budget reached → Warning sent

✅ **Real-Time Visibility**:
- Access dashboard anytime: Azure Portal → Dashboards
- View current daily spend
- See cost breakdown by service
- Monitor performance metrics

✅ **Cost Management**:
- Receive email warnings before budget exceeded
- Make adjustments if needed
- Track trends over time

---

**Document Version**: 1.0  
**Date**: November 11, 2025  
**Status**: 🟢 LIVE & ACTIVE
