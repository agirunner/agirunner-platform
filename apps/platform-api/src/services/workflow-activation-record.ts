import type { DatabaseClient, DatabasePool, DatabaseQueryable } from '../db/database.js';
import { EventService } from './event-service.js';

export interface WorkflowActivationEventRow {
  id: string;
  workflow_id: string;
  activation_id: string | null;
  request_id: string | null;
  reason: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  state: string;
  queued_at: Date;
  started_at: Date | null;
  consumed_at: Date | null;
  completed_at: Date | null;
  summary: string | null;
  error: Record<string, unknown> | null;
}

interface WorkflowActivationRecordParams {
  tenantId: string;
  workflowId: string;
  requestId?: string;
  reason: string;
  eventType: string;
  payload?: Record<string, unknown>;
  actorType?: string;
  actorId?: string;
}

export async function isPlaybookWorkflow(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
) {
  const result = await db.query<{ playbook_id: string | null }>(
    'SELECT playbook_id FROM workflows WHERE tenant_id = $1 AND id = $2',
    [tenantId, workflowId],
  );
  if (!result.rowCount) {
    return false;
  }
  return Boolean(result.rows[0].playbook_id);
}

export async function enqueueWorkflowActivationRecord(
  db: DatabaseClient | DatabasePool,
  eventService: EventService,
  params: WorkflowActivationRecordParams,
) {
  const requestId = params.requestId?.trim() || null;
  const result = await db.query<WorkflowActivationEventRow>(
    `INSERT INTO workflow_activations (tenant_id, workflow_id, request_id, reason, event_type, payload)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id, workflow_id, request_id)
     WHERE request_id IS NOT NULL
     DO NOTHING
     RETURNING id, workflow_id, activation_id, request_id, reason, event_type, payload, state,
               queued_at, started_at, consumed_at, completed_at, summary, error`,
    [
      params.tenantId,
      params.workflowId,
      requestId,
      params.reason.trim(),
      params.eventType.trim(),
      params.payload ?? {},
    ],
  );
  if (!result.rowCount) {
    if (!requestId) {
      throw new Error('Failed to enqueue workflow activation event');
    }
    const existing = await db.query<WorkflowActivationEventRow>(
      `SELECT id, workflow_id, activation_id, request_id, reason, event_type, payload, state,
              queued_at, started_at, consumed_at, completed_at, summary, error
         FROM workflow_activations
        WHERE tenant_id = $1 AND workflow_id = $2 AND request_id = $3
        LIMIT 1`,
      [params.tenantId, params.workflowId, requestId],
    );
    if (existing.rowCount) {
      return existing.rows[0];
    }
    throw new Error('Failed to load existing workflow activation event after conflict');
  }

  await eventService.emit(
    {
      tenantId: params.tenantId,
      type: 'workflow.activation_queued',
      entityType: 'workflow',
      entityId: params.workflowId,
      actorType: params.actorType ?? 'system',
      actorId: params.actorId ?? 'workflow_activation_service',
      data: {
        activation_id: result.rows[0].id,
        event_type: params.eventType,
        reason: params.reason,
      },
    },
    'release' in db ? db : undefined,
  );

  return result.rows[0];
}
