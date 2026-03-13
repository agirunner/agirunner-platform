import type { ReactNode } from 'react';
import { Download, Loader2, Search } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import type {
  DashboardProjectArtifactTaskOption,
  DashboardProjectArtifactWorkflowOption,
  DashboardProjectArtifactWorkItemOption,
} from '../../lib/api.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import type { ProjectArtifactScopeChip } from './project-artifact-explorer-adaptive-support.js';
import type { ProjectArtifactSort } from './project-artifact-explorer-support.js';

export function ProjectArtifactFilterCard(props: {
  loadedArtifactCount: number;
  totalArtifactCount: number;
  selectedArtifactCount: number;
  previewableArtifactCount: number;
  roleCount: number;
  nextAction: string;
  scopeChips: ProjectArtifactScopeChip[];
  query: string;
  selectedWorkflowId: string;
  selectedStageName: string;
  selectedWorkItemId: string;
  selectedTaskId: string;
  selectedRole: string;
  selectedContentType: string;
  previewMode: string;
  createdFrom: string;
  createdTo: string;
  sort: ProjectArtifactSort;
  workflows: DashboardProjectArtifactWorkflowOption[];
  stageOptions: string[];
  workItems: DashboardProjectArtifactWorkItemOption[];
  tasks: DashboardProjectArtifactTaskOption[];
  roleOptions: string[];
  contentTypeOptions: string[];
  onQueryChange(value: string): void;
  onWorkflowChange(value: string): void;
  onStageChange(value: string): void;
  onWorkItemChange(value: string): void;
  onTaskChange(value: string): void;
  onRoleChange(value: string): void;
  onContentTypeChange(value: string): void;
  onPreviewModeChange(value: string): void;
  onCreatedFromChange(value: string): void;
  onCreatedToChange(value: string): void;
  onSortChange(value: ProjectArtifactSort): void;
  onReset(): void;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Filter Artifacts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 rounded-2xl bg-muted/10 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="space-y-2">
            <div>
              <p className="text-sm font-medium">Current review scope</p>
              <p className="text-sm text-muted">{props.nextAction}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {props.scopeChips.length > 0 ? (
                props.scopeChips.map((chip) => (
                  <Badge key={`${chip.label}:${chip.value}`} variant="outline">
                    {chip.label}: {chip.value}
                  </Badge>
                ))
              ) : (
                <Badge variant="outline">Project-wide artifact scope</Badge>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Badge variant="secondary">{props.loadedArtifactCount} loaded</Badge>
            <Badge variant="outline">{props.totalArtifactCount} matched</Badge>
            <Badge variant="outline">{props.previewableArtifactCount} preview-ready</Badge>
            <Badge variant="outline">{props.roleCount} roles</Badge>
            {props.selectedArtifactCount > 0 ? (
              <Badge variant="secondary">{props.selectedArtifactCount} selected</Badge>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 2xl:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,0.8fr))]">
          <label className="grid gap-1">
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
              Search
            </span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                className="pl-9"
                placeholder="Artifact, workflow, task, role"
                value={props.query}
                onChange={(event) => props.onQueryChange(event.target.value)}
              />
            </div>
          </label>
          <ArtifactSelect
            label="Workflow"
            value={props.selectedWorkflowId}
            onValueChange={props.onWorkflowChange}
          >
            {props.workflows.map((workflow) => (
              <SelectItem key={workflow.id} value={workflow.id}>
                {workflow.name}
              </SelectItem>
            ))}
          </ArtifactSelect>
          <ArtifactSelect
            label="Stage"
            value={props.selectedStageName}
            onValueChange={props.onStageChange}
          >
            {props.stageOptions.map((stageName) => (
              <SelectItem key={stageName} value={stageName}>
                {stageName}
              </SelectItem>
            ))}
          </ArtifactSelect>
          <ArtifactSelect
            label="Work Item"
            value={props.selectedWorkItemId}
            onValueChange={props.onWorkItemChange}
          >
            {props.workItems.map((workItem) => (
              <SelectItem key={workItem.id} value={workItem.id}>
                {workItem.title}
              </SelectItem>
            ))}
          </ArtifactSelect>
          <ArtifactSelect label="Task" value={props.selectedTaskId} onValueChange={props.onTaskChange}>
            {props.tasks.map((task) => (
              <SelectItem key={task.id} value={task.id}>
                {task.title}
              </SelectItem>
            ))}
          </ArtifactSelect>
        </div>

        <div className="grid gap-3 2xl:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
          <ArtifactSelect label="Role" value={props.selectedRole} onValueChange={props.onRoleChange}>
            {props.roleOptions.map((role) => (
              <SelectItem key={role} value={role}>
                {role}
              </SelectItem>
            ))}
          </ArtifactSelect>
          <ArtifactSelect
            label="Content Type"
            value={props.selectedContentType}
            onValueChange={props.onContentTypeChange}
          >
            {props.contentTypeOptions.map((contentType) => (
              <SelectItem key={contentType} value={contentType}>
                {contentType}
              </SelectItem>
            ))}
          </ArtifactSelect>
          <ArtifactSelect
            label="Delivery mode"
            value={props.previewMode}
            onValueChange={props.onPreviewModeChange}
            allLabel="All delivery modes"
          >
            <SelectItem value="inline">Inline preview ready</SelectItem>
            <SelectItem value="download">Download only</SelectItem>
          </ArtifactSelect>
          <LabeledInput
            label="Created From"
            type="date"
            value={props.createdFrom}
            onChange={props.onCreatedFromChange}
          />
          <LabeledInput
            label="Created To"
            type="date"
            value={props.createdTo}
            onChange={props.onCreatedToChange}
          />
          <ArtifactSelect
            label="Sort"
            value={props.sort}
            onValueChange={(value) => props.onSortChange(value as ProjectArtifactSort)}
          >
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
            <SelectItem value="largest">Largest first</SelectItem>
            <SelectItem value="smallest">Smallest first</SelectItem>
            <SelectItem value="name">Name</SelectItem>
          </ArtifactSelect>
          <div className="flex items-end">
            <Button variant="outline" onClick={props.onReset}>
              Reset Filters
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ProjectArtifactBulkActionBar(props: {
  selectedCount: number;
  isDownloading: boolean;
  onClear(): void;
  onDownload(): void;
}): JSX.Element | null {
  if (props.selectedCount === 0) {
    return null;
  }

  return (
    <div className="sticky top-16 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/95 px-4 py-3 shadow-sm backdrop-blur">
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="secondary">{props.selectedCount} selected</Badge>
        <span className="text-muted">Use bulk actions for handoff and audit export.</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={props.onClear}>
          Clear
        </Button>
        <Button size="sm" onClick={props.onDownload} disabled={props.isDownloading}>
          {props.isDownloading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Download Selected
        </Button>
      </div>
    </div>
  );
}

function ArtifactSelect(props: {
  label: string;
  value: string;
  onValueChange(value: string): void;
  allLabel?: string;
  children: ReactNode;
}): JSX.Element {
  const allLabel = props.allLabel ?? `All ${props.label.toLowerCase()}s`;
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
        {props.label}
      </span>
      <Select
        value={props.value || '__all__'}
        onValueChange={(value) => props.onValueChange(value === '__all__' ? '' : value)}
      >
        <SelectTrigger>
          <SelectValue placeholder={allLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">{allLabel}</SelectItem>
          {props.children}
        </SelectContent>
      </Select>
    </label>
  );
}

function LabeledInput(props: {
  label: string;
  type: string;
  value: string;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
        {props.label}
      </span>
      <Input
        type={props.type}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}
