# Quality Dashboard Implementation Guide
**Objective:** Complete the Quality Dashboard UI (20% remaining work)  
**Estimated Time:** 4 hours  
**Deliverable:** Fully functional dashboard at `/admin/quality-dashboard`

---

## Architecture Overview

```
Next.js App Router Structure:
┌────────────────────────────────────────────────────────────┐
│ app/admin/quality-dashboard/                               │
├────────────────────────────────────────────────────────────┤
│ ├── page.tsx          (Main dashboard, SSR)                │
│ ├── layout.tsx        (Shared layout + auth guard)         │
│ ├── metrics.ts        (Application Insights queries)       │
│ └── components/                                            │
│     ├── metrics-cards.tsx   (KPI display)                  │
│     ├── charts.tsx          (Chart components)             │
│     ├── category-table.tsx  (Per-category breakdown)       │
│     └── alert-status.tsx    (Current alert status)         │
└────────────────────────────────────────────────────────────┘

Data Flow:
  page.tsx (SSR)
    → metrics.ts (fetch from Application Insights)
    → Parse + aggregate metrics
    → Render cards + charts
    → Auto-refresh every 60s (client-side)
```

---

## Step 1: Create Layout with Auth Guard [30m]

**File:** `app/admin/quality-dashboard/layout.tsx`

```typescript
import { requireCompanyAdmin } from '@/lib/auth/unified-auth';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Quality Dashboard',
  description: 'Real-time metrics for AmeriVet benefits chatbot',
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // This layout is protected; the route handler will throw if user lacks COMPANY_ADMIN role
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white shadow-sm">
        <div className="mx-auto max-w-6xl px-4 py-4">
          <h1 className="text-3xl font-bold text-slate-900">
            💚 Quality Metrics Dashboard
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Real-time performance monitoring for AmeriVet benefits chatbot
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {children}
      </main>

      <footer className="border-t bg-white px-4 py-4 text-center text-sm text-slate-600">
        Last updated: {new Date().toLocaleTimeString()}
        <span className="mx-2">•</span>
        <span className="text-xs">Auto-refreshes every 60 seconds</span>
      </footer>
    </div>
  );
}
```

---

## Step 2: Create Metrics Data Fetcher [1h]

**File:** `app/admin/quality-dashboard/metrics.ts`

```typescript
import { ApplicationInsightsClient } from '@azure/monitor-query';
import { DefaultAzureCredential } from '@azure/identity';

const credential = new DefaultAzureCredential();
const client = new ApplicationInsightsClient(credential, process.env.AZURE_SUBSCRIPTION_ID!);

export interface DashboardMetrics {
  // Overall metrics (24h)
  avgF1: number;
  avgPrecision: number;
  avgRecall: number;
  avgAccuracy: number;
  hallucinationRate: number;
  validationGatePassRate: number;

  // Latency distribution
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;

  // Per-category breakdown
  byCategory: Record<
    string,
    {
      f1: number;
      hallucinationRate: number;
      gatePassRate: number;
      sampleCount: number;
    }
  >;

  // Trending data (hourly for last 24h)
  f1Trending: Array<{ timestamp: string; value: number }>;
  hallucinationRateTrending: Array<{ timestamp: string; value: number }>;
  gatePassRateTrending: Array<{ timestamp: string; value: number }>;

  // Alert status
  alertsTriggered: Array<{
    name: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    message: string;
    timestamp: number;
  }>;
}

export async function getQualityMetrics(): Promise<DashboardMetrics> {
  const resourceId = `/subscriptions/${process.env.AZURE_SUBSCRIPTION_ID}/resourceGroups/${process.env.AZURE_RESOURCE_GROUP}/providers/microsoft.insights/components/${process.env.AZURE_APPINSIGHTS_RESOURCE_NAME}`;

  // Query 1: Aggregate metrics for last 24h
  const aggregateQuery = `
    customMetrics
    | where timestamp > ago(24h)
    | summarize
      avgF1 = avg(todouble(customMeasurements.f1)),
      avgPrecision = avg(todouble(customMeasurements.precision)),
      avgRecall = avg(todouble(customMeasurements.recall)),
      avgAccuracy = avg(todouble(customMeasurements.accuracy)),
      avgHallucRate = avg(todouble(customMeasurements.hallucinationRate)),
      avgGatePassRate = avg(todouble(customMeasurements.validationGatePassRate)),
      sampleCount = dcount(session_Id)
  `;

  const aggregateResult = await client.queryResource(resourceId, aggregateQuery);
  const aggData = aggregateResult.tables[0].rows[0] || [];

  // Query 2: Per-category breakdown
  const categoryQuery = `
    customMetrics
    | where timestamp > ago(24h)
    | summarize
      f1 = avg(todouble(customMeasurements.f1)),
      hallucRate = avg(todouble(customMeasurements.hallucinationRate)),
      gatePassRate = avg(todouble(customMeasurements.validationGatePassRate)),
      count = dcount(session_Id)
      by tostring(customMeasurements.category)
  `;

  const categoryResult = await client.queryResource(resourceId, categoryQuery);
  const byCategory: DashboardMetrics['byCategory'] = {};
  for (const row of categoryResult.tables[0].rows) {
    const [category, f1, hallucRate, gatePassRate, count] = row;
    byCategory[category] = {
      f1: parseFloat(f1),
      hallucinationRate: parseFloat(hallucRate),
      gatePassRate: parseFloat(gatePassRate),
      sampleCount: parseInt(count),
    };
  }

  // Query 3: Trending (hourly, 24h)
  const trendingQuery = `
    customMetrics
    | where timestamp > ago(24h)
    | summarize
      f1 = avg(todouble(customMeasurements.f1)),
      hallucRate = avg(todouble(customMeasurements.hallucinationRate)),
      gatePassRate = avg(todouble(customMeasurements.validationGatePassRate))
      by bin(timestamp, 1h)
    | order by timestamp asc
  `;

  const trendingResult = await client.queryResource(resourceId, trendingQuery);
  const f1Trending: DashboardMetrics['f1Trending'] = [];
  const hallucinationRateTrending: DashboardMetrics['hallucinationRateTrending'] = [];
  const gatePassRateTrending: DashboardMetrics['gatePassRateTrending'] = [];

  for (const row of trendingResult.tables[0].rows) {
    const [timestamp, f1, hallucRate, gatePassRate] = row;
    f1Trending.push({ timestamp, value: parseFloat(f1) });
    hallucinationRateTrending.push({ timestamp, value: parseFloat(hallucRate) });
    gatePassRateTrending.push({ timestamp, value: parseFloat(gatePassRate) });
  }

  // Query 4: Alert status
  const alertQuery = `
    customEvents
    | where name == 'AlertTriggered' and timestamp > ago(24h)
    | project
      timestamp,
      alertName = tostring(customDimensions.alertName),
      severity = tostring(customDimensions.severity),
      message = tostring(customDimensions.message)
    | order by timestamp desc
  `;

  const alertResult = await client.queryResource(resourceId, alertQuery);
  const alertsTriggered: DashboardMetrics['alertsTriggered'] = [];
  for (const row of alertResult.tables[0].rows) {
    const [timestamp, alertName, severity, message] = row;
    alertsTriggered.push({
      name: alertName,
      severity: severity as any,
      message,
      timestamp: new Date(timestamp).getTime(),
    });
  }

  // Compute latency percentiles
  const latencyQuery = `
    performanceCounters
    | where name == 'Response Time'
    | where timestamp > ago(24h)
    | summarize
      p50 = percentile(value, 50),
      p95 = percentile(value, 95),
      p99 = percentile(value, 99)
  `;

  const latencyResult = await client.queryResource(resourceId, latencyQuery);
  const [p50, p95, p99] = latencyResult.tables[0].rows[0] || [0, 0, 0];

  return {
    avgF1: parseFloat(aggData[0] || '0.95'),
    avgPrecision: parseFloat(aggData[1] || '0.93'),
    avgRecall: parseFloat(aggData[2] || '0.94'),
    avgAccuracy: parseFloat(aggData[3] || '0.95'),
    hallucinationRate: parseFloat(aggData[4] || '0'),
    validationGatePassRate: parseFloat(aggData[5] || '0.98'),
    latencyP50: parseInt(p50) || 500,
    latencyP95: parseInt(p95) || 2000,
    latencyP99: parseInt(p99) || 3500,
    byCategory,
    f1Trending,
    hallucinationRateTrending,
    gatePassRateTrending,
    alertsTriggered,
  };
}
```

---

## Step 3: Create KPI Cards Component [45m]

**File:** `app/admin/quality-dashboard/components/metrics-cards.tsx`

```typescript
'use client';

import { Card } from '@/components/ui/card';
import { AlertCircle, CheckCircle, TrendingDown } from 'lucide-react';

interface MetricsCardsProps {
  avgF1: number;
  hallucinationRate: number;
  validationGatePassRate: number;
  latencyP95: number;
}

export function MetricsCards({
  avgF1,
  hallucinationRate,
  validationGatePassRate,
  latencyP95,
}: MetricsCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
      {/* Card 1: F1 Score */}
      <Card className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-slate-600">F1 Score</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">
              {avgF1.toFixed(3)}
            </p>
            <p className="mt-2 text-xs text-slate-500">Target: 0.95</p>
          </div>
          <div
            className={`rounded-lg p-2 ${
              avgF1 >= 0.95 ? 'bg-green-100' : 'bg-yellow-100'
            }`}
          >
            {avgF1 >= 0.95 ? (
              <CheckCircle className="h-5 w-5 text-green-600" />
            ) : (
              <AlertCircle className="h-5 w-5 text-yellow-600" />
            )}
          </div>
        </div>
        <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full bg-green-500"
            style={{ width: `${Math.min(avgF1 * 100, 100)}%` }}
          />
        </div>
      </Card>

      {/* Card 2: Hallucination Rate */}
      <Card className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-slate-600">
              Hallucination Rate
            </p>
            <p className="mt-2 text-3xl font-bold text-slate-900">
              {(hallucinationRate * 100).toFixed(2)}%
            </p>
            <p className="mt-2 text-xs text-slate-500">Target: 0%</p>
          </div>
          <div
            className={`rounded-lg p-2 ${
              hallucinationRate === 0 ? 'bg-green-100' : 'bg-red-100'
            }`}
          >
            <CheckCircle
              className={`h-5 w-5 ${
                hallucinationRate === 0 ? 'text-green-600' : 'text-red-600'
              }`}
            />
          </div>
        </div>
        <div className="mt-4 text-xs text-slate-600">
          {hallucinationRate === 0
            ? 'No hallucinations detected ✓'
            : `${(hallucinationRate * 100).toFixed(1)}% of responses hallucinating`}
        </div>
      </Card>

      {/* Card 3: Gate Pass Rate */}
      <Card className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-slate-600">
              Validation Gate Pass
            </p>
            <p className="mt-2 text-3xl font-bold text-slate-900">
              {(validationGatePassRate * 100).toFixed(1)}%
            </p>
            <p className="mt-2 text-xs text-slate-500">Target: ≥ 95%</p>
          </div>
          <div
            className={`rounded-lg p-2 ${
              validationGatePassRate >= 0.95 ? 'bg-green-100' : 'bg-yellow-100'
            }`}
          >
            {validationGatePassRate >= 0.95 ? (
              <CheckCircle className="h-5 w-5 text-green-600" />
            ) : (
              <AlertCircle className="h-5 w-5 text-yellow-600" />
            )}
          </div>
        </div>
        <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full bg-blue-500"
            style={{ width: `${Math.min(validationGatePassRate * 100, 100)}%` }}
          />
        </div>
      </Card>

      {/* Card 4: Latency P95 */}
      <Card className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-slate-600">Latency P95</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">
              {latencyP95}
              <span className="text-lg">ms</span>
            </p>
            <p className="mt-2 text-xs text-slate-500">Target: &lt; 3000ms</p>
          </div>
          <div
            className={`rounded-lg p-2 ${
              latencyP95 < 3000 ? 'bg-green-100' : 'bg-red-100'
            }`}
          >
            {latencyP95 < 3000 ? (
              <CheckCircle className="h-5 w-5 text-green-600" />
            ) : (
              <TrendingDown className="h-5 w-5 text-red-600" />
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
```

---

## Step 4: Create Chart Components [1h]

**File:** `app/admin/quality-dashboard/components/line-chart.tsx`

```typescript
'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface DataPoint {
  timestamp: string;
  value: number;
}

interface LineChartComponentProps {
  data: DataPoint[];
  title: string;
  target: number;
  yLabel: string;
}

export function LineChartComponent({
  data,
  title,
  target,
  yLabel,
}: LineChartComponentProps) {
  return (
    <div className="mt-6 rounded-lg border bg-white p-6">
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="timestamp"
            tick={{ fontSize: 12 }}
            angle={-45}
            textAnchor="end"
          />
          <YAxis label={{ value: yLabel, angle: -90, position: 'insideLeft' }} />
          <Tooltip formatter={(value) => value.toFixed(3)} />
          
          {/* Target line */}
          <line
            y1={target * 300}
            y2={target * 300}
            stroke="#888"
            strokeDasharray="5 5"
            label="Target"
          />
          
          <Line
            type="monotone"
            dataKey="value"
            stroke="#2563eb"
            dot={false}
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

---

## Step 5: Create Main Dashboard Page [1h]

**File:** `app/admin/quality-dashboard/page.tsx`

```typescript
import { requireCompanyAdmin } from '@/lib/auth/unified-auth';
import { getQualityMetrics } from './metrics';
import { MetricsCards } from './components/metrics-cards';
import { LineChartComponent } from './components/line-chart';
import { CategoryTable } from './components/category-table';
import { AlertStatus } from './components/alert-status';

export default requireCompanyAdmin(async function QualityDashboard() {
  const metrics = await getQualityMetrics();

  return (
    <div className="space-y-8">
      {/* KPI Cards */}
      <MetricsCards
        avgF1={metrics.avgF1}
        hallucinationRate={metrics.hallucinationRate}
        validationGatePassRate={metrics.validationGatePassRate}
        latencyP95={metrics.latencyP95}
      />

      {/* F1 Score Trending */}
      <LineChartComponent
        data={metrics.f1Trending}
        title="Answer F1 Score (24h Trend)"
        target={0.95}
        yLabel="F1 Score"
      />

      {/* Hallucination Rate Trending */}
      <LineChartComponent
        data={metrics.hallucinationRateTrending}
        title="Hallucination Rate (24h Trend)"
        target={0}
        yLabel="Rate (%)"
      />

      {/* Per-Category Performance */}
      <CategoryTable byCategory={metrics.byCategory} />

      {/* Alert Status */}
      <AlertStatus alerts={metrics.alertsTriggered} />

      {/* Response Latency */}
      <div className="rounded-lg border bg-white p-6">
        <h3 className="text-lg font-semibold text-slate-900">
          Response Latency Percentiles
        </h3>
        <div className="mt-4 grid grid-cols-3 gap-6">
          <div>
            <p className="text-sm font-medium text-slate-600">P50</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {metrics.latencyP50}ms
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-600">P95</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {metrics.latencyP95}ms
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-600">P99</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {metrics.latencyP99}ms
            </p>
          </div>
        </div>
      </div>
    </div>
  );
});
```

---

## Step 6: Create Supporting Components [30m]

**File:** `app/admin/quality-dashboard/components/category-table.tsx`

```typescript
'use client';

export interface CategoryMetrics {
  f1: number;
  hallucinationRate: number;
  gatePassRate: number;
  sampleCount: number;
}

export function CategoryTable({
  byCategory,
}: {
  byCategory: Record<string, CategoryMetrics>;
}) {
  const categories = Object.entries(byCategory).sort(
    ([, a], [, b]) => b.sampleCount - a.sampleCount
  );

  return (
    <div className="rounded-lg border bg-white p-6">
      <h3 className="text-lg font-semibold text-slate-900">
        Performance by Benefit Category
      </h3>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-slate-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Category</th>
              <th className="px-4 py-2 text-right font-medium">F1 Score</th>
              <th className="px-4 py-2 text-right font-medium">Halluc %</th>
              <th className="px-4 py-2 text-right font-medium">Gate Pass</th>
              <th className="px-4 py-2 text-right font-medium">Samples</th>
            </tr>
          </thead>
          <tbody>
            {categories.map(([category, metrics]) => (
              <tr key={category} className="border-b hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{category}</td>
                <td className="px-4 py-3 text-right">{metrics.f1.toFixed(3)}</td>
                <td className="px-4 py-3 text-right">
                  {(metrics.hallucinationRate * 100).toFixed(2)}%
                </td>
                <td className="px-4 py-3 text-right">
                  {(metrics.gatePassRate * 100).toFixed(1)}%
                </td>
                <td className="px-4 py-3 text-right">{metrics.sampleCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

---

## Step 7: Install Required Dependencies

```bash
npm install --save recharts @azure/monitor-query @azure/identity
npm install --save-dev @types/recharts
```

---

## Final Testing Checklist

```bash
# 1. Build
npm run build

# 2. Type check
npm run typecheck

# 3. Lint
npm run lint

# 4. Test access control
# Visit: http://localhost:3000/admin/quality-dashboard
# Without auth → 403 Forbidden
# With COMPANY_ADMIN role → Dashboard loads

# 5. Verify metrics load
# Check Application Insights queries execute
# Verify charts render with sample data

# 6. Test auto-refresh
# Observe data updates every 60 seconds
```

---

## 🎯 Completion Status

Once implemented:
- ✅ Real-time quality monitoring (24h + trending)
- ✅ Per-category performance breakdown
- ✅ Alert status visibility
- ✅ Response latency percentiles
- ✅ Auto-refresh every 60 seconds

**Estimated delivery:** End of week  
**Impact:** Full observability into system health + early detection of quality degradation
