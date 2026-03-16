import { DEFAULT_PER_PAGE, MAX_PER_PAGE } from '../api/pagination.js';
import type { DatabasePool } from '../db/database.js';
import { ValidationError } from '../errors/domain-errors.js';
import { sanitizeEventRows } from './event-service.js';

const PROJECT_ID_SQL =
  "COALESCE(data->>'project_id', CASE WHEN entity_type = 'project' THEN entity_id::text ELSE '' END)";
const WORKFLOW_ID_SQL =
  "COALESCE(data->>'workflow_id', CASE WHEN entity_type = 'workflow' THEN entity_id::text ELSE '' END)";
const WORK_ITEM_ID_SQL =
  "COALESCE(data->>'work_item_id', CASE WHEN entity_type = 'work_item' THEN entity_id::text ELSE '' END)";
const STAGE_NAME_SQL = "COALESCE(data->>'stage_name', '')";
const ACTIVATION_ID_SQL = "COALESCE(data->>'activation_id', '')";
const GATE_ID_SQL = "COALESCE(data->>'gate_id', CASE WHEN entity_type = 'gate' THEN entity_id::text ELSE '' END)";

interface EventBrowseFilters {
  tenantId: string;
  entityTypes?: string[];
  entityId?: string;
  projectId?: string;
  workflowId?: string;
  workflowScopeId?: string;
  workItemId?: string;
  stageName?: string;
  activationId?: string;
  gateId?: string;
  eventTypes?: string[];
  after?: number;
  limit: number;
}

interface EventRow {
  id: number;
  type: string;
  entity_type: string;
  entity_id: string;
  actor_type: string;
  actor_id: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
}

export interface EventCursorPage<T> {
  data: T[];
  meta: {
    has_more: boolean;
    next_after: string | null;
  };
}

export function parseCursorLimit(raw?: string): number {
  const limit = Number(raw ?? DEFAULT_PER_PAGE);
  if (!Number.isFinite(limit) || limit <= 0 || limit > MAX_PER_PAGE) {
    throw new ValidationError('Invalid limit value');
  }
  return limit;
}

export function parseCursorAfter(raw?: string): number | undefined {
  if (!raw) {
    return undefined;
  }
  const after = Number(raw);
  if (!Number.isInteger(after) || after <= 0) {
    throw new ValidationError('Invalid after cursor');
  }
  return after;
}

export class EventQueryService {
  constructor(private readonly pool: DatabasePool) {}

  async listEvents(filters: EventBrowseFilters): Promise<EventCursorPage<EventRow>> {
    const conditions = ['tenant_id = $1'];
    const values: unknown[] = [filters.tenantId];

    if (filters.workflowScopeId) {
      values.push(filters.workflowScopeId);
      const workflowScopeIndex = values.length;
      conditions.push(
        `(entity_id = $${workflowScopeIndex} OR ${WORKFLOW_ID_SQL} = $${workflowScopeIndex})`,
      );
    }

    this.addArrayFilter(conditions, values, filters.entityTypes, 'entity_type::text');
    this.addExactFilter(conditions, values, filters.entityId, 'entity_id');
    this.addExactFilter(conditions, values, filters.projectId, PROJECT_ID_SQL);
    this.addExactFilter(conditions, values, filters.workflowId, WORKFLOW_ID_SQL);
    this.addExactFilter(conditions, values, filters.workItemId, WORK_ITEM_ID_SQL);
    this.addExactFilter(conditions, values, filters.stageName, STAGE_NAME_SQL);
    this.addExactFilter(conditions, values, filters.activationId, ACTIVATION_ID_SQL);
    this.addExactFilter(conditions, values, filters.gateId, GATE_ID_SQL);
    this.addArrayFilter(conditions, values, filters.eventTypes, 'type');

    if (filters.after !== undefined) {
      values.push(filters.after);
      conditions.push(`id < $${values.length}`);
    }

    values.push(filters.limit + 1);
    const rows = await this.pool.query<EventRow>(
      `SELECT *
         FROM events
        WHERE ${conditions.join(' AND ')}
        ORDER BY id DESC
        LIMIT $${values.length}`,
      values,
    );

    const hasMore = rows.rows.length > filters.limit;
    const visibleRows = sanitizeEventRows(rows.rows.slice(0, filters.limit));
    return {
      data: visibleRows,
      meta: {
        has_more: hasMore,
        next_after: hasMore ? String(visibleRows.at(-1)?.id ?? '') : null,
      },
    };
  }

  private addExactFilter(
    conditions: string[],
    values: unknown[],
    value: string | undefined,
    columnSql: string,
  ) {
    if (!value) {
      return;
    }
    values.push(value);
    conditions.push(`${columnSql} = $${values.length}`);
  }

  private addArrayFilter(
    conditions: string[],
    values: unknown[],
    items: string[] | undefined,
    columnSql: string,
  ) {
    if (!items || items.length === 0) {
      return;
    }
    values.push(items);
    conditions.push(`${columnSql} = ANY($${values.length}::text[])`);
  }
}
