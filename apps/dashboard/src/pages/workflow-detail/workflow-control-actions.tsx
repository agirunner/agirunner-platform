import { useState } from 'react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Loader2, Pause, Play, XCircle } from 'lucide-react';

import type { ButtonProps } from '../../components/ui/button.js';
import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { dashboardApi } from '../../lib/api.js';
import type { DashboardMissionControlActionAvailability } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { cn } from '../../lib/utils.js';
import { invalidateWorkflowQueries } from './workflow-detail-query.js';
import { getWorkflowControlAvailability } from './workflow-control-actions.support.js';

interface WorkflowControlActionsProps {
  workflowId: string;
  workflowState?: string | null;
  workflowPosture?: string | null;
  workspaceId?: string | null;
  size?: ButtonProps['size'];
  className?: string;
  additionalQueryKeys?: ReadonlyArray<QueryKey>;
  availableActions?: DashboardMissionControlActionAvailability[];
}

async function invalidateWorkflowControlQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  workflowId: string,
  workspaceId?: string | null,
  additionalQueryKeys: ReadonlyArray<QueryKey> = [],
) {
  await Promise.all([
    invalidateWorkflowQueries(queryClient, workflowId, workspaceId ?? undefined),
    queryClient.invalidateQueries({ queryKey: ['workflows'] }),
    queryClient.invalidateQueries({ queryKey: ['tasks'] }),
    queryClient.invalidateQueries({ queryKey: ['events-recent'] }),
    ...additionalQueryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  ]);
}

function readWorkflowControlError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

export function WorkflowControlActions(props: WorkflowControlActionsProps): JSX.Element | null {
  const queryClient = useQueryClient();
  const availability = getWorkflowControlAvailability({
    state: props.workflowState,
    workflowPosture: props.workflowPosture,
    availableActions: props.availableActions,
  });
  const [isPauseDialogOpen, setIsPauseDialogOpen] = useState(false);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);

  const pauseMutation = useMutation({
    mutationFn: () => dashboardApi.pauseWorkflow(props.workflowId),
    onSuccess: async () => {
      await invalidateWorkflowControlQueries(
        queryClient,
        props.workflowId,
        props.workspaceId,
        props.additionalQueryKeys,
      );
      toast.success('Workflow paused');
    },
    onError: (error) => {
      toast.error(readWorkflowControlError(error, 'Failed to pause workflow'));
    },
  });
  const resumeMutation = useMutation({
    mutationFn: () => dashboardApi.resumeWorkflow(props.workflowId),
    onSuccess: async () => {
      await invalidateWorkflowControlQueries(
        queryClient,
        props.workflowId,
        props.workspaceId,
        props.additionalQueryKeys,
      );
      toast.success('Workflow resumed');
    },
    onError: (error) => {
      toast.error(readWorkflowControlError(error, 'Failed to resume workflow'));
    },
  });
  const cancelMutation = useMutation({
    mutationFn: () => dashboardApi.cancelWorkflow(props.workflowId),
    onSuccess: async () => {
      setIsCancelDialogOpen(false);
      await invalidateWorkflowControlQueries(
        queryClient,
        props.workflowId,
        props.workspaceId,
        props.additionalQueryKeys,
      );
      toast.success('Workflow cancellation requested');
    },
    onError: (error) => {
      toast.error(readWorkflowControlError(error, 'Failed to cancel workflow'));
    },
  });

  const isPending =
    pauseMutation.isPending || resumeMutation.isPending || cancelMutation.isPending;

  if (!availability.canPause && !availability.canResume && !availability.canCancel) {
    return null;
  }

  function handlePauseDialogChange(nextOpen: boolean): void {
    if (pauseMutation.isPending) {
      return;
    }
    setIsPauseDialogOpen(nextOpen);
    if (!nextOpen) {
      pauseMutation.reset();
    }
  }

  function handleCancelDialogChange(nextOpen: boolean): void {
    if (cancelMutation.isPending) {
      return;
    }
    setIsCancelDialogOpen(nextOpen);
    if (!nextOpen) {
      cancelMutation.reset();
    }
  }

  return (
    <>
      <div className={cn('flex flex-wrap items-center gap-2', props.className)}>
        {availability.canPause ? (
          <Button
            type="button"
            variant="outline"
            size={props.size ?? 'sm'}
            disabled={isPending}
            onClick={() => setIsPauseDialogOpen(true)}
          >
            {pauseMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Pause className="h-4 w-4" />
            )}
            Pause
          </Button>
        ) : null}
        {availability.canResume ? (
          <Button
            type="button"
            variant="outline"
            size={props.size ?? 'sm'}
            disabled={isPending}
            onClick={() => resumeMutation.mutate()}
          >
            {resumeMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Resume
          </Button>
        ) : null}
        {availability.canCancel ? (
          <Button
            type="button"
            variant="destructive"
            size={props.size ?? 'sm'}
            disabled={isPending}
            onClick={() => setIsCancelDialogOpen(true)}
          >
            <XCircle className="h-4 w-4" />
            Cancel
          </Button>
        ) : null}
      </div>
      <Dialog open={isPauseDialogOpen} onOpenChange={handlePauseDialogChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pause workflow?</DialogTitle>
            <DialogDescription>
              Pausing freezes new routing and asks the current workflow work to stop cleanly.
              Resume it later when the workflow can continue.
            </DialogDescription>
          </DialogHeader>
          {pauseMutation.isError ? (
            <p className="text-sm text-red-600">
              {readWorkflowControlError(pauseMutation.error, 'Failed to pause workflow')}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pauseMutation.isPending}
              onClick={() => handlePauseDialogChange(false)}
            >
              Keep running
            </Button>
            <Button
              type="button"
              variant="default"
              disabled={pauseMutation.isPending}
              onClick={() => pauseMutation.mutate()}
            >
              {pauseMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Pausing...
                </>
              ) : (
                <>
                  <Pause className="h-4 w-4" />
                  Confirm pause
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={isCancelDialogOpen} onOpenChange={handleCancelDialogChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel workflow?</DialogTitle>
            <DialogDescription>
              Cancelling stops further orchestration and specialist work for this workflow. Use
              this only when the run should not continue.
            </DialogDescription>
          </DialogHeader>
          {cancelMutation.isError ? (
            <p className="text-sm text-red-600">
              {readWorkflowControlError(cancelMutation.error, 'Failed to cancel workflow')}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={cancelMutation.isPending}
              onClick={() => handleCancelDialogChange(false)}
            >
              Keep running
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              {cancelMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cancelling...
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4" />
                  Confirm cancel
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
