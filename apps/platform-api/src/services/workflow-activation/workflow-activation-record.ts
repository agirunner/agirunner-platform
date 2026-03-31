import type { DatabaseClient, DatabasePool, DatabaseQueryable } from '../../db/database.js';
import { EventService } from '../event/event-service.js';
import { sanitizeSecretLikeRecord } from '../secret-redaction.js';
import {
  PLATFORM_CONTROL_PLANE_IDEMPOTENT_MUTATION_REPLAY_ID,
  mustGetSafetynetEntry,
} from '../safetynet/registry.js';
import { logSafetynetTriggered } from '../safetynet/logging.js';

const IDEMPOTENT_MUTATION_REPLAY_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_CONTROL_PLANE_IDEMPOTENT_MUTATION_REPLAY_ID,
);

export interface WorkflowActivationEventRow {
  id: string;
  workflow_id: string;
  activation_id: string | null;
  request_id: string | null;
  reason: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  state: string;
  dispatch_attempt: number;
  dispatch_token: string | null;
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
  const payload = sanitizeSecretLikeRecord(params.payload ?? {}, {
    redactionValue: 'redacted://activation-secret',
    allowSecretReferences: false,
  });
  const result = await db.query<WorkflowActivationEventRow>(
    `INSERT INTO workflow_activations (
       tenant_id,
       workflow_id,
       request_id,
       reason,
       event_type,
       payload,
       state,
       consumed_at,
       completed_at,
       summary
     )
     SELECT
       $1,
       $2,
       $3,
       $4,
       $5,
       $6,
       CASE
         WHEN w.state IN ('completed', 'failed', 'cancelled') THEN 'completed'
         WHEN COALESCE(NULLIF(w.metadata->>'cancel_requested_at', ''), '') <> '' THEN 'completed'
         WHEN w.state = 'paused' THEN 'completed'
         WHEN COALESCE(NULLIF(w.metadata->>'pause_requested_at', ''), '') <> '' THEN 'completed'
         ELSE 'queued'
       END,
       CASE
         WHEN w.state IN ('completed', 'failed', 'cancelled') THEN now()
         WHEN COALESCE(NULLIF(w.metadata->>'cancel_requested_at', ''), '') <> '' THEN now()
         WHEN w.state = 'paused' THEN now()
         WHEN COALESCE(NULLIF(w.metadata->>'pause_requested_at', ''), '') <> '' THEN now()
         ELSE NULL
       END,
       CASE
         WHEN w.state IN ('completed', 'failed', 'cancelled') THEN now()
         WHEN COALESCE(NULLIF(w.metadata->>'cancel_requested_at', ''), '') <> '' THEN now()
         WHEN w.state = 'paused' THEN now()
         WHEN COALESCE(NULLIF(w.metadata->>'pause_requested_at', ''), '') <> '' THEN now()
         ELSE NULL
       END,
       CASE
         WHEN w.state IN ('completed', 'failed', 'cancelled')
           THEN 'Ignored activation because workflow is already ' || w.state || '.'
         WHEN COALESCE(NULLIF(w.metadata->>'cancel_requested_at', ''), '') <> ''
           THEN 'Ignored activation because workflow cancellation is already in progress.'
         WHEN w.state = 'paused'
           OR COALESCE(NULLIF(w.metadata->>'pause_requested_at', ''), '') <> ''
           THEN 'Ignored activation because workflow is paused.'
         ELSE NULL
       END
     FROM workflows w
     WHERE w.tenant_id = $1
       AND w.id = $2
     ON CONFLICT (tenant_id, workflow_id, request_id)
     WHERE request_id IS NOT NULL
     DO NOTHING
     RETURNING id, workflow_id, activation_id, request_id, reason, event_type, payload, state,
               dispatch_attempt, dispatch_token, queued_at, started_at, consumed_at, completed_at, summary, error`,
    [
      params.tenantId,
      params.workflowId,
      requestId,
      params.reason.trim(),
      params.eventType.trim(),
      payload,
    ],
  );
  if (!result.rowCount) {
    if (!requestId) {
      throw new Error('Failed to enqueue workflow activation event');
    }
    const existing = await db.query<WorkflowActivationEventRow>(
      `SELECT id, workflow_id, activation_id, request_id, reason, event_type, payload, state,
              dispatch_attempt, dispatch_token, queued_at, started_at, consumed_at, completed_at, summary, error
         FROM workflow_activations
        WHERE tenant_id = $1 AND workflow_id = $2 AND request_id = $3
        LIMIT 1`,
      [params.tenantId, params.workflowId, requestId],
    );
    if (existing.rowCount) {
      logSafetynetTriggered(
        IDEMPOTENT_MUTATION_REPLAY_SAFETYNET,
        'idempotent workflow activation replay returned stored activation event',
        { workflow_id: params.workflowId, request_id: requestId, event_type: params.eventType },
      );
      return existing.rows[0];
    }
    throw new Error('Failed to load existing workflow activation event after conflict');
  }

  if (result.rows[0].state === 'queued') {
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
  }

  return result.rows[0];
}
