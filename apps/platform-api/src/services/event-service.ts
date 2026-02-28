import type { Pool, PoolClient } from 'pg';

type EventEntityType = 'task' | 'pipeline' | 'agent' | 'worker' | 'project' | 'template' | 'system';

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
  query: Pool['query'];
}

export class EventService {
  constructor(private readonly pool: Pool) {}

  async emit(input: EventInput, client?: PoolClient): Promise<void> {
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
  }
}
