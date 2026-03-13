import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';

import { StructuredRecordView } from '../../components/structured-data.js';
import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
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
              : 'No memory entries matched the current filter.'}
          </p>
        )}
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-medium">{props.workItemHeading}</h3>
            <p className="text-xs text-muted">{props.workItemDescription}</p>
          </div>
          {props.workItemQueryState.isLoading ? (
            <LoadingLine body="Loading work-item memory..." />
          ) : props.filteredWorkItemEntries.length > 0 ? (
            <div className="space-y-2">
              {props.filteredWorkItemEntries.map((entry) => (
                <div key={`${entry.key}:${entry.updatedAt ?? 'unknown'}`} className="rounded-xl border border-border/70 bg-muted/10 p-4">
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
              {props.selectedWorkItemId ? 'No work-item memory entries matched the current filter.' : 'Select a workflow work item to inspect scoped memory.'}
            </p>
          )}
        </div>
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
      </CardContent>
    </Card>
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
                  <Link className="truncate text-sm font-medium text-accent hover:underline" to={`/work/workflows/${workflow.id}`}>
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
