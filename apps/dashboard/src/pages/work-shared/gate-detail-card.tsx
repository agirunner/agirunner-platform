import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, Link2, Loader2, MessageSquare, XCircle } from 'lucide-react';

import { StructuredRecordView } from '../../components/structured-data/structured-data.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { actOnGate, getGateDetail, type DashboardGateDetailRecord } from './gate-api.js';
import {
  computeWaitingTime,
  GateArtifactsPanel,
  GatePanel,
  GateRequestChangesDialog,
  GateRequestSourcePanel,
  GateSignalCard,
  GateTimelinePanel,
  readDecisionLabel,
} from './gate-detail-card.sections.js';
import { GateHandoffTrail } from './gate-handoff-trail.js';
import { OperatorBreadcrumbTrail } from './operator-breadcrumb-trail.js';
import {
  buildGateRecoveryPacket,
  buildGateBreadcrumbs,
  buildWorkflowGatePermalink,
  readGateDecisionSummary,
  readGateDecisionHistory,
  readGatePacketSummary,
  readGateRequestSourceSummary,
  readGateResumptionSummary,
  readGateTimelineRows,
  readGateId,
} from './gate-detail-support.js';
import { buildWorkflowDetailPermalink } from '../workflow-detail/workflow-detail-permalinks.js';
import { buildTaskDetailHref } from './work-href-support.js';

export function GateDetailCard(props: { gate: DashboardGateDetailRecord }) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [isChangesDialogOpen, setIsChangesDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const gateId = readGateId(props.gate as unknown as Record<string, unknown>);
  const workflowId = props.gate.workflow_id;
  const permalink = buildWorkflowGatePermalink(workflowId, props.gate.stage_name);
  const workflowDetailHighlight =
    new URLSearchParams(location.search).get('gate') === props.gate.stage_name ||
    location.hash === `#gate-${props.gate.stage_name}`;
  const highlighted = workflowDetailHighlight;

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
  const breadcrumbs = buildGateBreadcrumbs(gate).map((label) => ({ label }));
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
    ? buildTaskDetailHref(gate.requested_by_task.id)
    : null;
  const resumeTaskPermalink = resume?.task?.id ? buildTaskDetailHref(resume.task.id) : null;

  return (
    <>
      <Card
        data-highlighted={highlighted ? 'true' : 'false'}
        className={highlighted ? 'ring-2 ring-accent/50' : undefined}
      >
        <CardContent className="p-5">
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <Badge variant="warning">Stage gate</Badge>
                <Badge variant="outline">{gate.stage_name}</Badge>
                <Badge variant={gate.closure_effect === 'advisory' ? 'secondary' : 'destructive'}>
                  {gate.closure_effect === 'advisory' ? 'Advisory gate' : 'Blocking gate'}
                </Badge>
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
                  to={permalink ?? buildWorkflowDetailPermalink(workflowId, {})}
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
                <GatePanel eyebrow="Decision focus" title="Gate decision packet">
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
                      Inspect the linked concerns, artifacts, and decision trail before acting.
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

                <GateArtifactsPanel gate={gate} />
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

                <GateTimelinePanel timelineRows={timelineRows} />

                <GateRequestSourcePanel
                  gate={gate}
                  requestSourceSummary={requestSourceSummary}
                />

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
                       The current decision packet could not be refreshed. Use the workflow or approval
                       permalink to retry once the gate API is healthy.
                    </p>
                  </GatePanel>
                ) : null}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <GateRequestChangesDialog
        isOpen={isChangesDialogOpen}
        workflowLabel={gate.workflow_name ?? workflowId}
        stageName={gate.stage_name}
        feedback={feedback}
        isPending={requestChangesMutation.isPending}
        isError={requestChangesMutation.isError}
        canSubmit={Boolean(feedback.trim() && gateId)}
        onOpenChange={setIsChangesDialogOpen}
        onFeedbackChange={setFeedback}
        onSubmit={() => requestChangesMutation.mutate(feedback)}
      />
    </>
  );
}
