import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { DashboardPageHeader } from '../../components/layout/dashboard-page-header.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import {
  buildMissionControlShellHref,
  buildMissionControlShellSearchParams,
  readMissionControlShellState,
  type MissionControlMode,
  type MissionControlRail,
} from './mission-control-page.support.js';

const SAVED_VIEW_OPTIONS = [
  { label: 'All active', value: 'all-active' },
  { label: 'Needs action', value: 'needs-action' },
  { label: 'Shipping', value: 'shipping' },
];

const SCOPE_OPTIONS = [
  { label: 'Entire tenant', value: 'entire-tenant' },
  { label: 'Watchlist', value: 'watchlist' },
];

export function MissionControlPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const shellState = useMemo(() => readMissionControlShellState(searchParams), [searchParams]);
  const selectedWorkflowHref = buildMissionControlShellHref({
    rail: 'workflow',
    workflowId: shellState.workflowId ?? 'workflow-123',
  });

  function patchShellState(
    patch: Partial<ReturnType<typeof readMissionControlShellState>>,
  ): void {
    setSearchParams((current) => buildMissionControlShellSearchParams(current, patch), {
      replace: true,
    });
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        navHref="/mission-control"
        title="Mission Control"
        description="Tenant-wide live operations shell for monitoring workflow posture, reviewing recent changes, and drilling into one workflow without losing the wider operational picture."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm">
              Saved view
            </Button>
            <Button size="sm">Launch workflow</Button>
          </div>
        }
      />

      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border/80 bg-surface/70 p-4">
        <Tabs
          value={shellState.mode}
          onValueChange={(value) => patchShellState({ mode: value as MissionControlMode })}
        >
          <TabsList>
            <TabsTrigger value="live">Live</TabsTrigger>
            <TabsTrigger value="recent">Recent</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
        </Tabs>

        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <span>Saved view</span>
          <select
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            value={shellState.savedView}
            onChange={(event) => patchShellState({ savedView: event.target.value })}
          >
            {SAVED_VIEW_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Scope</span>
          <select
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            value={shellState.scope}
            onChange={(event) => patchShellState({ scope: event.target.value })}
          >
            {SCOPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <MissionControlSurfaceCard
          title="Tenant canvas"
          description="Workflow-first live operations view with posture-grouped sections, output snapshots, and fast-path actions."
        >
          <div className="flex flex-wrap items-center gap-2">
            <RailToggle
              isActive={shellState.lens === 'workflows'}
              label="Workflow canvas"
              onClick={() => patchShellState({ lens: 'workflows' })}
            />
            <RailToggle
              isActive={shellState.lens === 'tasks'}
              label="Task lens"
              onClick={() => patchShellState({ lens: 'tasks' })}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {shellState.mode === 'live'
              ? 'Live mode will stream tenant posture, output pulses, and cross-work attention here.'
              : shellState.mode === 'recent'
                ? 'Recent mode will switch this surface to review packets and carryover from the latest operating window.'
                : 'History mode will replace the live canvas with deeper packet history and stronger filtering.'}
          </p>
        </MissionControlSurfaceCard>

        <MissionControlSurfaceCard
          title={shellState.rail === 'attention' ? 'Attention rail' : 'Selected workflow'}
          description={
            shellState.rail === 'attention'
              ? 'Interrupt-first queue for decisions, interventions, and watchlist items.'
              : 'Persistent workflow workspace panel that keeps a selected workflow in view.'
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <RailToggle
              isActive={shellState.rail === 'attention'}
              label="Attention"
              onClick={() => patchShellState({ rail: 'attention' })}
            />
            <RailToggle
              isActive={shellState.rail === 'workflow'}
              label="Workflow"
              onClick={() => patchShellState({ rail: 'workflow' as MissionControlRail })}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {shellState.rail === 'attention'
              ? 'Attention rail keeps Needs Decision, Needs Intervention, and Watchlist visible without leaving the shell.'
              : `Selected workflow workspace will open here.${shellState.workflowId ? ` Active workflow: ${shellState.workflowId}.` : ''}`}
          </p>
          <Link className="text-sm font-medium text-accent hover:underline" to={selectedWorkflowHref}>
            Open selected workflow
          </Link>
        </MissionControlSurfaceCard>
      </div>
    </div>
  );
}

function MissionControlSurfaceCard(props: {
  title: string;
  description: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{props.children}</CardContent>
    </Card>
  );
}

function RailToggle(props: {
  isActive: boolean;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <Button onClick={props.onClick} size="sm" variant={props.isActive ? 'default' : 'outline'}>
      {props.label}
    </Button>
  );
}
