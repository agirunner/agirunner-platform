import { BrainCircuit, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { MemoryValuePreview } from './project-memory-table.fields.js';
import type {
  MemoryActorOption,
  MemoryKeyOption,
} from './project-memory-history-support.js';
import { ProjectMemoryTable } from './project-memory-table.js';
import type {
  MemoryEntry,
  ProjectTimelineSummary,
  RecentWorkflowEntry,
} from './project-memory-support.js';
import {
  buildMemoryOverviewCards,
  describeMemoryNextAction,
  describeRecentWorkflowPosture,
  describeScopeBadge,
} from './memory-browser-page.support.js';

interface HistoryPanelProps {
  entries: MemoryEntry[];
  isLoading: boolean;
  isScopedSelectionReady: boolean;
  selectedActor: string;
  selectedKey: string;
  actorOptions: MemoryActorOption[];
  keyOptions: MemoryKeyOption[];
  onActorChange(value: string): void;
  onKeyChange(value: string): void;
}

export function MemoryBrowserHeader(props: {
  scopedProjectId: string;
  selectedWorkflowId: string;
  projectBackLabel: string;
}): JSX.Element {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Memory Browser</h1>
      <p className="text-sm text-muted">
        Review shared project memory, scoped work-item memory, and revision history through
        operator packets instead of raw record dumps.
      </p>
      {props.scopedProjectId ? (
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          <Link className="underline-offset-4 hover:underline" to={`/projects/${props.scopedProjectId}`}>
            {props.projectBackLabel}
          </Link>
          {props.selectedWorkflowId ? (
            <Link
              className="underline-offset-4 hover:underline"
              to={`/work/workflows/${props.selectedWorkflowId}`}
            >
              Open Workflow Board
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ProjectScopeCard(props: {
  selectedProjectId: string;
  projects: Array<{ id: string; name: string }>;
  isLoading: boolean;
  error: unknown;
  disabled: boolean;
  onProjectChange(value: string): void;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Scope</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-sm">
          <label className="mb-1 block text-sm font-medium">Project</label>
          {props.isLoading ? (
            <LoadingLine body="Loading projects..." />
          ) : (
            <Select
              disabled={props.disabled}
              value={props.selectedProjectId}
              onValueChange={props.onProjectChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {props.projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {props.error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Failed to load projects: {String(props.error)}
          </div>
        ) : null}
        {!props.selectedProjectId && !props.isLoading ? (
          <EmptyExplorerState body="Select a project to inspect memory." />
        ) : null}
      </CardContent>
    </Card>
  );
}

export function MemoryOverviewSection(props: {
  selectedProjectId: string;
  selectedWorkflowName: string | null;
  selectedWorkItemTitle: string | null;
  projectEntryCount: number;
  workItemEntryCount: number;
  filteredProjectEntryCount: number;
  filteredWorkItemEntryCount: number;
  historyEntryCount: number;
  timelineSummary: ProjectTimelineSummary;
}): JSX.Element | null {
  if (!props.selectedProjectId) {
    return null;
  }

  const cards = buildMemoryOverviewCards({
    projectEntryCount: props.projectEntryCount,
    workItemEntryCount: props.workItemEntryCount,
    historyEntryCount: props.historyEntryCount,
    timelineSummary: props.timelineSummary,
  });
  const nextAction = describeMemoryNextAction({
    selectedProjectId: props.selectedProjectId,
    selectedWorkflowName: props.selectedWorkflowName,
    selectedWorkItemTitle: props.selectedWorkItemTitle,
    projectEntryCount: props.projectEntryCount,
    workItemEntryCount: props.workItemEntryCount,
    filteredProjectEntryCount: props.filteredProjectEntryCount,
    filteredWorkItemEntryCount: props.filteredWorkItemEntryCount,
  });

  return (
    <div className="grid gap-4 xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.4fr)]">
      {cards.map((card) => (
        <Card key={card.label} className="border-border/70 shadow-sm">
          <CardContent className="grid gap-2 p-4">
            <p className="text-sm font-medium text-muted">{card.label}</p>
            <p className="text-2xl font-semibold">{card.value}</p>
            <p className="text-xs leading-5 text-muted">{card.detail}</p>
          </CardContent>
        </Card>
      ))}
      <Card className="border-border/70 shadow-sm">
        <CardContent className="grid gap-2 p-4">
          <Badge variant="outline">
            {describeScopeBadge({
              selectedWorkflowName: props.selectedWorkflowName,
              selectedWorkItemTitle: props.selectedWorkItemTitle,
            })}
          </Badge>
          <p className="text-sm font-medium text-muted">Next action</p>
          <p className="text-sm leading-6">{nextAction}</p>
        </CardContent>
      </Card>
    </div>
  );
}

export function WorkflowScopeCard(props: {
  selectedWorkflowId: string;
  selectedWorkItemId: string;
  workflows: Array<{ id: string; name: string; state: string }>;
  workItems: Array<{ id: string; title: string; stageName: string; columnId: string }>;
  isTimelineLoading: boolean;
  isWorkItemsLoading: boolean;
  onWorkflowChange(value: string): void;
  onWorkItemChange(value: string): void;
}): JSX.Element {
  const selectedWorkflow =
    props.workflows.find((workflow) => workflow.id === props.selectedWorkflowId) ?? null;
  const selectedWorkItem =
    props.workItems.find((workItem) => workItem.id === props.selectedWorkItemId) ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workflow Scope</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_260px]">
        <ScopeSelect
          label="Workflow"
          isLoading={props.isTimelineLoading}
          loadingLabel="Loading project workflows..."
          value={props.selectedWorkflowId || '__all__'}
          emptyBody="No workflows have been recorded for this project yet."
          onValueChange={props.onWorkflowChange}
          options={props.workflows.map((workflow) => ({
            value: workflow.id,
            label: workflow.name,
          }))}
        />
        <ScopeSelect
          label="Work item"
          isLoading={props.isWorkItemsLoading}
          loadingLabel="Loading workflow work items..."
          value={props.selectedWorkItemId || '__all__'}
          emptyBody={
            props.selectedWorkflowId
              ? 'No work items found for this workflow yet.'
              : 'Select a workflow to browse work-item memory.'
          }
          onValueChange={props.onWorkItemChange}
          options={props.workItems.map((workItem) => ({
            value: workItem.id,
            label: workItem.title,
          }))}
        />
        <div className="rounded-xl border border-border/70 bg-muted/10 p-4">
          <div className="flex items-center justify-between gap-2">
            <Badge variant="secondary">
              {selectedWorkflow?.state ?? selectedWorkItem?.columnId ?? 'project'}
            </Badge>
            {selectedWorkflow ? (
              <Link
                className="text-sm text-accent hover:underline"
                to={`/work/workflows/${selectedWorkflow.id}`}
              >
                Open workflow
              </Link>
            ) : null}
          </div>
          <p className="mt-3 text-sm font-medium">
            {selectedWorkItem?.title ?? selectedWorkflow?.name ?? 'Project-wide memory scope'}
          </p>
          <p className="mt-1 text-xs text-muted">
            {selectedWorkItem
              ? `Stage ${selectedWorkItem.stageName}`
              : 'Select a work item when you need scoped history and memory review.'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

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
  HistoryPanelComponent(props: HistoryPanelProps): JSX.Element;
  historyPanel: Omit<HistoryPanelProps, 'isScopedSelectionReady'>;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Memory Explorer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="space-y-1">
            <p className="text-sm font-medium">Filter memory packets</p>
            <p className="text-xs text-muted">
              Search by key, value, stage, work item, task, or actor to isolate the decision
              packet you need.
            </p>
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
        <ProjectMemorySurface
          projectId={props.projectId}
          queryState={props.projectQueryState}
          projectEntries={props.projectEntries}
          filteredProjectEntries={props.filteredProjectEntries}
        />
        <WorkItemMemorySurface
          isLoading={props.workItemQueryState.isLoading}
          selectedWorkItemId={props.selectedWorkItemId}
          entries={props.filteredWorkItemEntries}
          heading={props.workItemHeading}
          description={props.workItemDescription}
          formatMemoryActor={props.formatMemoryActor}
        />
        <props.HistoryPanelComponent
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
          <div className="grid gap-3 lg:grid-cols-2">
            {props.recentWorkflows.map((workflow) => (
              <div key={workflow.id} className="rounded-xl border border-border/70 bg-muted/10 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      className="truncate text-sm font-medium text-accent hover:underline"
                      to={`/work/workflows/${workflow.id}`}
                    >
                      {workflow.name}
                    </Link>
                    <p className="mt-1 text-xs text-muted">
                      {new Date(workflow.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <Badge variant="secondary">{workflow.state}</Badge>
                </div>
                <p className="mt-3 text-sm text-muted">
                  {describeRecentWorkflowPosture(workflow)}
                </p>
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

function ScopeSelect(props: {
  label: string;
  isLoading: boolean;
  loadingLabel: string;
  value: string;
  emptyBody: string;
  options: Array<{ value: string; label: string }>;
  onValueChange(value: string): void;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <label className="mb-1 block text-sm font-medium">{props.label}</label>
      {props.isLoading ? (
        <LoadingLine body={props.loadingLabel} />
      ) : props.options.length > 0 ? (
        <Select value={props.value} onValueChange={props.onValueChange}>
          <SelectTrigger>
            <SelectValue placeholder={`All ${props.label.toLowerCase()}s`} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All {props.label.toLowerCase()}s</SelectItem>
            {props.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="text-sm text-muted">{props.emptyBody}</p>
      )}
    </div>
  );
}

function ProjectMemorySurface(props: {
  projectId: string;
  queryState: { isLoading: boolean; error: unknown };
  projectEntries: MemoryEntry[];
  filteredProjectEntries: MemoryEntry[];
}): JSX.Element {
  if (props.queryState.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }
  if (props.queryState.error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Failed to load project memory: {String(props.queryState.error)}
      </div>
    );
  }
  if (props.filteredProjectEntries.length > 0) {
    return <ProjectMemoryTable projectId={props.projectId} entries={props.filteredProjectEntries} />;
  }
  return (
    <EmptyExplorerState
      body={
        props.projectEntries.length === 0
          ? 'No project or work-item memory has been written yet.'
          : 'No memory entries matched the current filter.'
      }
    />
  );
}

function WorkItemMemorySurface(props: {
  isLoading: boolean;
  selectedWorkItemId: string;
  entries: MemoryEntry[];
  heading: string;
  description: string;
  formatMemoryActor(actorType?: string | null, actorId?: string | null): string;
}): JSX.Element {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">{props.heading}</h3>
        <p className="text-xs text-muted">{props.description}</p>
      </div>
      {props.isLoading ? (
        <LoadingLine body="Loading work-item memory..." />
      ) : props.entries.length > 0 ? (
        <div className="space-y-2">
          {props.entries.map((entry) => (
            <div
              key={`${entry.key}:${entry.updatedAt ?? 'unknown'}`}
              className="rounded-xl border border-border/70 bg-muted/10 p-4"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <Badge variant="outline">{entry.scope}</Badge>
                {entry.stageName ? <Badge variant="secondary">{entry.stageName}</Badge> : null}
                {entry.taskId ? <span>Task {entry.taskId}</span> : null}
                {entry.actorType ? (
                  <span>{props.formatMemoryActor(entry.actorType, entry.actorId)}</span>
                ) : null}
                {entry.updatedAt ? <span>{new Date(entry.updatedAt).toLocaleString()}</span> : null}
              </div>
              <p className="mt-2 font-mono text-sm">{entry.key}</p>
              <div className="mt-2">
                <MemoryValuePreview value={entry.value} />
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
    </div>
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

function EmptyExplorerState(props: { body: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center py-10 text-muted">
      <BrainCircuit className="mb-3 h-10 w-10" />
      <p className="text-sm">{props.body}</p>
    </div>
  );
}
