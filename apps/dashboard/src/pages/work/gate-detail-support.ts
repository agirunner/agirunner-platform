export interface GateIdentityShape {
  id?: string | null;
  gate_id?: string | null;
  workflow_id?: string | null;
  workflow_name?: string | null;
  stage_name?: string | null;
  gate_status?: string | null;
  status?: string | null;
  recommendation?: string | null;
  requested_at?: string | null;
  decided_at?: string | null;
  requested_by_type?: string | null;
  requested_by_id?: string | null;
  decided_by_type?: string | null;
  decided_by_id?: string | null;
  human_decision?: {
    action?: 'approve' | 'reject' | 'request_changes' | null;
    feedback?: string | null;
    decided_at?: string | null;
  } | null;
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
  } | null;
  concerns?: string[] | null;
  key_artifacts?: Array<Record<string, unknown>> | null;
}

export function readGateId(gate: GateIdentityShape): string | null {
  const candidate = gate.gate_id ?? gate.id ?? null;
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : null;
}

export function buildWorkflowGatePermalink(workflowId: string, stageName: string): string {
  return `/work/workflows/${workflowId}?gate=${encodeURIComponent(stageName)}#gate-${encodeURIComponent(stageName)}`;
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
    readNonEmpty(gate.workflow_name) ?? readNonEmpty(gate.workflow_id) ?? 'Workflow',
    readNonEmpty(gate.stage_name) ?? 'Stage gate',
  ];
  const workItemTitle = readNonEmpty(gate.requested_by_task?.work_item_title);
  if (workItemTitle) {
    breadcrumbs.push(workItemTitle);
  }
  const taskTitle = readNonEmpty(gate.requested_by_task?.title);
  if (taskTitle) {
    breadcrumbs.push(taskTitle);
  } else {
    const gateId = readGateId(gate);
    breadcrumbs.push(gateId ? `Gate ${gateId}` : 'Gate');
  }
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

export function readGateTimelineRows(gate: GateIdentityShape): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  const requestedBy = readGateActorLabel(gate.requested_by_type, gate.requested_by_id);
  const decidedBy = readGateActorLabel(gate.decided_by_type, gate.decided_by_id);

  rows.push({
    label: 'Requested',
    value: readTimelineValue(gate.requested_at, requestedBy),
  });
  if (gate.decided_at || decidedBy) {
    rows.push({
      label: 'Last decision',
      value: readTimelineValue(gate.decided_at, decidedBy),
    });
  }
  const resumeState = readNonEmpty(gate.orchestrator_resume?.state);
  if (resumeState || gate.orchestrator_resume?.queued_at) {
    rows.push({
      label: 'Orchestrator',
      value: readResumeValue(gate.orchestrator_resume ?? null),
    });
  }
  rows.push({
    label: 'Status',
    value: readGateStatusLabel(gate),
  });
  return rows;
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
      }
    | null,
): string {
  if (!resume) {
    return 'not queued';
  }
  const state = readNonEmpty(resume.state)?.replaceAll('_', ' ') ?? 'queued';
  const time = readTimeLabel(resume.queued_at);
  const activationId = readNonEmpty(resume.activation_id);
  return [state, time, activationId ? `activation ${activationId}` : null].filter(Boolean).join(' • ');
}

function readNonEmpty(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
