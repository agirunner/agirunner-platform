import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, RefreshCw, Search } from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';

function splitMetricLines(metrics: string | undefined): string[] {
  return (metrics ?? '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

function countMetricFamilies(lines: string[]): number {
  const families = new Set<string>();
  for (const line of lines) {
    if (line.startsWith('#')) {
      continue;
    }
    const metricName = line.split(/[{\s]/, 1)[0];
    if (metricName) {
      families.add(metricName);
    }
  }
  return families.size;
}

function countCommentLines(lines: string[]): number {
  return lines.filter((line) => line.startsWith('#')).length;
}

export function SystemMetricsPage(): JSX.Element {
  const [filter, setFilter] = useState('');
  const query = useQuery({
    queryKey: ['metrics'],
    queryFn: () => dashboardApi.getMetrics(),
    refetchInterval: 15000,
  });

  const lines = useMemo(() => splitMetricLines(query.data), [query.data]);
  const normalizedFilter = filter.trim().toLowerCase();
  const matchingLines = useMemo(
    () =>
      normalizedFilter.length === 0
        ? lines
        : lines.filter((line) => line.toLowerCase().includes(normalizedFilter)),
    [lines, normalizedFilter],
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Activity className="h-6 w-6 text-muted" />
            <h1 className="text-2xl font-semibold">System Metrics</h1>
          </div>
          <p className="max-w-2xl text-sm text-muted">
            Inspect the live Prometheus platform metrics feed. Use the filter to narrow output to
            a metric family or label of interest. Runtime continuity metrics such as
            `agirunner_runtime_context_warnings_total` and
            `agirunner_runtime_loop_compactions_total` appear here only after your aggregation
            pipeline exposes runtime registries alongside the platform feed.
          </p>
        </div>
        <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Metric Families</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            {countMetricFamilies(lines)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Series Lines</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{lines.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Help / Type Lines</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            {countCommentLines(lines)}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Metrics Output</CardTitle>
          <CardDescription>
            Filter metrics by name or label text, then scroll the live output below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="grid gap-2">
            <span className="text-sm font-medium">Filter metrics</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                className="pl-9"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="http_requests_total, worker, activation_id..."
              />
            </div>
          </label>

          {query.isLoading ? <p className="text-sm text-muted">Loading metrics...</p> : null}
          {query.error ? <p className="text-sm text-red-600">Failed to load metrics.</p> : null}
          {!query.isLoading && !query.error ? (
            matchingLines.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-border/70 bg-surface/80">
                <pre className="max-h-[70vh] min-h-[320px] overflow-y-auto p-4 text-xs leading-6 text-foreground">
                  <code>{matchingLines.join('\n')}</code>
                </pre>
              </div>
            ) : (
              <p className="text-sm text-muted">No metrics match the current filter.</p>
            )
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
