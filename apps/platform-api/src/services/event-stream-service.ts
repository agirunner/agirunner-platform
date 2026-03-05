import type { DatabaseClient, DatabasePool } from '../db/database.js';

interface EventFilters {
  types?: string[];
  entityTypes?: string[];
  projectId?: string;
  pipelineId?: string;
}

export interface StreamEvent {
  id: number;
  tenant_id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  actor_type: string;
  actor_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

export class EventStreamService {
  private listenerClient: DatabaseClient | null = null;
  private nextSubscriberId = 1;
  private readonly subscribers = new Map<
    number,
    { tenantId?: string; filters: EventFilters; onEvent: (event: StreamEvent) => void }
  >();

  constructor(private readonly pool: DatabasePool) {}

  async start(): Promise<void> {
    if (this.listenerClient) {
      return;
    }

    const client = await this.pool.connect();
    await client.query('LISTEN agentbaton_events');
    client.on('notification', (msg) => {
      if (!msg.payload) {
        return;
      }
      void this.handleNotification(msg.payload);
    });
    this.listenerClient = client;
  }

  async stop(): Promise<void> {
    if (!this.listenerClient) {
      return;
    }

    await this.listenerClient.query('UNLISTEN agentbaton_events');
    this.listenerClient.release();
    this.listenerClient = null;
    this.subscribers.clear();
  }

  subscribe(tenantId: string, filters: EventFilters, onEvent: (event: StreamEvent) => void): () => void {
    const id = this.nextSubscriberId++;
    this.subscribers.set(id, { tenantId, filters, onEvent });
    return () => {
      this.subscribers.delete(id);
    };
  }

  subscribeAll(filters: EventFilters, onEvent: (event: StreamEvent) => void): () => void {
    const id = this.nextSubscriberId++;
    this.subscribers.set(id, { filters, onEvent });
    return () => {
      this.subscribers.delete(id);
    };
  }

  private async handleNotification(payload: string): Promise<void> {
    let parsed: { id?: number } = {};
    try {
      parsed = JSON.parse(payload) as { id?: number };
    } catch {
      return;
    }
    if (!parsed.id) {
      return;
    }

    const eventRes = await this.pool.query<StreamEvent>('SELECT * FROM events WHERE id = $1', [parsed.id]);
    if (!eventRes.rowCount) {
      return;
    }
    const event = eventRes.rows[0];

    for (const subscriber of this.subscribers.values()) {
      if (subscriber.tenantId && subscriber.tenantId !== event.tenant_id) {
        continue;
      }
      if (!this.matches(subscriber.filters, event)) {
        continue;
      }
      subscriber.onEvent(event);
    }
  }

  private matches(filters: EventFilters, event: StreamEvent): boolean {
    if (filters.types && filters.types.length > 0 && !filters.types.includes(event.type)) {
      return false;
    }

    if (filters.entityTypes && filters.entityTypes.length > 0 && !filters.entityTypes.includes(event.entity_type)) {
      return false;
    }

    if (filters.projectId) {
      const projectId = (event.data?.project_id as string | undefined) ?? (event.entity_type === 'project' ? event.entity_id : undefined);
      if (projectId !== filters.projectId) {
        return false;
      }
    }

    if (filters.pipelineId) {
      const pipelineId = (event.data?.pipeline_id as string | undefined) ?? (event.entity_type === 'pipeline' ? event.entity_id : undefined);
      if (pipelineId !== filters.pipelineId) {
        return false;
      }
    }

    return true;
  }
}
