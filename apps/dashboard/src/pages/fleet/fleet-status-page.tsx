import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Clock,
  Container,
  Gauge,
  Loader2,
  Pause,
  Play,
  Server,
} from 'lucide-react';
import { readSession } from '../../lib/session.js';
import { cn } from '../../lib/utils.js';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

const REFETCH_INTERVAL_MS = 5000;
const EVENTS_PER_PAGE = 10;

interface TemplateFleetStatus {
  template_id: string;
  template_name: string;
  pool_mode: 'warm' | 'cold';
  max_runtimes: number;
  runtime_count: number;
  running: number;
  idle: number;
  executing: number;
  draining: number;
  pending_tasks: number;
  active_workflows: number;
}

interface FleetStatusResponse {
  total_runtimes: number;
  global_max: number;
  running: number;
  idle: number;
  executing: number;
  draining: number;
  templates: TemplateFleetStatus[];
}

interface FleetEvent {
  id: string;
  timestamp: string;
  type: string;
  level: 'info' | 'warning' | 'error';
  runtime_id: string;
  template_id?: string;
  details: string;
}

interface FleetEventsResponse {
  data: FleetEvent[];
  total: number;
}

async function fetchFleetStatus(): Promise<FleetStatusResponse> {
  const session = readSession();
  const resp = await fetch(`${API_BASE_URL}/api/v1/fleet/status`, {
    headers: { Authorization: `Bearer ${session?.accessToken}` },
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const json = await resp.json();
  return (json.data ?? json) as FleetStatusResponse;
}

async function fetchFleetEvents(
  page: number,
  templateFilter?: string,
): Promise<FleetEventsResponse> {
  const session = readSession();
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(EVENTS_PER_PAGE),
  });
  if (templateFilter) {
    params.set('template_id', templateFilter);
  }
  const resp = await fetch(`${API_BASE_URL}/api/v1/fleet/events?${params}`, {
    headers: { Authorization: `Bearer ${session?.accessToken}` },
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const json = await resp.json();
  return {
    data: json.data ?? [],
    total: json.total ?? json.data?.length ?? 0,
  };
}

function truncateId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}...` : id;
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function StatCard({
  label,
  value,
  icon: Icon,
  variant,
}: {
  label: string;
  value: number;
  icon: typeof Activity;
  variant?: string;
}): JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <Icon className={cn('h-5 w-5', variant ?? 'text-muted-foreground')} />
        <div>
          <p className="text-2xl font-semibold">{value}</p>
          <p className="text-xs text-muted">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function GlobalOverview({ status }: { status: FleetStatusResponse }): JSX.Element {
  const usagePercent =
    status.global_max > 0
      ? Math.round((status.total_runtimes / status.global_max) * 100)
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4" />
          Global Overview
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">Total Runtimes</span>
            <span className="font-medium">
              {status.total_runtimes} / {status.global_max}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted/20">
            <div
              className={cn(
                'h-2 rounded-full transition-all',
                usagePercent > 90 ? 'bg-red-500' : usagePercent > 70 ? 'bg-yellow-500' : 'bg-green-500',
              )}
              style={{ width: `${Math.min(usagePercent, 100)}%` }}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Running" value={status.running} icon={Play} variant="text-green-600" />
          <StatCard label="Idle" value={status.idle} icon={Pause} variant="text-yellow-600" />
          <StatCard label="Executing" value={status.executing} icon={Activity} variant="text-blue-600" />
          <StatCard label="Draining" value={status.draining} icon={Clock} variant="text-orange-600" />
        </div>
      </CardContent>
    </Card>
  );
}

function TemplateCard({ tpl }: { tpl: TemplateFleetStatus }): JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{tpl.template_name}</CardTitle>
          <Badge variant={tpl.pool_mode === 'warm' ? 'success' : 'secondary'}>
            {tpl.pool_mode}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Runtimes</span>
          <span className="font-medium">
            {tpl.runtime_count} / {tpl.max_runtimes}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-md border border-border p-2">
            <p className="font-semibold text-green-600">{tpl.running}</p>
            <p className="text-muted">Running</p>
          </div>
          <div className="rounded-md border border-border p-2">
            <p className="font-semibold text-yellow-600">{tpl.idle}</p>
            <p className="text-muted">Idle</p>
          </div>
          <div className="rounded-md border border-border p-2">
            <p className="font-semibold text-blue-600">{tpl.executing}</p>
            <p className="text-muted">Executing</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="flex items-center gap-1">
            <span className="text-muted">Pending:</span>
            <span className="font-medium">{tpl.pending_tasks}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted">Workflows:</span>
            <span className="font-medium">{tpl.active_workflows}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const LEVEL_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  info: 'secondary',
  warning: 'warning',
  error: 'destructive',
};

function EventsTable({
  templates,
}: {
  templates: TemplateFleetStatus[];
}): JSX.Element {
  const [page, setPage] = useState(1);
  const [templateFilter, setTemplateFilter] = useState<string>('');

  const { data, isLoading } = useQuery({
    queryKey: ['fleet-events', page, templateFilter],
    queryFn: () => fetchFleetEvents(page, templateFilter || undefined),
    refetchInterval: REFETCH_INTERVAL_MS,
  });

  const events = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / EVENTS_PER_PAGE));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Recent Events</CardTitle>
          <Select
            value={templateFilter}
            onValueChange={(val) => {
              setTemplateFilter(val === 'all' ? '' : val);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All templates" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All templates</SelectItem>
              {templates.map((tpl) => (
                <SelectItem key={tpl.template_id} value={tpl.template_id}>
                  {tpl.template_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted">No events found.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="pb-2 pr-4">Time</th>
                    <th className="pb-2 pr-4">Type</th>
                    <th className="pb-2 pr-4">Level</th>
                    <th className="pb-2 pr-4">Runtime ID</th>
                    <th className="pb-2">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id} className="border-b border-border/50">
                      <td className="py-2 pr-4 text-xs text-muted whitespace-nowrap">
                        {formatTimestamp(event.timestamp)}
                      </td>
                      <td className="py-2 pr-4 font-medium">{event.type}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={LEVEL_VARIANT[event.level] ?? 'secondary'}>
                          {event.level}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs" title={event.runtime_id}>
                        {truncateId(event.runtime_id)}
                      </td>
                      <td className="py-2 text-muted">{event.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-muted">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function FleetStatusPage(): JSX.Element {
  const { data: status, isLoading, isError } = useQuery({
    queryKey: ['fleet-status'],
    queryFn: fetchFleetStatus,
    refetchInterval: REFETCH_INTERVAL_MS,
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-48" />
        </div>
        <Skeleton className="h-48 w-full" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !status) {
    return (
      <div className="p-6 text-red-600">
        Failed to load fleet status.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Container className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Fleet Status</h1>
        <Loader2 className="ml-2 h-4 w-4 animate-spin text-muted" />
        <span className="text-xs text-muted">Auto-refreshing</span>
      </div>

      <GlobalOverview status={status} />

      {status.templates.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-medium">Per-Template Status</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {status.templates.map((tpl) => (
              <TemplateCard key={tpl.template_id} tpl={tpl} />
            ))}
          </div>
        </div>
      )}

      <EventsTable templates={status.templates} />
    </div>
  );
}
