import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Clock3, FileText, GitBranch, Inbox, Loader2, Search, Workflow } from 'lucide-react';

import { dashboardApi, type DashboardApprovalQueueResponse } from '../../lib/api.js';
import { subscribeToEvents } from '../../lib/sse.js';
import { SavedViews, type SavedViewFilters } from '../../components/saved-views.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import {
  ApprovalQueueWindowControls,
  ApprovalQueueSectionJumpStrip,
  QueueMetricCard,
  QueueSectionHeader,
} from './approval-queue-layout.js';
import {
  countPendingOrchestratorFollowUp,
  matchesApprovalSearch,
  sortStageGates,
  summarizeFirstGate,
  summarizeOldestWaiting,
} from './approval-queue-support.js';
import {
  APPROVAL_QUEUE_INITIAL_VISIBLE_COUNT,
  findApprovalQueueGateIndex,
  invalidateApprovalWorkflowQueries,
  limitApprovalQueueItems,
  nextApprovalQueueVisibleCount,
  readApprovalQueueTargetGateId,
  updateApprovalQueueSearchParams,
} from './approval-queue-page.support.js';
import { StageGateQueueCard } from './approval-queue-stage-gate-card.js';
import { TaskApprovalCard } from './approval-queue-task-card.js';

export function ApprovalQueuePage(): JSX.Element {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [visibleStageGateCount, setVisibleStageGateCount] = useState(
    APPROVAL_QUEUE_INITIAL_VISIBLE_COUNT,
  );
  const [visibleTaskApprovalCount, setVisibleTaskApprovalCount] = useState(
    APPROVAL_QUEUE_INITIAL_VISIBLE_COUNT,
  );
  const { data, isLoading, error } = useQuery<DashboardApprovalQueueResponse>({
    queryKey: ['approval-queue'],
    queryFn: () => dashboardApi.getApprovalQueue(),
  });
  const searchQuery = searchParams.get('q') ?? '';
  const queueFilter = searchParams.get('view') ?? 'all';
  const targetGateId = readApprovalQueueTargetGateId(searchParams, location.hash);

  useEffect(() => {
    return subscribeToEvents((eventType, payload) => {
      const workflowId =
        typeof payload.data?.workflow_id === 'string'
          ? payload.data.workflow_id
          : typeof payload.entity_type === 'string' && payload.entity_type === 'workflow'
            ? payload.entity_id
            : null;
      if (
        !eventType.startsWith('workflow.') &&
        !eventType.startsWith('task.') &&
        !eventType.startsWith('gate.') &&
        !eventType.startsWith('work_item.')
      ) {
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['approval-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow'] });
      if (workflowId) {
        void invalidateApprovalWorkflowQueries(queryClient, workflowId);
      }
    });
  }, [queryClient]);

  const taskApprovals = useMemo(() => {
    const items = data?.task_approvals ?? [];
    return items.filter((task) => {
      if (queueFilter === 'gates') {
        return false;
      }
      return matchesApprovalSearch(searchQuery, task);
    });
  }, [data?.task_approvals, queueFilter, searchQuery]);

  const stageGates = useMemo(() => {
    const items = sortStageGates(data?.stage_gates ?? []);
    return items.filter((gate) => {
      if (queueFilter === 'tasks') {
        return false;
      }
      return matchesApprovalSearch(searchQuery, gate);
    });
  }, [data?.stage_gates, queueFilter, searchQuery]);
  const visibleStageGates = useMemo(
    () => limitApprovalQueueItems(stageGates, visibleStageGateCount),
    [stageGates, visibleStageGateCount],
  );
  const visibleTaskApprovals = useMemo(
    () => limitApprovalQueueItems(taskApprovals, visibleTaskApprovalCount),
    [taskApprovals, visibleTaskApprovalCount],
  );

  const totalApprovals = taskApprovals.length + stageGates.length;
  const oldestWaiting = summarizeOldestWaiting(stageGates, taskApprovals);
  const firstGateSummary = summarizeFirstGate(stageGates);
  const pendingFollowUpCount = countPendingOrchestratorFollowUp(stageGates);
  const savedViewFilters = useMemo<SavedViewFilters>(
    () => ({
      ...(searchQuery ? { q: searchQuery } : {}),
      ...(queueFilter !== 'all' ? { view: queueFilter } : {}),
    }),
    [queueFilter, searchQuery],
  );

  useEffect(() => {
    setVisibleStageGateCount(APPROVAL_QUEUE_INITIAL_VISIBLE_COUNT);
    setVisibleTaskApprovalCount(APPROVAL_QUEUE_INITIAL_VISIBLE_COUNT);
  }, [queueFilter, searchQuery]);

  useEffect(() => {
    const targetIndex = findApprovalQueueGateIndex(stageGates, targetGateId);
    if (targetIndex < 0) {
      return;
    }
    setVisibleStageGateCount((current) => Math.max(current, targetIndex + 1));
  }, [stageGates, targetGateId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-red-600">Failed to load approval queue. Please try again later.</div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <section className="space-y-5 rounded-3xl border border-border/70 bg-card/80 p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold">Approval Queue</h1>
              <Badge variant="secondary">{totalApprovals}</Badge>
            </div>
            <p className="text-sm text-muted">
              Review stage gates first, then specialist step approvals and output gates that remain
              after orchestration.
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 md:max-w-3xl">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-end">
              <div className="relative w-full lg:max-w-xs">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                <Input
                  value={searchQuery}
                  onChange={(event) =>
                    updateApprovalQueueSearchParams(setSearchParams, (next) => {
                      const value = event.target.value.trim();
                      if (value) {
                        next.set('q', value);
                      } else {
                        next.delete('q');
                      }
                    })
                  }
                  placeholder="Search gates, boards, work items, stages, steps, or IDs"
                  className="pl-8"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant={queueFilter === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() =>
                    updateApprovalQueueSearchParams(setSearchParams, (next) => {
                      next.delete('view');
                    })
                  }
                >
                  All
                </Button>
                <Button
                  variant={queueFilter === 'gates' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() =>
                    updateApprovalQueueSearchParams(setSearchParams, (next) => {
                      next.set('view', 'gates');
                    })
                  }
                >
                  Gates
                </Button>
                <Button
                  variant={queueFilter === 'tasks' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() =>
                    updateApprovalQueueSearchParams(setSearchParams, (next) => {
                      next.set('view', 'tasks');
                    })
                  }
                >
                  Steps
                </Button>
                <SavedViews
                  storageKey="approval-queue"
                  currentFilters={savedViewFilters}
                  onApply={(filters) =>
                    setSearchParams(
                      {
                        ...(filters.q ? { q: filters.q } : {}),
                        ...(filters.view ? { view: filters.view } : {}),
                      },
                      { replace: true },
                    )
                  }
                />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <QueueMetricCard
                icon={<Workflow className="h-3.5 w-3.5" />}
                label="Stage gates"
                value={stageGates.length}
                detail="Human decision packets waiting by stage."
              />
              <QueueMetricCard
                icon={<FileText className="h-3.5 w-3.5" />}
                label="Step reviews"
                value={taskApprovals.length}
                detail="Specialist approvals or output assessments still owned by operators."
              />
              <QueueMetricCard
                icon={<GitBranch className="h-3.5 w-3.5" />}
                label="Recovery watch"
                value={`${pendingFollowUpCount} gates`}
                detail="Decision recorded, but no visible orchestrator follow-up yet."
              />
              <QueueMetricCard
                icon={<Clock3 className="h-3.5 w-3.5" />}
                label="Oldest wait"
                value={oldestWaiting}
                detail="Use this to clear stale queue items first."
              />
            </div>
          </div>
        </div>
        <ApprovalQueueSectionJumpStrip
          stageGateCount={stageGates.length}
          taskApprovalCount={taskApprovals.length}
          firstGateSummary={firstGateSummary}
          oldestWaiting={oldestWaiting}
        />
      </section>

      {totalApprovals === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Inbox className="h-12 w-12 text-muted" />
            <p className="mt-4 text-lg font-medium">No operator queue items waiting</p>
            <p className="mt-1 text-sm text-muted">
              Stage gates, specialist step approvals, and output assessments will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {stageGates.length > 0 ? (
            <section
              id="approval-stage-gates"
              className="scroll-mt-24 space-y-4 rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm"
            >
              <QueueSectionHeader
                icon={<Workflow className="h-4 w-4 text-muted" />}
                title="Stage Gates"
                count={stageGates.length}
                description="Review packets are ordered by oldest wait first so operators can clear stale gates before newer requests."
              />
              {visibleStageGates.map((gate, index) => (
                <StageGateQueueCard
                  key={`${gate.workflow_id}:${gate.stage_name}:${gate.gate_id ?? gate.id ?? 'pending'}`}
                  gate={gate}
                  index={index}
                />
              ))}
              <ApprovalQueueWindowControls
                visibleCount={visibleStageGates.length}
                totalCount={stageGates.length}
                noun="stage gates"
                actionLabel="gates"
                onShowMore={() =>
                  setVisibleStageGateCount((current) =>
                    nextApprovalQueueVisibleCount(current, stageGates.length),
                  )
                }
              />
            </section>
          ) : null}

          {taskApprovals.length > 0 ? (
            <section
              id="approval-step-approvals"
              className="scroll-mt-24 space-y-4 rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm"
            >
              <QueueSectionHeader
                icon={<FileText className="h-4 w-4 text-muted" />}
                title="Step Approvals"
                count={taskApprovals.length}
                description="These operator decisions apply to specialist steps blocked on approval, output assessment, or rework guidance."
              />
              {visibleTaskApprovals.map((task) => (
                <TaskApprovalCard key={task.id} task={task} />
              ))}
              <ApprovalQueueWindowControls
                visibleCount={visibleTaskApprovals.length}
                totalCount={taskApprovals.length}
                noun="step approvals"
                actionLabel="reviews"
                onShowMore={() =>
                  setVisibleTaskApprovalCount((current) =>
                    nextApprovalQueueVisibleCount(current, taskApprovals.length),
                  )
                }
              />
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
