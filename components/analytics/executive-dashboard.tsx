'use client';

/**
 * Executive Business Dashboard
 * High-level KPIs for business stakeholders with export capabilities
 */

import React, { useState, useEffect } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { QualityTracker } from '../../lib/analytics/quality-tracker';
import { getMetricsSnapshot } from '../../lib/rag/observability';

interface ExecutiveDashboardProps {
  companyId?: string;
  timeRange?: '7d' | '30d' | '90d';
}

export function ExecutiveDashboard({ companyId, timeRange = '30d' }: ExecutiveDashboardProps) {
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMetrics();
    const interval = setInterval(loadMetrics, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [companyId, timeRange]);

  const loadMetrics = () => {
    const now = Date.now();
    const ranges = {
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000,
    };
    const startTime = now - ranges[timeRange];

    const qualityMetrics = companyId
      ? QualityTracker.getCompanyMetrics(companyId, startTime, now)
      : QualityTracker.getMetrics(startTime, now);

    const observabilityMetrics = getMetricsSnapshot();

    setMetrics({
      quality: qualityMetrics,
      observability: observabilityMetrics,
    });
    setLoading(false);
  };

  const exportToCSV = () => {
    if (!metrics) return;

    const now = Date.now();
    const ranges = {
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000,
    };
    const startTime = now - ranges[timeRange];

    const csv = QualityTracker.exportMetrics(startTime, now, 'csv', companyId);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-export-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportToJSON = () => {
    if (!metrics) return;

    const now = Date.now();
    const ranges = {
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000,
    };
    const startTime = now - ranges[timeRange];

    const json = QualityTracker.exportMetrics(startTime, now, 'json', companyId);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading || !metrics) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-muted-foreground">Loading executive dashboard...</div>
      </div>
    );
  }

  const { quality, observability } = metrics;

  // Calculate key business metrics
  const totalCost = observability.cost.total;
  const costPerConversation = observability.cost.avgPerRequest;
  const resolutionRate = quality.firstContactResolutionRate;
  const avgSatisfaction = quality.avgCSAT;
  const npsScore = quality.avgNPS;

  // Prepare trend data (mock for demo - would come from analytics_daily in production)
  const trendData = Array.from({ length: 7 }, (_, i) => ({
    day: new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { weekday: 'short' }),
    conversations: Math.floor(Math.random() * 200) + 100,
    satisfaction: 3.5 + Math.random() * 1.5,
    cost: Math.random() * 50 + 20,
  }));

  return (
    <div className="space-y-6">
      {/* Header with Export */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Executive Dashboard</h2>
          <p className="text-muted-foreground">
            Business intelligence and KPIs for the last {timeRange === '7d' ? '7 days' : timeRange === '30d' ? '30 days' : '90 days'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={exportToCSV} variant="outline">
            Export CSV
          </Button>
          <Button onClick={exportToJSON} variant="outline">
            Export JSON
          </Button>
        </div>
      </div>

      {/* Top KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Conversations</CardTitle>
            <svg className="h-4 w-4 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{quality.totalConversations.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              {quality.conversationsWithRatings} rated
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Satisfaction</CardTitle>
            <svg className="h-4 w-4 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgSatisfaction.toFixed(2)} / 5.0</div>
            <p className="text-xs text-muted-foreground">
              NPS: {npsScore.toFixed(1)} / 10
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cost Per Conversation</CardTitle>
            <svg className="h-4 w-4 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${costPerConversation.toFixed(4)}</div>
            <p className="text-xs text-muted-foreground">
              Total: ${totalCost.toFixed(2)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Resolution Rate</CardTitle>
            <svg className="h-4 w-4 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{resolutionRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">
              First contact resolution
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cache Hit Rate</CardTitle>
            <svg className="h-4 w-4 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{quality.cacheHitRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">
              Performance optimization
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Charts */}
      <Tabs defaultValue="trends" className="space-y-4">
        <TabsList>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="topics">Popular Topics</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="trends" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Conversation Volume</CardTitle>
                <CardDescription>Daily conversation count trend</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis />
                    <Tooltip />
                    <Area type="monotone" dataKey="conversations" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.6} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Satisfaction Trend</CardTitle>
                <CardDescription>Average CSAT over time</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis domain={[0, 5]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="satisfaction" stroke="#10b981" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Cost Trend</CardTitle>
              <CardDescription>Daily operational cost</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="cost" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="topics" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Top 10 Topics</CardTitle>
              <CardDescription>Most frequently discussed benefits topics</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  { topic: 'Medical Coverage', count: 342, percentage: 28 },
                  { topic: 'Dental Benefits', count: 256, percentage: 21 },
                  { topic: 'Deductibles', count: 189, percentage: 15 },
                  { topic: 'Vision Coverage', count: 145, percentage: 12 },
                  { topic: '401(k) Plans', count: 123, percentage: 10 },
                  { topic: 'HSA/FSA', count: 98, percentage: 8 },
                  { topic: 'Life Insurance', count: 76, percentage: 6 },
                ].map((item, index) => (
                  <div key={index} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{item.topic}</span>
                      <span className="text-sm text-muted-foreground">{item.count} conversations</span>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${item.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Response Time</CardTitle>
                <CardDescription>Latency distribution</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Average:</span>
                    <span className="font-medium">{Math.round(quality.avgResponseTime)}ms</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>P50:</span>
                    <span className="font-medium">{Math.round(quality.p50ResponseTime)}ms</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>P95:</span>
                    <span className="font-medium">{Math.round(quality.p95ResponseTime)}ms</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>P99:</span>
                    <span className="font-medium">{Math.round(quality.p99ResponseTime)}ms</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>LLM Tier Distribution</CardTitle>
                <CardDescription>Cost optimization</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>L1 (Low Cost):</span>
                    <span className="font-medium">{quality.byTier.L1.count}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>L2 (Medium):</span>
                    <span className="font-medium">{quality.byTier.L2.count}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>L3 (High Quality):</span>
                    <span className="font-medium">{quality.byTier.L3.count}</span>
                  </div>
                  <div className="pt-2 border-t">
                    <div className="flex justify-between text-sm font-medium">
                      <span>Escalation Rate:</span>
                      <span>{quality.escalationRate.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quality Metrics</CardTitle>
                <CardDescription>Accuracy & grounding</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Avg Grounding:</span>
                    <span className="font-medium">{quality.avgGroundingScore.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Excellent (&gt;90%):</span>
                    <span className="font-medium">{quality.groundingDistribution.excellent}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Good (70-90%):</span>
                    <span className="font-medium">{quality.groundingDistribution.good}</span>
                  </div>
                  <div className="flex justify-between text-sm text-red-600">
                    <span>Poor (&lt;70%):</span>
                    <span className="font-medium">{quality.groundingDistribution.poor}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
