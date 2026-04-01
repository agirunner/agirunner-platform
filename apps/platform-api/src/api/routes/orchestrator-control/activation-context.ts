import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { DatabaseQueryable } from '../../../db/database.js';
import { logSafetynetTriggered } from '../../../services/safetynet/logging.js';
import {
  PLATFORM_ORCHESTRATOR_PARENT_WORK_ITEM_DEFAULT_INFERENCE_ID,
  mustGetSafetynetEntry,
} from '../../../services/safetynet/registry.js';
import type { ActiveOrchestratorTaskScope } from '../../../services/task/task-agent-scope-service.js';

import { asRecord, readString } from './shared.js';
import { workItemCreateSchema } from './schemas.js';

const PARENT_WORK_ITEM_DEFAULT_INFERENCE_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_ORCHESTRATOR_PARENT_WORK_ITEM_DEFAULT_INFERENCE_ID,
);

export interface OrchestratorCreateWorkItemContext {
  lifecycle: string | null;
  event_type: string | null;
  payload: Record<string, unknown>;
}

export async function normalizeOrchestratorWorkItemCreateInput(
  pool: FastifyInstance['pgPool'],
  tenantId: string,
  taskScope: ActiveOrchestratorTaskScope,
  body: z.infer<typeof workItemCreateSchema>,
): Promise<z.infer<typeof workItemCreateSchema>> {
  if (body.parent_work_item_id) {
    return body;
  }

  const context = await loadOrchestratorCreateWorkItemContext(
    pool,
    tenantId,
    taskScope.workflow_id,
    taskScope.activation_id,
  );
  const fallbackParentId = taskScope.work_item_id ?? readString(context.payload.work_item_id);
  if (!fallbackParentId || context.lifecycle !== 'planned') {
    return body;
  }
  if (
    !shouldDefaultParentWorkItemId(context.event_type, context.payload)
    && !shouldDefaultCrossStageParentWorkItemId(taskScope, body, context.payload)
  ) {
    return body;
  }
  logSafetynetTriggered(
    PARENT_WORK_ITEM_DEFAULT_INFERENCE_SAFETYNET,
    'orchestrator create_work_item defaulted parent_work_item_id from activation context',
    {
      workflow_id: taskScope.workflow_id,
      activation_id: taskScope.activation_id,
      parent_work_item_id: fallbackParentId,
      activation_event_type: context.event_type,
      requested_stage_name: body.stage_name,
    },
  );
  return {
    ...body,
    parent_work_item_id: fallbackParentId,
  };
}

export async function loadOrchestratorCreateWorkItemContext(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  activationId: string | null,
): Promise<OrchestratorCreateWorkItemContext> {
  if (!activationId) {
    return {
      lifecycle: null,
      event_type: null,
      payload: {},
    };
  }

  const result = await db.query<OrchestratorCreateWorkItemContext>(
    `SELECT w.lifecycle,
            wa.event_type,
            COALESCE(wa.payload, '{}'::jsonb) AS payload
       FROM workflows w
       LEFT JOIN workflow_activations wa
         ON wa.tenant_id = w.tenant_id
        AND wa.workflow_id = w.id
        AND (wa.id = $3 OR wa.activation_id = $3)
      WHERE w.tenant_id = $1
        AND w.id = $2
      LIMIT 1`,
    [tenantId, workflowId, activationId],
  );
  const row = result.rows[0];
  return {
    lifecycle: row?.lifecycle ?? null,
    event_type: row?.event_type ?? null,
    payload: asRecord(row?.payload),
  };
}

function shouldDefaultParentWorkItemId(
  eventType: string | null,
  payload: Record<string, unknown>,
): boolean {
  if (!readString(payload.work_item_id) || !eventType) {
    return false;
  }
  return new Set([
    'task.completed',
    'task.output_pending_assessment',
    'task.output_assessment.approved',
    'task.output_assessment.rejected',
    'stage.gate.approve',
    'stage.gate.reject',
    'work_item.created',
  ]).has(eventType);
}

function shouldDefaultCrossStageParentWorkItemId(
  taskScope: ActiveOrchestratorTaskScope,
  body: z.infer<typeof workItemCreateSchema>,
  payload: Record<string, unknown>,
) {
  if (!readString(payload.work_item_id)) {
    return false;
  }
  const activationStageName = readString(payload.stage_name) ?? taskScope.stage_name;
  if (!activationStageName || !body.stage_name) {
    return false;
  }
  return activationStageName !== body.stage_name;
}
