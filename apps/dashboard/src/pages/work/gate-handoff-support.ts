import type { GateIdentityShape } from './gate-detail-support.js';

export interface GateHandoffEntry {
  key: string;
  label: string;
  summary: string;
  detail: string | null;
  timestamp: string | null;
  activation_id: string | null;
  task_id: string | null;
}

interface ResumeHistoryEntry {
  activation_id?: string | null;
  state?: string | null;
  event_type?: string | null;
  reason?: string | null;
  queued_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  summary?: string | null;
  error?: Record<string, unknown> | null;
  latest_event_at?: string | null;
  event_count?: number | null;
  task?: {
    id?: string | null;
    title?: string | null;
    state?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
  } | null;
}

export function buildGateHandoffEntries(gate: GateIdentityShape): GateHandoffEntry[] {
  const entries = [
    buildRequestEntry(gate),
    ...buildDecisionEntries(gate),
    ...buildResumeEntries(gate),
  ];

  return entries
    .filter((entry): entry is GateHandoffEntry => entry !== null)
    .sort((left, right) => compareTimestamps(left.timestamp, right.timestamp));
}

export function readGateResumeTaskSummary(gate: GateIdentityShape): string | null {
  const latestResume = readLatestResume(gate);
  const task = latestResume?.task;
  if (!task?.id) {
    return null;
  }
  const taskTitle = readNonEmpty(task.title) ?? task.id;
  const taskState = readNonEmpty(task.state)?.replaceAll('_', ' ');
  return taskState ? `${taskTitle} • ${taskState}` : taskTitle;
}

function buildRequestEntry(gate: GateIdentityShape): GateHandoffEntry | null {
  const requestSummary = compactParts([
    readNonEmpty(gate.request_summary),
    readNonEmpty(gate.recommendation) ? `Recommendation: ${gate.recommendation}` : null,
    readPacketCounts(gate),
  ]);
  if (!requestSummary) {
    return null;
  }

  return {
    key: 'request',
    label: 'Gate requested',
    summary: requestSummary,
    detail: compactParts([
      readRequestedTaskSummary(gate),
      readConcernSummary(gate.concerns),
    ]),
    timestamp: readNonEmpty(gate.requested_at),
    activation_id: null,
    task_id: readNonEmpty(gate.requested_by_task?.id),
  };
}

function buildDecisionEntries(gate: GateIdentityShape): GateHandoffEntry[] {
  const entries = Array.isArray(gate.decision_history) ? gate.decision_history : [];
  const filtered = entries.filter(
    (entry) => readNonEmpty(entry.action) && readNonEmpty(entry.action) !== 'requested',
  );
  if (filtered.length > 0) {
    return filtered.map((entry, index) => ({
      key: `decision-${index}`,
      label: `Human ${humanizeAction(entry.action ?? 'decision')}`,
      summary: compactParts([
        readActorLabel(entry.actor_type, entry.actor_id),
        readTimeLabel(entry.created_at),
      ]) ?? 'Decision recorded',
      detail: readNonEmpty(entry.feedback),
      timestamp: readNonEmpty(entry.created_at),
      activation_id: null,
      task_id: null,
    }));
  }

  const decisionAction = readNonEmpty(gate.human_decision?.action);
  if (!decisionAction) {
    return [];
  }

  return [{
    key: 'decision-latest',
    label: `Human ${humanizeAction(decisionAction)}`,
    summary:
      compactParts([
        readActorLabel(
          gate.human_decision?.decided_by_type,
          gate.human_decision?.decided_by_id,
        ),
        readTimeLabel(gate.human_decision?.decided_at),
      ])
      ?? 'Decision recorded',
    detail: readNonEmpty(gate.human_decision?.feedback),
    timestamp: readNonEmpty(gate.human_decision?.decided_at),
    activation_id: null,
    task_id: null,
  }];
}

function buildResumeEntries(gate: GateIdentityShape): GateHandoffEntry[] {
  return readResumeHistory(gate).map((resume, index) => ({
    key: `resume-${index}-${resume.activation_id ?? 'pending'}`,
    label: `Orchestrator ${humanizeAction(readNonEmpty(resume.state) ?? 'queued')}`,
    summary:
      compactParts([
        readNonEmpty(resume.activation_id) ? `Activation ${resume.activation_id}` : null,
        readNonEmpty(resume.event_type)?.replaceAll('_', ' '),
        readResumeTaskLabel(resume),
      ])
      ?? 'Follow-up activation recorded',
    detail: compactParts([
      readNonEmpty(resume.summary),
      readNonEmpty(resume.reason),
      readErrorSummary(resume.error),
    ]),
    timestamp: readResumeTimestamp(resume),
    activation_id: readNonEmpty(resume.activation_id),
    task_id: readNonEmpty(resume.task?.id),
  }));
}

function readResumeHistory(gate: GateIdentityShape): ResumeHistoryEntry[] {
  if (Array.isArray(gate.orchestrator_resume_history) && gate.orchestrator_resume_history.length > 0) {
    return gate.orchestrator_resume_history.map((entry) => ({
      ...entry,
      event_count: entry.event_count ?? null,
    }));
  }
  if (!gate.orchestrator_resume) {
    return [];
  }
  return [{
    ...gate.orchestrator_resume,
    event_count: gate.orchestrator_resume.event_count ?? null,
  }];
}

function readLatestResume(gate: GateIdentityShape): ResumeHistoryEntry | null {
  const history = readResumeHistory(gate);
  return history[history.length - 1] ?? null;
}

function readRequestedTaskSummary(gate: GateIdentityShape): string | null {
  const task = gate.requested_by_task;
  if (!task?.id) {
    return readActorLabel(gate.requested_by_type, gate.requested_by_id);
  }
  const taskTitle = readNonEmpty(task.title) ?? task.id;
  const taskRole = readNonEmpty(task.role);
  const workItemTitle = readNonEmpty(task.work_item_title);
  return compactParts([
    workItemTitle ? `Work item ${workItemTitle}` : null,
    taskRole ? `${taskTitle} • ${taskRole}` : taskTitle,
    readActorLabel(gate.requested_by_type, gate.requested_by_id),
  ]);
}

function readResumeTaskLabel(resume: ResumeHistoryEntry): string | null {
  const task = resume.task;
  if (!task?.id) {
    return null;
  }
  const taskTitle = readNonEmpty(task.title) ?? task.id;
  const taskState = readNonEmpty(task.state)?.replaceAll('_', ' ');
  return taskState ? `${taskTitle} • ${taskState}` : taskTitle;
}

function readConcernSummary(concerns: string[] | null | undefined): string | null {
  const count = Array.isArray(concerns) ? concerns.length : 0;
  if (count === 0) {
    return null;
  }
  return `${count} concern${count === 1 ? '' : 's'}`;
}

function readPacketCounts(gate: GateIdentityShape): string | null {
  const concerns = Array.isArray(gate.concerns) ? gate.concerns.length : 0;
  const artifacts = Array.isArray(gate.key_artifacts) ? gate.key_artifacts.length : 0;
  return `${concerns} concern${concerns === 1 ? '' : 's'} • ${artifacts} artifact${artifacts === 1 ? '' : 's'}`;
}

function readActorLabel(type: string | null | undefined, id: string | null | undefined): string | null {
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

function humanizeAction(value: string): string {
  return value.replaceAll('_', ' ');
}

function readResumeTimestamp(resume: ResumeHistoryEntry): string | null {
  return (
    readNonEmpty(resume.completed_at)
    ?? readNonEmpty(resume.started_at)
    ?? readNonEmpty(resume.latest_event_at)
    ?? readNonEmpty(resume.queued_at)
    ?? null
  );
}

function readErrorSummary(error: Record<string, unknown> | null | undefined): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const message = error.message;
  return typeof message === 'string' && message.trim().length > 0 ? message : 'Follow-up error recorded';
}

function readTimeLabel(timestamp: string | null | undefined): string | null {
  const value = readNonEmpty(timestamp);
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleString();
}

function compareTimestamps(left: string | null, right: string | null): number {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return -1;
  }
  if (!right) {
    return 1;
  }
  return new Date(left).getTime() - new Date(right).getTime();
}

function compactParts(parts: Array<string | null | undefined>): string | null {
  const values = parts.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return values.length > 0 ? values.join(' • ') : null;
}

function readNonEmpty(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
