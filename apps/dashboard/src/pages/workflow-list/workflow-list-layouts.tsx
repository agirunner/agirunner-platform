import { Link } from 'react-router-dom';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { WorkflowControlActions } from '../workflow-detail/workflow-control-actions.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import {
  describeGateSummary,
  describeOperatorSignal,
  describeWorkflowCost,
  describeWorkflowProgress,
  describeWorkflowStage,
  describeWorkflowType,
  formatRelativeRunAge,
  resolveStatus,
  statusBadgeVariant,
  type WorkflowListRecord,
} from './workflow-list-support.js';
import {
  describeWorkflowStageLabel,
} from './workflow-list-stage-presentation.js';

export function WorkflowTable(props: { workflows: WorkflowListRecord[] }): JSX.Element {
  if (props.workflows.length === 0) {
    return <EmptyWorkflowState />;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:hidden">
        {props.workflows.map((workflow) => (
          <WorkflowListCard key={workflow.id} workflow={workflow} />
        ))}
      </div>
      <div className="hidden overflow-hidden rounded-xl border border-border/70 bg-card lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Board</TableHead>
              <TableHead>Posture</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Gates</TableHead>
              <TableHead>Spend</TableHead>
              <TableHead>Age</TableHead>
              <TableHead className="text-right">Controls</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.workflows.map((workflow) => {
              const status = resolveStatus(workflow);
              return (
                <TableRow key={workflow.id}>
                  <TableCell className="align-top">
                    <div className="space-y-1">
                      <Link
                        to={`/work/boards/${workflow.id}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {workflow.name}
                      </Link>
                      <div className="flex flex-wrap gap-2 text-xs text-muted">
                        <span>{workflow.workspace_name ?? 'No workspace linked'}</span>
                        <span>{describeWorkflowType(workflow)}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="space-y-1">
                      <Badge variant={statusBadgeVariant(status)} className="capitalize">
                        {status}
                      </Badge>
                      <p className="max-w-56 text-xs text-muted">
                        {describeOperatorSignal(workflow)}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="space-y-1 text-sm">
                      <p>{describeWorkflowStage(workflow)}</p>
                      <p className="text-xs text-muted">
                        {describeWorkflowProgress(workflow)}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="align-top text-sm">
                    {describeGateSummary(workflow)}
                  </TableCell>
                  <TableCell className="align-top text-sm">
                    {describeWorkflowCost(workflow)}
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="space-y-1 text-sm">
                      <p>{formatRelativeRunAge(workflow.created_at)}</p>
                      <p className="text-xs text-muted">
                        {new Date(workflow.created_at).toLocaleString()}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <WorkflowControlActions
                      workflowId={workflow.id}
                      workflowState={workflow.state ?? workflow.status}
                      workspaceId={workflow.workspace_id}
                      className="justify-end"
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function WorkflowListCard(props: { workflow: WorkflowListRecord }): JSX.Element {
  const status = resolveStatus(props.workflow);
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="grid gap-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <Link
              to={`/work/boards/${props.workflow.id}`}
              className="block truncate text-base font-semibold text-accent hover:underline"
            >
              {props.workflow.name}
            </Link>
            <p className="text-sm text-muted">
              {props.workflow.workspace_name ?? 'No workspace linked'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusBadgeVariant(status)} className="capitalize">
              {status}
            </Badge>
            <Badge variant="outline">{describeWorkflowType(props.workflow)}</Badge>
          </div>
        </div>
        <p className="text-sm text-foreground">{describeOperatorSignal(props.workflow)}</p>
        <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/20 p-3 sm:grid-cols-2">
          <WorkflowInfo
            label={describeWorkflowStageLabel(props.workflow)}
            value={describeWorkflowStage(props.workflow)}
          />
          <WorkflowInfo label="Progress" value={describeWorkflowProgress(props.workflow)} />
          <WorkflowInfo label="Gates" value={describeGateSummary(props.workflow)} />
          <WorkflowInfo label="Spend" value={describeWorkflowCost(props.workflow)} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">{formatRelativeRunAge(props.workflow.created_at)}</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <WorkflowControlActions
              workflowId={props.workflow.id}
              workflowState={props.workflow.state ?? props.workflow.status}
              workspaceId={props.workflow.workspace_id}
            />
            <Button size="sm" asChild>
              <Link to={`/work/boards/${props.workflow.id}`}>Open board</Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function WorkflowInfo(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
        {props.label}
      </p>
      <p className="text-sm text-foreground">{props.value}</p>
    </div>
  );
}

export function EmptyWorkflowState(): JSX.Element {
  return (
    <Card className="border-dashed border-border/70 bg-muted/10">
      <CardContent className="grid gap-2 px-6 py-10 text-center">
        <p className="text-base font-semibold text-foreground">
          No runs match the current filters.
        </p>
        <p className="text-sm text-muted">
          Clear the filters or launch a new playbook run to start tracking delivery posture here.
        </p>
      </CardContent>
    </Card>
  );
}
