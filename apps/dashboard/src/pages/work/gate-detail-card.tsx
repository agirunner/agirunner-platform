import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle, FileText, Link2, Loader2, MessageSquare, XCircle } from 'lucide-react';

import type { DashboardApprovalStageGateRecord } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { Textarea } from '../../components/ui/textarea.js';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog.js';
import { actOnGate, getGateDetail, type DashboardGateDetailRecord } from './gate-api.js';
import {
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

function computeWaitingTime(updatedAt: string): string {
  const diffMs = Date.now() - new Date(updatedAt).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

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
  const workflowDetailHighlight = new URLSearchParams(location.search).get('gate') === props.gate.stage_name
    || location.hash === `#gate-${props.gate.stage_name}`;
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
      gateId ? queryClient.invalidateQueries({ queryKey: ['workflow-gate', gateId] }) : Promise.resolve(),
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

  const isAwaitingApproval = gate.gate_status === 'awaiting_approval' || gate.status === 'awaiting_approval';
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

  return (
    <>
      <Card
        id={props.source === 'approval-queue' && gateId ? `gate-${gateId}` : undefined}
        data-highlighted={highlighted ? 'true' : 'false'}
        className={highlighted ? 'ring-2 ring-accent/50' : undefined}
      >
        <CardContent className="p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <Badge variant="warning">Stage gate</Badge>
                <Badge variant="outline">{gate.stage_name}</Badge>
                <Badge variant="secondary">Gate ID {gateId ?? 'pending'}</Badge>
                {decisionAction ? (
                  <Badge variant={decisionAction === 'approve' ? 'success' : decisionAction === 'request_changes' ? 'warning' : 'destructive'}>
                    {readDecisionLabel(decisionAction)}
                  </Badge>
                ) : null}
                {resume?.state ? (
                  <Badge variant="outline">orchestrator {resume.state.replaceAll('_', ' ')}</Badge>
                ) : decisionAction ? (
                  <Badge variant="outline">awaiting orchestrator follow-up</Badge>
                ) : null}
                <span>Waiting {computeWaitingTime(gate.updated_at)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-muted">
                <span>Operator breadcrumbs</span>
                <span className="normal-case">{breadcrumbs.join(' / ')}</span>
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
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={`/work/workflows/${workflowId}`}
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
              <p className="text-sm">{gate.stage_goal?.trim() || 'No gate goal recorded.'}</p>
              <div className="grid gap-3 pt-1 md:grid-cols-2">
                <div className="rounded-md border bg-border/10 p-3">
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                    Review packet
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted">
                    {packetSummary.map((item) => (
                      <Badge key={item} variant="secondary">
                        {item}
                      </Badge>
                    ))}
                  </div>
                  {gate.request_summary ? (
                    <p className="mt-2 text-xs text-muted">{gate.request_summary}</p>
                  ) : null}
                </div>
                <div className="rounded-md border bg-border/10 p-3">
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                    Lifecycle trail
                  </div>
                  <div className="space-y-1 text-xs text-muted">
                    {timelineRows.map((row) => (
                      <div key={row.label} className="flex items-start justify-between gap-3">
                        <span>{row.label}</span>
                        <span className="text-right">{row.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {gate.requested_by_task ? (
                <div className="rounded-md border bg-border/10 p-3">
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                    Request source
                  </div>
                  <div className="space-y-1 text-xs text-muted">
                    {gate.requested_by_task.work_item_title ? (
                      <div>
                        Work item:{' '}
                        {requestedWorkItemPermalink ? (
                          <Link className="text-accent hover:underline" to={requestedWorkItemPermalink}>
                            {gate.requested_by_task.work_item_title}
                          </Link>
                        ) : (
                          gate.requested_by_task.work_item_title
                        )}
                      </div>
                    ) : null}
                    <div>
                      Step:{' '}
                      <Link className="text-accent hover:underline" to={`/work/tasks/${gate.requested_by_task.id}`}>
                        {gate.requested_by_task.title ?? gate.requested_by_task.id}
                      </Link>
                      {gate.requested_by_task.role ? ` • ${gate.requested_by_task.role}` : ''}
                    </div>
                    {requestSourceSummary.length > 0 ? (
                      <div>{requestSourceSummary.join(' • ')}</div>
                    ) : null}
                    {requestedWorkItemPermalink ? (
                      <div>
                        <Link className="text-accent hover:underline" to={requestedWorkItemPermalink}>
                          Open work-item flow
                        </Link>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {gate.summary ? (
                <div className="mt-2 rounded-md border bg-border/10 p-3">
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                    Gate summary
                  </div>
                  <p className="text-xs text-muted">{gate.summary}</p>
                </div>
              ) : null}
              <div className="grid gap-3 pt-1 md:grid-cols-2">
                <div className="rounded-md border bg-border/10 p-3">
                  <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                    <CheckCircle className="h-3.5 w-3.5" />
                    Recommendation
                  </div>
                  <p className="text-xs text-muted">
                    {gate.recommendation?.trim() || 'No orchestrator recommendation recorded.'}
                  </p>
                </div>
                <div className="rounded-md border bg-border/10 p-3">
                  <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Concerns
                  </div>
                  {gate.concerns.length > 0 ? (
                    <ul className="space-y-1 text-xs text-muted">
                      {gate.concerns.map((concern, index) => (
                        <li key={`${concern}:${index}`}>• {concern}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted">No explicit concerns recorded.</p>
                  )}
                </div>
              </div>
              {decisionAction || decisionFeedback ? (
                <div className="rounded-md border bg-border/10 p-3 text-xs text-muted">
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                    Human decision
                  </div>
                  <p>{decisionSummary}</p>
                  {decisionFeedback ? <p className="mt-1">{decisionFeedback}</p> : null}
                </div>
              ) : null}
              {decisionHistory.length > 0 ? (
                <div className="rounded-md border bg-border/10 p-3 text-xs text-muted">
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                    Decision history
                  </div>
                  <div className="space-y-2">
                    {decisionHistory.map((entry, index) => (
                      <div key={`${entry.action}:${index}`} className="space-y-1">
                        <p>{entry.summary}</p>
                        {entry.feedback ? <p>{entry.feedback}</p> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {resume || decisionAction ? (
                <div className="rounded-md border bg-border/10 p-3 text-xs text-muted">
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                    Orchestrator follow-up
                  </div>
                  <div className="space-y-1">
                    <p>{resumptionSummary}</p>
                    {!resume && decisionAction ? (
                      <p>The operator decision is recorded. The orchestrator follow-up activation has not been queued yet.</p>
                    ) : null}
                    {resume?.reason ? <p>{resume.reason}</p> : null}
                    {resume?.summary ? <p>{resume.summary}</p> : null}
                    {resumePermalink ? (
                      <div>
                        <Link className="text-accent hover:underline" to={resumePermalink}>
                          Open follow-up activation
                        </Link>
                      </div>
                    ) : null}
                    {resume?.error ? (
                      <p className="text-red-600">{JSON.stringify(resume.error)}</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {gate.key_artifacts.length > 0 ? (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                    <FileText className="h-3.5 w-3.5" />
                    Key artifacts
                  </div>
                  <div className="grid gap-2">
                    {gate.key_artifacts.map((artifact, index) => {
                      const label = readArtifactLabel(artifact, index);
                      const taskId = typeof artifact.task_id === 'string' ? artifact.task_id : null;
                      const details = readArtifactMeta(artifact);
                      return (
                        <div key={`${label}:${index}`} className="rounded-md border bg-border/10 p-3 text-xs">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1">
                              {taskId ? (
                                <Link className="font-medium text-accent hover:underline" to={`/work/tasks/${taskId}`}>
                                  {label}
                                </Link>
                              ) : (
                                <div className="font-medium text-foreground">{label}</div>
                              )}
                              {details.length > 0 ? <div className="text-muted">{details.join(' • ')}</div> : null}
                              {typeof artifact.description === 'string' && artifact.description.trim().length > 0 ? (
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
                </div>
              ) : null}
              {detailQuery.isError ? (
                <p className="text-xs text-red-600">Failed to refresh gate detail.</p>
              ) : null}
            </div>
            {isAwaitingApproval ? (
              <div className="flex shrink-0 gap-2">
                <Button size="sm" disabled={isActionPending || !gateId} onClick={() => approveMutation.mutate()}>
                  {approveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  Approve Gate
                </Button>
                <Button variant="outline" size="sm" disabled={isActionPending || !gateId} onClick={() => setIsChangesDialogOpen(true)}>
                  <MessageSquare className="h-4 w-4" />
                  Request Changes
                </Button>
                <Button variant="destructive" size="sm" disabled={isActionPending || !gateId} onClick={() => rejectMutation.mutate()}>
                  {rejectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                  Reject Gate
                </Button>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Dialog open={isChangesDialogOpen} onOpenChange={setIsChangesDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Gate Changes</DialogTitle>
            <DialogDescription>
              Provide feedback for &ldquo;{gate.workflow_name ?? workflowId} / {gate.stage_name}&rdquo;.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              placeholder="Describe the changes needed..."
              rows={4}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
            />
            {requestChangesMutation.isError ? (
              <p className="text-sm text-red-600">Failed to submit feedback. Please try again.</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsChangesDialogOpen(false)}>
                Cancel
              </Button>
              <Button disabled={!feedback.trim() || requestChangesMutation.isPending || !gateId} onClick={() => requestChangesMutation.mutate(feedback)}>
                {requestChangesMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Submit
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
