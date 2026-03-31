import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import type { PoolClient } from 'pg';
import { sanitizeEventRow } from './event-service.js';

interface EventFilters {
  types?: string[];
  entityTypes?: string[];
  entityId?: string;
  workspaceId?: string;
  workflowId?: string;
  workItemId?: string;
  stageName?: string;
  activationId?: string;
  gateId?: string;
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
  private listenerClient: PoolClient | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.connectListener();
  }

  async stop(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const client = this.listenerClient;
    if (!client) {
      return;
    }
    this.listenerClient = null;
    client.removeAllListeners('notification');
    client.removeAllListeners('error');
    client.removeAllListeners('end');

    await client.query('UNLISTEN agirunner_events');
    client.release();
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

  private async connectListener(): Promise<void> {
    const client = await this.pool.connect();
    let released = false;
    const releaseClient = () => {
      if (released) {
        return;
      }
      released = true;
      client.release();
    };
    const scheduleReconnect = () => {
      if (this.listenerClient !== client) {
        releaseClient();
        return;
      }
      this.listenerClient = null;
      releaseClient();
      if (this.reconnectTimer) {
        return;
      }
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        void this.start().catch(() => {
          scheduleReconnect();
        });
      }, 1_000);
    };

    try {
      await client.query('LISTEN agirunner_events');
    } catch (error) {
      releaseClient();
      throw error;
    }

    client.on('notification', (msg) => {
      if (!msg.payload) {
        return;
      }
      void this.handleNotification(msg.payload).catch(() => {
        scheduleReconnect();
      });
    });
    client.on('error', () => {
      scheduleReconnect();
    });
    client.on('end', () => {
      scheduleReconnect();
    });
    this.listenerClient = client;
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
    const event = sanitizeEventRow(eventRes.rows[0]);

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

    if (filters.entityId && filters.entityId !== event.entity_id) {
      return false;
    }

    if (filters.workspaceId) {
      const workspaceId = (event.data?.workspace_id as string | undefined) ?? (event.entity_type === 'workspace' ? event.entity_id : undefined);
      if (workspaceId !== filters.workspaceId) {
        return false;
      }
    }

    if (filters.workflowId) {
      const workflowId = (event.data?.workflow_id as string | undefined) ?? (event.entity_type === 'workflow' ? event.entity_id : undefined);
      if (workflowId !== filters.workflowId) {
        return false;
      }
    }

    if (filters.workItemId) {
      const workItemId =
        (event.data?.work_item_id as string | undefined) ??
        (event.entity_type === 'work_item' ? event.entity_id : undefined);
      if (workItemId !== filters.workItemId) {
        return false;
      }
    }

    if (filters.stageName) {
      const stageName = event.data?.stage_name as string | undefined;
      if (stageName !== filters.stageName) {
        return false;
      }
    }

    if (filters.activationId) {
      const activationId = event.data?.activation_id as string | undefined;
      if (activationId !== filters.activationId) {
        return false;
      }
    }

    if (filters.gateId) {
      const gateId = event.data?.gate_id as string | undefined;
      if (gateId !== filters.gateId) {
        return false;
      }
    }

    return true;
  }
}
