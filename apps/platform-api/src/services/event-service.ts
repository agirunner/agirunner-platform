import type { DatabaseClient, DatabasePool } from '../db/database.js';

type EventEntityType =
  | 'task'
  | 'work_item'
  | 'gate'
  | 'workflow'
  | 'agent'
  | 'worker'
  | 'project'
  | 'template'
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

export class EventService {
  constructor(
    private readonly pool: DatabasePool,
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
  }
}
