import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { dashboardApi, type DashboardLiveContainerRecord } from '../../lib/api.js';
import { DashboardPageHeader } from '../../components/layout/dashboard-page-header.js';
import { ContainersTable } from './containers-table.js';
import {
  advanceSessionContainerRows,
  mergeLiveContainerSessionRows,
  partitionSessionContainerRowsByFunction,
  type SessionContainerRow,
} from './containers-page.support.js';

const LIVE_CONTAINERS_REFETCH_INTERVAL_MS = 5000;
const SESSION_TRANSITION_TICK_MS = 250;

export function ContainersPage(): JSX.Element {
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

  const groupedRows = useMemo(
    () => partitionSessionContainerRowsByFunction(sessionRows),
    [sessionRows],
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
      <DashboardPageHeader
        navHref="/diagnostics/live-containers"
        description="Live container inventory from the platform API, showing image, CPU, and memory of running and recently-active containers."
        actions={
          <p className="text-sm text-muted-foreground">
            {runningCount} active • {inactiveCount} inactive this session
          </p>
        }
      />

      {containersQuery.error ? (
        <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-muted-foreground">
          Live refresh is currently failing. Showing the last successful snapshot from this page
          session. Missing rows are only marked inactive after successful refreshes.
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">Orchestrator agent</h2>
          <p className="text-sm text-muted-foreground">
            Orchestrator agents and orchestrator-side executions.
          </p>
        </div>
        <ContainersTable
          rows={groupedRows.orchestrator}
          emptyMessage="No orchestrator agents were reported in this session."
        />
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">Specialists</h2>
          <p className="text-sm text-muted-foreground">
            Specialist agents and non-orchestrator specialist executions.
          </p>
        </div>
        <ContainersTable
          rows={groupedRows.specialists}
          emptyMessage="No specialist agents or specialist executions were reported in this session."
        />
      </section>
    </div>
  );
}
