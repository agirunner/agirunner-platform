import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import type { PoolClient } from 'pg';
import { LEVEL_ORDER } from './log-levels.js';
import type { LogRow } from './log-service.js';

export interface LogStreamFilters {
  source?: string[];
  category?: string[];
  level?: string;
  executionBackend?: string[];
  toolOwner?: string[];
  workspaceId?: string;
  workflowId?: string;
  taskId?: string;
  workItemId?: string;
  stageName?: string;
  activationId?: string;
  isOrchestratorTask?: boolean;
  traceId?: string;
  operation?: string[];
}

interface LogNotification {
  id: number;
  tenant_id: string;
  trace_id: string;
  source: string;
  category: string;
  level: string;
  operation: string;
  workspace_id: string | null;
  workflow_id: string | null;
  task_id: string | null;
  work_item_id: string | null;
  stage_name: string | null;
  activation_id: string | null;
  is_orchestrator_task: boolean;
  execution_backend: 'runtime_only' | 'runtime_plus_task' | null;
  tool_owner: 'runtime' | 'task' | null;
  created_at: string;
}

interface LogSubscriber {
  tenantId: string;
  filters: LogStreamFilters;
  onLog: (entry: LogRow) => void;
}

export class LogStreamService {
  private listenerClient: PoolClient | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private nextSubscriberId = 1;
  private readonly subscribers = new Map<number, LogSubscriber>();

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

    await client.query('UNLISTEN agirunner_execution_logs');
    client.release();
    this.subscribers.clear();
  }

  subscribe(
    tenantId: string,
    filters: LogStreamFilters,
    onLog: (entry: LogRow) => void,
  ): () => void {
    const id = this.nextSubscriberId++;
    this.subscribers.set(id, { tenantId, filters, onLog });
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
      await client.query('LISTEN agirunner_execution_logs');
    } catch (error) {
      releaseClient();
      throw error;
    }

    client.on('notification', (msg: { channel: string; payload?: string }) => {
      if (msg.channel !== 'agirunner_execution_logs' || !msg.payload) {
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
    let notification: LogNotification;
    try {
      notification = JSON.parse(payload) as LogNotification;
    } catch {
      return;
    }

    if (!notification.id) {
      return;
    }

    const matchingSubscribers = this.findMatchingSubscribers(notification);
    if (matchingSubscribers.length === 0) {
      return;
    }

    const result = await this.pool.query<LogRow>(
      `SELECT id, tenant_id, trace_id, span_id, parent_span_id,
              source, category, level, operation, status, duration_ms,
              payload, error,
              workspace_id, workflow_id, workflow_name, workspace_name, task_id,
              work_item_id, stage_name, activation_id, is_orchestrator_task,
              execution_backend, tool_owner,
              task_title, role,
              actor_type, actor_id, actor_name,
              resource_type, resource_id, resource_name,
              created_at
       FROM execution_logs
       WHERE id = $1 AND created_at = $2`,
      [notification.id, notification.created_at],
    );

    if (!result.rowCount) {
      return;
    }

    const row = result.rows[0];
    for (const subscriber of matchingSubscribers) {
      subscriber.onLog(row);
    }
  }

  private findMatchingSubscribers(notification: LogNotification): LogSubscriber[] {
    const matched: LogSubscriber[] = [];

    for (const subscriber of this.subscribers.values()) {
      if (subscriber.tenantId !== notification.tenant_id) {
        continue;
      }
      if (!this.matchesFilters(subscriber.filters, notification)) {
        continue;
      }
      matched.push(subscriber);
    }

    return matched;
  }

  private matchesFilters(filters: LogStreamFilters, notification: LogNotification): boolean {
    if (filters.source?.length && !filters.source.includes(notification.source)) {
      return false;
    }
    if (filters.category?.length && !filters.category.includes(notification.category)) {
      return false;
    }
    if (filters.level) {
      const minLevel = LEVEL_ORDER[filters.level] ?? 0;
      const notifLevel = LEVEL_ORDER[notification.level] ?? 0;
      if (notifLevel < minLevel) {
        return false;
      }
    }
    if (filters.executionBackend?.length) {
      const backend = notification.execution_backend ?? '';
      if (!filters.executionBackend.includes(backend)) {
        return false;
      }
    }
    if (filters.toolOwner?.length) {
      const toolOwner = notification.tool_owner ?? '';
      if (!filters.toolOwner.includes(toolOwner)) {
        return false;
      }
    }
    if (filters.workspaceId && notification.workspace_id !== filters.workspaceId) {
      return false;
    }
    if (filters.workflowId && notification.workflow_id !== filters.workflowId) {
      return false;
    }
    if (filters.taskId && notification.task_id !== filters.taskId) {
      return false;
    }
    if (filters.workItemId && notification.work_item_id !== filters.workItemId) {
      return false;
    }
    if (filters.stageName && notification.stage_name !== filters.stageName) {
      return false;
    }
    if (filters.activationId && notification.activation_id !== filters.activationId) {
      return false;
    }
    if (
      filters.isOrchestratorTask !== undefined &&
      notification.is_orchestrator_task !== filters.isOrchestratorTask
    ) {
      return false;
    }
    if (filters.traceId && notification.trace_id !== filters.traceId) {
      return false;
    }
    if (filters.operation?.length) {
      const matches = filters.operation.some((op) =>
        op.endsWith('*')
          ? notification.operation.startsWith(op.slice(0, -1))
          : notification.operation === op,
      );
      if (!matches) return false;
    }
    return true;
  }
}
