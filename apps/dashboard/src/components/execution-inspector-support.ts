import type { LogEntry } from '../lib/api.js';

export type InspectorView = 'raw' | 'summary' | 'detailed' | 'debug';

export interface InspectorFilters {
  search: string;
  workflowId: string;
  taskId: string;
  workItemId: string;
  stageName: string;
  activationId: string;
  level: string;
  operation: string;
  role: string;
  actor: string;
  timeWindowHours: string;
}

export const DEFAULT_INSPECTOR_FILTERS: InspectorFilters = {
  search: '',
  workflowId: '',
  taskId: '',
  workItemId: '',
  stageName: '',
  activationId: '',
  level: 'info',
  operation: '',
  role: '',
  actor: '',
  timeWindowHours: '24',
};

const INSPECTOR_ACRONYMS: Record<string, string> = {
  api: 'API',
  git: 'Git',
  llm: 'LLM',
  qa: 'QA',
  sse: 'SSE',
  ui: 'UI',
};

const FILTER_PARAM_KEYS = {
  search: 'search',
  workflowId: 'workflow',
  taskId: 'task',
  workItemId: 'work_item',
  stageName: 'stage',
  activationId: 'activation',
  level: 'level',
  operation: 'operation',
  role: 'role',
  actor: 'actor',
  timeWindowHours: 'time_window',
} as const;

export function buildLogFilters(
  filters: InspectorFilters,
  extra: Record<string, string> = {},
): Record<string, string> {
  const params: Record<string, string> = { ...extra };
  const since = new Date(Date.now() - Number(filters.timeWindowHours || '24') * 3_600_000);
  params.since = since.toISOString();
  params.until = new Date().toISOString();
  params.level = filters.level;

  setIfPresent(params, 'search', filters.search);
  setIfPresent(params, 'workflow_id', filters.workflowId);
  setIfPresent(params, 'task_id', filters.taskId);
  setIfPresent(params, 'work_item_id', filters.workItemId);
  setIfPresent(params, 'stage_name', filters.stageName);
  setIfPresent(params, 'activation_id', filters.activationId);
  setIfPresent(params, 'operation', filters.operation);
  setIfPresent(params, 'role', filters.role);
  setIfPresent(params, 'actor', filters.actor);
  return params;
}

export function readInspectorFilters(
  searchParams: URLSearchParams,
): InspectorFilters {
  return {
    search: searchParams.get(FILTER_PARAM_KEYS.search) ?? DEFAULT_INSPECTOR_FILTERS.search,
    workflowId:
      searchParams.get(FILTER_PARAM_KEYS.workflowId) ?? DEFAULT_INSPECTOR_FILTERS.workflowId,
    taskId: searchParams.get(FILTER_PARAM_KEYS.taskId) ?? DEFAULT_INSPECTOR_FILTERS.taskId,
    workItemId:
      searchParams.get(FILTER_PARAM_KEYS.workItemId) ?? DEFAULT_INSPECTOR_FILTERS.workItemId,
    stageName:
      searchParams.get(FILTER_PARAM_KEYS.stageName) ?? DEFAULT_INSPECTOR_FILTERS.stageName,
    activationId:
      searchParams.get(FILTER_PARAM_KEYS.activationId) ?? DEFAULT_INSPECTOR_FILTERS.activationId,
    level: searchParams.get(FILTER_PARAM_KEYS.level) ?? DEFAULT_INSPECTOR_FILTERS.level,
    operation:
      searchParams.get(FILTER_PARAM_KEYS.operation) ?? DEFAULT_INSPECTOR_FILTERS.operation,
    role: searchParams.get(FILTER_PARAM_KEYS.role) ?? DEFAULT_INSPECTOR_FILTERS.role,
    actor: searchParams.get(FILTER_PARAM_KEYS.actor) ?? DEFAULT_INSPECTOR_FILTERS.actor,
    timeWindowHours:
      searchParams.get(FILTER_PARAM_KEYS.timeWindowHours) ??
      DEFAULT_INSPECTOR_FILTERS.timeWindowHours,
  };
}

export function writeInspectorFilters(
  searchParams: URLSearchParams,
  filters: InspectorFilters,
): URLSearchParams {
  const next = new URLSearchParams(searchParams);

  setFilterParam(next, FILTER_PARAM_KEYS.search, filters.search);
  setFilterParam(next, FILTER_PARAM_KEYS.workflowId, filters.workflowId);
  setFilterParam(next, FILTER_PARAM_KEYS.taskId, filters.taskId);
  setFilterParam(next, FILTER_PARAM_KEYS.workItemId, filters.workItemId);
  setFilterParam(next, FILTER_PARAM_KEYS.stageName, filters.stageName);
  setFilterParam(next, FILTER_PARAM_KEYS.activationId, filters.activationId);
  setFilterParam(next, FILTER_PARAM_KEYS.operation, filters.operation);
  setFilterParam(next, FILTER_PARAM_KEYS.role, filters.role);
  setFilterParam(next, FILTER_PARAM_KEYS.actor, filters.actor);

  if (filters.level === DEFAULT_INSPECTOR_FILTERS.level) {
    next.delete(FILTER_PARAM_KEYS.level);
  } else {
    next.set(FILTER_PARAM_KEYS.level, filters.level);
  }

  if (filters.timeWindowHours === DEFAULT_INSPECTOR_FILTERS.timeWindowHours) {
    next.delete(FILTER_PARAM_KEYS.timeWindowHours);
  } else {
    next.set(FILTER_PARAM_KEYS.timeWindowHours, filters.timeWindowHours);
  }

  return next;
}

export function readSelectedInspectorLogId(searchParams: URLSearchParams): number | null {
  const raw = searchParams.get('log');
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function readInspectorView(searchParams: URLSearchParams): InspectorView {
  const view = searchParams.get('view');
  return view === 'summary' || view === 'detailed' || view === 'debug' ? view : 'raw';
}

export function describeTaskContextPacketKind(
  operation: string,
): 'attachments' | 'predecessor_handoff' | null {
  if (operation === 'task.context.attachments') {
    return 'attachments';
  }
  if (operation === 'task.context.predecessor_handoff.attach') {
    return 'predecessor_handoff';
  }
  return null;
}

interface GovernanceExecutionDescriptor {
  operationLabel: string;
  contextLabel: string;
  headlineSuffix: string;
  nextAction: string;
  signals: string[];
}

interface ContextContinuityDescriptor {
  operationLabel: string;
  contextLabel: string;
  headlineSuffix: string;
  nextAction: string;
  signals: string[];
}

const GOVERNANCE_EXECUTION_DESCRIPTORS: Record<string, GovernanceExecutionDescriptor> = {
  'task.handoff_submitted': {
    operationLabel: 'Handoff submitted',
    contextLabel: 'Handoff packet',
    headlineSuffix: 'submitted specialist handoff',
    nextAction:
      'Review the handoff summary and successor context before reactivating downstream work.',
    signals: ['Governance', 'Handoff'],
  },
  'task.review_resolution_applied': {
    operationLabel: 'Review resolution applied',
    contextLabel: 'Review resolution packet',
    headlineSuffix: 'applied review resolution',
    nextAction:
      'Confirm the review resolution updated the board state you expected before resuming execution.',
    signals: ['Governance', 'Review'],
  },
  'task.review_resolution_skipped': {
    operationLabel: 'Review resolution skipped',
    contextLabel: 'Review resolution packet',
    headlineSuffix: 'skipped review resolution',
    nextAction:
      'Check why the review resolution was skipped before assuming the board is ready to continue.',
    signals: ['Governance', 'Review'],
  },
  'task.retry_scheduled': {
    operationLabel: 'Retry scheduled',
    contextLabel: 'Retry packet',
    headlineSuffix: 'scheduled retry',
    nextAction:
      'Confirm the retry lane has the right brief, limits, and predecessor context before it reruns.',
    signals: ['Governance', 'Retry'],
  },
  'task.max_rework_exceeded': {
    operationLabel: 'Max rework exceeded',
    contextLabel: 'Rework packet',
    headlineSuffix: 'exceeded rework limit',
    nextAction:
      'Decide whether to escalate, widen the brief, or stop the lane before more rework burns time.',
    signals: ['Governance', 'Rework'],
  },
  'task.escalated': {
    operationLabel: 'Escalated',
    contextLabel: 'Escalation packet',
    headlineSuffix: 'escalated for operator follow-up',
    nextAction:
      'Open the escalation context, resolve the blocker, and record the decision before sending work forward.',
    signals: ['Governance', 'Escalation'],
  },
  'task.agent_escalated': {
    operationLabel: 'Agent escalated',
    contextLabel: 'Escalation packet',
    headlineSuffix: 'escalated to a specialist follow-up lane',
    nextAction:
      'Inspect the specialist escalation target and confirm the follow-up task has enough context to proceed.',
    signals: ['Governance', 'Escalation'],
  },
  'task.escalation_task_created': {
    operationLabel: 'Escalation task created',
    contextLabel: 'Escalation packet',
    headlineSuffix: 'created escalation follow-up',
    nextAction:
      'Inspect the new escalation task and confirm ownership, scope, and urgency.',
    signals: ['Governance', 'Escalation'],
  },
  'task.escalation_response_recorded': {
    operationLabel: 'Escalation response recorded',
    contextLabel: 'Escalation packet',
    headlineSuffix: 'recorded escalation response',
    nextAction:
      'Review the response and confirm the downstream task now has enough direction to continue.',
    signals: ['Governance', 'Escalation'],
  },
  'task.escalation_resolved': {
    operationLabel: 'Escalation resolved',
    contextLabel: 'Escalation packet',
    headlineSuffix: 'resolved escalation',
    nextAction:
      'Confirm the blocked lane is ready to resume and that any required follow-up has been captured.',
    signals: ['Governance', 'Escalation'],
  },
  'task.escalation_depth_exceeded': {
    operationLabel: 'Escalation depth exceeded',
    contextLabel: 'Escalation packet',
    headlineSuffix: 'exceeded escalation depth',
    nextAction: 'Stop automatic escalation chaining and decide the next owner manually.',
    signals: ['Governance', 'Escalation'],
  },
};

const CONTEXT_CONTINUITY_DESCRIPTORS: Record<string, ContextContinuityDescriptor> = {
  'runtime.context.warning': {
    operationLabel: 'Context warning',
    contextLabel: 'Context continuity packet',
    headlineSuffix: 'reported context pressure',
    nextAction:
      'Review durable memory, artifact breadcrumbs, and pending checkpoints before the next compaction boundary.',
    signals: ['Continuity', 'Compaction'],
  },
  'runtime.context.compaction.prepare_started': {
    operationLabel: 'Context compaction prepare started',
    contextLabel: 'Context continuity packet',
    headlineSuffix: 'started context compaction prepare',
    nextAction:
      'Check that durable memory writes and a fresh checkpoint are recorded before more history is compacted.',
    signals: ['Continuity', 'Compaction'],
  },
  'runtime.context.compaction.memory_persisted': {
    operationLabel: 'Context compaction memory persisted',
    contextLabel: 'Context continuity packet',
    headlineSuffix: 'persisted pre-compaction memory',
    nextAction:
      'Confirm the recorded memory keys are durable facts rather than temporary status before the run continues.',
    signals: ['Continuity', 'Compaction'],
  },
  'runtime.context.compaction.checkpoint_written': {
    operationLabel: 'Context compaction checkpoint written',
    contextLabel: 'Context continuity packet',
    headlineSuffix: 'wrote compaction checkpoint',
    nextAction:
      'Inspect the checkpoint ref and make sure it captures the transient continuity you expect to survive compaction.',
    signals: ['Continuity', 'Compaction'],
  },
  'runtime.context.compaction.completed': {
    operationLabel: 'Context compaction completed',
    contextLabel: 'Context continuity packet',
    headlineSuffix: 'compacted specialist context',
    nextAction:
      'Inspect the preserved checkpoint, tokens saved, and recent breadcrumbs before assuming older context is still available.',
    signals: ['Continuity', 'Compaction'],
  },
  'runtime.context.compaction.failed': {
    operationLabel: 'Context compaction failed',
    contextLabel: 'Context continuity packet',
    headlineSuffix: 'failed context compaction',
    nextAction:
      'Review the failure packet, then decide whether the step needs retry or manual recovery before more context pressure builds.',
    signals: ['Continuity', 'Compaction', 'Recovery'],
  },
  'runtime.context.activation_finish.prepare_started': {
    operationLabel: 'Activation finish prepare started',
    contextLabel: 'Activation checkpoint packet',
    headlineSuffix: 'started activation finish prepare',
    nextAction:
      'Check the pending checkpoint and continuity state before the orchestrator yields this activation.',
    signals: ['Continuity', 'Activation checkpoint'],
  },
  'runtime.context.activation_finish.memory_persisted': {
    operationLabel: 'Activation finish memory persisted',
    contextLabel: 'Activation checkpoint packet',
    headlineSuffix: 'persisted durable activation memory',
    nextAction:
      'Confirm the saved memory keys are durable facts that the next activation may need to recover quickly.',
    signals: ['Continuity', 'Activation checkpoint'],
  },
  'runtime.context.activation_finish.continuity_persisted': {
    operationLabel: 'Activation finish continuity persisted',
    contextLabel: 'Activation checkpoint packet',
    headlineSuffix: 'persisted activation continuity',
    nextAction:
      'Review the work-item continuity update before assuming the next activation has enough routing context.',
    signals: ['Continuity', 'Activation checkpoint'],
  },
  'runtime.context.activation_finish.checkpoint_persisted': {
    operationLabel: 'Activation checkpoint persisted',
    contextLabel: 'Activation checkpoint packet',
    headlineSuffix: 'persisted activation checkpoint',
    nextAction:
      'Inspect the checkpoint ref and confirm the next activation can recover the working state from it.',
    signals: ['Continuity', 'Activation checkpoint'],
  },
  'runtime.context.activation_finish.completed': {
    operationLabel: 'Activation finish completed',
    contextLabel: 'Activation checkpoint packet',
    headlineSuffix: 'persisted activation checkpoint',
    nextAction:
      'Confirm the activation checkpoint, continuity update, and durable memory writes before the next orchestrator activation starts.',
    signals: ['Continuity', 'Activation checkpoint'],
  },
  'runtime.context.activation_finish.failed': {
    operationLabel: 'Activation finish failed',
    contextLabel: 'Activation checkpoint packet',
    headlineSuffix: 'failed activation finish persistence',
    nextAction:
      'Review the failed persistence step before trusting the next activation to inherit the current working state.',
    signals: ['Continuity', 'Activation checkpoint', 'Recovery'],
  },
};

export function isTaskContextContinuityOperation(operation: string): boolean {
  return describeTaskContextPacketKind(operation) !== null;
}

export function summarizeLogContext(entry: LogEntry): string[] {
  const items: string[] = [];
  if (entry.workflow_name || entry.workflow_id) {
    items.push(`board ${entry.workflow_name ?? shortId(entry.workflow_id)}`);
  }
  if (entry.task_title || entry.task_id) {
    items.push(`step ${entry.task_title ?? shortId(entry.task_id)}`);
  }
  if (entry.stage_name) {
    items.push(`stage ${entry.stage_name}`);
  }
  if (entry.work_item_id) {
    items.push(`work item ${shortId(entry.work_item_id)}`);
  }
  if (entry.activation_id) {
    items.push(`activation ${shortId(entry.activation_id)}`);
  }
  const packetKind = describeTaskContextPacketKind(entry.operation);
  if (packetKind === 'attachments') {
    items.push('Continuity packet');
  } else if (packetKind === 'predecessor_handoff') {
    items.push('Predecessor handoff packet');
  } else {
    const governanceDescriptor = readGovernanceExecutionDescriptor(entry.operation);
    const continuityDescriptor = readContextContinuityDescriptor(entry.operation);
    if (continuityDescriptor) {
      items.push(continuityDescriptor.contextLabel);
    } else if (governanceDescriptor) {
      items.push(governanceDescriptor.contextLabel);
    }
  }
  return items;
}

export function describeExecutionHeadline(entry: LogEntry): string {
  const packetKind = describeTaskContextPacketKind(entry.operation);
  if (packetKind === 'attachments') {
    return `${readExecutionSubject(entry)} recorded continuity packet`;
  }
  if (packetKind === 'predecessor_handoff') {
    return `${readExecutionSubject(entry)} attached predecessor handoff`;
  }
  const continuityDescriptor = readContextContinuityDescriptor(entry.operation);
  if (continuityDescriptor) {
    return `${readExecutionSubject(entry)} ${continuityDescriptor.headlineSuffix}`;
  }
  const governanceDescriptor = readGovernanceExecutionDescriptor(entry.operation);
  if (governanceDescriptor) {
    return `${readExecutionSubject(entry)} ${governanceDescriptor.headlineSuffix}`;
  }
  const subject = readExecutionSubject(entry);
  const action = describeExecutionOperationLabel(entry.operation);

  if (entry.error?.message || entry.status === 'failed') {
    return `${subject} failed during ${action}`;
  }
  if (entry.status === 'started') {
    return `${subject} started ${action}`;
  }
  if (entry.status === 'completed') {
    return `${subject} completed ${action}`;
  }
  if (entry.status === 'skipped') {
    return `${subject} skipped ${action}`;
  }
  return `${subject} recorded ${action}`;
}

export function describeExecutionSummary(entry: LogEntry): string {
  const scope = summarizeLogContext(entry)
    .filter((item) => !item.startsWith('step ') || !entry.task_title)
    .join(' • ');
  const actor = entry.actor_name ?? `${entry.actor_type}:${entry.actor_id}`;
  const origin = [
    humanizeToken(entry.source),
    humanizeToken(entry.category),
    entry.role ? `role ${entry.role}` : null,
  ]
    .filter((item): item is string => Boolean(item))
    .join(' • ');

  return [scope || null, `Recorded by ${actor}`, origin ? `via ${origin}` : null]
    .filter((item): item is string => Boolean(item))
    .join(' • ');
}

export function describeExecutionOperationLabel(value: string): string {
  const continuityDescriptor = readContextContinuityDescriptor(value);
  if (continuityDescriptor) {
    return continuityDescriptor.operationLabel;
  }
  const governanceDescriptor = readGovernanceExecutionDescriptor(value);
  if (governanceDescriptor) {
    return governanceDescriptor.operationLabel;
  }
  const parts = value
    .split('.')
    .map((part) => humanizeToken(part))
    .filter((part) => part.length > 0);
  const visible = parts.length > 2 ? parts.slice(-2) : parts;
  const sentence = visible.join(' ').trim();
  return sentence.length > 0
    ? sentence.charAt(0).toUpperCase() + sentence.slice(1)
    : 'Activity';
}

export function describeExecutionOperationOption(value: string): string {
  const label = describeExecutionOperationLabel(value);
  if (value.trim().length === 0) {
    return label;
  }
  return `${label} · ${value}`;
}

export function describeExecutionNextAction(entry: LogEntry): string {
  const packetKind = describeTaskContextPacketKind(entry.operation);
  if (packetKind === 'attachments') {
    return 'Review the continuity packet before the next actor resumes the step.';
  }
  if (packetKind === 'predecessor_handoff') {
    return 'Confirm the selected handoff before the step resumes.';
  }
  const continuityDescriptor = readContextContinuityDescriptor(entry.operation);
  if (continuityDescriptor) {
    return continuityDescriptor.nextAction;
  }
  const governanceDescriptor = readGovernanceExecutionDescriptor(entry.operation);
  if (governanceDescriptor) {
    return governanceDescriptor.nextAction;
  }
  if (entry.error?.message || entry.status === 'failed') {
    return 'Review the failure packet, then decide whether to retry, rework, or escalate the affected step.';
  }
  if (entry.level === 'warn') {
    return 'Review this warning before it turns into a gate or board blocker.';
  }
  if (entry.status === 'started') {
    return 'Track the live activity and confirm the follow-on board movement once it settles.';
  }
  if (entry.status === 'skipped') {
    return 'Confirm the skip was intentional before treating the lane as clear.';
  }
  return 'Use diagnostics only if the operator packet leaves unresolved questions.';
}

export function readExecutionSignals(entry: LogEntry): string[] {
  const signals = new Set<string>();
  const packetKind = describeTaskContextPacketKind(entry.operation);
  const continuityDescriptor = readContextContinuityDescriptor(entry.operation);
  const governanceDescriptor = readGovernanceExecutionDescriptor(entry.operation);
  if (packetKind) {
    signals.add('Continuity');
  }
  if (packetKind === 'predecessor_handoff') {
    signals.add('Handoff');
  }
  for (const signal of continuityDescriptor?.signals ?? []) {
    signals.add(signal);
  }
  for (const signal of governanceDescriptor?.signals ?? []) {
    signals.add(signal);
  }
  if (entry.is_orchestrator_task) signals.add('Orchestrator');
  if (entry.activation_id) signals.add('Activation');
  if (entry.work_item_id) signals.add('Work item');
  if (entry.stage_name) signals.add('Stage');
  if (containsSignalKeyword(entry, 'gate')) signals.add('Gate');
  if (containsSignalKeyword(entry, 'escalat')) signals.add('Escalation');
  if (entry.error?.message || entry.status === 'failed') signals.add('Recovery');
  return Array.from(signals).slice(0, 5);
}

export function shortId(value?: string | null): string {
  if (!value) {
    return '-';
  }
  return value.length <= 12 ? value : value.slice(0, 8);
}

export function formatDuration(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return '-';
  }
  if (value < 1_000) {
    return `${Math.round(value)} ms`;
  }
  return `${(value / 1_000).toFixed(2)} s`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function formatCost(value: unknown): string {
  const cost = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isFinite(cost) || cost === 0) {
    return '$0.00';
  }
  return `$${cost.toFixed(4)}`;
}

export function levelVariant(level: string):
  | 'secondary'
  | 'success'
  | 'warning'
  | 'destructive' {
  switch (level) {
    case 'debug':
      return 'secondary';
    case 'info':
      return 'success';
    case 'warn':
      return 'warning';
    case 'error':
      return 'destructive';
    default:
      return 'secondary';
  }
}

export function statusVariant(status: string):
  | 'secondary'
  | 'success'
  | 'warning'
  | 'destructive' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'started':
      return 'secondary';
    case 'skipped':
      return 'warning';
    case 'failed':
      return 'destructive';
    default:
      return 'secondary';
  }
}

export function topGroups<T extends { count: number }>(items: T[], limit = 8): T[] {
  return [...items].sort((left, right) => right.count - left.count).slice(0, limit);
}

function setIfPresent(target: Record<string, string>, key: string, value: string): void {
  const normalized = value.trim();
  if (normalized.length > 0) {
    target[key] = normalized;
  }
}

function setFilterParam(searchParams: URLSearchParams, key: string, value: string): void {
  const normalized = value.trim();
  if (normalized.length === 0) {
    searchParams.delete(key);
    return;
  }
  searchParams.set(key, normalized);
}

function readExecutionSubject(entry: LogEntry): string {
  if (entry.is_orchestrator_task) {
    return 'Orchestrator activity';
  }
  if (entry.task_title) {
    return `Step ${entry.task_title}`;
  }
  if (entry.work_item_id) {
    return `Work item ${shortId(entry.work_item_id)}`;
  }
  if (entry.activation_id) {
    return `Activation ${shortId(entry.activation_id)}`;
  }
  if (entry.workflow_name) {
    return `Board ${entry.workflow_name}`;
  }
  return 'Execution activity';
}

function humanizeToken(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(' ')
    .map((part) => INSPECTOR_ACRONYMS[part.toLowerCase()] ?? part)
    .join(' ');
}

function readGovernanceExecutionDescriptor(
  operation: string,
): GovernanceExecutionDescriptor | null {
  return GOVERNANCE_EXECUTION_DESCRIPTORS[operation] ?? null;
}

function readContextContinuityDescriptor(
  operation: string,
): ContextContinuityDescriptor | null {
  return CONTEXT_CONTINUITY_DESCRIPTORS[operation] ?? null;
}

function containsSignalKeyword(entry: LogEntry, needle: string): boolean {
  const haystacks = [entry.operation, entry.category, entry.resource_type]
    .filter((value): value is string => typeof value === 'string');
  return haystacks.some((value) => value.toLowerCase().includes(needle));
}
