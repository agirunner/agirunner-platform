import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { getRequestContext } from '../observability/request-context.js';

export interface AuditLogInput {
  tenantId: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  actorType?: string;
  actorId?: string | null;
  outcome?: 'success' | 'failure';
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuditLogQuery {
  date_from?: string;
  date_to?: string;
  actor?: string;
  action?: string;
  resource_id?: string;
  page: number;
  per_page: number;
}

interface AuditExporter {
  export(entry: AuditLogRecord): Promise<void>;
}

interface AuditLogRow {
  id: number;
  tenant_id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  actor_type: string;
  actor_id: string | null;
  outcome: 'success' | 'failure';
  reason: string | null;
  request_id: string | null;
  source_ip: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface AuditLogRecord {
  id: number;
  tenant_id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  actor_type: string;
  actor_id: string | null;
  outcome: 'success' | 'failure';
  reason: string | null;
  request_id: string | null;
  source_ip: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export class AuditService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly exporter?: AuditExporter,
  ) {}

  async record(input: AuditLogInput, client?: DatabaseClient): Promise<void> {
    const db = client ?? this.pool;
    const context = getRequestContext();
    const metadata = input.metadata ?? {};
    const actor = resolveActor(input, context?.auth);
    const result = await db.query<AuditLogRow>(
      `INSERT INTO audit_logs (
         tenant_id,
         action,
         resource_type,
         resource_id,
         actor_type,
         actor_id,
         outcome,
         reason,
         request_id,
         source_ip,
         metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        input.tenantId,
        input.action,
        input.resourceType,
        input.resourceId ?? null,
        actor.actorType,
        actor.actorId,
        input.outcome ?? 'success',
        input.reason ?? null,
        context?.requestId ?? null,
        context?.sourceIp ?? null,
        metadata,
      ],
    );

    const row = result.rows[0];
    if (this.exporter && row && !client) {
      void this.exporter.export(toRecord(row)).catch(() => undefined);
    }
  }

  async listLogs(tenantId: string, query: AuditLogQuery) {
    const conditions = ['tenant_id = $1'];
    const values: unknown[] = [tenantId];

    if (query.date_from) {
      values.push(query.date_from);
      conditions.push(`created_at >= $${values.length}::timestamptz`);
    }
    if (query.date_to) {
      values.push(query.date_to);
      conditions.push(`created_at <= $${values.length}::timestamptz`);
    }
    if (query.actor) {
      values.push(query.actor);
      conditions.push(`actor_id = $${values.length}`);
    }
    if (query.action) {
      values.push(query.action);
      conditions.push(`action = $${values.length}`);
    }
    if (query.resource_id) {
      values.push(query.resource_id);
      conditions.push(`resource_id = $${values.length}`);
    }

    const whereClause = conditions.join(' AND ');
    const totalResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit_logs WHERE ${whereClause}`,
      values,
    );

    const offset = (query.page - 1) * query.per_page;
    values.push(query.per_page, offset);
    const rows = await this.pool.query<AuditLogRow>(
      `SELECT *
       FROM audit_logs
       WHERE ${whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT $${values.length - 1}
       OFFSET $${values.length}`,
      values,
    );

    const total = Number(totalResult.rows[0]?.count ?? '0');
    return {
      data: rows.rows.map(toRecord),
      meta: {
        total,
        page: query.page,
        per_page: query.per_page,
        pages: Math.ceil(total / query.per_page) || 1,
      },
    };
  }
}

export class WebhookAuditExporter implements AuditExporter {
  constructor(
    private readonly endpoint: string,
    private readonly timeoutMs: number,
    private readonly authToken?: string,
  ) {}

  async export(entry: AuditLogRecord): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: buildHeaders(this.authToken),
        body: JSON.stringify({ data: entry }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Audit export failed with status ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

function buildHeaders(authToken?: string): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authToken) {
    headers.authorization = `Bearer ${authToken}`;
  }
  return headers;
}

function resolveActor(
  input: AuditLogInput,
  auth: { ownerType: string; ownerId: string | null } | undefined,
): { actorType: string; actorId: string | null } {
  if (auth) {
    return {
      actorType: auth.ownerType ?? input.actorType ?? 'system',
      actorId: auth.ownerId ?? input.actorId ?? null,
    };
  }
  return {
    actorType: input.actorType ?? 'system',
    actorId: input.actorId ?? null,
  };
}

function toRecord(row: AuditLogRow): AuditLogRecord {
  return {
    ...row,
    metadata: row.metadata ?? {},
  };
}
