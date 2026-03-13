import { FileText, Package, Rows3, Workflow } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent } from '../../components/ui/card.js';
import type {
  ArtifactInventorySummary,
  DocumentInventorySummary,
  ProjectTaskOption,
  ProjectWorkflowOption,
  ProjectWorkItemOption,
} from './project-content-browser-support.js';
import {
  formatContentFileSize,
  formatContentRelativeTimestamp,
} from './project-content-browser-support.js';

interface ContentBrowserOverviewProps {
  activeTab: 'documents' | 'artifacts';
  workflowId: string;
  selectedWorkflow: ProjectWorkflowOption | null;
  selectedWorkItem: ProjectWorkItemOption | null;
  selectedTask: ProjectTaskOption | null;
  documentSummary: DocumentInventorySummary;
  artifactSummary: ArtifactInventorySummary;
}

export function ContentBrowserOverview(props: ContentBrowserOverviewProps): JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
      <PacketCard
        icon={<Workflow className="h-4 w-4" />}
        label="Workflow context"
        title={props.selectedWorkflow?.name ?? 'Workflow not selected'}
        helper={
          props.selectedWorkflow
            ? `${props.selectedWorkflow.state} • created ${formatContentRelativeTimestamp(props.selectedWorkflow.createdAt)}`
            : 'Choose a workflow to unlock document and artifact operations.'
        }
        meta={
          props.selectedWorkflow ? (
            <Badge variant="secondary">{props.selectedWorkflow.state}</Badge>
          ) : null
        }
        actions={
          props.selectedWorkflow ? (
            <Link
              className="text-sm text-accent hover:underline"
              to={`/work/workflows/${props.workflowId}`}
            >
              Open workflow
            </Link>
          ) : null
        }
      />
      <PacketCard
        icon={<FileText className="h-4 w-4" />}
        label="Document coverage"
        title={`${props.documentSummary.totalDocuments} documents`}
        helper={
          props.documentSummary.totalDocuments > 0
            ? `${props.documentSummary.repositoryDocuments} repository • ${props.documentSummary.artifactDocuments} artifact • ${props.documentSummary.externalDocuments} external`
            : 'No workflow documents have been published in this scope yet.'
        }
        detail={
          props.documentSummary.totalDocuments > 0
            ? `Latest update ${formatContentRelativeTimestamp(props.documentSummary.latestCreatedAt)} • ${props.documentSummary.metadataBackedDocuments} with structured metadata`
            : 'Create the first operator-facing document from the controls below.'
        }
      />
      <PacketCard
        icon={<Package className="h-4 w-4" />}
        label="Artifact coverage"
        title={
          props.selectedTask
            ? `${props.artifactSummary.totalArtifacts} artifacts`
            : 'Task-scoped artifacts'
        }
        helper={
          props.selectedTask
            ? `${props.selectedTask.title} • ${props.selectedTask.stageName ?? 'No stage'}`
            : 'Select a work item and task to inspect or manage published artifacts.'
        }
        detail={
          props.selectedTask && props.artifactSummary.totalArtifacts > 0
            ? `${formatContentFileSize(props.artifactSummary.totalBytes)} total • ${props.artifactSummary.uniqueContentTypes} content types • latest ${formatContentRelativeTimestamp(props.artifactSummary.latestCreatedAt)}`
            : props.selectedTask
              ? 'This task has not published artifacts yet.'
              : 'Artifact uploads, previews, and deletes stay anchored to the selected task.'
        }
        actions={
          props.selectedTask ? (
            <Link
              className="text-sm text-accent hover:underline"
              to={`/work/tasks/${props.selectedTask.id}`}
            >
              Open task
            </Link>
          ) : null
        }
      />
      <PacketCard
        icon={<Rows3 className="h-4 w-4" />}
        label="Operator focus"
        title={buildOperatorFocusTitle(props)}
        helper={buildOperatorFocusHelper(props)}
        detail={buildOperatorFocusDetail(props)}
      />
    </div>
  );
}

function buildOperatorFocusTitle(props: ContentBrowserOverviewProps): string {
  if (props.activeTab === 'documents') {
    return props.selectedWorkflow ? 'Review document references' : 'Choose a workflow';
  }
  if (props.selectedTask) {
    return props.selectedTask.isOrchestratorTask
      ? 'Orchestrator artifact review'
      : 'Specialist artifact review';
  }
  if (props.selectedWorkItem) {
    return props.selectedWorkItem.title;
  }
  return 'Choose execution scope';
}

function buildOperatorFocusHelper(props: ContentBrowserOverviewProps): string {
  if (props.activeTab === 'documents') {
    return 'Documents should stay current, discoverable, and safe to hand off from the workflow board.';
  }
  if (props.selectedTask) {
    return `${props.selectedTask.state} • ${props.selectedTask.role ?? 'Unassigned role'} • ${props.selectedTask.workItemId ? 'linked to work item' : 'task-only scope'}`;
  }
  if (props.selectedWorkItem) {
    return `${props.selectedWorkItem.stageName} • ${props.selectedWorkItem.priority} priority • ${props.selectedWorkItem.columnId}`;
  }
  return 'Work-item and task filters keep artifact review anchored to the board context.';
}

function buildOperatorFocusDetail(props: ContentBrowserOverviewProps): string {
  if (props.activeTab === 'documents') {
    return props.documentSummary.describedDocuments > 0
      ? `${props.documentSummary.describedDocuments} documents already include operator-facing descriptions.`
      : 'Add titles and descriptions so operators can scan intent without opening every record.';
  }
  if (props.selectedTask) {
    return props.artifactSummary.metadataBackedArtifacts > 0
      ? `${props.artifactSummary.metadataBackedArtifacts} artifacts include structured metadata for downstream review.`
      : 'Publish artifact metadata when operators need retention, provenance, or review signals at a glance.';
  }
  if (props.selectedWorkItem) {
    return props.selectedWorkItem.completedAt
      ? 'This work item is complete; use the linked task view for terminal outputs.'
      : 'Choose a task to unlock preview, download, and upload controls for this work item.';
  }
  return 'Pick a work item or task to move from browsing into execution-aware artifact management.';
}

function PacketCard(props: {
  icon: JSX.Element;
  label: string;
  title: string;
  helper: string;
  detail?: string;
  meta?: JSX.Element | null;
  actions?: JSX.Element | null;
}): JSX.Element {
  return (
    <Card className="border-border/70 bg-card/70">
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {props.icon}
              {props.label}
            </div>
            <p className="text-base font-semibold leading-tight">{props.title}</p>
          </div>
          {props.meta}
        </div>
        <div className="space-y-1">
          <p className="text-sm text-foreground/90">{props.helper}</p>
          {props.detail ? <p className="text-xs text-muted-foreground">{props.detail}</p> : null}
        </div>
        {props.actions ? <div>{props.actions}</div> : null}
      </CardContent>
    </Card>
  );
}
