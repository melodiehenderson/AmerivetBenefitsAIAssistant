'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
  Activity,
  Clock,
  Zap,
  Shield,
} from 'lucide-react';
import type { PipelineTrace } from '@/lib/services/pipeline-logger';

type Filter = 'all' | 'failed';

export default function PipelineTracesPage() {
  const router = useRouter();
  const [traces, setTraces] = useState<PipelineTrace[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchTraces = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (filter === 'failed') params.set('filter', 'failed');
      const res = await fetch(`/api/admin/pipeline-traces?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTraces(data.traces || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load traces');
      setTraces([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchTraces();
  }, [fetchTraces]);

  const stats = {
    total: traces.length,
    failed: traces.filter(t => !t.success).length,
    gateFailed: traces.filter(t => !t.gate.passed).length,
    avgLatency: traces.length
      ? Math.round(traces.reduce((s, t) => s + t.totalLatencyMs, 0) / traces.length)
      : 0,
    hallucinations: traces.reduce((s, t) => s + (t.response.hallucinationsDetected || 0), 0),
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => router.push('/admin')}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Admin
            </Button>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-600" />
              Pipeline Traces
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={filter === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('all')}
            >
              All
            </Button>
            <Button
              variant={filter === 'failed' ? 'destructive' : 'outline'}
              size="sm"
              onClick={() => setFilter('failed')}
            >
              <AlertTriangle className="w-3 h-3 mr-1" /> Failed
            </Button>
            <Button variant="outline" size="sm" onClick={fetchTraces} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard label="Total Traces" value={stats.total} icon={<Activity className="w-4 h-4 text-blue-600" />} />
          <StatCard label="Failed" value={stats.failed} icon={<XCircle className="w-4 h-4 text-red-600" />} variant={stats.failed > 0 ? 'danger' : 'default'} />
          <StatCard label="Gate Failures" value={stats.gateFailed} icon={<Shield className="w-4 h-4 text-amber-600" />} variant={stats.gateFailed > 0 ? 'warning' : 'default'} />
          <StatCard label="Avg Latency" value={`${stats.avgLatency}ms`} icon={<Clock className="w-4 h-4 text-purple-600" />} />
          <StatCard label="Hallucinations" value={stats.hallucinations} icon={<Zap className="w-4 h-4 text-orange-600" />} variant={stats.hallucinations > 0 ? 'warning' : 'default'} />
        </div>

        {/* Error state */}
        {error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4 text-sm text-red-800">
              {error}. Cosmos DB may be unavailable or the pipeline_logs container may not exist yet.
            </CardContent>
          </Card>
        )}

        {/* Traces table */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Pipeline Executions</CardTitle>
            <CardDescription>
              Last {traces.length} traces — click a row to expand full details
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-12 text-sm text-muted-foreground">Loading traces...</div>
            ) : traces.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                No traces found. Pipeline logs will appear here once users interact with the chatbot.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Query</TableHead>
                    <TableHead>Intent</TableHead>
                    <TableHead>Gate</TableHead>
                    <TableHead>Top Score</TableHead>
                    <TableHead>Response</TableHead>
                    <TableHead>Latency</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {traces.map((t) => (
                    <TraceRow
                      key={t.id}
                      trace={t}
                      expanded={expandedId === t.id}
                      onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({ label, value, icon, variant = 'default' }: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  variant?: 'default' | 'danger' | 'warning';
}) {
  const bg = variant === 'danger' ? 'bg-red-50 border-red-200' : variant === 'warning' ? 'bg-amber-50 border-amber-200' : 'bg-white';
  return (
    <Card className={bg}>
      <CardContent className="p-4 flex items-center gap-3">
        {icon}
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function TraceRow({ trace: t, expanded, onToggle }: {
  trace: PipelineTrace;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isFailed = !t.success || !t.gate.passed;
  const rowClass = isFailed ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50';
  const time = new Date(t.timestamp).toLocaleTimeString();
  const query = t.userQuery.length > 50 ? t.userQuery.slice(0, 50) + '...' : t.userQuery;

  return (
    <>
      <TableRow className={`${rowClass} cursor-pointer`} onClick={onToggle}>
        <TableCell>
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </TableCell>
        <TableCell className="text-xs whitespace-nowrap">{time}</TableCell>
        <TableCell className="text-xs">{t.userName}</TableCell>
        <TableCell><Badge variant="outline" className="text-xs">{t.userState}</Badge></TableCell>
        <TableCell className="text-xs max-w-[200px] truncate" title={t.userQuery}>{query}</TableCell>
        <TableCell><Badge variant="secondary" className="text-xs">{t.intent.detected}</Badge></TableCell>
        <TableCell>
          {t.gate.passed
            ? <CheckCircle className="w-4 h-4 text-green-600" />
            : <XCircle className="w-4 h-4 text-red-600" />
          }
        </TableCell>
        <TableCell className="text-xs font-mono">{t.gate.topScore.toFixed(3)}</TableCell>
        <TableCell><Badge variant="outline" className="text-xs">{t.response.type}</Badge></TableCell>
        <TableCell className="text-xs font-mono">{t.totalLatencyMs}ms</TableCell>
        <TableCell>
          {t.success
            ? <Badge className="bg-green-100 text-green-800 text-xs">OK</Badge>
            : <Badge className="bg-red-100 text-red-800 text-xs">FAIL</Badge>
          }
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={11} className="bg-gray-50 p-0">
            <TraceDetail trace={t} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function TraceDetail({ trace: t }: { trace: PipelineTrace }) {
  return (
    <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
      {/* Session */}
      <div className="space-y-1 border rounded p-3 bg-white">
        <div className="font-semibold text-sm mb-1">Session</div>
        <Row label="Trace ID" value={t.traceId} />
        <Row label="Session ID" value={t.sessionId} />
        <Row label="User" value={`${t.userName} (age ${t.userAge ?? '?'})`} />
        <Row label="State" value={t.userState} />
        <Row label="Coverage" value={t.coverageTier} />
        <Row label="Query" value={t.userQuery} />
      </div>

      {/* Intent + Retrieval */}
      <div className="space-y-1 border rounded p-3 bg-white">
        <div className="font-semibold text-sm mb-1">Intent &amp; Retrieval</div>
        <Row label="Intent" value={t.intent.detected} />
        <Row label="Confidence" value={t.intent.confidence.toFixed(2)} />
        <Row label="Retrieval Method" value={t.retrieval.method} />
        <Row label="Chunks Returned" value={String(t.retrieval.chunksReturned)} />
        <Row label="Top Score" value={t.retrieval.topScore.toFixed(3)} />
        <Row label="Retrieval Latency" value={`${t.retrieval.latencyMs}ms`} />
        <Row label="Category" value={t.retrieval.category || 'N/A'} />
      </div>

      {/* Gate + LLM */}
      <div className="space-y-1 border rounded p-3 bg-white">
        <div className="font-semibold text-sm mb-1">Gate &amp; LLM</div>
        <Row label="Gate Passed" value={t.gate.passed ? 'YES' : 'NO'} highlight={!t.gate.passed} />
        <Row label="Gate Score" value={t.gate.topScore.toFixed(3)} />
        <Row label="Gate Chunks" value={String(t.gate.chunkCount)} />
        {t.gate.failReason && <Row label="Fail Reason" value={t.gate.failReason} highlight />}
        {t.llm ? (
          <>
            <Row label="Model" value={t.llm.model} />
            <Row label="Prompt Tokens" value={String(t.llm.promptTokens)} />
            <Row label="Completion Tokens" value={String(t.llm.completionTokens)} />
            <Row label="LLM Latency" value={`${t.llm.latencyMs}ms`} />
            <Row label="Temperature" value={String(t.llm.temperature)} />
          </>
        ) : (
          <Row label="LLM" value="Skipped (intercept/template)" />
        )}
      </div>

      {/* Response */}
      <div className="space-y-1 border rounded p-3 bg-white">
        <div className="font-semibold text-sm mb-1">Response</div>
        <Row label="Type" value={t.response.type} />
        {t.response.interceptName && <Row label="Intercept" value={t.response.interceptName} />}
        <Row label="Length" value={`${t.response.length} chars`} />
        <Row label="Citations Stripped" value={String(t.response.citationsStripped)} />
        <Row label="Hallucinations" value={String(t.response.hallucinationsDetected)} highlight={t.response.hallucinationsDetected > 0} />
        <Row label="Grounding Warnings" value={String(t.response.groundingWarnings)} highlight={t.response.groundingWarnings > 0} />
        <Row label="Total Latency" value={`${t.totalLatencyMs}ms`} />
        <Row label="Success" value={t.success ? 'YES' : 'NO'} highlight={!t.success} />
        {t.errorMessage && <Row label="Error" value={t.errorMessage} highlight />}
      </div>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${highlight ? 'text-red-600 font-semibold' : ''}`}>{value}</span>
    </div>
  );
}
