import { useEffect, useState } from 'react';
import { StructuredRecordView } from '../components/structured-data.js';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import type {
  DashboardProjectTimelineEntry,
  DashboardWorkflowActivationRecord,
  DashboardWorkflowBoardResponse,
  DashboardWorkflowBoardColumn,
  DashboardWorkflowStageRecord,
  DashboardWorkflowState,
  DashboardWorkflowWorkItemRecord,
} from '../lib/api.js';
import { dashboardApi } from '../lib/api.js';
import {
  describeTaskGraphPacket,
  type DashboardWorkflowTaskRow,
} from './workflow-detail-support.js';
import { listWorkflowGates, type DashboardGateDetailRecord } from './work/gate-api.js';
import { GateDetailCard } from './work/gate-detail-card.js';
import {
  buildWorkflowDetailPermalink,
  isWorkflowDetailTargetHighlighted,
} from './workflow-detail-permalinks.js';
import {
  buildWorkflowProjectTimelineOverview,
  buildWorkflowProjectTimelinePacket,
} from './workflow-project-timeline-support.js';
import { WorkflowControlActions } from './workflow-control-actions.js';
import {
  CopyableIdBadge,
  OperatorStatusBadge,
  RelativeTimestamp,
} from '../components/operator-display.js';
import {
  describeReviewPacket,
  formatRelativeTimestamp,
  toStructuredDetailViewData,
} from './workflow-detail-presentation.js';
import { describeTimelineEvent } from './workflow-history-card.js';
import {
  groupWorkflowWorkItems,
  type DashboardGroupedWorkItemRecord,
} from './workflow-work-item-detail-support.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { Textarea } from '../components/ui/textarea.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table.js';

interface MissionControlSummary {
  total: number;
  ready: number;
  in_progress: number;
  blocked: number;
  completed: number;
  failed: number;
}

const MANUAL_WORKFLOW_ACTIVATION_EVENT_TYPE = 'operator.manual_enqueue';
const MANUAL_WORKFLOW_ACTIVATION_SOURCE = 'workflow-detail-activations-card';

export function MissionControlCard(props: {
  workflow: {
    id: string;
    state?: string | null;
    project_id?: string | null;
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
            <CardTitle>Mission Control</CardTitle>
            <CardDescription>
              Operator controls and live board health for this board run.
            </CardDescription>
          </div>
          <WorkflowControlActions
            workflowId={props.workflow.id}
            workflowState={props.workflow.state}
            projectId={props.workflow.project_id}
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
              <p className="text-lg font-semibold text-foreground">${props.totalCostUsd.toFixed(4)}</p>
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

export function TaskGraphCard(props: {
  tasks: DashboardWorkflowTaskRow[];
  stageGroups: Array<{ stageName: string; tasks: DashboardWorkflowTaskRow[] }>;
  isLoading: boolean;
  hasError: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Execution Steps</CardTitle>
        <CardDescription>
          Human-readable specialist steps grouped by board stage for faster operator scanning.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {props.isLoading ? (
          <p className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-3 text-sm text-muted">
            Loading tasks...
          </p>
        ) : null}
        {props.hasError ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            Failed to load tasks.
          </p>
        ) : null}
        {props.stageGroups.map((group) => (
          <Card key={group.stageName} className="border-border/70 bg-border/10 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
              <div className="grid gap-1">
                <CardTitle className="text-base">{group.stageName}</CardTitle>
                <CardDescription>Execution flow, ownership, and upstream dependencies for this stage.</CardDescription>
              </div>
              <Badge variant="secondary">{group.tasks.length} steps</Badge>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 lg:hidden">
                {group.tasks.map((task) => {
                  const packet = describeTaskGraphPacket(task, props.tasks);
                  return (
                    <article
                      key={task.id}
                      className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-4 shadow-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="grid gap-1">
                          <Link to={`/work/tasks/${task.id}`} className="font-medium text-foreground">
                            {task.title}
                          </Link>
                          <p className="text-sm text-muted">{packet.focus}</p>
                        </div>
                        <Badge variant={badgeVariantForState(task.state)} className="w-fit">
                          {task.state}
                        </Badge>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <TaskGraphMetric label="Upstream steps" value={packet.upstream} />
                        <TaskGraphMetric label="Execution focus" value={packet.timing} />
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="hidden overflow-x-auto lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Step</TableHead>
                      <TableHead>Focus</TableHead>
                      <TableHead>Upstream</TableHead>
                      <TableHead>Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.tasks.map((task) => {
                      const packet = describeTaskGraphPacket(task, props.tasks);
                      return (
                        <TableRow key={task.id}>
                          <TableCell className="font-medium">
                            <div className="grid gap-1">
                              <Link to={`/work/tasks/${task.id}`}>{task.title}</Link>
                              <Badge variant={badgeVariantForState(task.state)} className="w-fit">
                                {task.state}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted">{packet.focus}</TableCell>
                          <TableCell className="text-sm text-muted">{packet.upstream}</TableCell>
                          <TableCell className="text-sm text-muted">{packet.timing}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ))}
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
              {boardMode === 'grouped'
                ? 'Grouped board mode keeps parent milestones first-class and nests child deliverables under them.'
                : 'Ungrouped board mode shows every work item directly in its current board column.'}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {props.selectedWorkItemId ? (
              <Badge variant="outline">Focused detail open</Badge>
            ) : null}
            <Button
              type="button"
              variant={boardMode === 'grouped' ? 'default' : 'outline'}
              size="sm"
              aria-pressed={boardMode === 'grouped'}
              onClick={() => setBoardMode('grouped')}
              disabled={milestoneGroups.length === 0}
            >
              Grouped by Milestone
            </Button>
            <Button
              type="button"
              variant={boardMode === 'ungrouped' ? 'default' : 'outline'}
              size="sm"
              aria-pressed={boardMode === 'ungrouped'}
              onClick={() => setBoardMode('ungrouped')}
            >
              Flat Board
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {props.selectedWorkItemId ? (
          <div className="rounded-xl border border-border/70 bg-border/10 p-4 text-sm leading-6 text-muted">
            A selected work-item packet is open beside the board. Keep the board in triage mode
            here, then use the dedicated focus rail for edits, evidence, and step-level review.
          </div>
        ) : null}
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
                  ? 'grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
                  : 'grid gap-4 md:grid-cols-2 xl:grid-cols-4'
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
    <div className="grid gap-2 rounded-md border border-border/60 bg-surface/70 p-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">
        Board move controls
      </span>
      <div className="grid gap-2 md:grid-cols-2">
        <Select value={columnId} onValueChange={setColumnId}>
          <SelectTrigger>
            <SelectValue placeholder="Board column" />
          </SelectTrigger>
          <SelectContent>
            {props.columns.map((column) => (
              <SelectItem key={column.id} value={column.id}>
                {column.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={stageName} onValueChange={setStageName}>
          <SelectTrigger>
            <SelectValue placeholder="Stage" />
          </SelectTrigger>
          <SelectContent>
            {props.stages.map((stage) => (
              <SelectItem key={stage.id} value={stage.name}>
                {stage.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => moveMutation.mutate()} disabled={!hasChanges || moveMutation.isPending}>
          {moveMutation.isPending ? 'Moving…' : 'Apply Board Move'}
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
    humanGates: stages.filter((stage) => stage.human_gate).length,
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
            <StageSummaryMetric label="Human gates" value={String(stageMetrics.humanGates)} />
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
              {stage.human_gate ? <Badge variant="outline">Human Gate</Badge> : null}
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
                <GateDetailCard gate={gatesByStageName.get(stage.name) as DashboardGateDetailRecord} source="workflow-detail" />
              </div>
            ) : null}
          </article>
        ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function WorkflowActivationsCard(props: {
  workflowId: string;
  workflowState?: DashboardWorkflowState;
  activations: DashboardWorkflowActivationRecord[];
  isLoading: boolean;
  hasError: boolean;
  canEnqueueManualActivation?: boolean;
  selectedActivationId?: string | null;
  onSelectActivation?(activationId: string): void;
  onActivationQueued?(): Promise<unknown> | unknown;
}) {
  const location = useLocation();
  const [manualActivationReason, setManualActivationReason] = useState('');
  const [manualActivationMessage, setManualActivationMessage] = useState<string | null>(null);
  const [manualActivationError, setManualActivationError] = useState<string | null>(null);
  const processingCount = props.activations.filter((activation) =>
    ['processing', 'running', 'in_progress'].includes(activation.state),
  ).length;
  const needsAttentionCount = props.activations.filter((activation) =>
    activation.recovery_status ||
    activation.redispatched_task_id ||
    ['failed', 'stale', 'cancelled'].includes(activation.state),
  ).length;
  const recoveredCount = props.activations.filter(
    (activation) => Boolean(activation.recovery_status),
  ).length;
  const queuedEventCount = props.activations.reduce(
    (total, activation) => total + (activation.event_count ?? activation.events?.length ?? 1),
    0,
  );
  const enqueueManualActivationMutation = useMutation({
    mutationFn: async () => {
      const reason = manualActivationReason.trim();
      if (!reason) {
        throw new Error('Activation reason is required.');
      }
      return dashboardApi.enqueueWorkflowActivation(props.workflowId, {
        reason,
        event_type: MANUAL_WORKFLOW_ACTIVATION_EVENT_TYPE,
        payload: {
          source: MANUAL_WORKFLOW_ACTIVATION_SOURCE,
          workflow_state: props.workflowState ?? 'active',
        },
      });
    },
    onSuccess: async () => {
      setManualActivationReason('');
      setManualActivationError(null);
      setManualActivationMessage('Queued operator wake-up for the orchestrator.');
      await props.onActivationQueued?.();
    },
    onError: (error) => {
      setManualActivationMessage(null);
      setManualActivationError(
        error instanceof Error ? error.message : 'Failed to queue workflow activation.',
      );
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Orchestrator Activations</CardTitle>
        <CardDescription>
          Queued and completed orchestrator activations for this board run.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {props.isLoading ? <p className="text-sm text-muted">Loading activations...</p> : null}
        {props.hasError ? <p className="text-sm text-red-600">Failed to load activations.</p> : null}
        {props.canEnqueueManualActivation ? (
          <div className="grid gap-4 rounded-2xl border border-border/70 bg-gradient-to-br from-surface via-surface to-border/10 p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm text-foreground">Manual Wake-Up</strong>
                  <Badge variant="secondary">Operator control</Badge>
                </div>
                <p className="text-sm text-muted">
                  Queue an operator-requested orchestrator activation when the board needs another
                  management pass outside the normal event flow.
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/90 px-3 py-2 text-right shadow-sm">
                <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
                  Event Type
                </p>
                <p className="text-sm font-medium text-foreground">
                  {MANUAL_WORKFLOW_ACTIVATION_EVENT_TYPE}
                </p>
              </div>
            </div>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-foreground">Operator reason</span>
              <Textarea
                value={manualActivationReason}
                onChange={(event) => {
                  setManualActivationReason(event.target.value);
                  setManualActivationError(null);
                  setManualActivationMessage(null);
                }}
                rows={3}
                placeholder="Explain what changed or what the orchestrator should reassess."
              />
            </label>
            {manualActivationError ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                {manualActivationError}
              </p>
            ) : null}
            {manualActivationMessage ? (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
                {manualActivationMessage}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted">
                Use this when workflow state changed outside the queue and the board still needs
                orchestrator attention.
              </p>
              <Button
                type="button"
                size="sm"
                onClick={() => enqueueManualActivationMutation.mutate()}
                disabled={
                  enqueueManualActivationMutation.isPending ||
                  manualActivationReason.trim().length === 0
                }
              >
                {enqueueManualActivationMutation.isPending
                  ? 'Queueing activation...'
                  : 'Queue activation'}
              </Button>
            </div>
          </div>
        ) : null}
        {props.activations.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ActivationMetric label="Activation batches" value={String(props.activations.length)} />
            <ActivationMetric label="In flight" value={String(processingCount)} />
            <ActivationMetric label="Needs attention" value={String(needsAttentionCount)} />
            <ActivationMetric label="Queued events" value={String(queuedEventCount)} />
          </div>
        ) : null}
        <div className="grid gap-4">
        {props.activations.map((activation) => {
          const descriptor = describeActivationEvent(
            activation.workflow_id,
            activation.activation_id ?? activation.id,
            activation.event_type,
            activation.payload,
            activation.reason,
            activation.queued_at,
          );
          const payloadPacket = describeReviewPacket(activation.payload, 'activation payload');
          return (
            <article
              key={activation.id}
              id={`activation-${activation.activation_id ?? activation.id}`}
              className="grid gap-3 rounded-lg border border-border/70 bg-border/10 p-4"
              tabIndex={-1}
              data-workflow-focus-anchor="true"
              aria-labelledby={`activation-heading-${activation.id}`}
              data-highlighted={
                props.selectedActivationId === (activation.activation_id ?? activation.id) ||
                isWorkflowDetailTargetHighlighted(
                  location.search,
                  location.hash,
                  'activation',
                  activation.activation_id ?? activation.id,
                )
                  ? 'true'
                  : 'false'
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div className="grid gap-1">
                  <strong id={`activation-heading-${activation.id}`}>{descriptor.headline}</strong>
                  <p className="text-sm text-muted">
                    {activation.summary?.trim() || descriptor.summary || 'Activation packet ready for operator review.'}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <OperatorStatusBadge status={activation.state} />
                  <Badge variant="outline">{payloadPacket.typeLabel}</Badge>
                </div>
              </div>
              {descriptor.scope ? <p className="text-sm text-muted">{descriptor.scope}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">
                  {activation.event_count ?? activation.events?.length ?? 1} events
                </Badge>
                <RelativeTimestamp
                  value={activation.queued_at}
                  prefix="Queued"
                  className="rounded-full border border-border/70 bg-background/80 px-2.5 py-1"
                />
                {activation.recovery_status ? (
                  <OperatorStatusBadge status={activation.recovery_status} variant="outline" />
                ) : null}
                {recoveredCount > 0 && activation.recovery_status ? (
                  <Badge variant="secondary">Recovered flow</Badge>
                ) : null}
              </div>
              {describeActivationRecovery(activation) ? (
                <div className="grid gap-2 rounded-xl border border-amber-300/70 bg-amber-50/80 p-4 dark:border-amber-900/70 dark:bg-amber-950/20">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <strong className="text-sm text-foreground">Activation attention</strong>
                    <Badge variant="warning">Recovery signal</Badge>
                  </div>
                  <p className="text-sm text-muted">{describeActivationRecovery(activation)}</p>
                </div>
              ) : null}
              <div className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-4">
                <div className="grid gap-2">
                  <div className="text-sm font-semibold text-foreground">{payloadPacket.summary}</div>
                  <p className="text-sm leading-6 text-muted">{payloadPacket.detail}</p>
                </div>
                {payloadPacket.badges.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {payloadPacket.badges.map((badge) => (
                      <Badge key={badge} variant="outline">
                        {badge}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {payloadPacket.hasStructuredDetail ? (
                  <details className="rounded-lg border border-border/70 bg-surface/70 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-foreground">
                      Open activation payload
                    </summary>
                    <div className="mt-3">
                      <StructuredRecordView
                        data={toStructuredDetailViewData(activation.payload)}
                        emptyMessage="No activation payload."
                      />
                    </div>
                  </details>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    props.onSelectActivation?.(activation.activation_id ?? activation.id)
                  }
                >
                  Highlight activation
                </Button>
                <CopyableIdBadge value={activation.activation_id ?? activation.id} label="Activation" />
                <Link
                  to={`/work/boards/${activation.workflow_id}/inspector?activation=${activation.activation_id ?? activation.id}&view=debug`}
                  className="text-sm text-muted underline-offset-4 hover:underline"
                >
                  Open inspector
                </Link>
                {activation.redispatched_task_id ? (
                  <Link
                    to={`/work/tasks/${activation.redispatched_task_id}`}
                    className="text-sm text-muted underline-offset-4 hover:underline"
                  >
                    Redispatched task
                  </Link>
                ) : null}
                <Link
                  to={buildWorkflowDetailPermalink(activation.workflow_id, {
                    activationId: activation.activation_id ?? activation.id,
                  })}
                  className="text-sm text-muted underline-offset-4 hover:underline"
                >
                  Permalink
                </Link>
              </div>
              {activation.events && activation.events.length > 0 ? (
                <details className="rounded-xl border border-border/70 bg-background/80 p-4 shadow-sm">
                  <summary className="cursor-pointer text-sm font-medium text-foreground">
                    Open event batch ({activation.events.length})
                  </summary>
                  <ul className="mt-4 grid gap-3">
                    {activation.events.map((event) => {
                      const eventDescriptor = describeActivationEvent(
                        activation.workflow_id,
                        activation.activation_id ?? activation.id,
                        event.event_type,
                        event.payload,
                        event.reason,
                        event.queued_at,
                      );
                      const eventPayloadPacket = describeReviewPacket(
                        event.payload,
                        'activation event payload',
                      );
                      return (
                        <li key={event.id} className="grid gap-2 rounded-md border border-border/60 bg-surface/70 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="grid gap-1">
                              <strong>{eventDescriptor.headline}</strong>
                              <p className="text-sm text-muted">
                                {event.summary?.trim() || eventDescriptor.summary || 'Activation event packet available.'}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <OperatorStatusBadge status={event.state} />
                              <Badge variant="outline">{eventPayloadPacket.typeLabel}</Badge>
                            </div>
                          </div>
                          {eventDescriptor.scope ? <p className="text-sm text-muted">{eventDescriptor.scope}</p> : null}
                          <div className="flex flex-wrap gap-2">
                            <CopyableIdBadge value={event.id} label="Event" />
                            <RelativeTimestamp
                              value={event.queued_at}
                              prefix="Queued"
                              className="rounded-full border border-border/70 bg-background/80 px-2.5 py-1"
                            />
                          </div>
                          <div className="grid gap-2 rounded-lg border border-border/70 bg-background/80 p-3">
                            <div className="text-sm font-medium text-foreground">
                              {eventPayloadPacket.summary}
                            </div>
                            <p className="text-sm leading-6 text-muted">{eventPayloadPacket.detail}</p>
                            {eventPayloadPacket.badges.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {eventPayloadPacket.badges.map((badge) => (
                                  <Badge key={badge} variant="outline">
                                    {badge}
                                  </Badge>
                                ))}
                              </div>
                            ) : null}
                            {eventPayloadPacket.hasStructuredDetail ? (
                              <details className="rounded-lg border border-border/70 bg-surface/70 p-3">
                                <summary className="cursor-pointer text-sm font-medium text-foreground">
                                  Open event payload
                                </summary>
                                <div className="mt-3">
                                  <StructuredRecordView
                                    data={toStructuredDetailViewData(event.payload)}
                                    emptyMessage="No activation payload."
                                  />
                                </div>
                              </details>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              ) : null}
            </article>
          );
        })}
        {props.activations.length === 0 && !props.isLoading && !props.hasError ? (
          <p className="text-sm text-muted">No workflow activations recorded yet.</p>
        ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function describeActivationRecovery(activation: DashboardWorkflowActivationRecord): string | null {
  const details: string[] = [];
  if (activation.recovery_status) {
    details.push(`Recovery ${activation.recovery_status}`);
  }
  if (activation.recovery_reason) {
    details.push(activation.recovery_reason);
  }
  if (activation.stale_started_at) {
    details.push(`stale since ${formatRelativeTimestamp(activation.stale_started_at)}`);
  }
  if (activation.recovery_detected_at) {
    details.push(`detected ${formatRelativeTimestamp(activation.recovery_detected_at)}`);
  }
  if (activation.redispatched_task_id) {
    details.push(`redispatched via task ${activation.redispatched_task_id}`);
  }
  return details.length > 0 ? details.join(' • ') : null;
}

function ActivationMetric(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="grid gap-1 rounded-xl border border-border/70 bg-background/90 p-4 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
        {props.label}
      </p>
      <strong className="text-xl text-foreground">{props.value}</strong>
    </div>
  );
}

function TaskGraphMetric(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="grid gap-1 rounded-lg border border-border/70 bg-surface/70 p-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
        {props.label}
      </div>
      <div className="text-sm text-foreground">{props.value}</div>
    </div>
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

function describeActivationEvent(
  workflowId: string,
  activationId: string,
  eventType: string,
  payload: unknown,
  reason: string | null | undefined,
  queuedAt: string,
): {
  headline: string;
  summary: string | null;
  scope: string | null;
} {
  if (eventType === MANUAL_WORKFLOW_ACTIVATION_EVENT_TYPE) {
    return {
      headline: 'Operator wake-up queued',
      summary: reason ?? 'Operator-requested activation queued for orchestrator review.',
      scope: null,
    };
  }
  const descriptor = describeTimelineEvent({
    id: `${activationId}:${eventType}:${queuedAt}`,
    type: eventType,
    entity_type: 'workflow',
    entity_id: workflowId,
    actor_type: 'system',
    actor_id: null,
    data: asActivationPayload(payload),
    created_at: queuedAt,
  });
  return {
    headline: descriptor.headline,
    summary: reason ?? descriptor.summary,
    scope: describeActivationScope(descriptor.stageName, descriptor.workItemId, descriptor.taskId),
  };
}

function describeActivationScope(
  stageName: string | null,
  workItemId: string | null,
  taskId: string | null,
): string | null {
  const parts: string[] = [];
  if (stageName) {
    parts.push(`Stage ${stageName}`);
  }
  if (workItemId) {
    parts.push(`Work item ${workItemId.slice(0, 8)}`);
  }
  if (taskId) {
    parts.push(`Task ${taskId.slice(0, 8)}`);
  }
  return parts.length > 0 ? parts.join(' • ') : null;
}

function asActivationPayload(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function ProjectTimelineCard(props: {
  isLoading: boolean;
  hasError: boolean;
  entries: DashboardProjectTimelineEntry[];
  currentWorkflowId: string;
  selectedChildWorkflowId?: string | null;
  onSelectChildWorkflow?(workflowId: string): void;
}) {
  const location = useLocation();
  const overview = buildWorkflowProjectTimelineOverview(props.entries);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Timeline</CardTitle>
        <CardDescription>
          Run-level continuity for this project, including chained lineage.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {props.isLoading ? <p className="text-sm text-muted">Loading timeline...</p> : null}
        {props.hasError ? <p className="text-sm text-red-600">Failed to load project timeline.</p> : null}
        {props.entries.length > 0 ? (
          <div className="grid gap-4 rounded-xl border border-border/70 bg-background/70 p-4">
            <div className="grid gap-1">
              <div className="text-sm font-medium text-foreground">Run continuity</div>
              <p className="text-sm leading-6 text-muted">{overview.summary}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {overview.metrics.map((metric) => (
                <div
                  key={metric.label}
                  className="grid gap-1 rounded-xl border border-border/70 bg-card/70 p-4"
                >
                  <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                    {metric.label}
                  </div>
                  <div className="text-sm font-semibold text-foreground">{metric.value}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="grid gap-4">
        {props.entries.map((entry) => {
          const packet = buildWorkflowProjectTimelinePacket(entry);
          const isCurrentWorkflow = entry.workflow_id === props.currentWorkflowId;
          return (
          <article
            key={entry.workflow_id}
            id={`child-workflow-${entry.workflow_id}`}
            className="grid gap-3 rounded-lg border border-border/70 bg-border/10 p-4"
            tabIndex={-1}
            data-workflow-focus-anchor="true"
            aria-labelledby={`child-workflow-heading-${entry.workflow_id}`}
            data-highlighted={
              props.selectedChildWorkflowId === entry.workflow_id ||
              isWorkflowDetailTargetHighlighted(
                location.search,
                location.hash,
                'child',
                entry.workflow_id,
              )
                ? 'true'
                : 'false'
            }
          >
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-1">
                <strong id={`child-workflow-heading-${entry.workflow_id}`}>
                  {packet.workflowName}
                </strong>
                <p className="text-sm text-muted">{packet.summary}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {isCurrentWorkflow ? <Badge variant="secondary">Current board</Badge> : null}
                <Badge variant={badgeVariantForState(entry.state)}>{packet.stateLabel}</Badge>
              </div>
            </div>
            <div className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" title={packet.createdTitle}>
                  Created {packet.createdLabel}
                </Badge>
                <Badge variant="outline">{packet.completedLabel}</Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {packet.metrics.map((metric) => (
                  <div
                    key={`${entry.workflow_id}:${metric.label}`}
                    className="grid gap-1 rounded-xl border border-border/70 bg-card/70 p-3"
                  >
                    <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                      {metric.label}
                    </div>
                    <div className="text-sm font-semibold text-foreground">{metric.value}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-border/70 bg-card/70 p-3 text-sm leading-6 text-muted">
                <span className="font-medium text-foreground">Best next step:</span>{' '}
                {packet.nextAction}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => props.onSelectChildWorkflow?.(entry.workflow_id)}
              >
                Highlight lineage
              </Button>
              <div className="flex flex-wrap items-center gap-3">
                {!isCurrentWorkflow ? (
                  <Link to={packet.workflowHref}>Open board</Link>
                ) : null}
                <Link to={packet.inspectorHref}>Open inspector</Link>
                <Link
                  to={buildWorkflowDetailPermalink(props.currentWorkflowId, {
                    childWorkflowId: entry.workflow_id,
                  })}
                  className="text-sm text-muted underline-offset-4 hover:underline"
                >
                  Permalink
                </Link>
              </div>
            </div>
          </article>
          );
        })}
        </div>
      </CardContent>
    </Card>
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
