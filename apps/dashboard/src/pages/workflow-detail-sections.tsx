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
  DashboardWorkflowWorkItemRecord,
} from '../lib/api.js';
import { dashboardApi } from '../lib/api.js';
import type { DashboardWorkflowTaskRow } from './workflow-detail-support.js';
import { listWorkflowGates, type DashboardGateDetailRecord } from './work/gate-api.js';
import { GateDetailCard } from './work/gate-detail-card.js';
import {
  buildWorkflowDetailPermalink,
  isWorkflowDetailTargetHighlighted,
} from './workflow-detail-permalinks.js';
import {
  describeReviewPacket,
  formatAbsoluteTimestamp,
  formatRelativeTimestamp,
  summarizeIdentifier,
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

export function MissionControlCard(props: {
  summary: MissionControlSummary;
  totalCostUsd: number;
  onPause(): void;
  onResume(): void;
  onCancel(): void;
}) {
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
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={props.onPause}>
              Pause
            </Button>
            <Button variant="outline" size="sm" onClick={props.onResume}>
              Resume
            </Button>
            <Button variant="destructive" size="sm" onClick={props.onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <MissionMetric label="Total" value={props.summary.total} />
          <MissionMetric label="Ready" value={props.summary.ready} />
          <MissionMetric label="In Progress" value={props.summary.in_progress} />
          <MissionMetric label="Blocked" value={props.summary.blocked} />
          <MissionMetric label="Completed" value={props.summary.completed} />
          <MissionMetric label="Failed" value={props.summary.failed} />
        </div>
        <div className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Operator posture</p>
              <p className="text-sm text-muted">
                Stage changes, retries, approvals, and escalations all flow through work items and gates.
              </p>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/90 px-3 py-2 text-right shadow-sm">
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
                Cost to Date
              </p>
              <p className="text-lg font-semibold text-foreground">${props.totalCostUsd.toFixed(4)}</p>
            </div>
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
          Execution steps grouped by board stage for faster operator scanning.
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
                <CardDescription>Execution steps anchored to this board stage.</CardDescription>
              </div>
              <Badge variant="secondary">{group.tasks.length} steps</Badge>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Step</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Depends On</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.tasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell className="font-medium">
                        <Link to={`/work/tasks/${task.id}`}>{task.title}</Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={badgeVariantForState(task.state)}>{task.state}</Badge>
                      </TableCell>
                      <TableCell>{task.depends_on.length > 0 ? task.depends_on.join(', ') : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
      id={`work-item-${props.item.id}`}
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
        <div className="grid gap-4">
        {props.stages.map((stage) => (
          <article
            key={stage.id}
            id={`gate-${stage.name}`}
            className="grid gap-3 rounded-lg border border-border/70 bg-border/10 p-4"
            data-highlighted={
              props.selectedGateStageName === stage.name ||
              isWorkflowDetailTargetHighlighted(location.search, location.hash, 'gate', stage.name)
                ? 'true'
                : 'false'
            }
          >
            <div className="flex items-start justify-between gap-3">
              <strong>{stage.position + 1}. {stage.name}</strong>
              <div className="flex flex-wrap gap-2">
                <Badge variant={badgeVariantForState(stage.status)}>{stage.status}</Badge>
                <Badge variant="outline">Gate: {stage.gate_status}</Badge>
              </div>
            </div>
            <p className="text-sm text-muted">{stage.goal}</p>
            {stage.guidance ? <p className="text-sm text-muted">{stage.guidance}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Iterations: {stage.iteration_count}</Badge>
              {stage.human_gate ? <Badge variant="outline">Human Gate</Badge> : null}
              {stage.started_at ? (
                <Badge variant="outline">
                  Started {new Date(stage.started_at).toLocaleDateString()}
                </Badge>
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
            {stage.summary ? (
              <div className="rounded-md border bg-border/10 p-3 text-xs text-muted">
                {stage.summary}
              </div>
            ) : null}
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
  activations: DashboardWorkflowActivationRecord[];
  isLoading: boolean;
  hasError: boolean;
  selectedActivationId?: string | null;
  onSelectActivation?(activationId: string): void;
}) {
  const location = useLocation();
  const processingCount = props.activations.filter((activation) =>
    ['processing', 'running', 'in_progress'].includes(activation.state),
  ).length;
  const recoveredCount = props.activations.filter(
    (activation) => Boolean(activation.recovery_status),
  ).length;
  const queuedEventCount = props.activations.reduce(
    (total, activation) => total + (activation.event_count ?? activation.events?.length ?? 1),
    0,
  );

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
        {props.activations.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <ActivationMetric label="Activation batches" value={String(props.activations.length)} />
            <ActivationMetric label="In flight" value={String(processingCount)} />
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
                  <strong>{descriptor.headline}</strong>
                  <p className="text-sm text-muted">
                    {activation.summary?.trim() || descriptor.summary || 'Activation packet ready for operator review.'}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Badge variant={badgeVariantForState(activation.state)}>{activation.state}</Badge>
                  <Badge variant="outline">{payloadPacket.typeLabel}</Badge>
                </div>
              </div>
              {descriptor.scope ? <p className="text-sm text-muted">{descriptor.scope}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">
                  {activation.event_count ?? activation.events?.length ?? 1} events
                </Badge>
                <Badge variant="outline" title={formatAbsoluteTimestamp(activation.queued_at)}>
                  Queued {formatRelativeTimestamp(activation.queued_at)}
                </Badge>
                {activation.recovery_status ? (
                  <Badge variant="outline">{activation.recovery_status}</Badge>
                ) : null}
                {recoveredCount > 0 && activation.recovery_status ? (
                  <Badge variant="secondary">Recovered flow</Badge>
                ) : null}
              </div>
              {describeActivationRecovery(activation) ? (
                <p className="text-sm text-muted">{describeActivationRecovery(activation)}</p>
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
                  Activation {activation.activation_id ?? activation.id}
                </Button>
                <Link
                  to={`/logs?workflow=${activation.workflow_id}&activation=${activation.activation_id ?? activation.id}&view=debug`}
                  className="text-sm text-muted underline-offset-4 hover:underline"
                >
                  Open logs
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
                <ul className="grid gap-3">
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
                            <Badge variant={badgeVariantForState(event.state)}>{event.state}</Badge>
                            <Badge variant="outline">{eventPayloadPacket.typeLabel}</Badge>
                          </div>
                        </div>
                        {eventDescriptor.scope ? <p className="text-sm text-muted">{eventDescriptor.scope}</p> : null}
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">Event {summarizeIdentifier(event.id)}</Badge>
                          <Badge variant="outline" title={formatAbsoluteTimestamp(event.queued_at)}>
                            Queued {formatRelativeTimestamp(event.queued_at)}
                          </Badge>
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
        <div className="grid gap-4">
        {props.entries.map((entry) => (
          <article
            key={entry.workflow_id}
            id={`child-workflow-${entry.workflow_id}`}
            className="grid gap-3 rounded-lg border border-border/70 bg-border/10 p-4"
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
              <strong>{entry.name}</strong>
              <Badge variant={badgeVariantForState(entry.state)}>{entry.state}</Badge>
            </div>
            <p className="text-sm text-muted">
              {entry.completed_at ? new Date(entry.completed_at).toLocaleString() : 'In progress'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">Duration: {entry.duration_seconds ?? 0}s</Badge>
              <Badge variant="secondary">
                Artifacts: {entry.produced_artifacts?.length ?? 0}
              </Badge>
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
                {entry.workflow_id !== props.currentWorkflowId ? (
                  <Link to={`/work/workflows/${entry.workflow_id}`}>Open workflow</Link>
                ) : null}
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
        ))}
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
