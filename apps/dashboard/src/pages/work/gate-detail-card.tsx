import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle,
  FileText,
  Link2,
  Loader2,
  MessageSquare,
  XCircle,
} from 'lucide-react';

import type { DashboardApprovalStageGateRecord } from '../../lib/api.js';
import { StructuredRecordView } from '../../components/structured-data.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { Textarea } from '../../components/ui/textarea.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { actOnGate, getGateDetail, type DashboardGateDetailRecord } from './gate-api.js';
import { GateHandoffTrail } from './gate-handoff-trail.js';
import { OperatorBreadcrumbTrail } from './operator-breadcrumb-trail.js';
import { computeWaitingTime } from './approval-queue-support.js';
import {
  buildGateRecoveryPacket,
  buildGateBreadcrumbs,
  buildApprovalQueueGatePermalink,
  buildWorkflowGatePermalink,
  isGateHighlighted,
  readGateDecisionSummary,
  readGateDecisionHistory,
  readGatePacketSummary,
  readGateRequestSourceSummary,
  readGateResumptionSummary,
  readGateTimelineRows,
  readGateId,
} from './gate-detail-support.js';
import { buildWorkflowDetailPermalink } from '../workflow-detail-permalinks.js';

function readArtifactLabel(artifact: Record<string, unknown>, index: number): string {
  const label = artifact.label ?? artifact.path ?? artifact.name ?? artifact.id;
  if (typeof label === 'string' && label.trim().length > 0) {
    return label;
  }
  return `Artifact ${index + 1}`;
}

function readArtifactMeta(artifact: Record<string, unknown>): string[] {
  const details: string[] = [];
  if (typeof artifact.kind === 'string' && artifact.kind.trim().length > 0) {
    details.push(artifact.kind);
  }
  if (typeof artifact.stage_name === 'string' && artifact.stage_name.trim().length > 0) {
    details.push(`stage ${artifact.stage_name}`);
  }
  if (typeof artifact.task_role === 'string' && artifact.task_role.trim().length > 0) {
    details.push(artifact.task_role);
  }
  return details;
}

function readDecisionLabel(action: string | null | undefined): string {
  if (!action) {
    return 'Pending decision';
  }
  return action.replaceAll('_', ' ');
}

type GateSourceRecord = DashboardApprovalStageGateRecord | DashboardGateDetailRecord;

export function GateDetailCard(props: {
  gate: GateSourceRecord;
  source: 'approval-queue' | 'workflow-detail';
}) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [isChangesDialogOpen, setIsChangesDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const gateId = readGateId(props.gate as unknown as Record<string, unknown>);
  const workflowId = props.gate.workflow_id;
  const permalink = buildWorkflowGatePermalink(workflowId, props.gate.stage_name);
  const queuePermalink = gateId ? buildApprovalQueueGatePermalink(gateId) : null;
  const workflowDetailHighlight =
    new URLSearchParams(location.search).get('gate') === props.gate.stage_name ||
    location.hash === `#gate-${props.gate.stage_name}`;
  const highlighted =
    props.source === 'workflow-detail'
      ? workflowDetailHighlight
      : isGateHighlighted(location.search, location.hash, gateId);

  const detailQuery = useQuery({
    queryKey: ['workflow-gate', gateId],
    queryFn: () => getGateDetail(gateId as string),
    enabled: gateId !== null,
  });

  const gate = useMemo(
    () => detailQuery.data ?? (props.gate as DashboardGateDetailRecord),
    [detailQuery.data, props.gate],
  );

  const invalidateGateQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['approval-queue'] }),
      queryClient.invalidateQueries({ queryKey: ['workflow', workflowId] }),
      queryClient.invalidateQueries({ queryKey: ['workflow-stages', workflowId] }),
      queryClient.invalidateQueries({ queryKey: ['workflows'] }),
      queryClient.invalidateQueries({ queryKey: ['workflow-gates', workflowId] }),
      gateId
        ? queryClient.invalidateQueries({ queryKey: ['workflow-gate', gateId] })
        : Promise.resolve(),
    ]);
  };

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!gateId) {
        throw new Error('Gate id is required');
      }
      return actOnGate(gateId, { action: 'approve' });
    },
    onSuccess: (updatedGate) => {
      if (gateId) {
        queryClient.setQueryData(['workflow-gate', gateId], updatedGate);
      }
      void invalidateGateQueries();
    },
  });
  const rejectMutation = useMutation({
    mutationFn: async () => {
      if (!gateId) {
        throw new Error('Gate id is required');
      }
      return actOnGate(gateId, { action: 'reject', feedback: 'Rejected from gate review' });
    },
    onSuccess: (updatedGate) => {
      if (gateId) {
        queryClient.setQueryData(['workflow-gate', gateId], updatedGate);
      }
      void invalidateGateQueries();
    },
  });
  const requestChangesMutation = useMutation({
    mutationFn: async (changeFeedback: string) => {
      if (!gateId) {
        throw new Error('Gate id is required');
      }
      return actOnGate(gateId, { action: 'request_changes', feedback: changeFeedback });
    },
    onSuccess: (updatedGate) => {
      setIsChangesDialogOpen(false);
      setFeedback('');
      if (gateId) {
        queryClient.setQueryData(['workflow-gate', gateId], updatedGate);
      }
      void invalidateGateQueries();
    },
  });

  const isAwaitingApproval =
    gate.gate_status === 'awaiting_approval' || gate.status === 'awaiting_approval';
  const isActionPending =
    approveMutation.isPending || rejectMutation.isPending || requestChangesMutation.isPending;
  const breadcrumbs = buildGateBreadcrumbs(gate);
  const packetSummary = readGatePacketSummary(gate);
  const timelineRows = readGateTimelineRows(gate);
  const decisionAction = gate.human_decision?.action ?? null;
  const decisionFeedback = gate.human_decision?.feedback ?? gate.decision_feedback ?? null;
  const resume = gate.orchestrator_resume ?? null;
  const requestSourceSummary = readGateRequestSourceSummary(gate);
  const decisionSummary = readGateDecisionSummary(gate);
  const decisionHistory = readGateDecisionHistory(gate);
  const resumptionSummary = readGateResumptionSummary(gate);
  const recoveryPacket = buildGateRecoveryPacket(gate);
  const resumeHistoryCount = gate.orchestrator_resume_history?.length ?? (resume ? 1 : 0);
  const requestedWorkItemPermalink =
    workflowId && gate.requested_by_task?.work_item_id
      ? buildWorkflowDetailPermalink(workflowId, {
          workItemId: gate.requested_by_task.work_item_id,
        })
      : null;
  const resumePermalink =
    workflowId && resume?.activation_id
      ? buildWorkflowDetailPermalink(workflowId, {
          activationId: resume.activation_id,
        })
      : null;
  const requestTaskPermalink = gate.requested_by_task?.id
    ? `/work/tasks/${gate.requested_by_task.id}`
    : null;
  const resumeTaskPermalink = resume?.task?.id ? `/work/tasks/${resume.task.id}` : null;

  return (
    <>
      <Card
        id={props.source === 'approval-queue' && gateId ? `gate-${gateId}` : undefined}
        data-highlighted={highlighted ? 'true' : 'false'}
        className={highlighted ? 'ring-2 ring-accent/50' : undefined}
      >
        <CardContent className="p-5">
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <Badge variant="warning">Stage gate</Badge>
                <Badge variant="outline">{gate.stage_name}</Badge>
                <Badge variant="secondary">Gate ID {gateId ?? 'pending'}</Badge>
                {decisionAction ? (
                  <Badge
                    variant={
                      decisionAction === 'approve'
                        ? 'success'
                        : decisionAction === 'request_changes'
                          ? 'warning'
                          : 'destructive'
                    }
                  >
                    {readDecisionLabel(decisionAction)}
                  </Badge>
                ) : null}
                {resume?.state ? (
                  <Badge variant="outline">orchestrator {resume.state.replaceAll('_', ' ')}</Badge>
                ) : decisionAction ? (
                  <Badge variant="outline">awaiting orchestrator follow-up</Badge>
                ) : null}
                {resumeHistoryCount > 1 ? (
                  <Badge variant="outline">{resumeHistoryCount} follow-up runs</Badge>
                ) : null}
                <span>Waiting {computeWaitingTime(gate.updated_at)}</span>
              </div>
              <div className="space-y-2">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
                  Operator breadcrumbs
                </div>
                <OperatorBreadcrumbTrail items={breadcrumbs} />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                {requestSourceSummary.map((item) => (
                  <Badge key={item} variant="secondary">
                    {item}
                  </Badge>
                ))}
                <Badge variant="outline">{decisionSummary}</Badge>
                <Badge variant="outline">{resumptionSummary}</Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <GateSignalCard label="Stage" value={gate.stage_name} />
                <GateSignalCard label="Decision" value={decisionSummary} />
                <GateSignalCard label="Follow-up" value={resumptionSummary} />
                <GateSignalCard label="Artifacts" value={`${gate.key_artifacts.length} linked`} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={permalink ?? `/work/boards/${workflowId}`}
                  className="text-sm font-semibold text-accent hover:underline"
                >
                  {gate.workflow_name ?? workflowId}
                </Link>
                {permalink ? (
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={permalink}>
                      <Link2 className="h-3.5 w-3.5" />
                      Permalink
                    </Link>
                  </Button>
                ) : null}
                {props.source === 'workflow-detail' && queuePermalink ? (
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={queuePermalink}>Open in approvals</Link>
                  </Button>
                ) : null}
                {requestedWorkItemPermalink ? (
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={requestedWorkItemPermalink}>Open work-item flow</Link>
                  </Button>
                ) : null}
                {resumePermalink ? (
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={resumePermalink}>Open follow-up activation</Link>
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.95fr)]">
              <div className="space-y-4">
                <GatePanel eyebrow="Review focus" title="Gate review packet">
                  <p className="text-sm leading-6 text-foreground">
                    {gate.stage_goal?.trim() || 'No gate goal recorded.'}
                  </p>
                  {packetSummary.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {packetSummary.map((item) => (
                        <Badge key={item} variant="secondary">
                          {item}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {gate.request_summary ? (
                    <p className="text-sm leading-6 text-muted">{gate.request_summary}</p>
                  ) : (
                    <p className="text-sm leading-6 text-muted">
                      Review the linked concerns, artifacts, and decision trail before acting.
                    </p>
                  )}
                </GatePanel>

                {gate.summary ? (
                  <GatePanel eyebrow="Operator context" title="Gate summary">
                    <p className="text-sm leading-6 text-muted">{gate.summary}</p>
                  </GatePanel>
                ) : null}

                <div className="grid gap-4 lg:grid-cols-2">
                  <GatePanel eyebrow="Recommendation" title="Recommendation">
                    <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                      <CheckCircle className="h-3.5 w-3.5" />
                      Recommendation
                    </div>
                    <p className="text-sm leading-6 text-muted">
                      {gate.recommendation?.trim() || 'No orchestrator recommendation recorded.'}
                    </p>
                  </GatePanel>
                  <GatePanel eyebrow="Risk scan" title="Concerns">
                    <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Concerns
                    </div>
                    {gate.concerns.length > 0 ? (
                      <ul className="space-y-1 text-sm leading-6 text-muted">
                        {gate.concerns.map((concern, index) => (
                          <li key={`${concern}:${index}`}>• {concern}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm leading-6 text-muted">No explicit concerns recorded.</p>
                    )}
                  </GatePanel>
                </div>

                {gate.key_artifacts.length > 0 ? (
                  <GatePanel eyebrow="Review evidence" title="Key artifacts">
                    <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                      <FileText className="h-3.5 w-3.5" />
                      Key artifacts
                    </div>
                    <div className="grid gap-2">
                      {gate.key_artifacts.map((artifact, index) => {
                        const label = readArtifactLabel(artifact, index);
                        const taskId =
                          typeof artifact.task_id === 'string' ? artifact.task_id : null;
                        const details = readArtifactMeta(artifact);
                        return (
                          <div
                            key={`${label}:${index}`}
                            className="rounded-md border border-border/70 bg-background/80 p-3 text-xs"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 space-y-1">
                                {taskId ? (
                                  <Link
                                    className="font-medium text-accent hover:underline"
                                    to={`/work/tasks/${taskId}`}
                                  >
                                    {label}
                                  </Link>
                                ) : (
                                  <div className="font-medium text-foreground">{label}</div>
                                )}
                                {details.length > 0 ? (
                                  <div className="text-muted">{details.join(' • ')}</div>
                                ) : null}
                                {typeof artifact.description === 'string' &&
                                artifact.description.trim().length > 0 ? (
                                  <div className="text-muted">{artifact.description}</div>
                                ) : null}
                              </div>
                              <Badge variant={taskId ? 'outline' : 'secondary'}>
                                {taskId ? 'Step' : 'Reference'}
                              </Badge>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </GatePanel>
                ) : null}
              </div>

              <div className="order-first space-y-4 xl:order-none">
                <GatePanel
                  eyebrow="Recovery lane"
                  title="Next operator move"
                  tone={recoveryPacket.tone}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={recoveryPacket.tone}>{recoveryPacket.title}</Badge>
                    <Badge variant="outline">{decisionSummary}</Badge>
                  </div>
                  <p className="text-sm leading-6 text-muted">{recoveryPacket.summary}</p>
                  <div className="flex flex-wrap gap-2">
                    {permalink ? (
                      <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
                        <Link to={permalink}>Open board gate</Link>
                      </Button>
                    ) : null}
                    {requestedWorkItemPermalink ? (
                      <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
                        <Link to={requestedWorkItemPermalink}>Open work-item flow</Link>
                      </Button>
                    ) : null}
                    {resumePermalink ? (
                      <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
                        <Link to={resumePermalink}>Open follow-up activation</Link>
                      </Button>
                    ) : null}
                    {requestTaskPermalink ? (
                      <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
                        <Link to={requestTaskPermalink}>Open source step diagnostics</Link>
                      </Button>
                    ) : null}
                    {resumeTaskPermalink ? (
                      <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
                        <Link to={resumeTaskPermalink}>Open follow-up step diagnostics</Link>
                      </Button>
                    ) : null}
                  </div>
                  {isAwaitingApproval ? (
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={isActionPending || !gateId}
                        onClick={() => approveMutation.mutate()}
                      >
                        {approveMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle className="h-4 w-4" />
                        )}
                        Approve Gate
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        disabled={isActionPending || !gateId}
                        onClick={() => setIsChangesDialogOpen(true)}
                      >
                        <MessageSquare className="h-4 w-4" />
                        Request Changes
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="w-full"
                        disabled={isActionPending || !gateId}
                        onClick={() => rejectMutation.mutate()}
                      >
                        {rejectMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <XCircle className="h-4 w-4" />
                        )}
                        Reject Gate
                      </Button>
                    </div>
                  ) : null}
                  {(approveMutation.isError || rejectMutation.isError) && (
                    <p className="text-sm text-red-600">Action failed. Please try again.</p>
                  )}
                </GatePanel>

                <GatePanel eyebrow="Timeline" title="Lifecycle trail">
                  <div className="space-y-2 text-sm text-muted">
                    {timelineRows.map((row) => (
                      <div
                        key={row.label}
                        className="flex items-start justify-between gap-3 rounded-md bg-background/70 px-3 py-2"
                      >
                        <span className="font-medium text-foreground">{row.label}</span>
                        <span className="text-right">{row.value}</span>
                      </div>
                    ))}
                  </div>
                </GatePanel>

                <GatePanel eyebrow="Request trace" title="Request source">
                  <p className="text-sm leading-6 text-muted">
                    Keep the decision on the gate or work-item flow first. Use step diagnostics only
                    when you need the source execution evidence behind this review packet.
                  </p>
                  {requestSourceSummary.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {requestSourceSummary.map((item) => (
                        <Badge key={`request:${item}`} variant="outline">
                          {item}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm leading-6 text-muted">
                      This gate already carries the relevant operator context.
                    </p>
                  )}
                  {gate.requested_by_task ? (
                    <div className="space-y-1 text-sm text-muted">
                      {gate.requested_by_task.work_item_title ? (
                        <div>Work item: {gate.requested_by_task.work_item_title}</div>
                      ) : null}
                      <div>
                        Source step: {gate.requested_by_task.title ?? gate.requested_by_task.id}
                        {gate.requested_by_task.role ? ` • ${gate.requested_by_task.role}` : ''}
                      </div>
                    </div>
                  ) : null}
                </GatePanel>

                {decisionAction || decisionFeedback || decisionHistory.length > 0 || resume ? (
                  <GatePanel eyebrow="Decision trail" title="Decision and follow-up">
                    {decisionAction || decisionFeedback ? (
                      <div className="space-y-1 text-sm text-muted">
                        <div className="font-medium text-foreground">Human decision</div>
                        <p>{decisionSummary}</p>
                        {decisionFeedback ? <p>{decisionFeedback}</p> : null}
                      </div>
                    ) : null}
                    {decisionHistory.length > 0 ? (
                      <div className="space-y-2 text-sm text-muted">
                        <div className="font-medium text-foreground">Decision history</div>
                        {decisionHistory.map((entry, index) => (
                          <div key={`${entry.action}:${index}`} className="space-y-1">
                            <p>{entry.summary}</p>
                            {entry.feedback ? <p>{entry.feedback}</p> : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {resume || decisionAction ? (
                      <div className="space-y-2 text-sm text-muted">
                        <div className="font-medium text-foreground">Orchestrator follow-up</div>
                        <p>
                          Keep follow-up triage on the board gate or activation flow first. Use step
                          diagnostics only when you need the underlying specialist trace.
                        </p>
                        <p>{resumptionSummary}</p>
                        {!resume && decisionAction ? (
                          <p>
                            The operator decision is recorded. The orchestrator follow-up activation
                            has not been queued yet.
                          </p>
                        ) : null}
                        {resume?.reason ? <p>{resume.reason}</p> : null}
                        {resume?.summary ? <p>{resume.summary}</p> : null}
                        {resume?.task ? (
                          <div>
                            Follow-up step:{' '}
                            {resumeTaskPermalink ? (
                              <Link
                                className="text-accent hover:underline"
                                to={resumeTaskPermalink}
                              >
                                {resume.task.title ?? resume.task.id}
                              </Link>
                            ) : (
                              (resume.task.title ?? resume.task.id)
                            )}
                            {resume.task.state
                              ? ` • ${resume.task.state.replaceAll('_', ' ')}`
                              : ''}
                          </div>
                        ) : null}
                        {resumeHistoryCount > 1 ? (
                          <p>
                            {resumeHistoryCount} follow-up activations have been recorded for this
                            gate.
                          </p>
                        ) : null}
                        {resume?.error ? (
                          <div className="rounded-md border border-rose-200 bg-rose-50/80 p-3">
                            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-rose-800">
                              Follow-up error details
                            </div>
                            <StructuredRecordView
                              data={resume.error}
                              emptyMessage="No structured error details recorded."
                            />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <GateHandoffTrail gate={gate} />
                  </GatePanel>
                ) : null}

                {detailQuery.isError ? (
                  <GatePanel eyebrow="Recovery" title="Gate refresh failed" tone="destructive">
                    <p className="text-sm leading-6 text-rose-900">
                      The current review packet could not be refreshed. Use the workflow or approval
                      permalink to retry once the gate API is healthy.
                    </p>
                  </GatePanel>
                ) : null}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isChangesDialogOpen} onOpenChange={setIsChangesDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Request Gate Changes</DialogTitle>
            <DialogDescription>
              Provide feedback for &ldquo;{gate.workflow_name ?? workflowId} / {gate.stage_name}
              &rdquo;.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[75vh] gap-4 overflow-y-auto pr-1">
            <Textarea
              placeholder="Describe the changes needed..."
              rows={4}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              className="min-h-[140px]"
            />
            {requestChangesMutation.isError ? (
              <p className="text-sm text-red-600">Failed to submit feedback. Please try again.</p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setIsChangesDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!feedback.trim() || requestChangesMutation.isPending || !gateId}
                onClick={() => requestChangesMutation.mutate(feedback)}
              >
                {requestChangesMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Submit
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function GatePanel(props: {
  eyebrow: string;
  title: string;
  tone?: 'secondary' | 'warning' | 'destructive' | 'success';
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className={readGatePanelClassName(props.tone)}>
      <div className="space-y-1">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          {props.eyebrow}
        </div>
        <h3 className="text-sm font-semibold text-foreground">{props.title}</h3>
      </div>
      <div className="space-y-3">{props.children}</div>
    </section>
  );
}

function GateSignalCard(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="grid gap-1 rounded-xl border border-border/70 bg-background/80 p-3 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
        {props.label}
      </div>
      <div className="text-sm text-foreground">{props.value}</div>
    </div>
  );
}

function readGatePanelClassName(
  tone: 'secondary' | 'warning' | 'destructive' | 'success' = 'secondary',
): string {
  if (tone === 'warning') {
    return 'space-y-3 rounded-xl border border-yellow-200 bg-yellow-50/80 p-4 shadow-sm';
  }
  if (tone === 'destructive') {
    return 'space-y-3 rounded-xl border border-rose-200 bg-rose-50/80 p-4 shadow-sm';
  }
  if (tone === 'success') {
    return 'space-y-3 rounded-xl border border-green-200 bg-green-50/80 p-4 shadow-sm';
  }
  return 'space-y-3 rounded-xl border border-border/70 bg-border/10 p-4 shadow-sm';
}
