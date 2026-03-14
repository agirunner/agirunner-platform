import type { DashboardEventRecord } from '../lib/api.js';
import type { DashboardPacketFact } from './workflow-detail-support.js';
import type { TimelineDescriptor } from './workflow-history-card.narrative.js';
import { buildBudgetSummary, capitalizeToken, humanizeToken, readString, readStringArray } from './workflow-history-card.narrative.helpers.js';
import { describeReviewPacket, type ReviewPacketDescriptor } from './workflow-detail-presentation.js';

export interface TimelineEventPacketDescriptor extends ReviewPacketDescriptor {
  disclosureLabel: string;
  facts: DashboardPacketFact[];
}

const SUPPRESSED_KEYS = new Set([
  'activation_id', 'actor_id', 'actor_type', 'assigned_role', 'child_workflow_id',
  'child_workflow_name', 'column_id', 'dimensions', 'entity_id', 'entity_type',
  'parent_work_item_id', 'stage_id', 'stage_name', 'task_id', 'task_title',
  'to_column_id', 'work_item_id', 'work_item_title', 'workflow_id',
]);

const CURATED_LABELS: Record<string, string> = {
  column_label: 'Column',
  cost_limit_usd: 'Cost limit',
  cost_usd: 'Current cost',
  duration_limit_minutes: 'Duration limit',
  elapsed_minutes: 'Elapsed',
  error: 'Error detail',
  feedback: 'Feedback',
  from_column_label: 'Previous column',
  from_state: 'Previous state',
  goal: 'Goal',
  message: 'Detail',
  notes: 'Notes',
  outcome: 'Outcome',
  parent_work_item_title: 'Parent item',
  playbook_name: 'Playbook',
  policy_name: 'Policy name',
  priority: 'Priority',
  reason: 'Reason',
  recommendation: 'Recommendation',
  request_summary: 'Review summary',
  role: 'Specialist role',
  severity: 'Severity',
  state: 'State',
  summary: 'Summary',
  title: 'Title',
  to_column_label: 'Destination column',
  to_state: 'New state',
  tokens_limit: 'Token limit',
  tokens_used: 'Tokens used',
};

const PROMOTED_FIELDS: Record<string, Array<{ key: string; label: string }>> = {
  'child_workflow.completed': [{ key: 'playbook_name', label: 'Playbook' }],
  'child_workflow.failed': [{ key: 'playbook_name', label: 'Playbook' }],
  'task.completed': [{ key: 'role', label: 'Specialist role' }],
  'task.created': [{ key: 'goal', label: 'Step goal' }],
  'task.escalated': [{ key: 'role', label: 'Specialist role' }, { key: 'severity', label: 'Severity' }],
  'task.failed': [{ key: 'role', label: 'Specialist role' }],
  'work_item.created': [{ key: 'priority', label: 'Priority' }],
  'work_item.moved': [{ key: 'from_column_label', label: 'Previous column' }],
  'work_item.updated': [{ key: 'priority', label: 'Priority' }],
  'workflow.state_changed': [{ key: 'from_state', label: 'Previous state' }, { key: 'to_state', label: 'New state' }],
};

export function describeTimelineEventPacket(
  event: DashboardEventRecord,
  descriptor: TimelineDescriptor,
): TimelineEventPacketDescriptor {
  const fallback = describeReviewPacket(event.data, 'interaction packet');
  if (isActivationEvent(event.type)) return withStructuredDetail(buildActivationPacket(event, descriptor), fallback);
  if (event.type.startsWith('work_item.')) return withStructuredDetail(buildWorkItemPacket(event, descriptor), fallback);
  if (event.type.startsWith('task.')) return withStructuredDetail(buildTaskPacket(event, descriptor), fallback);
  if (event.type === 'stage.gate_requested' || event.type.startsWith('stage.gate.')) return withStructuredDetail(buildGatePacket(event, descriptor), fallback);
  if (event.type.startsWith('budget.')) return withStructuredDetail(buildBudgetPacket(event, descriptor), fallback);
  return {
    ...fallback,
    typeLabel: descriptor.emphasisLabel,
    summary: descriptor.outcomeLabel ?? descriptor.summary ?? descriptor.headline,
    detail: descriptor.scopeSummary ?? fallback.detail,
    badges: descriptor.signalBadges.length > 0 ? descriptor.signalBadges : fallback.badges,
    facts: curatePacketFacts(event.type, event.data, 4),
    disclosureLabel: 'Open full interaction packet',
  };
}

export function curatePacketFacts(eventType: string, data: unknown, limit = 4): DashboardPacketFact[] {
  const record = asRecord(data);
  const facts: DashboardPacketFact[] = [];
  const consumed = new Set<string>();
  for (const field of PROMOTED_FIELDS[eventType] ?? []) {
    if (facts.length >= limit) return facts;
    const value = record[field.key];
    if (isPresentableScalar(value)) {
      facts.push({ label: field.label, value: formatFactValue(value) });
      consumed.add(field.key);
    }
  }
  for (const key of Object.keys(record).filter((entry) => !consumed.has(entry) && !SUPPRESSED_KEYS.has(entry) && isPresentableScalar(record[entry])).sort((left, right) => left.localeCompare(right))) {
    if (facts.length >= limit) break;
    facts.push({ label: CURATED_LABELS[key] ?? humanizeFieldKey(key), value: formatFactValue(record[key]) });
  }
  return facts;
}

function buildActivationPacket(event: DashboardEventRecord, descriptor: TimelineDescriptor): Omit<TimelineEventPacketDescriptor, 'hasStructuredDetail'> {
  const reason = readString(event.data?.reason);
  const source = readString(event.data?.source);
  return {
    typeLabel: 'Activation',
    summary:
      event.type === 'workflow.activation_started'
        ? descriptor.activationId
          ? `Activation ${descriptor.activationId} is processing the queued board activity.`
          : 'The orchestrator is actively processing queued board activity.'
        : event.type === 'operator.manual_enqueue'
          ? 'An operator manually queued a fresh orchestrator wake-up.'
          : 'A wake-up is queued so the orchestrator can process pending board activity.',
    detail:
      reason
      ?? (source ? `Queued from ${humanizeToken(source)}.` : null)
      ?? descriptor.scopeSummary
      ?? 'Keep this activation packet available until the queued board activity is resolved.',
    badges: buildBadges(descriptor, event),
    facts: buildFacts([
      descriptor.activationId ? { label: 'Activation', value: descriptor.activationId } : null,
      source ? { label: 'Trigger', value: humanizeToken(source) } : null,
      descriptor.stageName ? { label: 'Stage', value: descriptor.stageName } : null,
      descriptor.objectLabel ? { label: 'Scope', value: descriptor.objectLabel } : null,
    ]),
    disclosureLabel: 'Open full activation packet',
  };
}

function buildWorkItemPacket(event: DashboardEventRecord, descriptor: TimelineDescriptor): Omit<TimelineEventPacketDescriptor, 'hasStructuredDetail'> {
  const columnLabel = readString(event.data?.to_column_label) ?? readString(event.data?.column_label) ?? readString(event.data?.to_column_id) ?? readString(event.data?.column_id);
  return {
    typeLabel: 'Work item',
    summary: ({
      'work_item.created': `${descriptor.objectLabel ?? 'Work item'} is now part of this board run.`,
      'work_item.updated': `${descriptor.objectLabel ?? 'Work item'} was refreshed for downstream execution.`,
      'work_item.moved': `${descriptor.objectLabel ?? 'Work item'} changed board placement.`,
      'work_item.reparented': `${descriptor.objectLabel ?? 'Work item'} now rolls up under a different milestone.`,
      'work_item.completed': `${descriptor.objectLabel ?? 'Work item'} completed its assigned board work.`,
    })[event.type] ?? `${descriptor.objectLabel ?? 'Work item'} changed.`,
    detail:
      readString(event.data?.summary)
      ?? readString(event.data?.goal)
      ?? readString(event.data?.notes)
      ?? (columnLabel ? `Board placement is now ${columnLabel}.` : null)
      ?? descriptor.scopeSummary
      ?? 'Board work packet available for operator review.',
    badges: buildBadges(descriptor, event),
    facts: buildFacts([
      descriptor.objectLabel ? { label: 'Work item', value: descriptor.objectLabel } : null,
      descriptor.stageName ? { label: 'Stage', value: descriptor.stageName } : null,
      columnLabel ? { label: 'Board position', value: columnLabel } : null,
      readString(event.data?.owner_role) ? { label: 'Owner role', value: capitalizeToken(readString(event.data?.owner_role) ?? '') } : null,
      readString(event.data?.priority) ? { label: 'Priority', value: capitalizeToken(readString(event.data?.priority) ?? '') } : null,
    ]),
    disclosureLabel: 'Open full work-item packet',
  };
}

function buildTaskPacket(event: DashboardEventRecord, descriptor: TimelineDescriptor): Omit<TimelineEventPacketDescriptor, 'hasStructuredDetail'> {
  const role = readString(event.data?.role) ?? readString(event.data?.assigned_role) ?? readRoleFromActor(descriptor.actorLabel);
  return {
    typeLabel: 'Specialist step',
    summary: ({
      'task.created': `${descriptor.objectLabel ?? 'Specialist step'} is queued for execution.`,
      'task.completed': `${descriptor.objectLabel ?? 'Specialist step'} reported back successfully.`,
      'task.failed': `${descriptor.objectLabel ?? 'Specialist step'} needs recovery before the board can continue.`,
      'task.escalated': `${descriptor.objectLabel ?? 'Specialist step'} needs explicit operator follow-up.`,
    })[event.type] ?? `${descriptor.objectLabel ?? 'Specialist step'} changed execution state.`,
    detail:
      readString(event.data?.summary)
      ?? readString(event.data?.error)
      ?? readString(event.data?.message)
      ?? readString(event.data?.reason)
      ?? descriptor.scopeSummary
      ?? 'Specialist execution packet available for operator review.',
    badges: buildBadges(descriptor, event),
    facts: buildFacts([
      descriptor.objectLabel ? { label: 'Step', value: descriptor.objectLabel } : null,
      role ? { label: 'Role', value: role } : null,
      descriptor.stageName ? { label: 'Stage', value: descriptor.stageName } : null,
      descriptor.workItemId ? { label: 'Work item', value: descriptor.workItemLabel ?? descriptor.workItemId } : null,
    ]),
    disclosureLabel: 'Open full step packet',
  };
}

function buildGatePacket(event: DashboardEventRecord, descriptor: TimelineDescriptor): Omit<TimelineEventPacketDescriptor, 'hasStructuredDetail'> {
  const decisionLabel = event.type === 'stage.gate_requested' ? 'Gate review requested' : event.type === 'stage.gate.approve' ? 'Approved' : event.type === 'stage.gate.reject' ? 'Rejected' : 'Changes requested';
  const stageLabel = descriptor.stageName ?? 'Current stage';
  return {
    typeLabel: 'Gate decision',
    summary: `${stageLabel} gate: ${decisionLabel.toLowerCase()}.`,
    detail:
      readString(event.data?.feedback)
      ?? readString(event.data?.recommendation)
      ?? readString(event.data?.request_summary)
      ?? descriptor.scopeSummary
      ?? 'Gate packet available for operator review.',
    badges: buildBadges(descriptor, event),
    facts: buildFacts([{ label: 'Stage', value: stageLabel }, { label: 'Decision', value: decisionLabel }, descriptor.actorLabel ? { label: 'Actor', value: descriptor.actorLabel } : null]),
    disclosureLabel: 'Open full gate packet',
  };
}

function buildBudgetPacket(event: DashboardEventRecord, descriptor: TimelineDescriptor): Omit<TimelineEventPacketDescriptor, 'hasStructuredDetail'> {
  const dimensions = readStringArray(event.data?.dimensions);
  return {
    typeLabel: 'Budget guardrail',
    summary: descriptor.summary ?? buildBudgetSummary(event.data, event.type === 'budget.exceeded' ? 'exceeded' : 'warning'),
    detail:
      dimensions.length > 0
        ? `Watch ${dimensions.map((dimension) => humanizeToken(dimension)).join(', ')} before the next operator intervention.`
        : 'Budget guardrail packet available for operator review.',
    badges: buildBadges(descriptor, event),
    facts: buildFacts([
      dimensions.length > 0 ? { label: 'Dimensions', value: dimensions.map((dimension) => humanizeToken(dimension)).join(', ') } : null,
      event.type === 'budget.warning' ? { label: 'Severity', value: 'Warning' } : event.type === 'budget.exceeded' ? { label: 'Severity', value: 'Exceeded' } : null,
    ]),
    disclosureLabel: 'Open full budget packet',
  };
}

function buildBadges(descriptor: TimelineDescriptor, event: DashboardEventRecord): string[] {
  const badges = new Set<string>(descriptor.signalBadges);
  if (event.type === 'operator.manual_enqueue') badges.add('Manual wake-up');
  return Array.from(badges);
}

function withStructuredDetail(
  packet: Omit<TimelineEventPacketDescriptor, 'hasStructuredDetail'>,
  fallback: ReviewPacketDescriptor,
): TimelineEventPacketDescriptor {
  return { ...packet, hasStructuredDetail: fallback.hasStructuredDetail };
}

function buildFacts(facts: Array<DashboardPacketFact | null>): DashboardPacketFact[] {
  return facts.filter((fact): fact is DashboardPacketFact => Boolean(fact)).slice(0, 4);
}

function isActivationEvent(eventType: string): boolean {
  return eventType.startsWith('workflow.activation_') || eventType === 'operator.manual_enqueue';
}

function readRoleFromActor(actorLabel: string): string | null {
  const normalized = actorLabel.trim();
  return normalized.endsWith(' specialist') ? normalized.replace(/ specialist$/, '') : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isPresentableScalar(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  return typeof value === 'number' || typeof value === 'boolean';
}

function formatFactValue(value: unknown): string {
  if (typeof value === 'string') return value.length > 96 ? `${value.slice(0, 93)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function humanizeFieldKey(key: string): string {
  const spaced = key.replaceAll('_', ' ').replaceAll('.', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
