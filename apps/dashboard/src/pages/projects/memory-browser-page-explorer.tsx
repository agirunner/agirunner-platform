import { Component, useEffect, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { BrainCircuit, Clock3, FolderKanban, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';

import { StructuredRecordView } from '../../components/structured-data.js';
import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import { ProjectMemoryTable } from './project-memory-table.js';
import type { MemoryActorOption, MemoryKeyOption } from './project-memory-history-support.js';
import type { MemoryEntry, RecentWorkflowEntry } from './project-memory-support.js';
import { describeRecentWorkflowPosture } from './memory-browser-page.support.js';

export function MemoryExplorerCard(props: {
  projectId: string;
  searchQuery: string;
  onSearchChange(value: string): void;
  projectQueryState: { isLoading: boolean; error: unknown };
  projectEntries: MemoryEntry[];
  filteredProjectEntries: MemoryEntry[];
  workItemQueryState: { isLoading: boolean };
  filteredWorkItemEntries: MemoryEntry[];
  selectedWorkItemId: string;
  workItemHeading: string;
  workItemDescription: string;
  formatMemoryActor(actorType?: string | null, actorId?: string | null): string;
  HistoryPanelComponent: (props: {
    entries: MemoryEntry[];
    isLoading: boolean;
    isScopedSelectionReady: boolean;
    selectedActor: string;
    selectedKey: string;
    actorOptions: MemoryActorOption[];
    keyOptions: MemoryKeyOption[];
    onActorChange(value: string): void;
    onKeyChange(value: string): void;
  }) => JSX.Element;
  historyPanel: {
    entries: MemoryEntry[];
    isLoading: boolean;
    selectedActor: string;
    selectedKey: string;
    actorOptions: MemoryActorOption[];
    keyOptions: MemoryKeyOption[];
    onActorChange(value: string): void;
    onKeyChange(value: string): void;
  };
}): JSX.Element {
  const HistoryPanel = props.HistoryPanelComponent;
  const defaultView = props.selectedWorkItemId.length > 0 ? 'scoped' : 'project';
  const [activeView, setActiveView] = useState<'project' | 'scoped' | 'history'>(defaultView);

  useEffect(() => {
    setActiveView(props.selectedWorkItemId.length > 0 ? 'scoped' : 'project');
  }, [props.selectedWorkItemId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Memory Explorer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="space-y-1">
            <p className="text-sm font-medium">Filter memory packets</p>
            <p className="text-xs text-muted">Search by key, value, stage, work item, task, or actor to isolate the decision packet you need.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{props.filteredProjectEntries.length} project entries</Badge>
            <Badge variant="outline">{props.filteredWorkItemEntries.length} scoped entries</Badge>
          </div>
        </div>
        <div className="max-w-md">
          <Input
            placeholder="Search by key, value, stage, work item, task, or actor"
            value={props.searchQuery}
            onChange={(event) => props.onSearchChange(event.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <ExplorerFocusCard
            icon={<FolderKanban className="h-4 w-4" />}
            label="Project packets"
            value={String(props.filteredProjectEntries.length)}
            detail={
              props.filteredProjectEntries.length === props.projectEntries.length
                ? 'Project-wide memory in current scope.'
                : `Filtered from ${props.projectEntries.length} total project entries.`
            }
          />
          <ExplorerFocusCard
            icon={<BrainCircuit className="h-4 w-4" />}
            label="Scoped packets"
            value={String(props.filteredWorkItemEntries.length)}
            detail={
              props.selectedWorkItemId
                ? 'Selected work-item memory after current filters.'
                : 'Pick a work item to unlock scoped packets.'
            }
          />
          <ExplorerFocusCard
            icon={<Clock3 className="h-4 w-4" />}
            label="History trail"
            value={String(props.historyPanel.entries.length)}
            detail="Scoped memory revisions ready for diff review."
          />
        </div>
        <Tabs
          value={activeView}
          onValueChange={(value) => setActiveView(value as 'project' | 'scoped' | 'history')}
          className="grid gap-4"
        >
          <TabsList className="grid h-auto w-full grid-cols-1 gap-2 rounded-xl border border-border/70 bg-border/10 p-1 md:grid-cols-3">
            <TabsTrigger value="project">Project packets</TabsTrigger>
            <TabsTrigger value="scoped">Scoped packets</TabsTrigger>
            <TabsTrigger value="history">History trail</TabsTrigger>
          </TabsList>
          <TabsContent value="project" className="mt-0 grid gap-4">
            <ExplorerSectionHeader
              title="Project memory packets"
              description="Review shared memory that applies across runs before drilling into work-item-specific notes."
              badgeLabel={`${props.filteredProjectEntries.length} visible`}
            />
            {props.projectQueryState.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted" />
              </div>
            ) : props.projectQueryState.error ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                Failed to load project memory: {String(props.projectQueryState.error)}
              </div>
            ) : props.filteredProjectEntries.length > 0 ? (
              <ProjectMemoryTable projectId={props.projectId} entries={props.filteredProjectEntries} />
            ) : (
              <p className="text-sm text-muted">
                {props.projectEntries.length === 0
                  ? 'No project or work-item memory has been written yet.'
                  : 'No project memory entries matched the current filter.'}
              </p>
            )}
          </TabsContent>
          <TabsContent value="scoped" className="mt-0 grid gap-4">
            <ExplorerSectionHeader
              title={props.workItemHeading}
              description={props.workItemDescription}
              badgeLabel={
                props.selectedWorkItemId
                  ? `${props.filteredWorkItemEntries.length} scoped packets`
                  : 'Select a work item'
              }
            />
            {props.workItemQueryState.isLoading ? (
              <LoadingLine body="Loading work-item memory..." />
            ) : props.filteredWorkItemEntries.length > 0 ? (
              <div className="space-y-2">
                {props.filteredWorkItemEntries.map((entry) => (
                  <div
                    key={`${entry.key}:${entry.updatedAt ?? 'unknown'}`}
                    className="rounded-xl border border-border/70 bg-muted/10 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <Badge variant="outline">{entry.scope}</Badge>
                      {entry.stageName ? <Badge variant="secondary">{entry.stageName}</Badge> : null}
                      {entry.taskId ? <span>Task {entry.taskId}</span> : null}
                      {entry.actorType ? <span>{props.formatMemoryActor(entry.actorType, entry.actorId)}</span> : null}
                      {entry.updatedAt ? <span>{new Date(entry.updatedAt).toLocaleString()}</span> : null}
                    </div>
                    <p className="mt-2 font-mono text-sm">{entry.key}</p>
                    <div className="mt-2">
                      <MemoryPayloadView value={entry.value} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">
                {props.selectedWorkItemId
                  ? 'No work-item memory entries matched the current filter.'
                  : 'Select a workflow work item to inspect scoped memory.'}
              </p>
            )}
          </TabsContent>
          <TabsContent value="history" className="mt-0 grid gap-4">
            <ExplorerSectionHeader
              title="Scoped history trail"
              description="Compare who changed scoped memory, when it changed, and how the payload evolved before you update project memory."
              badgeLabel={
                props.selectedWorkItemId
                  ? `${props.historyPanel.entries.length} revisions`
                  : 'Select a work item'
              }
            />
            <TabErrorBoundary label="History trail">
              <HistoryPanel
                entries={props.historyPanel.entries}
                isLoading={props.historyPanel.isLoading}
                isScopedSelectionReady={props.selectedWorkItemId.length > 0}
                selectedActor={props.historyPanel.selectedActor}
                selectedKey={props.historyPanel.selectedKey}
                actorOptions={props.historyPanel.actorOptions}
                keyOptions={props.historyPanel.keyOptions}
                onActorChange={props.historyPanel.onActorChange}
                onKeyChange={props.historyPanel.onKeyChange}
              />
            </TabErrorBoundary>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function ExplorerFocusCard(props: {
  icon: JSX.Element;
  label: string;
  value: string;
  detail: string;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/10 p-4 shadow-sm">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
        {props.icon}
        {props.label}
      </div>
      <p className="mt-2 text-2xl font-semibold text-foreground">{props.value}</p>
      <p className="mt-1 text-xs leading-5 text-muted">{props.detail}</p>
    </div>
  );
}

function ExplorerSectionHeader(props: {
  title: string;
  description: string;
  badgeLabel: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{props.title}</p>
        <p className="text-xs leading-5 text-muted">{props.description}</p>
      </div>
      <Badge variant="outline" className="w-fit">
        {props.badgeLabel}
      </Badge>
    </div>
  );
}

export function RecentWorkflowContextCard(props: {
  isLoading: boolean;
  error: unknown;
  recentWorkflows: RecentWorkflowEntry[];
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Workflow Context</CardTitle>
      </CardHeader>
      <CardContent>
        {props.isLoading ? (
          <LoadingLine body="Loading project timeline..." />
        ) : props.recentWorkflows.length > 0 ? (
          <div className="space-y-3">
            {props.recentWorkflows.map((workflow) => (
              <div key={workflow.id} className="rounded-xl border border-border/70 bg-muted/10 p-4">
                <div className="flex items-center justify-between gap-3">
                  <Link className="truncate text-sm font-medium text-accent hover:underline" to={`/work/boards/${workflow.id}`}>
                    {workflow.name}
                  </Link>
                  <Badge variant="secondary">{workflow.state}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted">{new Date(workflow.createdAt).toLocaleString()}</p>
                <p className="mt-2 text-sm text-muted">{describeRecentWorkflowPosture(workflow)}</p>
              </div>
            ))}
          </div>
        ) : props.error ? (
          <p className="text-sm text-red-600">Failed to load workflow context.</p>
        ) : (
          <p className="text-sm text-muted">No workflows have been recorded for this project yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function LoadingLine(props: { body: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" />
      {props.body}
    </div>
  );
}

function MemoryPayloadView(props: { value: unknown }): JSX.Element {
  if (typeof props.value === 'string') {
    return <p className="whitespace-pre-wrap text-sm leading-6">{props.value}</p>;
  }
  if (typeof props.value === 'number' || typeof props.value === 'boolean') {
    return <p className="text-sm">{String(props.value)}</p>;
  }
  if (Array.isArray(props.value)) {
    return (
      <pre className="overflow-x-auto rounded-md bg-border/10 p-3 text-xs">
        {JSON.stringify(props.value, null, 2)}
      </pre>
    );
  }
  return <StructuredRecordView data={props.value} emptyMessage="No memory payload recorded." />;
}

interface TabErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class TabErrorBoundary extends Component<
  { label: string; children: ReactNode },
  TabErrorBoundaryState
> {
  constructor(props: { label: string; children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): TabErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[TabErrorBoundary:${this.props.label}]`, error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-950/30">
        <p className="text-sm font-medium text-red-800 dark:text-red-300">
          {this.props.label} encountered an error
        </p>
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
          {this.state.error?.message ?? 'An unexpected error occurred.'}
        </p>
        <button
          type="button"
          className="mt-3 rounded-md bg-red-100 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-200 dark:bg-red-900/50 dark:text-red-300 dark:hover:bg-red-900/70"
          onClick={() => this.setState({ hasError: false, error: null })}
        >
          Retry
        </button>
      </div>
    );
  }
}
