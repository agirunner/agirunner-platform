import type { LogEntry } from '../../lib/api.js';
import { describeTaskContextPacketKind } from './execution-inspector-support.filters.js';
import {
  readContextContinuityDescriptor,
  readGovernanceExecutionDescriptor,
} from './execution-inspector-support.descriptors.js';

const INSPECTOR_ACRONYMS: Record<string, string> = {
  api: 'API',
  git: 'Git',
  llm: 'LLM',
  sse: 'SSE',
  ui: 'UI',
};

export function isTaskContextContinuityOperation(operation: string): boolean {
  return describeTaskContextPacketKind(operation) !== null;
}

export function summarizeLogContext(entry: LogEntry): string[] {
  const items: string[] = [];
  if (entry.workflow_name || entry.workflow_id) {
    items.push(`workflow ${entry.workflow_name ?? shortId(entry.workflow_id)}`);
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
  return sentence.length > 0 ? sentence.charAt(0).toUpperCase() + sentence.slice(1) : 'Activity';
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
    return 'Review this warning before it turns into a gate or workflow blocker.';
  }
  if (entry.status === 'started') {
    return 'Track the live activity and confirm the follow-on workflow movement once it settles.';
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

export function levelVariant(
  level: string,
): 'info' | 'secondary' | 'success' | 'warning' | 'destructive' {
  switch (level) {
    case 'debug':
      return 'secondary';
    case 'info':
      return 'info';
    case 'warn':
      return 'warning';
    case 'error':
      return 'destructive';
    default:
      return 'secondary';
  }
}

export function statusVariant(status: string): 'secondary' | 'success' | 'warning' | 'destructive' {
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
    return `Workflow ${entry.workflow_name}`;
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

function containsSignalKeyword(entry: LogEntry, needle: string): boolean {
  const haystacks = [entry.operation, entry.category, entry.resource_type].filter(
    (value): value is string => typeof value === 'string',
  );
  return haystacks.some((value) => value.toLowerCase().includes(needle));
}
