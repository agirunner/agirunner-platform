import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { AuditService } from './audit-service.js';

type EventEntityType = 'task' | 'workflow' | 'agent' | 'worker' | 'project' | 'template' | 'system';

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

export class EventService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly auditService?: AuditService,
  ) {}

  async emit(input: EventInput, client?: DatabaseClient): Promise<void> {
    const db: DbLike = client ?? this.pool;
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
        input.data ?? {},
      ],
    );
    await this.auditService?.record(
      {
        tenantId: input.tenantId,
        action: input.type,
        resourceType: input.entityType,
        resourceId: input.entityId,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        outcome: 'success',
        metadata: input.data ?? {},
      },
      client,
    );
  }
}
