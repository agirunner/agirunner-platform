import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import type {
  DashboardWorkflowStageRecord,
} from '../../lib/api.js';
import { listWorkflowGates, type DashboardGateDetailRecord } from '../work-shared/gate-api.js';
import { GateDetailCard } from '../work-shared/gate-detail-card.js';
import {
  buildWorkflowDetailPermalink,
  isWorkflowDetailTargetHighlighted,
} from './workflow-detail-permalinks.js';
import { PlaybookBoardCard } from './workflow-detail-board-card.js';
import { TaskGraphCard } from './workflow-detail-task-graph-card.js';
import { formatUsdDisplay } from './workflow-ux-formatting.js';
import { WorkflowActivationsCard } from './workflow-detail-activations-card.js';
import { WorkspaceTimelineCard } from './workflow-detail-workspace-timeline-card.js';
import { WorkflowControlActions } from './workflow-control-actions.js';
import {
  CopyableIdBadge,
  OperatorStatusBadge,
  RelativeTimestamp,
} from '../../components/operator-display/operator-display.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';

interface MissionControlSummary {
  total: number;
  ready: number;
  in_progress: number;
  blocked: number;
  completed: number;
  failed: number;
}

export function MissionControlCard(props: {
  workflow: {
    id: string;
    state?: string | null;
    workspace_id?: string | null;
  };
  summary: MissionControlSummary;
  workItemSummary?: {
    open_work_item_count?: number;
    completed_work_item_count?: number;
    active_stage_count?: number;
    awaiting_gate_count?: number;
  } | null;
  totalCostUsd: number;
  latestActivitySummary?: string;
}) {
  const specialistPressure = props.summary.ready + props.summary.in_progress;
  const openWorkItems = props.workItemSummary?.open_work_item_count ?? 0;
  const completedWorkItems = props.workItemSummary?.completed_work_item_count ?? 0;
  const liveStages = props.workItemSummary?.active_stage_count ?? 0;
  const gateReviews = props.workItemSummary?.awaiting_gate_count ?? 0;
  return (
    <Card className="border-border/80 bg-card shadow-sm">
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Workflow Workspace</CardTitle>
            <CardDescription>
              Workflow state, operator controls, and live board health for this run.
            </CardDescription>
          </div>
          <WorkflowControlActions
            workflowId={props.workflow.id}
            workflowState={props.workflow.state}
            workspaceId={props.workflow.workspace_id}
          />
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <MissionMetric label="Open Work" value={openWorkItems} />
          <MissionMetric label="Gate Reviews" value={gateReviews} />
          <MissionMetric label="Live Stages" value={liveStages} />
          <MissionMetric label="Queued Steps" value={specialistPressure} />
          <MissionMetric label="Blocked + Failed" value={props.summary.blocked + props.summary.failed} />
          <MissionMetric label="Completed Work" value={completedWorkItems} />
        </div>
        <div className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Operator posture</p>
              <p className="text-sm text-muted">
                Prioritize open work, gate pressure, and blocked specialist steps before touching run controls.
              </p>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/90 px-3 py-2 text-right shadow-sm">
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
                Cost to Date
              </p>
              <p className="text-lg font-semibold text-foreground">
                {formatUsdDisplay(props.totalCostUsd)}
              </p>
            </div>
          </div>
          <div className="grid gap-3 rounded-lg border border-border/60 bg-background/80 p-3 sm:grid-cols-2">
            <SnapshotMetric
              label="Specialist step health"
              value={`${props.summary.in_progress} in progress • ${props.summary.ready} ready`}
            />
            <SnapshotMetric
              label="Recovery pressure"
              value={`${props.summary.blocked} blocked • ${props.summary.failed} failed`}
            />
            <SnapshotMetric
              label="Board completion"
              value={`${completedWorkItems} complete • ${openWorkItems} open`}
            />
            <SnapshotMetric
              label="Latest operator activity"
              value={props.latestActivitySummary ?? 'No operator activity recorded yet'}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function summarizeStageMetrics(stages: DashboardWorkflowStageRecord[]) {
  return {
    total: stages.length,
    active: stages.filter((stage) => stage.status !== 'completed').length,
    awaitingGate: stages.filter((stage) => stage.gate_status === 'awaiting_approval').length,
    trackedGates: stages.filter((stage) => stage.gate_status !== 'not_requested').length,
  };
}

export function WorkflowStagesCard(props: {
  stages: DashboardWorkflowStageRecord[];
  isLoading: boolean;
  hasError: boolean;
  selectedGateStageName?: string | null;
  onSelectGate?(stageName: string): void;
}) {
  const location = useLocation();
  const params = useParams<{ id: string }>();
  const workflowId = params.id ?? '';
  const gatesQuery = useQuery({
    queryKey: ['workflow-gates', workflowId],
    queryFn: () => listWorkflowGates(workflowId),
    enabled: workflowId.length > 0,
  });
  const gatesByStageName = new Map<string, DashboardGateDetailRecord>();
  for (const gate of gatesQuery.data ?? []) {
    if (!gatesByStageName.has(gate.stage_name)) {
      gatesByStageName.set(gate.stage_name, gate);
    }
  }
  const stageMetrics = summarizeStageMetrics(props.stages);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stage Gates</CardTitle>
        <CardDescription>
          Stage goals, gate detail, and stable gate permalinks for this playbook board run.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {props.isLoading ? <p className="text-sm text-muted">Loading stages...</p> : null}
        {props.hasError ? <p className="text-sm text-red-600">Failed to load board stages.</p> : null}
        {gatesQuery.isError ? (
          <p className="text-sm text-red-600">Failed to load board gate detail.</p>
        ) : null}
        {props.stages.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StageSummaryMetric label="Stages" value={String(stageMetrics.total)} />
            <StageSummaryMetric label="Live" value={String(stageMetrics.active)} />
            <StageSummaryMetric label="Awaiting gates" value={String(stageMetrics.awaitingGate)} />
            <StageSummaryMetric label="Tracked gates" value={String(stageMetrics.trackedGates)} />
          </div>
        ) : null}
        <div className="grid gap-4">
        {props.stages.map((stage) => (
          <article
            key={stage.id}
            id={`gate-${stage.name}`}
            className="grid gap-3 rounded-lg border border-border/70 bg-border/10 p-4"
            tabIndex={-1}
            data-workflow-focus-anchor="true"
            aria-labelledby={`gate-heading-${stage.id}`}
            data-highlighted={
              props.selectedGateStageName === stage.name ||
              isWorkflowDetailTargetHighlighted(location.search, location.hash, 'gate', stage.name)
                ? 'true'
                : 'false'
            }
          >
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-1">
                <strong id={`gate-heading-${stage.id}`}>
                  {stage.position + 1}. {stage.name}
                </strong>
                <span className="text-sm text-muted">
                  {stage.summary?.trim() || 'Stage packet ready for operator review.'}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <OperatorStatusBadge status={stage.status} />
                <OperatorStatusBadge status={stage.gate_status} variant="outline" />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <StageDetailCard
                label="Review goal"
                value={stage.goal || 'No stage goal recorded.'}
              />
              <StageDetailCard
                label="Operator posture"
                value={stage.guidance || 'No additional operator guidance recorded.'}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Iterations: {stage.iteration_count}</Badge>
              {stage.started_at ? (
                <RelativeTimestamp
                  value={stage.started_at}
                  prefix="Started"
                  className="rounded-full border border-border/70 bg-background/80 px-2.5 py-1"
                />
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={() => props.onSelectGate?.(stage.name)}>
                Gate focus
              </Button>
              <Link
                to={buildWorkflowDetailPermalink(workflowId, {
                  gateStageName: stage.name,
                })}
                className="text-sm text-muted underline-offset-4 hover:underline"
              >
                Permalink
              </Link>
            </div>
            {gatesByStageName.get(stage.name) ? (
              <div className="pt-2">
                <GateDetailCard gate={gatesByStageName.get(stage.name) as DashboardGateDetailRecord} />
              </div>
            ) : null}
          </article>
        ))}
        </div>
      </CardContent>
    </Card>
  );
}

function StageSummaryMetric(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="grid gap-1 rounded-xl border border-border/70 bg-background/90 p-4 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
        {props.label}
      </div>
      <strong className="text-xl text-foreground">{props.value}</strong>
    </div>
  );
}

function StageDetailCard(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="grid gap-2 rounded-xl border border-border/70 bg-background/80 p-4 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
        {props.label}
      </div>
      <p className="text-sm leading-6 text-muted">{props.value}</p>
    </div>
  );
}

function MissionMetric({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="grid gap-1 rounded-xl border border-border/70 bg-background/90 p-4 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted">{label}</p>
      <strong className="text-2xl text-foreground">{value}</strong>
    </div>
  );
}

function SnapshotMetric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="grid gap-1 rounded-xl border border-border/70 bg-background/90 p-4 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted">{label}</p>
      <strong className="text-sm text-foreground">{value}</strong>
    </div>
  );
}

function badgeVariantForState(
  state: string | null | undefined,
): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' {
  switch (state) {
    case 'completed':
    case 'approved':
      return 'success';
    case 'failed':
    case 'rejected':
    case 'cancelled':
      return 'destructive';
    case 'blocked':
    case 'escalated':
    case 'awaiting_approval':
      return 'warning';
    case 'in_progress':
    case 'running':
    case 'processing':
      return 'default';
    default:
      return 'outline';
  }
}
