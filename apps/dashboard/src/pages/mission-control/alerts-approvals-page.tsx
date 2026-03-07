import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  SkipForward,
  UserPlus,
  XCircle,
} from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { cn } from '../../lib/utils.js';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs.js';

interface TaskRecord {
  id: string;
  title?: string;
  name?: string;
  status: string;
  output?: unknown;
  error_message?: string;
  assigned_worker?: string | null;
  retry_count?: number;
  escalation_reason?: string;
  created_at?: string;
}

const REFETCH_INTERVAL = 5000;

function normalizeArray(response: unknown): TaskRecord[] {
  if (Array.isArray(response)) {
    return response as TaskRecord[];
  }
  const wrapped = response as { data?: unknown } | null;
  if (wrapped && Array.isArray(wrapped.data)) {
    return wrapped.data as TaskRecord[];
  }
  return [];
}

function truncateOutput(output: unknown): string {
  if (output == null) {
    return 'No output available';
  }
  const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
  const maxLength = 200;
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function AlertsApprovalsPage(): JSX.Element {
  const queryClient = useQueryClient();

  const approvalQuery = useQuery({
    queryKey: ['tasks', 'awaiting_approval'],
    queryFn: () => dashboardApi.listTasks({ status: 'awaiting_approval' }),
    refetchInterval: REFETCH_INTERVAL,
  });

  const failedQuery = useQuery({
    queryKey: ['tasks', 'failed'],
    queryFn: () => dashboardApi.listTasks({ status: 'failed' }),
    refetchInterval: REFETCH_INTERVAL,
  });

  const escalatedQuery = useQuery({
    queryKey: ['tasks', 'escalated'],
    queryFn: () => dashboardApi.listTasks({ status: 'escalated' }),
    refetchInterval: REFETCH_INTERVAL,
  });

  const approvalTasks = useMemo(() => normalizeArray(approvalQuery.data), [approvalQuery.data]);
  const failedTasks = useMemo(() => normalizeArray(failedQuery.data), [failedQuery.data]);
  const escalatedTasks = useMemo(() => normalizeArray(escalatedQuery.data), [escalatedQuery.data]);

  const allItems = [...approvalTasks, ...failedTasks, ...escalatedTasks];
  const isLoading = approvalQuery.isLoading || failedQuery.isLoading || escalatedQuery.isLoading;
  const hasError = approvalQuery.error || failedQuery.error || escalatedQuery.error;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };

  const approveMutation = useMutation({
    mutationFn: (taskId: string) => dashboardApi.approveTask(taskId),
    onSuccess: () => { invalidateAll(); toast.success('Task approved'); },
    onError: () => { toast.error('Failed to approve task'); },
  });

  const rejectMutation = useMutation({
    mutationFn: (taskId: string) => dashboardApi.rejectTask(taskId, { feedback: 'Rejected by operator' }),
    onSuccess: () => { invalidateAll(); toast.success('Task rejected'); },
    onError: () => { toast.error('Failed to reject task'); },
  });

  const requestChangesMutation = useMutation({
    mutationFn: (taskId: string) => dashboardApi.requestTaskChanges(taskId, { feedback: 'Changes requested by operator' }),
    onSuccess: () => { invalidateAll(); toast.success('Changes requested'); },
    onError: () => { toast.error('Failed to request changes'); },
  });

  const skipMutation = useMutation({
    mutationFn: (taskId: string) => dashboardApi.skipTask(taskId, { reason: 'Skipped by operator' }),
    onSuccess: () => { invalidateAll(); toast.success('Task skipped'); },
    onError: () => { toast.error('Failed to skip task'); },
  });

  const retryMutation = useMutation({
    mutationFn: (taskId: string) => dashboardApi.retryTask(taskId),
    onSuccess: () => { invalidateAll(); toast.success('Task retry initiated'); },
    onError: () => { toast.error('Failed to retry task'); },
  });

  const retryOnDifferentWorkerMutation = useMutation({
    mutationFn: (taskId: string) => dashboardApi.retryTask(taskId, { force: true }),
    onSuccess: () => { invalidateAll(); toast.success('Task retry on different worker initiated'); },
    onError: () => { toast.error('Failed to retry task on different worker'); },
  });

  const reassignMutation = useMutation({
    mutationFn: (taskId: string) => dashboardApi.reassignTask(taskId, { reason: 'Reassigned by operator' }),
    onSuccess: () => { invalidateAll(); toast.success('Task reassigned'); },
    onError: () => { toast.error('Failed to reassign task'); },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted">
        <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
        Loading action queue...
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="p-6 text-red-600">
        <AlertTriangle className="mr-2 inline h-5 w-5" />
        Failed to load tasks. Please retry.
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Alerts & Approvals</h1>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All ({allItems.length})</TabsTrigger>
          <TabsTrigger value="approvals">Approvals ({approvalTasks.length})</TabsTrigger>
          <TabsTrigger value="failures">Failures ({failedTasks.length})</TabsTrigger>
          <TabsTrigger value="escalations">Escalations ({escalatedTasks.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <div className="space-y-4">
            {allItems.length === 0 && <EmptyState />}
            {approvalTasks.map((task) => (
              <ApprovalCard
                key={task.id}
                task={task}
                onApprove={() => approveMutation.mutate(task.id)}
                onRequestChanges={() => requestChangesMutation.mutate(task.id)}
                onSkip={() => skipMutation.mutate(task.id)}
                onReject={() => rejectMutation.mutate(task.id)}
                isLoading={approveMutation.isPending || rejectMutation.isPending || requestChangesMutation.isPending || skipMutation.isPending}
              />
            ))}
            {failedTasks.map((task) => (
              <FailedCard
                key={task.id}
                task={task}
                onRetry={() => retryMutation.mutate(task.id)}
                onRetryDifferentWorker={() => retryOnDifferentWorkerMutation.mutate(task.id)}
                onSkip={() => skipMutation.mutate(task.id)}
                isLoading={retryMutation.isPending || retryOnDifferentWorkerMutation.isPending || skipMutation.isPending}
              />
            ))}
            {escalatedTasks.map((task) => (
              <EscalationCard
                key={task.id}
                task={task}
                onReassign={() => reassignMutation.mutate(task.id)}
                isLoading={reassignMutation.isPending}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="approvals">
          <div className="space-y-4">
            {approvalTasks.length === 0 && <EmptyState message="No tasks awaiting approval." />}
            {approvalTasks.map((task) => (
              <ApprovalCard
                key={task.id}
                task={task}
                onApprove={() => approveMutation.mutate(task.id)}
                onRequestChanges={() => requestChangesMutation.mutate(task.id)}
                onSkip={() => skipMutation.mutate(task.id)}
                onReject={() => rejectMutation.mutate(task.id)}
                isLoading={approveMutation.isPending || rejectMutation.isPending || requestChangesMutation.isPending || skipMutation.isPending}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="failures">
          <div className="space-y-4">
            {failedTasks.length === 0 && <EmptyState message="No failed tasks." />}
            {failedTasks.map((task) => (
              <FailedCard
                key={task.id}
                task={task}
                onRetry={() => retryMutation.mutate(task.id)}
                onRetryDifferentWorker={() => retryOnDifferentWorkerMutation.mutate(task.id)}
                onSkip={() => skipMutation.mutate(task.id)}
                isLoading={retryMutation.isPending || retryOnDifferentWorkerMutation.isPending || skipMutation.isPending}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="escalations">
          <div className="space-y-4">
            {escalatedTasks.length === 0 && <EmptyState message="No escalated tasks." />}
            {escalatedTasks.map((task) => (
              <EscalationCard
                key={task.id}
                task={task}
                onReassign={() => reassignMutation.mutate(task.id)}
                isLoading={reassignMutation.isPending}
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyState({ message = 'No items require action.' }: { message?: string }): JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-8 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-green-600" />
        <p className="text-muted">{message}</p>
      </CardContent>
    </Card>
  );
}

interface ApprovalCardProps {
  task: TaskRecord;
  onApprove: () => void;
  onRequestChanges: () => void;
  onSkip: () => void;
  onReject: () => void;
  isLoading: boolean;
}

function ApprovalCard({ task, onApprove, onRequestChanges, onSkip, onReject, isLoading }: ApprovalCardProps): JSX.Element {
  return (
    <Card className="border-l-4 border-l-amber-400">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{task.title ?? task.name ?? task.id}</CardTitle>
          <Badge variant="warning">Awaiting Approval</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 rounded-md bg-border/20 p-3">
          <p className="text-xs font-medium text-muted mb-1">Output Preview</p>
          <pre className="whitespace-pre-wrap text-xs">{truncateOutput(task.output)}</pre>
        </div>
        {task.assigned_worker && (
          <p className="mb-3 text-xs text-muted">Worker: {task.assigned_worker}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onApprove} disabled={isLoading}>
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={onRequestChanges} disabled={isLoading}>
            Request Changes
          </Button>
          <Button size="sm" variant="outline" onClick={onSkip} disabled={isLoading}>
            <SkipForward className="mr-1 h-3.5 w-3.5" />
            Skip
          </Button>
          <Button size="sm" variant="destructive" onClick={onReject} disabled={isLoading}>
            <XCircle className="mr-1 h-3.5 w-3.5" />
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface FailedCardProps {
  task: TaskRecord;
  onRetry: () => void;
  onRetryDifferentWorker: () => void;
  onSkip: () => void;
  isLoading: boolean;
}

function FailedCard({ task, onRetry, onRetryDifferentWorker, onSkip, isLoading }: FailedCardProps): JSX.Element {
  return (
    <Card className="border-l-4 border-l-red-500">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{task.title ?? task.name ?? task.id}</CardTitle>
          <Badge variant="destructive">Failed</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {task.error_message && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-red-800">
            <p className="text-xs font-medium mb-1">Error</p>
            <p className="text-xs">{task.error_message}</p>
          </div>
        )}
        <div className="mb-3 flex items-center gap-4 text-xs text-muted">
          {task.retry_count != null && <span>Retry count: {task.retry_count}</span>}
          {task.assigned_worker && <span>Worker: {task.assigned_worker}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onRetry} disabled={isLoading}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            Retry
          </Button>
          <Button size="sm" variant="outline" onClick={onRetryDifferentWorker} disabled={isLoading}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            Retry on Different Worker
          </Button>
          <Button size="sm" variant="outline" onClick={onSkip} disabled={isLoading}>
            <SkipForward className="mr-1 h-3.5 w-3.5" />
            Skip
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface EscalationCardProps {
  task: TaskRecord;
  onReassign: () => void;
  isLoading: boolean;
}

function EscalationCard({ task, onReassign, isLoading }: EscalationCardProps): JSX.Element {
  return (
    <Card className="border-l-4 border-l-blue-500">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{task.title ?? task.name ?? task.id}</CardTitle>
          <Badge variant="default">Escalated</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {task.escalation_reason && (
          <div className="mb-4 rounded-md bg-blue-50 p-3 text-blue-800">
            <p className="text-xs font-medium mb-1">Escalation Reason</p>
            <p className="text-xs">{task.escalation_reason}</p>
          </div>
        )}
        {task.assigned_worker && (
          <p className="mb-3 text-xs text-muted">Worker: {task.assigned_worker}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onReassign} disabled={isLoading}>
            <UserPlus className="mr-1 h-3.5 w-3.5" />
            Reassign
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={`/tasks/${task.id}`}>
              <ShieldAlert className="mr-1 h-3.5 w-3.5" />
              View Task
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
