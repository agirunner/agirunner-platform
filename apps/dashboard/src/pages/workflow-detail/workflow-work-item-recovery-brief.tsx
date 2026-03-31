import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { dashboardApi } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Textarea } from '../../components/ui/textarea.js';
import { cn } from '../../lib/utils.js';
import { normalizeTaskState } from '../work-shared/task-state.js';
import {
  buildWorkItemRecoveryBrief,
  sortTasksForOperatorReview,
  type DashboardWorkItemTaskRecord,
} from './workflow-work-item-detail-support.js';

const errorTextClass =
  'rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700';
const mutedBodyClass = 'text-sm leading-6 text-muted';

export function WorkItemRecoveryBriefSection(props: {
  brief: ReturnType<typeof buildWorkItemRecoveryBrief>;
  workflowId: string;
  workItemId: string;
  tasks: DashboardWorkItemTaskRecord[];
  onWorkItemChanged(): Promise<unknown> | unknown;
}): JSX.Element {
  const recoveryTask = useMemo(() => selectWorkItemRecoveryTask(props.tasks), [props.tasks]);
  const shouldForceRetry = recoveryTask
    ? normalizeTaskState(recoveryTask.state) !== 'failed'
    : false;
  const [isSkipDialogOpen, setIsSkipDialogOpen] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setIsSkipDialogOpen(false);
    setSkipReason('');
    setActionError(null);
  }, [props.workItemId]);

  const retryMutation = useMutation({
    mutationFn: () =>
      dashboardApi.retryWorkflowWorkItem(props.workflowId, props.workItemId, {
        force: shouldForceRetry,
      }),
    onSuccess: async () => {
      setActionError(null);
      await props.onWorkItemChanged();
    },
    onError: (mutationError) => {
      setActionError(
        mutationError instanceof Error ? mutationError.message : 'Failed to retry work item.',
      );
    },
  });
  const skipMutation = useMutation({
    mutationFn: () =>
      dashboardApi.skipWorkflowWorkItem(props.workflowId, props.workItemId, {
        reason: skipReason.trim(),
      }),
    onSuccess: async () => {
      setActionError(null);
      setSkipReason('');
      setIsSkipDialogOpen(false);
      await props.onWorkItemChanged();
    },
    onError: (mutationError) => {
      setActionError(
        mutationError instanceof Error ? mutationError.message : 'Failed to skip work item.',
      );
    },
  });
  const canAct = recoveryTask !== null;
  const retryLabel = shouldForceRetry ? 'Force Retry Work Item' : 'Retry Work Item';

  return (
    <section
      className={cn(
        'grid gap-4 rounded-xl border p-4 shadow-sm',
        props.brief.tone === 'destructive'
          ? 'border-red-300/70 bg-red-50/80 dark:border-red-900/70 dark:bg-red-950/20'
          : props.brief.tone === 'warning'
            ? 'border-amber-300/70 bg-amber-50/80 dark:border-amber-900/70 dark:bg-amber-950/20'
            : props.brief.tone === 'success'
              ? 'border-green-300/70 bg-green-50/80 dark:border-green-900/70 dark:bg-green-950/20'
              : 'border-border/70 bg-border/10',
      )}
      data-testid="work-item-recovery-brief"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            Recovery brief
          </div>
          <strong className="text-base text-foreground">{props.brief.title}</strong>
          <p className={mutedBodyClass}>{props.brief.summary}</p>
        </div>
        <Badge variant={props.brief.tone}>{props.brief.badge}</Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        {props.brief.facts.map((fact) => (
          <Badge key={fact.label} variant="outline">
            {fact.label}: {fact.value}
          </Badge>
        ))}
      </div>
      <div className="grid gap-3 rounded-lg border border-border/70 bg-background/80 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="text-sm text-foreground">Work-item recovery</strong>
          <Badge variant={canAct ? 'warning' : 'outline'}>
            {canAct ? 'Board-owned step recovery' : 'No retryable step selected'}
          </Badge>
        </div>
        <p className={mutedBodyClass}>
          {recoveryTask
            ? `Actions apply to ${recoveryTask.title} so the board keeps recovery decisions attached to the work item instead of bouncing through the task detail surface.`
            : 'No failed or escalated step is currently available for recovery from this work item.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => retryMutation.mutate()}
            disabled={!canAct || retryMutation.isPending || skipMutation.isPending}
          >
            {retryLabel}
          </Button>
          <Button
            variant="outline"
            onClick={() => setIsSkipDialogOpen(true)}
            disabled={!canAct || retryMutation.isPending || skipMutation.isPending}
          >
            Skip Work Item
          </Button>
        </div>
      </div>
      {actionError ? <p className={errorTextClass}>{actionError}</p> : null}
      <Dialog open={isSkipDialogOpen} onOpenChange={setIsSkipDialogOpen}>
        <DialogContent className="max-h-[75vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Skip Work Item</DialogTitle>
            <DialogDescription>
              Keep the bypass reason attached to the work item so recovery stays board-owned and
              does not drift back to the raw task helper.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Textarea
              value={skipReason}
              onChange={(event) => setSkipReason(event.target.value)}
              placeholder="Describe why this work item recovery step should be skipped..."
              rows={4}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setIsSkipDialogOpen(false)}
                disabled={skipMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() => skipMutation.mutate()}
                disabled={!skipReason.trim() || skipMutation.isPending}
              >
                Skip Work Item
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function selectWorkItemRecoveryTask(
  tasks: DashboardWorkItemTaskRecord[],
): DashboardWorkItemTaskRecord | null {
  const ordered = sortTasksForOperatorReview(tasks);
  return (
    ordered.find((task) => normalizeTaskState(task.state) === 'failed') ??
    ordered.find((task) => normalizeTaskState(task.state) === 'escalated') ??
    null
  );
}
