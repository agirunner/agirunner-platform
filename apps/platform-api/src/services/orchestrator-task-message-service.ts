import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';
import type { WorkerConnectionHub } from './worker-connection-hub.js';

type DeliveryState =
  | 'pending_delivery'
  | 'delivery_in_progress'
  | 'delivered'
  | 'task_not_in_progress'
  | 'worker_unassigned'
  | 'worker_unavailable';

interface ManagedTaskRow {
  id: string;
  workflow_id: string;
  is_orchestrator_task: boolean;
  state: string;
  assigned_worker_id: string | null;
  stage_name: string | null;
}

interface TaskMessageRow {
  id: string;
  tenant_id: string;
  workflow_id: string;
  task_id: string;
  orchestrator_task_id: string;
  activation_id: string | null;
  stage_name: string | null;
  worker_id: string | null;
  request_id: string;
  urgency: string;
  message: string;
  delivery_state: DeliveryState;
  delivery_attempt_count: number;
  last_delivery_attempt_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
}

interface TaskScope {
  workflow_id: string;
  id: string;
  stage_name: string | null;
  activation_id: string | null;
}

interface CreateTaskMessageInput {
  request_id: string;
  message: string;
  urgency?: 'info' | 'important' | 'critical';
}

interface OrchestratorTaskMessageDeliveryPolicy {
  staleAfterMs?: number;
  readStaleAfterMs?: (tenantId: string) => Promise<number>;
}

interface MessageDeliveryReservation {
  row: TaskMessageRow;
  shouldSend: boolean;
}

export class OrchestratorTaskMessageService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
    private readonly workerConnectionHub?: WorkerConnectionHub,
    private readonly deliveryPolicy?: OrchestratorTaskMessageDeliveryPolicy,
  ) {}

  async prepareMessage(
    identity: ApiKeyIdentity,
    taskScope: TaskScope,
    managedTaskId: string,
    input: CreateTaskMessageInput,
    client: DatabaseClient,
  ): Promise<Record<string, unknown>> {
    const managedTask = await this.loadManagedTask(identity.tenantId, taskScope.workflow_id, managedTaskId, client);
    const inserted = await this.insertMessage(identity, taskScope, managedTask, input, client);
    await this.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'task.message_sent',
        entityType: 'task',
        entityId: inserted.task_id,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: {
          workflow_id: inserted.workflow_id,
          task_id: inserted.task_id,
          stage_name: inserted.stage_name,
          urgency: inserted.urgency,
          delivered: inserted.delivery_state === 'delivered',
          delivery_state: inserted.delivery_state,
          message_length: inserted.message.length,
          assigned_worker_id: inserted.worker_id,
        },
      },
      client,
    );
    return toMessageResponse(inserted);
  }

  async deliverPendingByRequestId(
    identity: ApiKeyIdentity,
    workflowId: string,
    requestId: string,
  ): Promise<Record<string, unknown> | null> {
    const reservation = await this.reservePendingDelivery(identity.tenantId, workflowId, requestId);
    if (!reservation) {
      return null;
    }
    if (!reservation.shouldSend) {
      return toMessageResponse(reservation.row);
    }

    const delivered =
      reservation.row.worker_id !== null &&
      this.workerConnectionHub?.sendToWorker(reservation.row.worker_id, {
        type: 'task.message',
        task_id: reservation.row.task_id,
        workflow_id: reservation.row.workflow_id,
        activation_id: reservation.row.activation_id,
        orchestrator_task_id: reservation.row.orchestrator_task_id,
        message_id: reservation.row.request_id,
        urgency: reservation.row.urgency,
        message: reservation.row.message,
        issued_at: reservation.row.created_at.toISOString(),
      }) === true;

    const finalized = await this.finalizeDelivery(identity, reservation.row, delivered);
    return toMessageResponse(finalized);
  }

  private async insertMessage(
    identity: ApiKeyIdentity,
    taskScope: TaskScope,
    managedTask: ManagedTaskRow,
    input: CreateTaskMessageInput,
    client: DatabaseClient,
  ): Promise<TaskMessageRow> {
    const urgency = input.urgency ?? 'info';
    const deliveryState = determineInitialDeliveryState(managedTask);
    const inserted = await client.query<TaskMessageRow>(
      `INSERT INTO orchestrator_task_messages (
         tenant_id,
         workflow_id,
         task_id,
         orchestrator_task_id,
         activation_id,
         stage_name,
         worker_id,
         request_id,
         urgency,
         message,
         delivery_state
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
       )
       ON CONFLICT (tenant_id, workflow_id, request_id)
       DO NOTHING
       RETURNING id, tenant_id, workflow_id, task_id, orchestrator_task_id, activation_id, stage_name,
                 worker_id, request_id, urgency, message, delivery_state, delivery_attempt_count,
                 last_delivery_attempt_at, delivered_at, created_at`,
      [
        identity.tenantId,
        taskScope.workflow_id,
        managedTask.id,
        taskScope.id,
        taskScope.activation_id,
        managedTask.stage_name ?? taskScope.stage_name,
        managedTask.assigned_worker_id,
        input.request_id,
        urgency,
        input.message,
        deliveryState,
      ],
    );
    if (inserted.rowCount) {
      return inserted.rows[0];
    }

    const existing = await this.loadMessage(identity.tenantId, taskScope.workflow_id, input.request_id, client);
    if (!existing) {
      throw new Error('Failed to load task message after request-id conflict');
    }
    return existing;
  }

  private async reservePendingDelivery(
    tenantId: string,
    workflowId: string,
    requestId: string,
  ): Promise<MessageDeliveryReservation | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await this.loadMessageForUpdate(tenantId, workflowId, requestId, client);
      const row = locked.rows[0] ?? null;
      if (!row) {
        await client.query('COMMIT');
        return null;
      }

      if (!canResumeDelivery(row.delivery_state)) {
        await client.query('COMMIT');
        return { row, shouldSend: false };
      }
      const task = await this.loadManagedTask(tenantId, workflowId, row.task_id, client);
      const terminalState = determineInitialDeliveryState(task);
      if (terminalState !== 'pending_delivery') {
        const updated = await this.updateDeliveryState(
          row.id,
          terminalState,
          client,
        );
        await client.query('COMMIT');
        return { row: updated, shouldSend: false };
      }
      if (row.delivery_state === 'delivery_in_progress') {
        const isStaleAttempt = await this.isStaleDeliveryAttempt(tenantId, row);
        if (!isStaleAttempt) {
          await client.query('COMMIT');
          return { row, shouldSend: false };
        }
      }

      const reserved = await client.query<TaskMessageRow>(
        `UPDATE orchestrator_task_messages
            SET delivery_state = 'delivery_in_progress',
                worker_id = $2,
                stage_name = $3,
                delivery_attempt_count = delivery_attempt_count + 1,
                last_delivery_attempt_at = now()
          WHERE id = $1
            AND delivery_state = ANY($4::text[])
        RETURNING id, tenant_id, workflow_id, task_id, orchestrator_task_id, activation_id, stage_name,
                  worker_id, request_id, urgency, message, delivery_state, delivery_attempt_count,
                  last_delivery_attempt_at, delivered_at, created_at`,
        [row.id, task.assigned_worker_id, task.stage_name ?? row.stage_name, resumableDeliveryStates],
      );
      if (!reserved.rowCount) {
        await client.query('COMMIT');
        return { row, shouldSend: false };
      }
      await client.query('COMMIT');
      return { row: reserved.rows[0], shouldSend: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async isStaleDeliveryAttempt(tenantId: string, row: TaskMessageRow): Promise<boolean> {
    if (row.delivery_state !== 'delivery_in_progress') {
      return false;
    }
    if (!row.last_delivery_attempt_at) {
      return true;
    }
    const staleAfterMs = await this.resolveDeliveryStaleAfterMs(tenantId);
    if (!staleAfterMs || staleAfterMs <= 0) {
      return false;
    }
    const ageMs = Date.now() - row.last_delivery_attempt_at.getTime();
    return ageMs >= staleAfterMs;
  }

  private async resolveDeliveryStaleAfterMs(tenantId: string): Promise<number | null> {
    const explicitStaleAfterMs = this.deliveryPolicy?.staleAfterMs;
    if (typeof explicitStaleAfterMs === 'number') {
      if (explicitStaleAfterMs <= 0) {
        throw new Error('orchestrator task message stale-after must be greater than 0');
      }
      return explicitStaleAfterMs;
    }
    const reader = this.deliveryPolicy?.readStaleAfterMs;
    if (!reader) {
      return null;
    }
    return reader(tenantId);
  }

  private async finalizeDelivery(
    identity: ApiKeyIdentity,
    row: TaskMessageRow,
    delivered: boolean,
  ): Promise<TaskMessageRow> {
    const client = await this.pool.connect();
    const deliveryState: DeliveryState = delivered ? 'delivered' : 'worker_unavailable';
    try {
      await client.query('BEGIN');
      const result = await client.query<TaskMessageRow>(
        `UPDATE orchestrator_task_messages
            SET delivery_state = $2,
                delivered_at = CASE WHEN $2 = 'delivered' THEN now() ELSE delivered_at END
          WHERE id = $1
            AND delivery_state = 'delivery_in_progress'
        RETURNING id, tenant_id, workflow_id, task_id, orchestrator_task_id, activation_id, stage_name,
                  worker_id, request_id, urgency, message, delivery_state, delivery_attempt_count,
                  last_delivery_attempt_at, delivered_at, created_at`,
        [row.id, deliveryState],
      );
      const updated = result.rows[0] ?? row;
      if (result.rowCount) {
        await this.eventService.emit(
          {
            tenantId: identity.tenantId,
            type: delivered ? 'task.message_delivered' : 'task.message_delivery_deferred',
            entityType: 'task',
            entityId: updated.task_id,
            actorType: 'system',
            actorId: 'orchestrator_task_message_dispatcher',
            data: {
              workflow_id: updated.workflow_id,
              task_id: updated.task_id,
              stage_name: updated.stage_name,
              message_id: updated.request_id,
              urgency: updated.urgency,
              delivery_state: updated.delivery_state,
              assigned_worker_id: updated.worker_id,
            },
          },
          client,
        );
      }
      await client.query('COMMIT');
      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async loadManagedTask(
    tenantId: string,
    workflowId: string,
    managedTaskId: string,
    client: DatabaseClient,
  ): Promise<ManagedTaskRow> {
    const result = await client.query<ManagedTaskRow>(
      `SELECT id, workflow_id, is_orchestrator_task, state, assigned_worker_id, stage_name
         FROM tasks
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1`,
      [tenantId, managedTaskId],
    );
    const task = result.rows[0];
    if (!task) {
      throw new NotFoundError('Managed task not found');
    }
    if (task.workflow_id !== workflowId) {
      throw new ValidationError('Managed task must belong to the orchestrator workflow');
    }
    if (task.is_orchestrator_task) {
      throw new ValidationError('Managed task must be a specialist task');
    }
    return task;
  }

  private async loadMessage(
    tenantId: string,
    workflowId: string,
    requestId: string,
    client: DatabaseClient,
  ): Promise<TaskMessageRow | null> {
    const result = await client.query<TaskMessageRow>(
      `SELECT id, tenant_id, workflow_id, task_id, orchestrator_task_id, activation_id, stage_name,
              worker_id, request_id, urgency, message, delivery_state, delivery_attempt_count,
              last_delivery_attempt_at, delivered_at, created_at
         FROM orchestrator_task_messages
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND request_id = $3
        LIMIT 1`,
      [tenantId, workflowId, requestId],
    );
    return result.rows[0] ?? null;
  }

  private loadMessageForUpdate(
    tenantId: string,
    workflowId: string,
    requestId: string,
    client: DatabaseClient,
  ) {
    return client.query<TaskMessageRow>(
      `SELECT id, tenant_id, workflow_id, task_id, orchestrator_task_id, activation_id, stage_name,
              worker_id, request_id, urgency, message, delivery_state, delivery_attempt_count,
              last_delivery_attempt_at, delivered_at, created_at
         FROM orchestrator_task_messages
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND request_id = $3
        LIMIT 1
        FOR UPDATE`,
      [tenantId, workflowId, requestId],
    );
  }

  private async updateDeliveryState(
    messageId: string,
    deliveryState: DeliveryState,
    client: DatabaseClient,
  ): Promise<TaskMessageRow> {
    const result = await client.query<TaskMessageRow>(
      `UPDATE orchestrator_task_messages
          SET delivery_state = $2,
              worker_id = CASE WHEN $2 = 'worker_unassigned' THEN NULL ELSE worker_id END
        WHERE id = $1
      RETURNING id, tenant_id, workflow_id, task_id, orchestrator_task_id, activation_id, stage_name,
                worker_id, request_id, urgency, message, delivery_state, delivery_attempt_count,
                last_delivery_attempt_at, delivered_at, created_at`,
      [messageId, deliveryState],
    );
    return result.rows[0];
  }
}

function determineInitialDeliveryState(task: ManagedTaskRow): DeliveryState {
  if (task.state !== 'in_progress') {
    return 'task_not_in_progress';
  }
  if (task.assigned_worker_id === null) {
    return 'worker_unassigned';
  }
  return 'pending_delivery';
}

const resumableDeliveryStates: DeliveryState[] = [
  'pending_delivery',
  'delivery_in_progress',
  'worker_unassigned',
  'worker_unavailable',
];

function canResumeDelivery(state: DeliveryState): boolean {
  return resumableDeliveryStates.includes(state);
}

function toMessageResponse(row: TaskMessageRow): Record<string, unknown> {
  return {
    success: true,
    delivered: row.delivery_state === 'delivered',
    task_id: row.task_id,
    message_id: row.request_id,
    urgency: row.urgency,
    issued_at: row.created_at.toISOString(),
    delivery_state: row.delivery_state,
  };
}
