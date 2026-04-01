import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ValidationError } from '../../../errors/domain-errors.js';
import { logSafetynetTriggered } from '../../../services/safetynet/logging.js';
import {
  PLATFORM_ORCHESTRATOR_STAGE_ALIGNMENT_REPAIR_ID,
  mustGetSafetynetEntry,
} from '../../../services/safetynet/registry.js';

import { orchestratorTaskCreateSchema } from './schemas.js';

const STAGE_ALIGNMENT_REPAIR_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_ORCHESTRATOR_STAGE_ALIGNMENT_REPAIR_ID,
);

interface TaskCreateStageAlignedWorkItem {
  work_item_id: string;
  source: 'parent_stage_match' | 'child_stage_match' | null;
}

interface TaskCreateWorkItemStageContextRow {
  id: string;
  stage_name: string;
  parent_work_item_id: string | null;
  parent_id: string | null;
  parent_stage_name: string | null;
  workflow_lifecycle: string | null;
}

export async function alignOrchestratorTaskCreateWorkItemToStage(
  pool: FastifyInstance['pgPool'],
  tenantId: string,
  workflowId: string,
  body: z.infer<typeof orchestratorTaskCreateSchema>,
): Promise<z.infer<typeof orchestratorTaskCreateSchema>> {
  const aligned = await resolveStageAlignedTaskWorkItemId(
    pool,
    tenantId,
    workflowId,
    body.work_item_id,
    body.stage_name,
  );
  if (aligned.source === null || aligned.work_item_id === body.work_item_id) {
    return body;
  }

  logSafetynetTriggered(
    STAGE_ALIGNMENT_REPAIR_SAFETYNET,
    'orchestrator create_task repaired work_item_id to match the requested stage',
    {
      workflow_id: workflowId,
      requested_work_item_id: body.work_item_id,
      aligned_work_item_id: aligned.work_item_id,
      alignment_source: aligned.source,
      target_stage_name: body.stage_name,
    },
  );

  return {
    ...body,
    work_item_id: aligned.work_item_id,
    metadata: {
      ...(body.metadata ?? {}),
      stage_aligned_work_item_id_source: aligned.source,
    },
  };
}

async function resolveStageAlignedTaskWorkItemId(
  pool: FastifyInstance['pgPool'],
  tenantId: string,
  workflowId: string,
  workItemId: string,
  targetStageName: string,
): Promise<TaskCreateStageAlignedWorkItem> {
  const contextResult = await pool.query<TaskCreateWorkItemStageContextRow>(
    `SELECT wi.id,
            wi.stage_name,
            wi.parent_work_item_id,
            parent.id AS parent_id,
            parent.stage_name AS parent_stage_name,
            w.lifecycle AS workflow_lifecycle
       FROM workflow_work_items wi
       JOIN workflows w
         ON w.tenant_id = wi.tenant_id
        AND w.id = wi.workflow_id
       LEFT JOIN workflow_work_items parent
         ON parent.tenant_id = wi.tenant_id
        AND parent.workflow_id = wi.workflow_id
        AND parent.id = wi.parent_work_item_id
      WHERE wi.tenant_id = $1
        AND wi.workflow_id = $2
        AND wi.id = $3
      LIMIT 1`,
    [tenantId, workflowId, workItemId],
  );
  const current = contextResult.rows[0];
  if (!current || current.workflow_lifecycle !== 'planned' || current.stage_name === targetStageName) {
    return { work_item_id: workItemId, source: null };
  }

  if (current.parent_id && current.parent_stage_name === targetStageName) {
    return {
      work_item_id: current.parent_id,
      source: 'parent_stage_match',
    };
  }

  const childResult = await pool.query<{ id: string }>(
    `SELECT id
       FROM workflow_work_items
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND parent_work_item_id = $3
        AND stage_name = $4
      ORDER BY updated_at DESC
      LIMIT 2`,
    [tenantId, workflowId, workItemId, targetStageName],
  );
  if ((childResult.rowCount ?? childResult.rows.length) === 1) {
    return {
      work_item_id: childResult.rows[0].id,
      source: 'child_stage_match',
    };
  }
  if ((childResult.rowCount ?? childResult.rows.length) > 1) {
    throw new ValidationError(
      `work_item_id '${workItemId}' does not match stage '${targetStageName}' and multiple child work items exist in the requested stage. Specify the exact target work_item_id.`,
    );
  }

  return { work_item_id: workItemId, source: null };
}
