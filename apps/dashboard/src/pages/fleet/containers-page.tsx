import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Container, Search } from 'lucide-react';

import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { dashboardApi, type DashboardLiveContainerRecord } from '../../lib/api.js';
import { ContainersTable } from './containers-table.js';
import {
  advanceSessionContainerRows,
  filterSessionContainerRows,
  mergeLiveContainerSessionRows,
  type ContainerKindFilter,
  type ContainerStatusFilter,
  type SessionContainerRow,
} from './containers-page.support.js';

const LIVE_CONTAINERS_REFETCH_INTERVAL_MS = 5000;
const SESSION_TRANSITION_TICK_MS = 250;

export function ContainersPage(): JSX.Element {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<ContainerKindFilter>('all');
  const [status, setStatus] = useState<ContainerStatusFilter>('all');
  const [sessionRows, setSessionRows] = useState<SessionContainerRow[]>([]);
  const [hasObservedSnapshot, setHasObservedSnapshot] = useState(false);

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
      mergeLiveContainerSessionRows(previous, containersQuery.data ?? [], observedAt, {
        hasBaselineSnapshot: hasObservedSnapshot,
      }),
    );
    setHasObservedSnapshot(true);
  }, [containersQuery.data, containersQuery.dataUpdatedAt, containersQuery.isSuccess, hasObservedSnapshot]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const observedAt = new Date().toISOString();
      setSessionRows((previous) => advanceSessionContainerRows(previous, observedAt));
    }, SESSION_TRANSITION_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const filteredRows = useMemo(
    () => filterSessionContainerRows(sessionRows, { query, kind, status }),
    [kind, query, sessionRows, status],
  );
  const runningCount = sessionRows.filter((row) => row.presence === 'running').length;
  const inactiveCount = sessionRows.filter((row) => row.presence === 'inactive').length;

  if (containersQuery.isLoading && sessionRows.length === 0) {
    return <div className="p-6 text-muted-foreground">Loading live containers...</div>;
  }

  if (containersQuery.error && sessionRows.length === 0) {
    const message = containersQuery.error instanceof Error ? containersQuery.error.message : 'Unknown error';
    return (
      <div className="space-y-6 p-6">
        <div className="rounded-lg border border-border/70 bg-surface/80 px-4 py-6">
          <h2 className="text-base font-semibold text-foreground">Container inventory unavailable</h2>
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        </div>
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
          <p className="max-w-4xl text-sm text-muted-foreground">
            Live container inventory from the platform API, showing image, CPU, and memory of running and recently-active containers.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          {runningCount} running • {inactiveCount} inactive this session
        </p>
      </div>

      {containersQuery.error ? (
        <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-muted-foreground">
          Live refresh is currently failing. Showing the last successful snapshot from this page
          session. Missing rows are only marked inactive after successful refreshes.
        </div>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
            placeholder="Search kinds, roles, workflows, stages, tasks, or images"
          />
        </div>
        <Select value={kind} onValueChange={(value) => setKind(value as ContainerKindFilter)}>
          <SelectTrigger className="w-full lg:w-48">
            <SelectValue placeholder="All kinds" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            <SelectItem value="orchestrator">Orchestrator worker</SelectItem>
            <SelectItem value="runtime">Runtime</SelectItem>
            <SelectItem value="task">Task execution</SelectItem>
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
      </div>

      <ContainersTable
        rows={filteredRows}
        emptyMessage="No containers match the current filters."
      />
    </div>
  );
}
