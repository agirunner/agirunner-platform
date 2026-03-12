import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  SkipForward,
  XCircle,
  Zap,
} from 'lucide-react';

import { dashboardApi, type DashboardApprovalQueueResponse } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs.js';
import { GateDetailCard } from '../work/gate-detail-card.js';

interface TaskRecord {
  id: string;
  title?: string;
  name?: string;
  state?: string;
  status?: string;
  type?: string;
  description?: string;
  role?: string | null;
  input?: Record<string, unknown>;
  output?: unknown;
  error_message?: string;
  metadata?: Record<string, unknown>;
  assigned_agent_id?: string | null;
  assigned_worker_id?: string | null;
  assigned_worker?: string | null;
  retry_count?: number;
  rework_count?: number;
  escalation_reason?: string;
  created_at?: string;
  depends_on?: string[];
  workflow_id?: string | null;
}

const REFETCH_INTERVAL = 5000;

function normalizeArray(response: unknown): TaskRecord[] {
  if (Array.isArray(response)) return response as TaskRecord[];
  const wrapped = response as { data?: unknown } | null;
  if (wrapped && Array.isArray(wrapped.data)) return wrapped.data as TaskRecord[];
  return [];
}

function truncateText(text: string | null | undefined, max: number): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function extractInstructions(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  if (typeof input.instructions === 'string') return input.instructions;
  return null;
}

function formatWaitTime(createdAt: string | undefined): string {
  if (!createdAt) return '';
  const ms = Date.now() - new Date(createdAt).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatOutput(output: unknown): string {
  if (output == null) return '';
  if (typeof output === 'string') return output;
  return JSON.stringify(output, null, 2);
}

// ---------------------------------------------------------------------------
// Feedback dialog (inline expandable)
// ---------------------------------------------------------------------------

function FeedbackAction({
  label,
  icon,
  variant = 'outline',
  placeholder,
  onSubmit,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  variant?: 'outline' | 'destructive';
  placeholder: string;
  onSubmit: (feedback: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  if (!open) {
    return (
      <Button size="sm" variant={variant} onClick={() => setOpen(true)} disabled={disabled}>
        {icon}
        {label}
      </Button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-md border border-border/50 p-2">
      <textarea
        className="w-full rounded-md border border-border bg-background p-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-ring"
        rows={3}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={variant}
          disabled={disabled || text.trim().length === 0}
          onClick={() => { onSubmit(text.trim()); setOpen(false); setText(''); }}
        >
          {label}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setText(''); }}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AlertsApprovalsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [dismissedEscalationTaskIds, setDismissedEscalationTaskIds] = useState<string[]>([]);
  const [dismissedFailureTaskIds, setDismissedFailureTaskIds] = useState<string[]>([]);

  const approvalsQuery = useQuery<DashboardApprovalQueueResponse>({
    queryKey: ['approval-queue'],
    queryFn: () => dashboardApi.getApprovalQueue(),
    refetchInterval: REFETCH_INTERVAL,
  });

  const failedQuery = useQuery({
    queryKey: ['tasks', 'failed'],
    queryFn: () => dashboardApi.listTasks({ state: 'failed' }),
    refetchInterval: REFETCH_INTERVAL,
  });

  const escalationQuery = useQuery({
    queryKey: ['tasks', 'escalated'],
    queryFn: () => dashboardApi.listTasks({ state: 'escalated' }),
    refetchInterval: REFETCH_INTERVAL,
  });

  const approvalTasks = useMemo(() => approvalsQuery.data?.task_approvals ?? [], [approvalsQuery.data]);
  const stageGates = useMemo(() => approvalsQuery.data?.stage_gates ?? [], [approvalsQuery.data]);
  const reviewTasks = useMemo(
    () => approvalTasks.filter((task) => task.state === 'output_pending_review'),
    [approvalTasks],
  );
  const manualApprovalTasks = useMemo(
    () => approvalTasks.filter((task) => task.state !== 'output_pending_review'),
    [approvalTasks],
  );
  const failedTasks = useMemo(
    () =>
      normalizeArray(failedQuery.data).filter((task) => !dismissedFailureTaskIds.includes(task.id)),
    [dismissedFailureTaskIds, failedQuery.data],
  );
  const escalationTasks = useMemo(
    () =>
      normalizeArray(escalationQuery.data).filter(
        (task) => !dismissedEscalationTaskIds.includes(task.id),
      ),
    [dismissedEscalationTaskIds, escalationQuery.data],
  );

  const allItems = [...stageGates, ...manualApprovalTasks, ...reviewTasks, ...failedTasks, ...escalationTasks];
  const approvalsError = approvalsQuery.error;
  const failedError = failedQuery.error;
  const escalationError = escalationQuery.error;
  const showInitialLoading =
    approvalsQuery.isLoading && failedQuery.isLoading && escalationQuery.isLoading;

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['approval-queue'] }),
      queryClient.invalidateQueries({ queryKey: ['workflows'] }),
    ]);
  };

  const approveMutation = useMutation({
    mutationFn: (taskId: string) => dashboardApi.approveTask(taskId),
    onSuccess: async () => { await invalidateAll(); toast.success('Specialist step approved'); },
    onError: () => { toast.error('Failed to approve specialist step'); },
  });

  const approveOutputMutation = useMutation({
    mutationFn: (taskId: string) => dashboardApi.approveTaskOutput(taskId),
    onSuccess: async () => { await invalidateAll(); toast.success('Output gate approved'); },
    onError: () => { toast.error('Failed to approve output gate'); },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ taskId, feedback }: { taskId: string; feedback: string }) =>
      dashboardApi.rejectTask(taskId, { feedback }),
    onSuccess: async () => { await invalidateAll(); toast.success('Specialist step rejected'); },
    onError: () => { toast.error('Failed to reject specialist step'); },
  });

  const requestChangesMutation = useMutation({
    mutationFn: ({ taskId, feedback }: { taskId: string; feedback: string }) =>
      dashboardApi.requestTaskChanges(taskId, { feedback }),
    onSuccess: async () => {
      await invalidateAll();
      toast.success('Rework requested — the specialist step will re-run with operator feedback');
    },
    onError: () => { toast.error('Failed to request rework'); },
  });

  const skipMutation = useMutation({
    mutationFn: ({ taskId, reason }: { taskId: string; reason: string }) =>
      dashboardApi.skipTask(taskId, { reason }),
    onSuccess: async () => { await invalidateAll(); toast.success('Specialist step bypassed'); },
    onError: () => { toast.error('Failed to bypass specialist step'); },
  });

  const retryMutation = useMutation({
    mutationFn: (taskId: string) => dashboardApi.retryTask(taskId),
    onSuccess: async () => { await invalidateAll(); toast.success('Specialist step re-run initiated'); },
    onError: () => { toast.error('Failed to re-run specialist step'); },
  });

  const retryOnDifferentWorkerMutation = useMutation({
    mutationFn: (taskId: string) => dashboardApi.retryTask(taskId, { force: true }),
    onSuccess: async () => {
      await invalidateAll();
      toast.success('Specialist step re-run on a new worker initiated');
    },
    onError: () => { toast.error('Failed to re-run step on a new worker'); },
  });

  const cancelFailedMutation = useMutation({
    mutationFn: (taskId: string) => dashboardApi.cancelTask(taskId),
    onMutate: async (taskId) => {
      setDismissedFailureTaskIds((current) => (current.includes(taskId) ? current : [...current, taskId]));
    },
    onSuccess: async () => { await invalidateAll(); toast.success('Failed step cancelled'); },
    onError: (_error, taskId) => {
      setDismissedFailureTaskIds((current) => current.filter((id) => id !== taskId));
      toast.error('Failed to cancel failed step');
    },
  });

  const resolveEscalationMutation = useMutation({
    mutationFn: ({ taskId, instructions }: { taskId: string; instructions: string }) =>
      dashboardApi.resolveEscalation(taskId, { instructions }),
    onMutate: async ({ taskId }) => {
      setDismissedEscalationTaskIds((current) =>
        current.includes(taskId) ? current : [...current, taskId],
      );
    },
    onSuccess: async () => {
      await invalidateAll();
      toast.success('Operator guidance submitted — the specialist step will resume');
    },
    onError: (_error, variables) => {
      setDismissedEscalationTaskIds((current) => current.filter((id) => id !== variables.taskId));
      toast.error('Failed to submit operator guidance');
    },
  });

  const cancelEscalationMutation = useMutation({
    mutationFn: (taskId: string) => dashboardApi.cancelTask(taskId),
    onMutate: async (taskId) => {
      setDismissedEscalationTaskIds((current) =>
        current.includes(taskId) ? current : [...current, taskId],
      );
    },
    onSuccess: async () => {
      await invalidateAll();
      toast.success('Escalated step cancelled');
    },
    onError: (_error, taskId) => {
      setDismissedEscalationTaskIds((current) => current.filter((id) => id !== taskId));
      toast.error('Failed to cancel escalated step');
    },
  });

  const anyApprovalLoading =
    approveMutation.isPending || rejectMutation.isPending ||
    requestChangesMutation.isPending || skipMutation.isPending;

  const anyReviewLoading =
    approveOutputMutation.isPending || rejectMutation.isPending ||
    requestChangesMutation.isPending || skipMutation.isPending;

  const renderApprovalCards = (tasks: TaskRecord[]) =>
    tasks.map((task) => (
      <ApprovalCard
        key={task.id}
        task={task}
        onApprove={() => approveMutation.mutate(task.id)}
        onRequestChanges={(feedback) => requestChangesMutation.mutate({ taskId: task.id, feedback })}
        onSkip={(reason) => skipMutation.mutate({ taskId: task.id, reason })}
        onReject={(feedback) => rejectMutation.mutate({ taskId: task.id, feedback })}
        isLoading={anyApprovalLoading}
      />
    ));

  const renderReviewCards = (tasks: TaskRecord[]) =>
    tasks.map((task) => (
      <OutputReviewCard
        key={task.id}
        task={task}
        onApproveOutput={() => approveOutputMutation.mutate(task.id)}
        onRequestChanges={(feedback) => requestChangesMutation.mutate({ taskId: task.id, feedback })}
        onSkip={(reason) => skipMutation.mutate({ taskId: task.id, reason })}
        onReject={(feedback) => rejectMutation.mutate({ taskId: task.id, feedback })}
        isLoading={anyReviewLoading}
      />
    ));

  const renderFailedCards = (tasks: TaskRecord[]) =>
    tasks.map((task) => (
      <FailedCard
        key={task.id}
        task={task}
        onRetry={() => retryMutation.mutate(task.id)}
        onRetryDifferentWorker={() => retryOnDifferentWorkerMutation.mutate(task.id)}
        onSkip={(reason) => skipMutation.mutate({ taskId: task.id, reason })}
        onCancel={() => cancelFailedMutation.mutate(task.id)}
        isLoading={retryMutation.isPending || retryOnDifferentWorkerMutation.isPending || skipMutation.isPending || cancelFailedMutation.isPending}
      />
    ));

  const anyEscalationLoading =
    resolveEscalationMutation.isPending || skipMutation.isPending || cancelEscalationMutation.isPending;

  const renderGateCards = () =>
    stageGates.map((gate) => (
      <GateDetailCard
        key={`${gate.workflow_id}:${gate.stage_name}:${(gate as unknown as { gate_id?: string; id?: string }).gate_id ?? (gate as unknown as { gate_id?: string; id?: string }).id ?? 'pending'}`}
        gate={gate}
        source="approval-queue"
      />
    ));

  const renderEscalationCards = (tasks: TaskRecord[]) =>
    tasks.map((task) => (
      <EscalationCard
        key={task.id}
        task={task}
        onResolve={(instructions) => resolveEscalationMutation.mutate({ taskId: task.id, instructions })}
        onSkip={(reason) => skipMutation.mutate({ taskId: task.id, reason })}
        onCancel={() => cancelEscalationMutation.mutate(task.id)}
        isLoading={anyEscalationLoading}
      />
    ));

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Alerts & Approvals</h1>
        <p className="text-sm text-muted">
          Review stage gates first, then operator step reviews, escalations, and execution failures across active boards.
        </p>
      </div>

      {showInitialLoading ? (
        <LaneLoadingState message="Loading operator intervention lanes..." />
      ) : null}

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">Operator Queue ({allItems.length})</TabsTrigger>
          <TabsTrigger value="gates">Stage Gates ({stageGates.length})</TabsTrigger>
          <TabsTrigger value="approvals">Step Approvals ({manualApprovalTasks.length})</TabsTrigger>
          <TabsTrigger value="reviews">Output Gates ({reviewTasks.length})</TabsTrigger>
          <TabsTrigger value="escalations">Operator Guidance ({escalationTasks.length})</TabsTrigger>
          <TabsTrigger value="failures">Execution Failures ({failedTasks.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <div className="space-y-4">
            {approvalsQuery.isLoading ? <LaneLoadingState message="Loading stage gates and operator approvals..." /> : null}
            {escalationQuery.isLoading ? <LaneLoadingState message="Loading operator guidance escalations..." /> : null}
            {failedQuery.isLoading ? <LaneLoadingState message="Loading execution failures..." /> : null}
            {approvalsError ? <LaneErrorState message="Failed to load stage gates and operator approvals." /> : null}
            {escalationError ? <LaneErrorState message="Failed to load operator guidance escalations." /> : null}
            {failedError ? <LaneErrorState message="Failed to load execution failures." /> : null}
            {allItems.length === 0 && <EmptyState />}
            {renderGateCards()}
            {renderApprovalCards(manualApprovalTasks)}
            {renderReviewCards(reviewTasks)}
            {renderEscalationCards(escalationTasks)}
            {renderFailedCards(failedTasks)}
          </div>
        </TabsContent>

        <TabsContent value="gates">
          <div className="space-y-4">
            {approvalsQuery.isLoading ? <LaneLoadingState message="Loading stage gates..." /> : null}
            {approvalsError ? <LaneErrorState message="Failed to load stage gates." /> : null}
            {stageGates.length === 0 && <EmptyState message="No stage gates awaiting operator review." />}
            {renderGateCards()}
          </div>
        </TabsContent>

        <TabsContent value="approvals">
          <div className="space-y-4">
            {approvalsQuery.isLoading ? <LaneLoadingState message="Loading specialist step approvals..." /> : null}
            {approvalsError ? <LaneErrorState message="Failed to load specialist step approvals." /> : null}
            {manualApprovalTasks.length === 0 && <EmptyState message="No specialist steps awaiting operator approval." />}
            {renderApprovalCards(manualApprovalTasks)}
          </div>
        </TabsContent>

        <TabsContent value="reviews">
          <div className="space-y-4">
            {approvalsQuery.isLoading ? <LaneLoadingState message="Loading output gates..." /> : null}
            {approvalsError ? <LaneErrorState message="Failed to load output gates." /> : null}
            {reviewTasks.length === 0 && <EmptyState message="No specialist outputs waiting at an operator quality gate." />}
            {renderReviewCards(reviewTasks)}
          </div>
        </TabsContent>

        <TabsContent value="escalations">
          <div className="space-y-4">
            {escalationQuery.isLoading ? <LaneLoadingState message="Loading specialist escalations..." /> : null}
            {escalationError ? <LaneErrorState message="Failed to load specialist escalations." /> : null}
            {escalationTasks.length === 0 && <EmptyState message="No specialist steps are waiting for operator guidance." />}
            {renderEscalationCards(escalationTasks)}
          </div>
        </TabsContent>

        <TabsContent value="failures">
          <div className="space-y-4">
            {failedQuery.isLoading ? <LaneLoadingState message="Loading execution failures..." /> : null}
            {failedError ? <LaneErrorState message="Failed to load execution failures." /> : null}
            {failedTasks.length === 0 && <EmptyState message="No specialist steps have failed and need operator intervention." />}
            {renderFailedCards(failedTasks)}
          </div>
        </TabsContent>

      </Tabs>
    </div>
  );
}

function EmptyState({ message = 'No operator queue items require action.' }: { message?: string }): JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-8 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-green-600" />
        <p className="text-muted">{message}</p>
      </CardContent>
    </Card>
  );
}

function LaneErrorState({ message }: { message: string }): JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4 text-red-600">
        <AlertTriangle className="h-4 w-4" />
        <p className="text-sm">{message}</p>
      </CardContent>
    </Card>
  );
}

function LaneLoadingState({ message }: { message: string }): JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4 text-muted">
        <RefreshCw className="h-4 w-4 animate-spin" />
        <p className="text-sm">{message}</p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Approval card (operator decision before continuing execution)
// ---------------------------------------------------------------------------

interface ApprovalCardProps {
  task: TaskRecord;
  onApprove: () => void;
  onRequestChanges: (feedback: string) => void;
  onSkip: (reason: string) => void;
  onReject: (feedback: string) => void;
  isLoading: boolean;
}

function ApprovalCard({ task, onApprove, onRequestChanges, onSkip, onReject, isLoading }: ApprovalCardProps): JSX.Element {
  const instructions = extractInstructions(task.input);
  const description = task.description;
  const hasOutput = task.output != null;

  return (
    <Card className="border-l-4 border-l-amber-400">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">{task.title ?? task.name ?? task.id}</CardTitle>
            {task.type && <Badge variant="outline" className="text-[10px]">{task.type}</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatWaitTime(task.created_at)}
            </span>
            <Badge variant="warning">Awaiting Operator Decision</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {task.role && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted font-medium">Role:</span>
              <Badge variant="outline" className="text-[10px]">{task.role}</Badge>
            </div>
          )}
          {description && (
            <div className="rounded-md bg-border/20 p-3">
              <p className="text-xs font-medium text-muted mb-1 flex items-center gap-1">
                <FileText className="h-3 w-3" /> Description
              </p>
              <p className="text-xs whitespace-pre-wrap">{truncateText(description, 500)}</p>
            </div>
          )}
          {instructions && (
            <div className="rounded-md bg-border/20 p-3">
              <p className="text-xs font-medium text-muted mb-1 flex items-center gap-1">
                <FileText className="h-3 w-3" /> Instructions
              </p>
              <p className="text-xs whitespace-pre-wrap">{truncateText(instructions, 500)}</p>
            </div>
          )}
          {hasOutput && (
            <div className="rounded-md bg-border/20 p-3">
              <p className="text-xs font-medium text-muted mb-1">Output</p>
              <pre className="whitespace-pre-wrap text-xs">{truncateText(formatOutput(task.output), 500)}</pre>
            </div>
          )}
          {!description && !instructions && !hasOutput && (
            <p className="text-xs text-muted italic">No description or instructions available.</p>
          )}
        </div>

        <TaskMetaRow task={task} />

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={onApprove} disabled={isLoading}>
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
            Approve Step
          </Button>
          <FeedbackAction
            label="Request Rework"
            icon={<MessageSquare className="mr-1 h-3.5 w-3.5" />}
            placeholder="Describe what needs to change before this specialist step should continue..."
            onSubmit={onRequestChanges}
            disabled={isLoading}
          />
          <FeedbackAction
            label="Bypass Step"
            icon={<SkipForward className="mr-1 h-3.5 w-3.5" />}
            placeholder="Reason for bypassing this specialist step..."
            onSubmit={onSkip}
            disabled={isLoading}
          />
          <FeedbackAction
            label="Reject Step"
            icon={<XCircle className="mr-1 h-3.5 w-3.5" />}
            variant="destructive"
            placeholder="Reason for rejecting this specialist step..."
            onSubmit={onReject}
            disabled={isLoading}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Output review card (operator quality gate after execution)
// ---------------------------------------------------------------------------

interface OutputReviewCardProps {
  task: TaskRecord;
  onApproveOutput: () => void;
  onRequestChanges: (feedback: string) => void;
  onSkip: (reason: string) => void;
  onReject: (feedback: string) => void;
  isLoading: boolean;
}

function OutputReviewCard({ task, onApproveOutput, onRequestChanges, onSkip, onReject, isLoading }: OutputReviewCardProps): JSX.Element {
  const [outputExpanded, setOutputExpanded] = useState(false);
  const reviewPrompt = task.metadata?.review_prompt as string | undefined;
  const reworkCount = task.rework_count ?? (task.metadata?.rework_count as number | undefined) ?? 0;
  const reviewFeedback = task.input?.review_feedback as string | undefined;
  const outputText = formatOutput(task.output);
  const outputTruncated = outputText.length > 800;

  return (
    <Card className="border-l-4 border-l-blue-500">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">{task.title ?? task.name ?? task.id}</CardTitle>
            {task.role && <Badge variant="outline" className="text-[10px]">{task.role}</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatWaitTime(task.created_at)}
            </span>
            {reworkCount > 0 && (
              <Badge variant="outline" className="text-[10px]">
                Iteration {reworkCount + 1}
              </Badge>
            )}
            <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
              <Eye className="mr-1 h-3 w-3" />
              Output Gate
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Review instructions captured on the task payload */}
        {reviewPrompt && (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
            <p className="text-xs font-medium text-blue-800 dark:text-blue-300 mb-1 flex items-center gap-1">
              <MessageSquare className="h-3 w-3" /> Operator Review Guidance
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-400 whitespace-pre-wrap">{reviewPrompt}</p>
          </div>
        )}

        {/* Previous review feedback (on rework iterations) */}
        {reviewFeedback && reworkCount > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1 flex items-center gap-1">
              <MessageSquare className="h-3 w-3" /> Previous Operator Feedback
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 whitespace-pre-wrap">{reviewFeedback}</p>
          </div>
        )}

        {/* Agent output */}
        <div className="rounded-md bg-border/20 p-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-medium text-muted flex items-center gap-1">
              <FileText className="h-3 w-3" /> Specialist Output
            </p>
            {outputTruncated && (
              <Button
                size="sm" variant="ghost" className="h-5 px-2 text-[10px]"
                onClick={() => setOutputExpanded(!outputExpanded)}
              >
                {outputExpanded ? 'Show less' : 'Show all'}
              </Button>
            )}
          </div>
          {outputText ? (
            <pre className="whitespace-pre-wrap text-xs max-h-96 overflow-y-auto">
              {outputExpanded ? outputText : truncateText(outputText, 800)}
            </pre>
          ) : (
            <p className="text-xs text-muted italic">No output produced yet.</p>
          )}
        </div>

        <TaskMetaRow task={task} />

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={onApproveOutput} disabled={isLoading}>
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
            Approve Output Gate
          </Button>
          <FeedbackAction
            label="Request Rework"
            icon={<MessageSquare className="mr-1 h-3.5 w-3.5" />}
            placeholder="Describe what needs to change — this operator feedback will be passed to the specialist on the next iteration..."
            onSubmit={onRequestChanges}
            disabled={isLoading}
          />
          <FeedbackAction
            label="Bypass Review"
            icon={<SkipForward className="mr-1 h-3.5 w-3.5" />}
            placeholder="Reason for bypassing this output gate..."
            onSubmit={onSkip}
            disabled={isLoading}
          />
          <FeedbackAction
            label="Reject Output"
            icon={<XCircle className="mr-1 h-3.5 w-3.5" />}
            variant="destructive"
            placeholder="Reason for rejection — the specialist step will be marked as failed..."
            onSubmit={onReject}
            disabled={isLoading}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Failed card
// ---------------------------------------------------------------------------

interface FailedCardProps {
  task: TaskRecord;
  onRetry: () => void;
  onRetryDifferentWorker: () => void;
  onSkip: (reason: string) => void;
  onCancel: () => void;
  isLoading: boolean;
}

function FailedCard({ task, onRetry, onRetryDifferentWorker, onSkip, onCancel, isLoading }: FailedCardProps): JSX.Element {
  return (
    <Card className="border-l-4 border-l-red-500">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{task.title ?? task.name ?? task.id}</CardTitle>
          <Badge variant="destructive">Execution Failed</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {task.error_message && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-red-800 dark:bg-red-950/30 dark:text-red-300">
            <p className="text-xs font-medium mb-1">Error</p>
            <p className="text-xs">{task.error_message}</p>
          </div>
        )}
        <div className="mb-3 flex items-center gap-4 text-xs text-muted">
          {task.retry_count != null && <span>Re-run count: {task.retry_count}</span>}
          {(task.assigned_worker_id ?? task.assigned_worker) && (
            <span>Assigned worker: {(task.assigned_worker_id ?? task.assigned_worker)!.slice(0, 8)}</span>
          )}
          <span className="font-mono">Step {task.id.slice(0, 8)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onRetry} disabled={isLoading}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            Re-run Step
          </Button>
          <Button size="sm" variant="outline" onClick={onRetryDifferentWorker} disabled={isLoading}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            Re-run on New Worker
          </Button>
          <FeedbackAction
            label="Bypass Step"
            icon={<SkipForward className="mr-1 h-3.5 w-3.5" />}
            placeholder="Reason for bypassing this failed step..."
            onSubmit={onSkip}
            disabled={isLoading}
          />
          <Button size="sm" variant="destructive" onClick={onCancel} disabled={isLoading}>
            <XCircle className="mr-1 h-3.5 w-3.5" />
            Cancel Failed Step
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Escalation card (specialist requested operator help)
// ---------------------------------------------------------------------------

interface EscalationCardProps {
  task: TaskRecord;
  onResolve: (instructions: string) => void;
  onSkip: (reason: string) => void;
  onCancel: () => void;
  isLoading: boolean;
}

function EscalationCard({ task, onResolve, onSkip, onCancel, isLoading }: EscalationCardProps): JSX.Element {
  const escalationReason = task.metadata?.escalation_reason as string | undefined;
  const escalationContext = task.metadata?.escalation_context as string | undefined;
  const escalationDepth = (task.metadata?.escalation_depth as number | undefined) ?? 1;
  const maxDepth = (task.metadata?.max_escalation_depth as number | undefined) ?? 5;
  const instructions = extractInstructions(task.input);

  return (
    <Card className="border-l-4 border-l-purple-500">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">{task.title ?? task.name ?? task.id}</CardTitle>
            {task.role && <Badge variant="outline" className="text-[10px]">{task.role}</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatWaitTime(task.created_at)}
            </span>
            <Badge variant="secondary" className="bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300">
              <Zap className="mr-1 h-3 w-3" />
              Operator Guidance Needed
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {escalationReason && (
          <div className="rounded-md border border-purple-200 bg-purple-50 p-3 dark:border-purple-900 dark:bg-purple-950/30">
            <p className="text-xs font-medium text-purple-800 dark:text-purple-300 mb-1 flex items-center gap-1">
              <MessageSquare className="h-3 w-3" /> Specialist Question
            </p>
            <p className="text-xs text-purple-700 dark:text-purple-400 whitespace-pre-wrap">{escalationReason}</p>
          </div>
        )}

        {escalationContext && (
          <div className="rounded-md bg-border/20 p-3">
            <p className="text-xs font-medium text-muted mb-1 flex items-center gap-1">
              <FileText className="h-3 w-3" /> Execution Context
            </p>
            <p className="text-xs whitespace-pre-wrap">{truncateText(escalationContext, 500)}</p>
          </div>
        )}

        {instructions && (
          <div className="rounded-md bg-border/20 p-3">
            <p className="text-xs font-medium text-muted mb-1 flex items-center gap-1">
              <FileText className="h-3 w-3" /> Original Step Instructions
            </p>
            <p className="text-xs whitespace-pre-wrap">{truncateText(instructions, 500)}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted">
          {task.workflow_id && <span>Board: {task.workflow_id.slice(0, 8)}</span>}
          <span>Escalation depth: {escalationDepth}/{maxDepth}</span>
          <span className="font-mono">Step {task.id.slice(0, 8)}</span>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <FeedbackAction
            label="Resume with Guidance"
            icon={<CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
            placeholder="Provide operator guidance to help the specialist continue..."
            onSubmit={onResolve}
            disabled={isLoading}
          />
          <FeedbackAction
            label="Bypass Step"
            icon={<SkipForward className="mr-1 h-3.5 w-3.5" />}
            placeholder="Reason for bypassing this escalated step..."
            onSubmit={onSkip}
            disabled={isLoading}
          />
          <Button size="sm" variant="destructive" onClick={onCancel} disabled={isLoading}>
            <XCircle className="mr-1 h-3.5 w-3.5" />
            Cancel Work
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Shared metadata row
// ---------------------------------------------------------------------------

function TaskMetaRow({ task }: { task: TaskRecord }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted">
      {task.workflow_id && <span>Board: {task.workflow_id.slice(0, 8)}</span>}
      {(task.depends_on ?? []).length > 0 && (
        <span>Upstream steps: {task.depends_on!.length}</span>
      )}
      {(task.assigned_worker_id ?? task.assigned_worker) && (
        <span>Assigned worker: {(task.assigned_worker_id ?? task.assigned_worker)!.slice(0, 8)}</span>
      )}
      <span className="font-mono">Step {task.id.slice(0, 8)}</span>
    </div>
  );
}
