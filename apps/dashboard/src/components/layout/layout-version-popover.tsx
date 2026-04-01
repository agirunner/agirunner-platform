import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';

import type {
  DashboardRuntimeVersionRecord,
  DashboardVersionComponentRecord,
} from '../../lib/api.js';
import { dashboardApi } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.js';
import { FOCUS_RING_CLASSES } from './layout-nav.js';
import { describeRuntimeVersionGroup, shortenRevision } from './layout-version-summary.js';

export function LayoutVersionPopover(props: {
  isSidebarCollapsed: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const summaryQuery = useQuery({
    queryKey: ['fleet', 'version-summary'],
    queryFn: () => dashboardApi.fetchVersionSummary(),
    enabled: open,
    staleTime: 30_000,
  });

  const triggerClasses = cn(
    'flex w-full items-center rounded-xl text-xs text-slate-500 transition-[background-color,color] hover:bg-white hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-900/70 dark:hover:text-slate-200',
    props.isSidebarCollapsed ? 'justify-center px-0 py-2.5' : 'gap-2 px-3 py-2',
    FOCUS_RING_CLASSES,
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={triggerClasses}
          aria-label={props.isSidebarCollapsed ? 'Versions' : undefined}
          title={props.isSidebarCollapsed ? 'Versions' : undefined}
        >
          <Info size={14} />
          {props.isSidebarCollapsed ? null : <span>Versions</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={props.isSidebarCollapsed ? 'right' : 'top'}
        align={props.isSidebarCollapsed ? 'start' : 'end'}
        className="w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border/70 bg-background/95 p-3 shadow-lg"
      >
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Running Versions</h2>
            <p className="text-xs text-muted-foreground">
              Live image metadata from the current Agirunner stack.
            </p>
          </div>

          {summaryQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading versions...</p>
          ) : summaryQuery.error ? (
            <p className="text-sm text-rose-600 dark:text-rose-300">
              Version summary is unavailable right now.
            </p>
          ) : summaryQuery.data ? (
            <>
              <div className="space-y-2">
                <VersionComponentCard label="Platform API" record={summaryQuery.data.platform_api} />
                <VersionComponentCard label="Dashboard" record={summaryQuery.data.dashboard} />
                <VersionComponentCard
                  label="Container Manager"
                  record={summaryQuery.data.container_manager}
                />
              </div>

              <div className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Runtime Containers
                </p>
                {summaryQuery.data.runtimes.length > 0 ? (
                  summaryQuery.data.runtimes.map((group) => (
                    <RuntimeVersionCard key={runtimeVersionKey(group)} group={group} />
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No runtime containers detected.</p>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No version data available.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function VersionComponentCard(props: {
  label: string;
  record: DashboardVersionComponentRecord | null;
}): JSX.Element {
  if (!props.record) {
    return (
      <div className="rounded-xl border border-border/70 bg-surface/75 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-foreground">{props.label}</span>
          <span className="text-xs text-muted-foreground">not detected</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/70 bg-surface/75 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-foreground">{props.label}</span>
        <span className="text-xs text-muted-foreground">{props.record.status}</span>
      </div>
      <p className="mt-1 text-sm text-foreground">
        {props.record.version}
        <span className="text-muted-foreground"> | {shortenRevision(props.record.revision)}</span>
      </p>
      <p className="mt-1 truncate text-xs text-muted-foreground" title={props.record.image}>
        {props.record.image}
      </p>
    </div>
  );
}

function RuntimeVersionCard(props: {
  group: DashboardRuntimeVersionRecord;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-surface/75 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-foreground">{props.group.version}</span>
        <span className="text-xs text-muted-foreground">
          {shortenRevision(props.group.revision)}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {describeRuntimeVersionGroup(props.group)}
      </p>
      <p className="mt-1 truncate text-xs text-muted-foreground" title={props.group.image}>
        {props.group.image}
      </p>
    </div>
  );
}

function runtimeVersionKey(group: DashboardRuntimeVersionRecord): string {
  return [
    group.image,
    group.image_digest ?? '',
    group.version,
    group.revision,
  ].join('::');
}
