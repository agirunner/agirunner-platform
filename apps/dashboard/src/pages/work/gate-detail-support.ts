export interface GateIdentityShape {
  id?: string | null;
  gate_id?: string | null;
  workflow_id?: string | null;
  workflow_name?: string | null;
  stage_name?: string | null;
  gate_status?: string | null;
  status?: string | null;
  request_summary?: string | null;
  summary?: string | null;
  recommendation?: string | null;
  requested_at?: string | null;
  decided_at?: string | null;
  requested_by_type?: string | null;
  requested_by_id?: string | null;
  decided_by_type?: string | null;
  decided_by_id?: string | null;
  human_decision?: {
    action?: 'approve' | 'reject' | 'request_changes' | null;
    decided_by_type?: string | null;
    decided_by_id?: string | null;
    feedback?: string | null;
    decided_at?: string | null;
  } | null;
  decision_history?: Array<{
    action?: string | null;
    actor_type?: string | null;
    actor_id?: string | null;
    feedback?: string | null;
    created_at?: string | null;
  }> | null;
  requested_by_task?: {
    id?: string | null;
    title?: string | null;
    role?: string | null;
    work_item_id?: string | null;
    work_item_title?: string | null;
  } | null;
  orchestrator_resume?: {
    activation_id?: string | null;
    state?: string | null;
    event_type?: string | null;
    reason?: string | null;
    queued_at?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
    latest_event_at?: string | null;
    event_count?: number | null;
    summary?: string | null;
    error?: Record<string, unknown> | null;
    task?: {
      id?: string | null;
      title?: string | null;
      state?: string | null;
      started_at?: string | null;
      completed_at?: string | null;
    } | null;
  } | null;
  orchestrator_resume_history?: Array<{
    activation_id?: string | null;
    state?: string | null;
    event_type?: string | null;
    reason?: string | null;
    queued_at?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
    latest_event_at?: string | null;
    event_count?: number | null;
    summary?: string | null;
    error?: Record<string, unknown> | null;
    task?: {
      id?: string | null;
      title?: string | null;
      state?: string | null;
      started_at?: string | null;
      completed_at?: string | null;
    } | null;
  }> | null;
  concerns?: string[] | null;
  key_artifacts?: Array<Record<string, unknown>> | null;
}

export function readGateId(gate: GateIdentityShape): string | null {
  const candidate = gate.gate_id ?? gate.id ?? null;
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : null;
}

export function buildWorkflowGatePermalink(workflowId: string, stageName: string): string {
  return `/work/boards/${workflowId}?gate=${encodeURIComponent(stageName)}#gate-${encodeURIComponent(stageName)}`;
}

export function buildApprovalQueueGatePermalink(gateId: string): string {
  return `/work/approvals?gate=${encodeURIComponent(gateId)}#gate-${encodeURIComponent(gateId)}`;
}

export function isGateHighlighted(search: string, hash: string, gateId: string | null): boolean {
  if (!gateId) {
    return false;
  }
  const params = new URLSearchParams(search);
  if (params.get('gate') === gateId) {
    return true;
  }
  return hash === `#gate-${gateId}`;
}

export function buildGateBreadcrumbs(gate: GateIdentityShape): string[] {
  const breadcrumbs = [
    `Board: ${readNonEmpty(gate.workflow_name) ?? readNonEmpty(gate.workflow_id) ?? 'Workflow'}`,
    `Stage: ${readNonEmpty(gate.stage_name) ?? 'Stage gate'}`,
  ];
  const workItemTitle = readNonEmpty(gate.requested_by_task?.work_item_title);
  if (workItemTitle) {
    breadcrumbs.push(`Work item: ${workItemTitle}`);
  }
  const taskTitle = readNonEmpty(gate.requested_by_task?.title);
  const taskRole = readNonEmpty(gate.requested_by_task?.role);
  if (taskTitle) {
    breadcrumbs.push(taskRole ? `Step: ${taskTitle} • ${taskRole}` : `Step: ${taskTitle}`);
  }
  const gateId = readGateId(gate);
  breadcrumbs.push(gateId ? `Gate: ${gateId}` : 'Gate');
  return breadcrumbs;
}

export function readGateStatusLabel(gate: GateIdentityShape): string {
  const status = readNonEmpty(gate.gate_status) ?? readNonEmpty(gate.status) ?? 'pending';
  return status.replaceAll('_', ' ');
}

export function readGatePacketSummary(gate: GateIdentityShape): string[] {
  const concerns = Array.isArray(gate.concerns) ? gate.concerns.length : 0;
  const artifacts = Array.isArray(gate.key_artifacts) ? gate.key_artifacts.length : 0;
  const summary = [
    `${concerns} concern${concerns === 1 ? '' : 's'}`,
    `${artifacts} artifact${artifacts === 1 ? '' : 's'}`,
  ];
  const recommendation = readNonEmpty(gate.recommendation);
  if (recommendation) {
    summary.push(`recommendation: ${recommendation}`);
  }
  const decision = readNonEmpty(gate.human_decision?.action);
  if (decision) {
    summary.push(`decision: ${decision.replaceAll('_', ' ')}`);
  }
  return summary;
}

export function readGateRequestSourceSummary(gate: GateIdentityShape): string[] {
  const summary: string[] = [];
  const workItemTitle = readNonEmpty(gate.requested_by_task?.work_item_title);
  if (workItemTitle) {
    summary.push(`work item: ${workItemTitle}`);
  }
  const taskLabel = readNonEmpty(gate.requested_by_task?.title) ?? readNonEmpty(gate.requested_by_task?.id);
  const taskRole = readNonEmpty(gate.requested_by_task?.role);
  if (taskLabel) {
    summary.push(taskRole ? `step: ${taskLabel} • ${taskRole}` : `step: ${taskLabel}`);
  }
  const actor = readGateActorLabel(gate.requested_by_type, gate.requested_by_id);
  if (actor) {
    summary.push(`requested by ${actor}`);
  }
  return summary;
}

export function readGateDecisionSummary(gate: GateIdentityShape): string {
  const action = readNonEmpty(gate.human_decision?.action);
  if (!action) {
    return 'Pending operator decision';
  }
  const actor = readGateActorLabel(
    gate.human_decision?.decided_by_type ?? gate.decided_by_type,
    gate.human_decision?.decided_by_id ?? gate.decided_by_id,
  );
  const when = readTimeLabel(gate.human_decision?.decided_at ?? gate.decided_at);
  return [
    action.replaceAll('_', ' '),
    actor ? `by ${actor}` : null,
    when ? `at ${when}` : null,
  ].filter(Boolean).join(' ');
}

export function readGateResumptionSummary(gate: GateIdentityShape): string {
  const resume = gate.orchestrator_resume ?? null;
  if (resume) {
    const state = readNonEmpty(resume.state)?.replaceAll('_', ' ') ?? 'queued';
    const eventType = readNonEmpty(resume.event_type)?.replaceAll('_', ' ');
    const activationId = readNonEmpty(resume.activation_id);
    const task = readResumeTaskLabel(resume);
    const timing = readResumeTimingSummary(resume);
    return [
      state,
      eventType,
      activationId ? `activation ${activationId}` : null,
      task,
      timing,
    ].filter(Boolean).join(' • ');
  }
  if (readNonEmpty(gate.human_decision?.action)) {
    return 'Decision recorded • follow-up activation not visible yet';
  }
  return 'Follow-up not queued';
}

export function readGateTimelineRows(gate: GateIdentityShape): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  const requestedBy = readGateActorLabel(gate.requested_by_type, gate.requested_by_id);
  const decidedBy = readGateActorLabel(gate.decided_by_type, gate.decided_by_id);

  rows.push({
    label: 'Requested',
    value: readTimelineValue(gate.requested_at, requestedBy),
  });
  const requestSource = readGateRequestSourceValue(gate);
  if (requestSource) {
    rows.push({
      label: 'Request source',
      value: requestSource,
    });
  }
  if (gate.decided_at || decidedBy) {
    rows.push({
      label: 'Last decision',
      value: readTimelineValue(gate.decided_at, decidedBy),
    });
  }
  const resumeState = readNonEmpty(gate.orchestrator_resume?.state);
  if (resumeState || gate.orchestrator_resume?.queued_at) {
    rows.push({
      label: 'Orchestrator follow-up',
      value: readResumeValue(gate.orchestrator_resume ?? null),
    });
  }
  const activationId = readNonEmpty(gate.orchestrator_resume?.activation_id);
  if (activationId) {
    rows.push({
      label: 'Activation',
      value: activationId,
    });
  }
  const resumeTask = readResumeTaskLabel(gate.orchestrator_resume ?? null);
  if (resumeTask) {
    rows.push({
      label: 'Orchestrator task',
      value: resumeTask,
    });
  }
  rows.push({
    label: 'Status',
    value: readGateStatusLabel(gate),
  });
  return rows;
}

export function readGateDecisionHistory(
  gate: GateIdentityShape,
): Array<{ action: string; summary: string; feedback: string | null }> {
  const entries = Array.isArray(gate.decision_history) ? gate.decision_history : [];
  return entries
    .filter((entry) => Boolean(readNonEmpty(entry.action)))
    .map((entry) => {
      const action = readNonEmpty(entry.action) ?? 'unknown';
      const actor = readGateActorLabel(entry.actor_type, entry.actor_id);
      const when = readTimeLabel(entry.created_at);
      return {
        action,
        summary: [
          action.replaceAll('_', ' '),
          actor ? `by ${actor}` : null,
          when ? `at ${when}` : null,
        ]
          .filter(Boolean)
          .join(' '),
        feedback: readNonEmpty(entry.feedback),
      };
    });
}

function readTimelineValue(timestamp: string | null | undefined, actor: string | null): string {
  const parts = [readTimeLabel(timestamp), actor].filter(Boolean);
  return parts.join(' by ');
}

function readTimeLabel(timestamp: string | null | undefined): string | null {
  if (!timestamp) {
    return null;
  }
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleString();
}

function readGateActorLabel(type: string | null | undefined, id: string | null | undefined): string | null {
  const actorType = readNonEmpty(type);
  const actorId = readNonEmpty(id);
  if (!actorType && !actorId) {
    return null;
  }
  if (!actorType) {
    return actorId;
  }
  if (!actorId) {
    return actorType;
  }
  return `${actorType}:${actorId}`;
}

function readResumeValue(
  resume:
    | {
        activation_id?: string | null;
        state?: string | null;
        queued_at?: string | null;
        started_at?: string | null;
        completed_at?: string | null;
      }
    | null,
): string {
  if (!resume) {
    return 'not queued';
  }
  const state = readNonEmpty(resume.state)?.replaceAll('_', ' ') ?? 'queued';
  const activationId = readNonEmpty(resume.activation_id);
  const timing = readResumeTimingSummary(resume);
  return [state, activationId ? `activation ${activationId}` : null, timing].filter(Boolean).join(' • ');
}

function readResumeTimingSummary(
  resume: {
    queued_at?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
    latest_event_at?: string | null;
  },
): string | null {
  const completed = readTimeLabel(resume.completed_at);
  if (completed) {
    return `completed ${completed}`;
  }
  const started = readTimeLabel(resume.started_at);
  if (started) {
    return `started ${started}`;
  }
  const queued = readTimeLabel(resume.queued_at);
  if (queued) {
    return `queued ${queued}`;
  }
  const latest = readTimeLabel(resume.latest_event_at);
  if (latest) {
    return `latest event ${latest}`;
  }
  return null;
}

function readGateRequestSourceValue(gate: GateIdentityShape): string | null {
  const workItemTitle = readNonEmpty(gate.requested_by_task?.work_item_title);
  const taskTitle = readNonEmpty(gate.requested_by_task?.title);
  const taskRole = readNonEmpty(gate.requested_by_task?.role);
  const actor = readGateActorLabel(gate.requested_by_type, gate.requested_by_id);
  return [
    workItemTitle ? `work item ${workItemTitle}` : null,
    taskTitle ? (taskRole ? `${taskTitle} • ${taskRole}` : taskTitle) : null,
    actor ? `requested by ${actor}` : null,
  ].filter(Boolean).join(' • ') || null;
}

function readNonEmpty(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readResumeTaskLabel(
  resume:
    | {
        task?: {
          id?: string | null;
          title?: string | null;
          state?: string | null;
        } | null;
      }
    | null,
): string | null {
  const taskId = readNonEmpty(resume?.task?.id);
  if (!taskId) {
    return null;
  }
  const taskTitle = readNonEmpty(resume?.task?.title) ?? taskId;
  const taskState = readNonEmpty(resume?.task?.state)?.replaceAll('_', ' ');
  return taskState ? `${taskTitle} • ${taskState}` : taskTitle;
}
