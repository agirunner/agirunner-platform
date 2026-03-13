import { BrainCircuit, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import type {
  ProjectTimelineSummary,
} from './project-memory-support.js';
import {
  buildMemoryOverviewCards,
  describeMemoryNextAction,
  describeScopeBadge,
} from './memory-browser-page.support.js';

export function MemoryBrowserHeader(props: {
  scopedProjectId: string;
  selectedWorkflowId: string;
  projectBackLabel: string;
}): JSX.Element {
  const title = props.scopedProjectId ? 'Project Memory Explorer' : 'Memory Browser';
  const description = props.scopedProjectId
    ? 'Review shared project memory, scoped work-item memory, and revision history without leaving the current project.'
    : 'Review shared project memory, scoped work-item memory, and revision history through operator packets instead of raw record dumps.';

  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-muted">{description}</p>
      {props.scopedProjectId ? (
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          <Link className="underline-offset-4 hover:underline" to={`/projects/${props.scopedProjectId}`}>
            {props.projectBackLabel}
          </Link>
          <Link
            className="underline-offset-4 hover:underline"
            to={`/projects/${props.scopedProjectId}/artifacts`}
          >
            Open Artifact Explorer
          </Link>
          {props.selectedWorkflowId ? (
            <Link className="underline-offset-4 hover:underline" to={`/work/workflows/${props.selectedWorkflowId}`}>
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
          <p className="text-sm leading-6">{describeMemoryNextAction(props)}</p>
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
  const selectedWorkflow = props.workflows.find((workflow) => workflow.id === props.selectedWorkflowId) ?? null;
  const selectedWorkItem = props.workItems.find((workItem) => workItem.id === props.selectedWorkItemId) ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workflow Scope</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_260px]">
        <SelectBlock
          label="Workflow"
          isLoading={props.isTimelineLoading}
          loadingBody="Loading project workflows..."
          emptyBody="No workflows have been recorded for this project yet."
          value={props.selectedWorkflowId || '__all__'}
          placeholder="All workflows"
          options={props.workflows.map((workflow) => ({ value: workflow.id, label: workflow.name }))}
          onChange={props.onWorkflowChange}
        />
        <SelectBlock
          label="Work item"
          isLoading={props.isWorkItemsLoading}
          loadingBody="Loading workflow work items..."
          emptyBody={props.selectedWorkflowId ? 'No work items found for this workflow yet.' : 'Select a workflow to browse work-item memory.'}
          value={props.selectedWorkItemId || '__all__'}
          placeholder="All work items"
          options={props.workItems.map((workItem) => ({ value: workItem.id, label: workItem.title }))}
          onChange={props.onWorkItemChange}
        />
        <div className="rounded-xl border border-border/70 bg-muted/10 p-4">
          <div className="flex items-center justify-between gap-2">
            <Badge variant="secondary">{selectedWorkflow?.state ?? selectedWorkItem?.columnId ?? 'project'}</Badge>
            {selectedWorkflow ? (
              <Link className="text-sm text-accent hover:underline" to={`/work/workflows/${selectedWorkflow.id}`}>
                Open workflow
              </Link>
            ) : null}
          </div>
          <p className="mt-3 text-sm font-medium">
            {selectedWorkItem?.title ?? selectedWorkflow?.name ?? 'Project-wide memory scope'}
          </p>
          <p className="mt-1 text-xs text-muted">
            {selectedWorkItem ? `Stage ${selectedWorkItem.stageName}` : 'Select a work item when you need scoped history and memory review.'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function SelectBlock(props: {
  label: string;
  isLoading: boolean;
  loadingBody: string;
  emptyBody: string;
  value: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <label className="mb-1 block text-sm font-medium">{props.label}</label>
      {props.isLoading ? (
        <LoadingLine body={props.loadingBody} />
      ) : props.options.length > 0 ? (
        <Select value={props.value} onValueChange={props.onChange}>
          <SelectTrigger>
            <SelectValue placeholder={props.placeholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{props.placeholder}</SelectItem>
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
    <div className="flex flex-col items-center py-8 text-muted">
      <BrainCircuit className="mb-3 h-10 w-10" />
      <p className="text-sm">{props.body}</p>
    </div>
  );
}
