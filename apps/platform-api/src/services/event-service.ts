import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { sanitizeSecretLikeRecord } from './secret-redaction.js';

type EventEntityType =
  | 'task'
  | 'work_item'
  | 'gate'
  | 'workflow'
  | 'agent'
  | 'worker'
  | 'workspace'
  | 'system';

interface EventInput {
  tenantId: string;
  type: string;
  entityType: EventEntityType;
  entityId: string;
  actorType: string;
  actorId?: string | null;
  data?: Record<string, unknown>;
}

interface DbLike {
  query: DatabasePool['query'];
}

const ACTIVATION_EVENT_PREFIX = 'workflow.activation_';
const WORK_ITEM_EVENT_PREFIX = 'work_item.';
const STAGE_EVENT_PREFIX = 'stage.';
const CHILD_WORKFLOW_EVENT_PREFIX = 'child_workflow.';
const EVENT_SECRET_REDACTION = 'redacted://event-secret';
const ESCALATION_EVENT_TYPES = new Set([
  'task.agent_escalated',
  'task.escalation_task_created',
  'task.escalation_response_recorded',
  'task.escalation_resolved',
  'task.escalation_depth_exceeded',
  'task.escalation',
]);

export class EventService {
  constructor(
    private readonly pool: DatabasePool,
  ) {}

  async emit(input: EventInput, client?: DatabaseClient): Promise<void> {
    const db: DbLike = client ?? this.pool;
    const data = normalizeEventData(input);
    await db.query(
      `INSERT INTO events (tenant_id, type, entity_type, entity_id, actor_type, actor_id, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.tenantId,
        input.type,
        input.entityType,
        input.entityId,
        input.actorType,
        input.actorId ?? null,
        data,
      ],
    );
  }
}

function normalizeEventData(input: EventInput): Record<string, unknown> {
  const data = asRecord(input.data);
  const nestedEventType = readString(data, 'event_type');
  const category = resolveTimelineCategory(input.type, nestedEventType, input.entityType);
  const family = resolveTimelineFamily(input.type, input.entityType);

  return sanitizeEventData({
    ...data,
    ...buildEntityIdFallbacks(input.entityType, input.entityId, data),
    timeline_category: readString(data, 'timeline_category') ?? category,
    timeline_family: readString(data, 'timeline_family') ?? family,
    timeline_chain:
      readString(data, 'timeline_chain') ?? resolveTimelineChain(category, nestedEventType, data),
  });
}

export function sanitizeEventRow<T extends { data?: Record<string, unknown> | null }>(event: T): T {
  return {
    ...event,
    data: sanitizeEventData(event.data),
  };
}

export function sanitizeEventRows<T extends { data?: Record<string, unknown> | null }>(events: T[]): T[] {
  return events.map((event) => sanitizeEventRow(event));
}

function sanitizeEventData(data: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return sanitizeSecretLikeRecord(data, {
    redactionValue: EVENT_SECRET_REDACTION,
    allowSecretReferences: false,
  });
}

function buildEntityIdFallbacks(
  entityType: EventEntityType,
  entityId: string,
  data: Record<string, unknown>,
) {
  const fallback: Record<string, unknown> = {};
  if (entityType === 'workflow' && readString(data, 'workflow_id') === undefined) {
    fallback.workflow_id = entityId;
  }
  if (entityType === 'task' && readString(data, 'task_id') === undefined) {
    fallback.task_id = entityId;
  }
  if (entityType === 'work_item' && readString(data, 'work_item_id') === undefined) {
    fallback.work_item_id = entityId;
  }
  if (entityType === 'gate' && readString(data, 'gate_id') === undefined) {
    fallback.gate_id = entityId;
  }
  if (entityType === 'workspace' && readString(data, 'workspace_id') === undefined) {
    fallback.workspace_id = entityId;
  }
  return fallback;
}

function resolveTimelineCategory(
  eventType: string,
  nestedEventType: string | undefined,
  entityType: EventEntityType,
) {
  const subject = nestedEventType ?? eventType;
  if (subject.startsWith(CHILD_WORKFLOW_EVENT_PREFIX)) return 'child_workflow';
  if (ESCALATION_EVENT_TYPES.has(subject)) return 'escalation';
  if (subject === 'stage.gate_requested' || subject.startsWith('stage.gate.')) return 'gate';
  if (subject.startsWith(WORK_ITEM_EVENT_PREFIX)) return 'work_item';
  if (subject.startsWith(ACTIVATION_EVENT_PREFIX)) return 'activation';
  if (subject.startsWith(STAGE_EVENT_PREFIX)) return 'stage';
  if (entityType === 'task') return 'task';
  if (entityType === 'workflow') return 'workflow';
  if (entityType === 'gate') return 'gate';
  if (entityType === 'work_item') return 'work_item';
  return entityType;
}

function resolveTimelineFamily(eventType: string, entityType: EventEntityType) {
  if (eventType.startsWith(CHILD_WORKFLOW_EVENT_PREFIX)) return 'child_workflow';
  if (eventType.startsWith(ACTIVATION_EVENT_PREFIX)) return 'activation';
  if (eventType.startsWith(WORK_ITEM_EVENT_PREFIX)) return 'work_item';
  if (eventType === 'stage.gate_requested' || eventType.startsWith('stage.gate.')) return 'gate';
  if (eventType.startsWith(STAGE_EVENT_PREFIX)) return 'stage';
  if (entityType === 'task') return 'task';
  if (entityType === 'workflow') return 'workflow';
  return entityType;
}

function resolveTimelineChain(
  category: string,
  nestedEventType: string | undefined,
  data: Record<string, unknown>,
) {
  if (category === 'child_workflow') {
    return readString(data, 'child_workflow_id') ?? nestedEventType ?? 'child_workflow';
  }
  if (category === 'escalation') {
    return (
      readString(data, 'source_task_id') ??
      readString(data, 'task_id') ??
      readString(data, 'escalation_task_id') ??
      nestedEventType ??
      'escalation'
    );
  }
  if (category === 'activation') {
    return readString(data, 'activation_id') ?? nestedEventType ?? 'activation';
  }
  if (category === 'gate') {
    return readString(data, 'gate_id') ?? readString(data, 'stage_name') ?? 'gate';
  }
  return nestedEventType ?? category;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

