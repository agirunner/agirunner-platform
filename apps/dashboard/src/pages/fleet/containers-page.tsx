import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Container, Search } from 'lucide-react';
import { Link } from 'react-router-dom';

import {
  CopyableIdBadge,
  OperatorStatusBadge,
  RelativeTimestamp,
  formatOperatorStatusLabel,
} from '../../components/operator-display.js';
import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { dashboardApi, type DashboardLiveContainerRecord } from '../../lib/api.js';
import {
  filterSessionContainerRows,
  mergeLiveContainerSessionRows,
  type ContainerKindFilter,
  type ContainerStatusFilter,
  type SessionContainerRow,
} from './containers-page.support.js';

const LIVE_CONTAINERS_REFETCH_INTERVAL_MS = 5000;

export function ContainersPage(): JSX.Element {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<ContainerKindFilter>('all');
  const [status, setStatus] = useState<ContainerStatusFilter>('all');
  const [sessionRows, setSessionRows] = useState<SessionContainerRow[]>([]);

  const containersQuery = useQuery<DashboardLiveContainerRecord[]>({
    queryKey: ['live-containers'],
    queryFn: () => dashboardApi.fetchLiveContainers(),
    refetchInterval: LIVE_CONTAINERS_REFETCH_INTERVAL_MS,
  });

  useEffect(() => {
    if (!containersQuery.isSuccess || !containersQuery.data) {
      return;
    }
    const observedAt = new Date(containersQuery.dataUpdatedAt || Date.now()).toISOString();
    setSessionRows((previous) =>
      mergeLiveContainerSessionRows(previous, containersQuery.data ?? [], observedAt),
    );
  }, [containersQuery.data, containersQuery.dataUpdatedAt, containersQuery.isSuccess]);

  const filteredRows = useMemo(
    () => filterSessionContainerRows(sessionRows, { query, kind, status }),
    [kind, query, sessionRows, status],
  );
  const runningRows = filteredRows.filter((row) => row.presence === 'running');
  const inactiveRows = filteredRows.filter((row) => row.presence === 'inactive');
  const runningCounts = countRunningKinds(sessionRows);

  if (containersQuery.isLoading && sessionRows.length === 0) {
    return <div className="p-6 text-muted-foreground">Loading live containers...</div>;
  }

  if (containersQuery.error && sessionRows.length === 0) {
    const message = containersQuery.error instanceof Error ? containersQuery.error.message : 'Unknown error';
    return (
      <div className="space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Container inventory unavailable</CardTitle>
            <CardDescription>{message}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Container className="h-6 w-6 text-muted-foreground" />
            <h1 className="text-2xl font-semibold">Containers</h1>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Live container inventory from the platform API. Image, CPU, and memory come from the
            current Docker-inspected container configuration, not desired-state guesses.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          {runningRows.length} running shown • {inactiveRows.length} recently inactive
        </p>
      </div>

      {containersQuery.error ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardHeader>
            <CardTitle className="text-base">Live refresh is currently failing</CardTitle>
            <CardDescription>
              Showing the last successful snapshot from this page session. Missing rows are only
              marked inactive after successful refreshes.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Running now" value={String(sessionRows.filter((row) => row.presence === 'running').length)} />
        <SummaryCard title="Recently inactive" value={String(sessionRows.filter((row) => row.presence === 'inactive').length)} />
        <SummaryCard title="Runtime containers" value={String(runningCounts.runtime)} />
        <SummaryCard title="Task containers" value={String(runningCounts.task)} />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
              placeholder="Search containers, roles, workflows, tasks, or images"
            />
          </div>
          <Select value={kind} onValueChange={(value) => setKind(value as ContainerKindFilter)}>
            <SelectTrigger className="w-full lg:w-48">
              <SelectValue placeholder="All kinds" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              <SelectItem value="orchestrator">Orchestrator</SelectItem>
              <SelectItem value="runtime">Runtime</SelectItem>
              <SelectItem value="task">Task</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(value) => setStatus(value as ContainerStatusFilter)}>
            <SelectTrigger className="w-full lg:w-48">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <ContainerSection
        title="Running now"
        description="Currently reported by the platform API."
        rows={runningRows}
        emptyMessage="No running containers match the current filters."
      />
      <ContainerSection
        title="Recently inactive"
        description="Previously seen on this page, but no longer reported by the platform API."
        rows={inactiveRows}
        emptyMessage="No recently inactive containers match the current filters."
      />
    </div>
  );
}

function SummaryCard({ title, value }: { title: string; value: string }): JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function ContainerSection(props: {
  title: string;
  description: string;
  rows: SessionContainerRow[];
  emptyMessage: string;
}): JSX.Element {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">{props.title}</h2>
        <p className="text-sm text-muted-foreground">{props.description}</p>
      </div>
      {props.rows.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">{props.emptyMessage}</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {props.rows.map((row) => (
            <ContainerCard key={row.id} row={row} />
          ))}
        </div>
      )}
    </section>
  );
}

function ContainerCard({ row }: { row: SessionContainerRow }): JSX.Element {
  return (
    <Card className="h-full">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">{row.name}</CardTitle>
              <Badge variant="outline">{formatOperatorStatusLabel(row.kind)}</Badge>
            </div>
            <CopyableIdBadge value={row.container_id} label="Container" />
          </div>
          <OperatorStatusBadge status={row.presence === 'inactive' ? 'inactive' : row.state} />
        </div>
        <CardDescription>
          {row.presence === 'inactive'
            ? 'No longer reported by the platform API'
            : `${formatOperatorStatusLabel(row.activity_state ?? row.state)} • ${row.status}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <MetadataRow label="Role" value={row.role_name ?? 'Unassigned'} />
        <MetadataRow label="Playbook" value={row.playbook_name ?? '-'} />
        <MetadataRow label="Workflow" value={renderEntityLink(row.workflow_id, row.workflow_name, '/work/boards')} />
        <MetadataRow label="Task" value={renderEntityLink(row.task_id, row.task_title, '/work/tasks')} />
        <MetadataRow label="Image" value={<code className="break-all text-xs">{row.image}</code>} />
        <MetadataRow label="CPU / Memory" value={`${formatLimit(row.cpu_limit)} CPU • ${formatLimit(row.memory_limit)} memory`} />
        <div className="grid gap-2 sm:grid-cols-2">
          <RelativeTimestamp value={row.started_at ?? row.last_seen_at} prefix={row.presence === 'inactive' ? 'Started' : 'Started'} />
          <RelativeTimestamp value={row.inactive_at ?? row.last_seen_at} prefix={row.presence === 'inactive' ? 'Went inactive' : 'Last seen'} />
        </div>
      </CardContent>
    </Card>
  );
}

function MetadataRow({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{label}</p>
      <div className="text-sm text-foreground">{value}</div>
    </div>
  );
}

function renderEntityLink(id: string | null, label: string | null, hrefBase: string): ReactNode {
  if (!id) {
    return '-';
  }
  return (
    <Link className="text-accent hover:underline" to={`${hrefBase}/${id}`}>
      {label ?? id}
    </Link>
  );
}

function formatLimit(value: string | null): string {
  return value?.trim() ? value : 'Docker default';
}

function countRunningKinds(rows: SessionContainerRow[]): Record<'orchestrator' | 'runtime' | 'task', number> {
  return rows
    .filter((row) => row.presence === 'running')
    .reduce(
      (counts, row) => {
        counts[row.kind] += 1;
        return counts;
      },
      { orchestrator: 0, runtime: 0, task: 0 },
    );
}
