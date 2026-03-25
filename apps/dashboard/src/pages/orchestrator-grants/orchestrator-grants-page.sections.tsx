import type { ReactNode } from 'react';
import { Bot, Lock, Plus, RotateCcw, ShieldAlert, ShieldCheck, Workflow } from 'lucide-react';

import { SearchableCombobox, type ComboboxItem } from '../../components/log-viewer/ui/searchable-combobox.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  hasGrantFilters,
  type GrantFilters,
  type GrantSummary,
} from './orchestrator-grants-page.support.js';

export function GrantsHeader(props: { onCreate?(): void }): JSX.Element {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Lock className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">Orchestrator Grants</h1>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-muted">
          Control which agents can operate on workflow orchestration scopes. Keep the grant list
          readable, auditable, and easy to revoke when a role, pool, or temporary escalation ends.
        </p>
      </div>
      {props.onCreate ? (
        <Button onClick={props.onCreate} className="w-full sm:w-auto">
          <Plus className="h-4 w-4" />
          Create grant
        </Button>
      ) : null}
    </div>
  );
}

export function GrantsOverview(props: { summary: GrantSummary }): JSX.Element {
  const packets = [
    {
      title: 'Grant coverage',
      value: `${props.summary.totalGrants} active`,
      detail: 'Current orchestrator grants across all visible workflows',
      icon: ShieldCheck,
    },
    {
      title: 'Workflow scope',
      value: `${props.summary.workflowCount} workflows`,
      detail: 'Unique workflow bindings currently delegated',
      icon: Workflow,
    },
    {
      title: 'Agent reach',
      value: `${props.summary.agentCount} agents`,
      detail: 'Agents with any live orchestration permission',
      icon: Bot,
    },
    {
      title: 'Elevated grants',
      value: `${props.summary.elevatedCount} write or execute`,
      detail: 'Review these first when tightening operator access',
      icon: ShieldAlert,
    },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {packets.map((packet) => (
        <Card key={packet.title} className="border-border/70 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted">{packet.title}</CardTitle>
            <packet.icon className="h-4 w-4 text-muted" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{packet.value}</p>
            <p className="mt-2 text-xs leading-5 text-muted">{packet.detail}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function GrantsLoadingState(): JSX.Element {
  return (
    <div className="space-y-4 p-6">
      <GrantsHeader />
      <Card className="border-border/70 shadow-sm">
        <CardContent className="p-6 text-sm text-muted">Loading orchestrator grants…</CardContent>
      </Card>
    </div>
  );
}

export function GrantsErrorState(props: { error: unknown }): JSX.Element {
  const message = String(props.error ?? '');
  if (message.includes('404')) {
    return (
      <StatusCard
        title="Grant API unavailable"
        description="The dashboard cannot find the orchestrator-grants endpoint for this environment."
        body={
          <>
            This page needs the <code>/api/v1/orchestrator-grants</code> API to be enabled before
            administrators can manage delegation here.
          </>
        }
      />
    );
  }

  if (message.includes('403')) {
    return (
      <StatusCard
        cardClassName="border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30"
        bodyClassName="text-amber-800 dark:text-amber-300"
        title="Admin access required"
        description="Grant management is restricted to administrators with orchestration policy access."
        body="Sign in with an admin API key or ask a workspace administrator to manage grants for this environment."
      />
    );
  }

  return (
    <StatusCard
      cardClassName="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
      bodyClassName="text-red-700 dark:text-red-200"
      title="Unable to load grant posture"
      description="The dashboard could not refresh the grant registry for this workspace."
      body="Retry in a moment. If the problem persists, inspect the platform logs for the orchestrator-grants API."
    />
  );
}

export function GrantsEmptyState(props: { onCreate(): void }): JSX.Element {
  return (
    <Card className="border-dashed border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle>No grants yet</CardTitle>
        <CardDescription>
          Create a scoped grant when an agent needs temporary or persistent orchestration access.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm leading-6 text-muted">
          Start with the narrowest workflow scope and only add write or execute permissions when an
          operator or automation path truly needs them.
        </p>
        <Button onClick={props.onCreate} className="w-full sm:w-auto">
          <Plus className="h-4 w-4" />
          Create first grant
        </Button>
      </CardContent>
    </Card>
  );
}

export function GrantsFilterBar(props: {
  filters: GrantFilters;
  workflowItems: ComboboxItem[];
  agentItems: ComboboxItem[];
  workflowsLoading: boolean;
  agentsLoading: boolean;
  workflowsError: boolean;
  agentsError: boolean;
  onWorkflowChange(value: string | null): void;
  onAgentChange(value: string | null): void;
  onReset(): void;
}): JSX.Element {
  const hasFiltersApplied = hasGrantFilters(props.filters);

  return (
    <Card className="border-border/70 bg-card/80 shadow-sm">
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle>Filter visible grants</CardTitle>
            <CardDescription>
              Narrow the registry by workflow scope or agent before the table renders.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" disabled={!hasFiltersApplied} onClick={props.onReset}>
            <RotateCcw className="h-3.5 w-3.5" />
            Clear filters
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <FilterField
          label="Workflow scope"
          description="Search by workflow name, state, workspace, or playbook."
          isLoading={props.workflowsLoading}
          hasError={props.workflowsError}
          isEmpty={props.workflowItems.length === 0}
          emptyMessage="No workflows are available for filtering yet."
        >
          <SearchableCombobox
            items={props.workflowItems}
            value={props.filters.workflowId}
            onChange={props.onWorkflowChange}
            placeholder="All workflows"
            searchPlaceholder="Search workflows by name, state, workspace, or playbook"
            allGroupLabel="Workflow scopes"
            isLoading={props.workflowsLoading}
            disabled={props.workflowsLoading || props.workflowsError || props.workflowItems.length === 0}
          />
        </FilterField>
        <FilterField
          label="Agent"
          description="Search by agent name, status, or agent ID."
          isLoading={props.agentsLoading}
          hasError={props.agentsError}
          isEmpty={props.agentItems.length === 0}
          emptyMessage="No agents are available for filtering yet."
        >
          <SearchableCombobox
            items={props.agentItems}
            value={props.filters.agentId}
            onChange={props.onAgentChange}
            placeholder="All agents"
            searchPlaceholder="Search agents by name, status, or agent ID"
            allGroupLabel="Agents"
            isLoading={props.agentsLoading}
            disabled={props.agentsLoading || props.agentsError || props.agentItems.length === 0}
          />
        </FilterField>
      </CardContent>
    </Card>
  );
}

export function GrantsFilteredEmptyState(props: {
  onClearFilters(): void;
  onCreate(): void;
}): JSX.Element {
  return (
    <Card className="border-dashed border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle>No grants match the current filters</CardTitle>
        <CardDescription>
          Clear the workflow or agent filter to inspect the wider grant registry again.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm leading-6 text-muted">
          This scope is currently empty. Try a different workflow or agent, or create a new grant
          if this pairing should exist.
        </p>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button variant="outline" onClick={props.onClearFilters} className="w-full sm:w-auto">
            Clear filters
          </Button>
          <Button onClick={props.onCreate} className="w-full sm:w-auto">
            <Plus className="h-4 w-4" />
            Create grant
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusCard(props: {
  title: string;
  description: string;
  body: ReactNode;
  cardClassName?: string;
  bodyClassName?: string;
}): JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <GrantsHeader />
      <Card className={props.cardClassName ?? 'border-border/70 shadow-sm'}>
        <CardHeader>
          <CardTitle>{props.title}</CardTitle>
          <CardDescription>{props.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className={`text-sm leading-6 ${props.bodyClassName ?? 'text-muted'}`}>{props.body}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function FilterField(props: {
  label: string;
  description: string;
  isLoading: boolean;
  hasError: boolean;
  isEmpty: boolean;
  emptyMessage: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{props.label}</p>
      {props.children}
      {props.isLoading ? <p className="text-xs leading-5 text-muted">Loading options…</p> : null}
      {props.hasError ? (
        <p className="text-xs leading-5 text-red-700 dark:text-red-200">
          Inventory is unavailable right now. Retry after the page refreshes.
        </p>
      ) : null}
      {!props.isLoading && !props.hasError && props.isEmpty ? (
        <p className="text-xs leading-5 text-muted">{props.emptyMessage}</p>
      ) : null}
      {!props.isLoading && !props.hasError && !props.isEmpty ? (
        <p className="text-xs leading-5 text-muted">{props.description}</p>
      ) : null}
    </div>
  );
}
