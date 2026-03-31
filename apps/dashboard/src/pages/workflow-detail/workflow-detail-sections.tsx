import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import type {
  DashboardWorkflowBoardResponse,
  DashboardWorkflowBoardColumn,
  DashboardWorkflowStageRecord,
  DashboardWorkflowWorkItemRecord,
} from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { listWorkflowGates, type DashboardGateDetailRecord } from '../work-shared/gate-api.js';
import { GateDetailCard } from '../work-shared/gate-detail-card.js';
import {
  buildWorkflowDetailPermalink,
  isWorkflowDetailTargetHighlighted,
} from './workflow-detail-permalinks.js';
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
import {
  groupWorkflowWorkItems,
  type DashboardGroupedWorkItemRecord,
} from './workflow-work-item-detail-support.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
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

export function PlaybookBoardCard(props: {
  workflowId: string;
  board?: DashboardWorkflowBoardResponse;
  stages: DashboardWorkflowStageRecord[];
  isLoading: boolean;
  hasError: boolean;
  selectedWorkItemId?: string | null;
  onSelectWorkItem?(workItemId: string): void;
  onBoardChanged?(): Promise<unknown> | unknown;
}) {
  const location = useLocation();
  const groupedWorkItems = groupWorkflowWorkItems(props.board?.work_items ?? []);
  const workItemsById = new Map((props.board?.work_items ?? []).map((item) => [item.id, item]));
  const milestoneGroups = groupedWorkItems.filter((item) => (item.children?.length ?? 0) > 0);
  const standaloneRoots = groupedWorkItems.filter((item) => (item.children?.length ?? 0) === 0);
  const [boardMode, setBoardMode] = useState<'grouped' | 'ungrouped'>(
    milestoneGroups.length > 0 ? 'grouped' : 'ungrouped',
  );

  useEffect(() => {
    if (milestoneGroups.length === 0 && boardMode === 'grouped') {
      setBoardMode('ungrouped');
    }
  }, [boardMode, milestoneGroups.length]);

  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Work Board</CardTitle>
            <CardDescription>
              Triage directly on the board, then switch display mode when you need milestone
              grouping or a flat operator scan.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {props.selectedWorkItemId ? (
              <Badge variant="outline">Focused detail open</Badge>
            ) : null}
            <div
              aria-label="Board view mode"
              className="inline-flex rounded-xl border border-border/70 bg-background/80 p-1"
              role="tablist"
            >
              <button
                type="button"
                role="tab"
                aria-selected={boardMode === 'grouped'}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  boardMode === 'grouped'
                    ? 'bg-accent text-accent-foreground shadow-sm'
                    : 'text-muted hover:bg-border/60 hover:text-foreground',
                )}
                onClick={() => setBoardMode('grouped')}
                disabled={milestoneGroups.length === 0}
              >
                Grouped by milestone
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={boardMode === 'ungrouped'}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  boardMode === 'ungrouped'
                    ? 'bg-accent text-accent-foreground shadow-sm'
                    : 'text-muted hover:bg-border/60 hover:text-foreground',
                )}
                onClick={() => setBoardMode('ungrouped')}
              >
                Flat board
              </button>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {props.isLoading ? (
          <p className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-3 text-sm text-muted">
            Loading board...
          </p>
        ) : null}
        {props.hasError ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            Failed to load work board.
          </p>
        ) : null}
        {props.board ? (
          <div className="grid gap-4">
            {props.board.stage_summary.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-3">
                {props.board.stage_summary.map((stage) => (
                  <article
                    key={stage.name}
                    className="grid gap-2 rounded-xl border border-border/70 bg-gradient-to-br from-border/10 via-surface to-surface p-4 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="grid gap-1">
                        <strong>{stage.name}</strong>
                        <span className="text-xs text-muted">Stage snapshot</span>
                      </div>
                      <Badge variant="secondary">
                        {stage.completed_count}/{stage.work_item_count}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted">{stage.goal}</p>
                  </article>
                ))}
              </div>
            ) : null}
            <div
              className={
                props.selectedWorkItemId
                  ? 'grid gap-4 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3'
                  : 'grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
              }
            >
              {props.board.columns.map((column) => {
                const flatItems =
                  props.board?.work_items.filter((item) => item.column_id === column.id) ?? [];
                const groupedItems = [
                  ...milestoneGroups.filter((item) => item.column_id === column.id),
                  ...standaloneRoots.filter((item) => item.column_id === column.id),
                ];
                const visibleCount =
                  boardMode === 'grouped' ? groupedItems.length : flatItems.length;
                return (
                  <Card key={column.id} className="border-border/70 bg-surface/90">
                    <CardHeader className="gap-3 pb-4">
                      <div className="flex items-center justify-between gap-3">
                        <CardTitle className="text-base">{column.label}</CardTitle>
                        <Badge variant="secondary">{visibleCount}</Badge>
                      </div>
                      {column.description ? (
                        <CardDescription>{column.description}</CardDescription>
                      ) : null}
                    </CardHeader>
                    <CardContent className="grid gap-3">
                      {boardMode === 'grouped'
                        ? groupedItems.map((item) =>
                            isMilestoneRecord(item) ? (
                              <MilestoneGroupCard
                                key={item.id}
                                workflowId={props.workflowId}
                                columns={props.board!.columns}
                                stages={props.stages}
                                milestone={item}
                                selectedWorkItemId={props.selectedWorkItemId}
                                onSelectWorkItem={props.onSelectWorkItem}
                                onBoardChanged={props.onBoardChanged}
                              />
                            ) : (
                              <BoardWorkItemCard
                                key={item.id}
                                workflowId={props.workflowId}
                                columns={props.board!.columns}
                                stages={props.stages}
                                item={item}
                                parentTitle={
                                  item.parent_work_item_id
                                    ? workItemsById.get(item.parent_work_item_id)?.title
                                    : undefined
                                }
                                selectedWorkItemId={props.selectedWorkItemId}
                                onSelectWorkItem={props.onSelectWorkItem}
                                onBoardChanged={props.onBoardChanged}
                                locationSearch={location.search}
                                locationHash={location.hash}
                              />
                            ),
                          )
                        : flatItems.map((item) => (
                            <BoardWorkItemCard
                              key={item.id}
                              workflowId={props.workflowId}
                              columns={props.board!.columns}
                              stages={props.stages}
                              item={item}
                              parentTitle={
                                item.parent_work_item_id
                                  ? workItemsById.get(item.parent_work_item_id)?.title
                                  : undefined
                              }
                              selectedWorkItemId={props.selectedWorkItemId}
                              onSelectWorkItem={props.onSelectWorkItem}
                              onBoardChanged={props.onBoardChanged}
                              locationSearch={location.search}
                              locationHash={location.hash}
                            />
                          ))}
                      {visibleCount === 0 ? (
                        <div className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-5 text-sm text-muted">
                          No work items.
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MilestoneGroupCard(props: {
  workflowId: string;
  columns: DashboardWorkflowBoardColumn[];
  stages: DashboardWorkflowStageRecord[];
  milestone: DashboardGroupedWorkItemRecord;
  selectedWorkItemId?: string | null;
  onSelectWorkItem?(workItemId: string): void;
  onBoardChanged?(): Promise<unknown> | unknown;
}) {
  const completedChildren = readCompletedChildren(props.milestone);
  const totalChildren = readChildCount(props.milestone);
  const progressPercent = totalChildren === 0 ? 0 : Math.round((completedChildren / totalChildren) * 100);

  return (
    <article className="grid gap-3 rounded-lg border border-border/70 bg-border/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          className="text-left"
          aria-pressed={props.selectedWorkItemId === props.milestone.id}
          onClick={() => props.onSelectWorkItem?.(props.milestone.id)}
        >
          <strong className="text-foreground">{props.milestone.title}</strong>
        </button>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">Milestone</Badge>
          <Badge variant="secondary">{progressPercent}% complete</Badge>
        </div>
      </div>
      {props.milestone.goal ? <p className="text-sm text-muted">{props.milestone.goal}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">
          {completedChildren}/{totalChildren} child items complete
        </Badge>
        <Badge variant="outline">{props.milestone.stage_name}</Badge>
        <Badge variant="outline">{props.milestone.column_id}</Badge>
      </div>
      <BoardMoveControls
        workflowId={props.workflowId}
        workItemId={props.milestone.id}
        columns={props.columns}
        stages={props.stages}
        initialColumnId={props.milestone.column_id ?? ''}
        initialStageName={props.milestone.stage_name ?? ''}
        onBoardChanged={props.onBoardChanged}
      />
      <div className="grid gap-2">
        {(props.milestone.children ?? []).map((child) => (
          <BoardWorkItemCard
            key={child.id}
            workflowId={props.workflowId}
            columns={props.columns}
            stages={props.stages}
            item={child}
            parentTitle={props.milestone.title}
            selectedWorkItemId={props.selectedWorkItemId}
            onSelectWorkItem={props.onSelectWorkItem}
            onBoardChanged={props.onBoardChanged}
            locationSearch=""
            locationHash=""
            compact
          />
        ))}
      </div>
    </article>
  );
}

function BoardWorkItemCard(props: {
  workflowId: string;
  columns: DashboardWorkflowBoardColumn[];
  stages: DashboardWorkflowStageRecord[];
  item: DashboardWorkflowWorkItemRecord | DashboardGroupedWorkItemRecord;
  parentTitle?: string;
  selectedWorkItemId?: string | null;
  onSelectWorkItem?(workItemId: string): void;
  onBoardChanged?(): Promise<unknown> | unknown;
  locationSearch: string;
  locationHash: string;
  compact?: boolean;
}) {
  return (
    <article
      key={props.item.id}
      id={`work-item-card-${props.item.id}`}
      className={
        props.compact
          ? 'grid gap-3 rounded-lg border border-border/70 bg-surface/80 p-3'
          : 'grid gap-3 rounded-lg border border-border/70 bg-border/10 p-4 shadow-sm'
      }
      data-selected={props.selectedWorkItemId === props.item.id ? 'true' : 'false'}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          className="text-left"
          aria-pressed={props.selectedWorkItemId === props.item.id}
          onClick={() => props.onSelectWorkItem?.(props.item.id)}
        >
          <strong className="text-foreground">{props.item.title}</strong>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {props.item.completed_at ? <Badge variant="success">completed</Badge> : null}
          <Link
            to={buildWorkflowDetailPermalink(props.item.workflow_id, {
              workItemId: props.item.id,
            })}
            className="text-sm text-muted underline-offset-4 hover:underline"
          >
            Permalink
          </Link>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">
          {props.locationSearch &&
          isWorkflowDetailTargetHighlighted(
            props.locationSearch,
            props.locationHash,
            'work_item',
            props.item.id,
          )
            ? 'Highlighted'
            : props.item.stage_name}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{props.item.priority}</Badge>
        {props.item.owner_role ? <Badge variant="outline">{props.item.owner_role}</Badge> : null}
        {isMilestoneRecord(props.item) ? <Badge variant="outline">Milestone</Badge> : null}
        {props.parentTitle ? <Badge variant="outline">Milestone: {props.parentTitle}</Badge> : null}
        {props.item.task_count !== undefined ? (
          <Badge variant="secondary">{props.item.task_count} tasks</Badge>
        ) : null}
        {isMilestoneRecord(props.item) ? (
          <Badge variant="secondary">
            {readCompletedChildren(props.item)}/{readChildCount(props.item)} children
          </Badge>
        ) : null}
      </div>
      {props.item.goal ? <p className="text-sm text-muted">{props.item.goal}</p> : null}
      {props.item.acceptance_criteria ? (
        <p className="text-sm text-muted">Acceptance: {props.item.acceptance_criteria}</p>
      ) : null}
      {props.item.notes ? <p className="text-sm text-muted">Notes: {props.item.notes}</p> : null}
      <BoardMoveControls
        workflowId={props.workflowId}
        workItemId={props.item.id}
        columns={props.columns}
        stages={props.stages}
        initialColumnId={props.item.column_id ?? ''}
        initialStageName={props.item.stage_name ?? ''}
        onBoardChanged={props.onBoardChanged}
      />
    </article>
  );
}

function BoardMoveControls(props: {
  workflowId: string;
  workItemId: string;
  columns: DashboardWorkflowBoardColumn[];
  stages: DashboardWorkflowStageRecord[];
  initialColumnId: string;
  initialStageName: string;
  onBoardChanged?(): Promise<unknown> | unknown;
}) {
  const [columnId, setColumnId] = useState(props.initialColumnId);
  const [stageName, setStageName] = useState(props.initialStageName);
  const moveMutation = useMutation({
    mutationFn: async () =>
      dashboardApi.updateWorkflowWorkItem(props.workflowId, props.workItemId, {
        column_id: columnId,
        stage_name: stageName,
      }),
    onSuccess: async () => {
      await props.onBoardChanged?.();
    },
  });

  useEffect(() => {
    setColumnId(props.initialColumnId);
    setStageName(props.initialStageName);
  }, [props.initialColumnId, props.initialStageName]);

  const hasChanges = columnId !== props.initialColumnId || stageName !== props.initialStageName;

  return (
    <div className="grid gap-3 rounded-md border border-border/60 bg-surface/70 p-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">
        Move work item
      </span>
      <div className="grid gap-2">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted">Column</span>
          <Select value={columnId} onValueChange={setColumnId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose column" />
            </SelectTrigger>
            <SelectContent>
              {props.columns.map((column) => (
                <SelectItem key={column.id} value={column.id}>
                  {column.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted">Stage</span>
          <Select value={stageName} onValueChange={setStageName}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose stage" />
            </SelectTrigger>
            <SelectContent>
              {props.stages.map((stage) => (
                <SelectItem key={stage.id} value={stage.name}>
                  {stage.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      <div className="flex">
        <Button onClick={() => moveMutation.mutate()} disabled={!hasChanges || moveMutation.isPending}>
          {moveMutation.isPending ? 'Moving…' : 'Move item'}
        </Button>
      </div>
    </div>
  );
}

function isMilestoneRecord(
  item: { children_count?: number; is_milestone?: boolean } | DashboardWorkflowWorkItemRecord,
) {
  return (item.children_count ?? 0) > 0 || item.is_milestone === true;
}

function readChildCount(
  item:
    | { children_count?: number; children?: DashboardGroupedWorkItemRecord[] }
    | DashboardWorkflowWorkItemRecord,
) {
  return item.children_count ?? item.children?.length ?? 0;
}

function readCompletedChildren(item: {
  children_completed?: number;
  children?: DashboardGroupedWorkItemRecord[];
} | DashboardWorkflowWorkItemRecord) {
  return item.children_completed ?? item.children?.filter((child) => child.completed_at).length ?? 0;
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
