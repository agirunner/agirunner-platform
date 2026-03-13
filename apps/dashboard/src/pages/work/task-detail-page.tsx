import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  Loader2,
  CheckCircle,
  XCircle,
  RotateCcw,
  Clock,
  DollarSign,
  User,
  Cpu,
  Workflow,
} from 'lucide-react';
import { dashboardApi } from '../../lib/api.js';
import { StructuredRecordView } from '../../components/structured-data.js';
import { LogViewer } from '../../components/log-viewer/log-viewer.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '../../components/ui/tabs.js';
import {
  buildTaskNextStep,
  readClarificationAnswers,
  readClarificationHistory,
  readExecutionSummary,
  readHumanEscalationResponse,
  readReviewSignals,
  readReworkDetails,
} from '../task-detail-support.js';
import {
  buildWorkflowOperatorPermalink,
  usesWorkItemOperatorFlow,
  usesWorkflowOperatorFlow,
} from './task-operator-flow.js';
import { TaskDetailArtifactsPanel } from './task-detail-artifacts-panel.js';

interface Task {
  id: string;
  name?: string;
  title?: string;
  status: string;
  state?: string;
  role?: string;
  stage_name?: string | null;
  work_item_id?: string | null;
  activation_id?: string | null;
  is_orchestrator_task?: boolean;
  agent_id?: string;
  agent_name?: string;
  assigned_worker?: string;
  worker_id?: string;
  workflow_id?: string;
  workflow_name?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  duration_seconds?: number;
  cost?: number;
  output?: unknown;
  description?: string;
  input?: Record<string, unknown>;
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  verification?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  rework_count?: number;
  type?: string;
}

function normalizeTask(response: unknown): Task {
  const wrapped = response as { data?: unknown };
  if (wrapped?.data && typeof wrapped.data === 'object' && 'id' in (wrapped.data as object)) {
    return wrapped.data as Task;
  }
  return response as Task;
}

function resolveStatus(task: Task): string {
  return normalizeTaskStatus((task.status ?? task.state ?? 'unknown').toLowerCase());
}

function statusBadgeVariant(status: string) {
  const map: Record<string, 'success' | 'default' | 'destructive' | 'warning' | 'secondary'> = {
    completed: 'success',
    in_progress: 'default',
    failed: 'destructive',
    output_pending_review: 'warning',
    pending: 'secondary',
    awaiting_approval: 'warning',
    escalated: 'destructive',
    ready: 'secondary',
  };
  return map[status] ?? 'secondary';
}

function describeTaskKind(task: Task): string {
  const status = resolveStatus(task);
  if (task.is_orchestrator_task) {
    return 'Orchestrator activation';
  }
  if (status === 'output_pending_review') {
    return 'Output review';
  }
  if (status === 'awaiting_approval') {
    return 'Operator approval';
  }
  if (status === 'escalated') {
    return 'Escalated specialist step';
  }
  return 'Specialist step';
}

function formatTimestamp(value?: string): string {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function formatDuration(task: Task): string {
  if (task.duration_seconds !== undefined && task.duration_seconds !== null) {
    const s = task.duration_seconds;
    if (s < 60) return `${Math.round(s)}s`;
    return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  }
  if (!task.started_at) return '-';
  const start = new Date(task.started_at).getTime();
  const end = task.completed_at ? new Date(task.completed_at).getTime() : Date.now();
  const seconds = (end - start) / 1000;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function InfoCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
}): JSX.Element {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Icon className="h-4 w-4" />
          {label}
        </div>
        <p className="mt-1 text-sm font-medium">{value}</p>
      </CardContent>
    </Card>
  );
}

function TaskActionButtons({ task }: { task: Task }): JSX.Element {
  const queryClient = useQueryClient();
  const status = resolveStatus(task);
  const isAwaitingApproval = status === 'awaiting_approval';
  const isOutputReview = status === 'output_pending_review';
  const isEscalated = status === 'escalated';
  const isFailed = status === 'failed';
  const isInProgress = status === 'in_progress';
  const workItemFlow = usesWorkItemOperatorFlow(task);
  const workflowOperatorFlow = usesWorkflowOperatorFlow(task);
  const workflowOperatorPermalink = buildWorkflowOperatorPermalink(task);

  const approveMutation = useMutation({
    mutationFn: () =>
      isOutputReview ? dashboardApi.approveTaskOutput(task.id) : dashboardApi.approveTask(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', task.id] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => dashboardApi.rejectTask(task.id, { feedback: 'Rejected from dashboard' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', task.id] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: () => dashboardApi.retryTask(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', task.id] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => dashboardApi.cancelTask(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', task.id] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const isActionPending =
    approveMutation.isPending ||
    rejectMutation.isPending ||
    retryMutation.isPending ||
    cancelMutation.isPending;

  if (workflowOperatorFlow && workflowOperatorPermalink) {
    return (
      <div className="space-y-2">
        <div className="flex gap-2">
          <Button size="sm" asChild>
            <Link to={workflowOperatorPermalink}>
              {workItemFlow ? 'Open Work Item Flow' : 'Open Board Stage Flow'}
            </Link>
          </Button>
        </div>
        <p className="text-xs text-muted">
          {workItemFlow
            ? 'This step belongs to a workflow work item. Operator review, rework, and retry decisions should run through the work-item panel so gate state, linked steps, and board context stay aligned.'
            : 'This step belongs to a workflow stage. Operator review, rework, and retry decisions should run through the board stage flow so stage-gate and board context stay aligned.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      {isAwaitingApproval && (
        <>
          <Button
            size="sm"
            disabled={isActionPending}
            onClick={() => approveMutation.mutate()}
          >
            <CheckCircle className="h-4 w-4" />
            Approve Step
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={isActionPending}
            onClick={() => rejectMutation.mutate()}
          >
            <XCircle className="h-4 w-4" />
            Reject Step
          </Button>
        </>
      )}
      {isOutputReview && (
        <Button
          size="sm"
          disabled={isActionPending}
          onClick={() => approveMutation.mutate()}
        >
          <CheckCircle className="h-4 w-4" />
          Approve Output
        </Button>
      )}
      {isEscalated && (
        <Button variant="outline" size="sm" asChild>
          <a href="#escalation-response">
            <Workflow className="h-4 w-4" />
            Open Escalation Context
          </a>
        </Button>
      )}
      {isFailed && (
        <Button
          variant="outline"
          size="sm"
          disabled={isActionPending}
          onClick={() => retryMutation.mutate()}
        >
          <RotateCcw className="h-4 w-4" />
          Retry Step
        </Button>
      )}
      {isInProgress && (
        <Button
          variant="destructive"
          size="sm"
          disabled={isActionPending}
          onClick={() => cancelMutation.mutate()}
        >
          <XCircle className="h-4 w-4" />
          Cancel
        </Button>
      )}
    </div>
  );
}

function normalizeTaskStatus(status: string): string {
  return status;
}

function OutputSection({ output }: { output: unknown }): JSX.Element {
  if (output === undefined || output === null) {
    return <p className="text-sm text-muted">No output available.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-border/10 p-4">
        {renderOutputPreview(output)}
      </div>
      <details className="rounded-xl border border-border/70 bg-surface p-4">
        <summary className="cursor-pointer text-sm font-medium">Raw payload</summary>
        <pre className="mt-3 overflow-x-auto rounded-md bg-border/10 p-4 text-xs">
          <code>{typeof output === 'string' ? output : JSON.stringify(output, null, 2)}</code>
        </pre>
      </details>
    </div>
  );
}

function renderOutputPreview(output: unknown): JSX.Element {
  if (typeof output === 'string') {
    return <p className="whitespace-pre-wrap text-sm leading-6">{output}</p>;
  }
  if (typeof output === 'number' || typeof output === 'boolean') {
    return <p className="text-sm font-medium">{String(output)}</p>;
  }
  if (Array.isArray(output)) {
    if (output.length === 0) {
      return <p className="text-sm text-muted">Output array is empty.</p>;
    }
    const primitiveItems = output.every((item) =>
      item === null || ['string', 'number', 'boolean'].includes(typeof item),
    );
    if (primitiveItems) {
      return (
        <ul className="list-disc space-y-2 pl-5 text-sm">
          {output.map((item, index) => (
            <li key={`${String(item)}-${index}`}>{String(item)}</li>
          ))}
        </ul>
      );
    }
    return (
      <div className="space-y-3">
        {output.map((item, index) => (
          <div key={index} className="rounded-lg bg-surface p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
              Item {index + 1}
            </p>
            <StructuredRecordView data={item} emptyMessage="No output payload." />
          </div>
        ))}
      </div>
    );
  }
  return <StructuredRecordView data={output} emptyMessage="No structured output available." />;
}

function formatStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

function renderTimestamp(value?: string): React.ReactNode {
  if (!value) {
    return '-';
  }
  return (
    <time dateTime={value} title={formatTimestamp(value)}>
      {formatRelativeTime(value)}
    </time>
  );
}

function formatRelativeTime(value: string): string {
  const millis = new Date(value).getTime();
  if (!Number.isFinite(millis)) {
    return formatTimestamp(value);
  }
  const deltaSeconds = Math.round((Date.now() - millis) / 1000);
  const absSeconds = Math.abs(deltaSeconds);
  if (absSeconds < 60) {
    return deltaSeconds >= 0 ? `${absSeconds}s ago` : `in ${absSeconds}s`;
  }
  const absMinutes = Math.round(absSeconds / 60);
  if (absMinutes < 60) {
    return deltaSeconds >= 0 ? `${absMinutes}m ago` : `in ${absMinutes}m`;
  }
  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) {
    return deltaSeconds >= 0 ? `${absHours}h ago` : `in ${absHours}h`;
  }
  const absDays = Math.round(absHours / 24);
  return deltaSeconds >= 0 ? `${absDays}d ago` : `in ${absDays}d`;
}

function summarizeId(value?: string | null): string {
  if (!value) {
    return '-';
  }
  if (value.length <= 16) {
    return value;
  }
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function RelatedLinks({ task }: { task: Task }): JSX.Element {
  const workItemPermalink =
    task.workflow_id && task.work_item_id
      ? `/work/workflows/${task.workflow_id}?work_item=${encodeURIComponent(task.work_item_id)}#work-item-${encodeURIComponent(task.work_item_id)}`
      : null;

  return (
    <div className="flex flex-wrap gap-2 text-sm">
      {task.workflow_id ? (
        <Link to={`/work/workflows/${task.workflow_id}`} className="text-accent hover:underline">
          Open board
        </Link>
      ) : null}
      {workItemPermalink ? (
        <Link to={workItemPermalink} className="text-accent hover:underline">
          Open work item flow
        </Link>
      ) : null}
      {task.activation_id && task.workflow_id ? (
        <Link
          to={`/work/workflows/${task.workflow_id}#activation-${encodeURIComponent(task.activation_id)}`}
          className="text-accent hover:underline"
        >
          Open activation
        </Link>
      ) : null}
    </div>
  );
}

function OperatorBriefingCard({ task, status }: { task: Task; status: string }): JSX.Element {
  const nextStep = buildTaskNextStep(task as never);
  const reviewSignals = readReviewSignals(task as never);
  const reworkDetails = readReworkDetails(task as never);
  const workItemFlow = usesWorkItemOperatorFlow(task);
  const workflowOperatorFlow = usesWorkflowOperatorFlow(task);

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusBadgeVariant(status)} className="capitalize">
                {formatStatusLabel(status)}
              </Badge>
              <Badge variant="outline">{describeTaskKind(task)}</Badge>
              {task.stage_name ? <Badge variant="secondary">Stage {task.stage_name}</Badge> : null}
              {task.role ? <Badge variant="outline">Role {task.role}</Badge> : null}
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">
                {task.title ?? task.name ?? task.id}
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-muted">
                {task.description ?? nextStep.detail}
              </p>
            </div>
            <RelatedLinks task={task} />
          </div>
          <TaskActionButtons task={task} />
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="rounded-xl bg-border/10 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Recommended next move
          </p>
          <h2 className="mt-2 text-lg font-semibold">{nextStep.title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted">{nextStep.detail}</p>
          {workflowOperatorFlow ? (
            <p className="mt-3 text-sm text-muted">
              {workItemFlow
                ? 'This specialist step belongs to a workflow work item. Run approval, rework, and retry decisions from the work-item flow so stage state, linked steps, and board context stay aligned.'
                : 'This specialist step belongs to a workflow stage. Run approval, rework, and retry decisions from the board stage flow so stage-gate and board context stay aligned.'}
            </p>
          ) : null}
        </section>
        <section className="grid gap-3 rounded-xl bg-surface p-4 shadow-sm">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Operator signals</p>
          </div>
          <SignalRow
            label="Review status"
            value={reviewSignals.reviewAction ? formatStatusLabel(reviewSignals.reviewAction) : 'No review action recorded'}
          />
          <SignalRow
            label="Rework rounds"
            value={reworkDetails.reworkCount > 0 ? String(reworkDetails.reworkCount) : 'No rework yet'}
          />
          <SignalRow
            label="Escalation target"
            value={reviewSignals.escalationTarget ?? 'No escalation target'}
          />
          <SignalRow
            label="Clarification"
            value={reworkDetails.clarificationRequested ? 'Clarification requested' : 'No clarification request recorded'}
          />
          {reviewSignals.reviewFeedback ? (
            <div className="rounded-lg bg-border/10 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Latest feedback</p>
              <p className="mt-2 text-sm leading-6">{reviewSignals.reviewFeedback}</p>
              {reviewSignals.reviewUpdatedAt ? (
                <p className="mt-2 text-xs text-muted" title={formatTimestamp(reviewSignals.reviewUpdatedAt)}>
                  Updated {formatRelativeTime(reviewSignals.reviewUpdatedAt)}
                </p>
              ) : null}
            </div>
          ) : null}
          {reviewSignals.escalationAwaitingHuman ? (
            <div className="rounded-lg bg-border/10 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Escalation state</p>
              <p className="mt-2 text-sm leading-6">
                Waiting on a human response before the task can continue.
              </p>
            </div>
          ) : null}
        </section>
      </CardContent>
    </Card>
  );
}

function SignalRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function ContextSection({ task, status }: { task: Task; status: string }): JSX.Element {
  const clarificationAnswers = readClarificationAnswers(task as never);
  const clarificationHistory = readClarificationHistory(task as never);
  const escalationResponse = readHumanEscalationResponse(task as never);
  const executionSummary = readExecutionSummary(task as never);
  const reviewSignals = readReviewSignals(task as never);
  const input = asRecord(task.input);
  const context = asRecord(task.context);
  const reviewPrompt = readStringValue(input.review_prompt);
  const escalationNotes = [
    reviewSignals.escalationReason ? `Reason: ${reviewSignals.escalationReason}` : null,
    reviewSignals.escalationContext ? `Context: ${reviewSignals.escalationContext}` : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Operator packet</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl bg-border/10 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Current status</p>
            <p className="mt-2 text-sm leading-6">
              {formatStatusLabel(status)} {task.stage_name ? `in stage ${task.stage_name}` : ''}.
              {task.work_item_id ? ` Attached to work item ${summarizeId(task.work_item_id)}.` : ''}
            </p>
            {reviewPrompt ? (
              <>
                <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">
                  Review prompt
                </p>
                <p className="mt-2 text-sm leading-6">{reviewPrompt}</p>
              </>
            ) : null}
            {escalationNotes.length > 0 ? (
              <>
                <p
                  id="escalation-response"
                  className="mt-4 text-xs font-medium uppercase tracking-wide text-muted"
                >
                  Escalation briefing
                </p>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6">
                  {escalationNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
          <div className="rounded-xl bg-surface p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Workflow routing
            </p>
            <dl className="mt-3 grid gap-3 text-sm">
              <SignalListItem label="Board" value={task.workflow_name ?? summarizeId(task.workflow_id)} />
              <SignalListItem label="Stage" value={task.stage_name ?? 'No stage'} />
              <SignalListItem label="Work item" value={summarizeId(task.work_item_id)} />
              <SignalListItem label="Activation" value={summarizeId(task.activation_id)} />
              <SignalListItem label="Step kind" value={task.type ?? describeTaskKind(task)} />
            </dl>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Clarifications</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.keys(clarificationAnswers).length > 0 ? (
              <StructuredRecordView
                data={clarificationAnswers}
                emptyMessage="No clarification answers recorded."
              />
            ) : (
              <p className="text-sm text-muted">No clarification answers recorded.</p>
            )}
            {clarificationHistory.length > 0 ? (
              <div className="space-y-3">
                {clarificationHistory.map((entry, index) => (
                  <article key={`${entry.answered_at ?? 'clarification'}-${index}`} className="rounded-xl bg-border/10 p-4">
                    <p className="text-sm font-medium">
                      {entry.feedback ?? 'Clarification request'}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {entry.answered_by ?? 'Unknown responder'}
                      {entry.answered_at ? ` • ${formatTimestamp(entry.answered_at)}` : ''}
                    </p>
                    <div className="mt-3">
                      <StructuredRecordView data={entry.answers ?? {}} emptyMessage="No answers captured." />
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Escalation and execution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.keys(escalationResponse).length > 0 ? (
              <StructuredRecordView
                data={escalationResponse}
                emptyMessage="No human escalation response recorded."
              />
            ) : (
              <p className="text-sm text-muted">No human escalation response recorded.</p>
            )}
            {Object.keys(executionSummary.verification).length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                  Verification
                </p>
                <StructuredRecordView
                  data={executionSummary.verification}
                  emptyMessage="No verification data."
                />
              </div>
            ) : null}
            {Object.keys(executionSummary.metrics).length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                  Execution metrics
                </p>
                <StructuredRecordView
                  data={executionSummary.metrics}
                  emptyMessage="No execution metrics."
                />
              </div>
            ) : null}
            {Object.keys(context).length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                  Runtime context
                </p>
                <StructuredRecordView data={context} emptyMessage="No runtime context." />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SignalListItem({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

export function TaskDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['task', id],
    queryFn: () => dashboardApi.getTask(id!),
    enabled: Boolean(id),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-red-600">Failed to load task. Please try again later.</div>
    );
  }

  const task = normalizeTask(data);
  const status = resolveStatus(task);

  return (
    <div className="space-y-6 p-6">
      <OperatorBriefingCard task={task} status={status} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <InfoCard
          icon={User}
          label="Assigned Agent"
          value={task.agent_name ?? task.agent_id ?? 'Unassigned'}
        />
        <InfoCard
          icon={Cpu}
          label="Worker"
          value={task.assigned_worker ?? task.worker_id ?? 'Unassigned'}
        />
        <InfoCard
          icon={Workflow}
          label="Board"
          value={task.workflow_name ?? task.workflow_id ?? '-'}
        />
        <InfoCard icon={Workflow} label="Stage" value={task.stage_name ?? '-'} />
        <InfoCard
          icon={Workflow}
          label="Work Item"
          value={
            <span title={task.work_item_id ?? undefined} className="font-mono text-xs">
              {summarizeId(task.work_item_id)}
            </span>
          }
        />
        <InfoCard
          icon={Workflow}
          label="Activation"
          value={
            <span title={task.activation_id ?? undefined} className="font-mono text-xs">
              {summarizeId(task.activation_id)}
            </span>
          }
        />
        <InfoCard icon={User} label="Role" value={task.role ?? '-'} />
        <InfoCard icon={Clock} label="Created" value={renderTimestamp(task.created_at)} />
        <InfoCard icon={Clock} label="Started" value={renderTimestamp(task.started_at)} />
        <InfoCard icon={Clock} label="Completed" value={renderTimestamp(task.completed_at)} />
        <InfoCard icon={Clock} label="Duration" value={formatDuration(task)} />
        <InfoCard
          icon={DollarSign}
          label="Cost"
          value={
            task.cost !== undefined && task.cost !== null ? `$${task.cost.toFixed(2)}` : '-'
          }
        />
      </div>

      <Tabs defaultValue="output">
        <TabsList>
          <TabsTrigger value="output">Output</TabsTrigger>
          <TabsTrigger value="context">Operator Context</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
        </TabsList>

        <TabsContent value="output">
          <Card>
            <CardHeader>
              <CardTitle>Operator Output Packet</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted">
                Review the rendered output first. Use the raw payload only when you need exact serialized data.
              </p>
              <OutputSection output={task.output} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="context">
          <ContextSection task={task} status={status} />
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardContent className="pt-6">
              <LogViewer
                scope={{ taskId: task.id }}
                compact
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="artifacts">
          <Card>
            <CardHeader>
              <CardTitle>Artifacts</CardTitle>
            </CardHeader>
            <CardContent>
              <TaskDetailArtifactsPanel taskId={task.id} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
