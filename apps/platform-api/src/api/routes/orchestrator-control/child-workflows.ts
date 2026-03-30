import type { FastifyInstance } from 'fastify';

import type { ApiKeyIdentity } from '../../../auth/api-key.js';

import {
  asRecord,
  dedupeStrings,
  readStringArray,
} from './shared.js';

export async function loadExistingChildWorkflow(
  app: FastifyInstance,
  identity: ApiKeyIdentity,
  parentWorkflowId: string,
  requestId: string,
) {
  const result = await app.pgPool.query<{ id: string }>(
    `SELECT id
       FROM workflows
      WHERE tenant_id = $1
        AND metadata->>'parent_workflow_id' = $2
        AND metadata->>'create_request_id' = $3
      LIMIT 1`,
    [identity.tenantId, parentWorkflowId, requestId],
  );
  const workflowId = result.rows[0]?.id;
  if (!workflowId) {
    return null;
  }
  return app.workflowService.getWorkflow(identity.tenantId, workflowId);
}

export function isWorkflowCreateRequestConflict(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const pgError = error as { code?: string; constraint?: string };
  return pgError.code === '23505' && pgError.constraint === 'idx_workflows_parent_create_request';
}

export interface ChildWorkflowLinkage {
  parentWorkflowId: string;
  parentOrchestratorTaskId: string;
  parentOrchestratorActivationId: string | null;
  parentWorkItemId: string | null;
  parentStageName: string | null;
  parentContext?: string;
}

export async function normalizeOrchestratorChildWorkflowLinkage(
  pool: FastifyInstance['pgPool'],
  tenantId: string,
  linkage: ChildWorkflowLinkage,
  childWorkflowId: string,
): Promise<void> {
  const [parentResult, childResult] = await Promise.all([
    pool.query<{ metadata: Record<string, unknown> | null }>(
      'SELECT metadata FROM workflows WHERE tenant_id = $1 AND id = $2',
      [tenantId, linkage.parentWorkflowId],
    ),
    pool.query<{ metadata: Record<string, unknown> | null }>(
      'SELECT metadata FROM workflows WHERE tenant_id = $1 AND id = $2',
      [tenantId, childWorkflowId],
    ),
  ]);
  if (!parentResult.rowCount || !childResult.rowCount) {
    return;
  }

  const parentMetadata = asRecord(parentResult.rows[0].metadata);
  const childMetadata = asRecord(childResult.rows[0].metadata);
  const childWorkflowIds = dedupeStrings([
    ...readStringArray(parentMetadata.child_workflow_ids),
    childWorkflowId,
  ]);

  await Promise.all([
    pool.query(
      `UPDATE workflows
          SET metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [
        tenantId,
        linkage.parentWorkflowId,
        {
          child_workflow_ids: childWorkflowIds,
          latest_child_workflow_id: childWorkflowId,
          latest_child_workflow_created_by_orchestrator_task_id: linkage.parentOrchestratorTaskId,
        },
      ],
    ),
    pool.query(
      `UPDATE workflows
          SET metadata = $3::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [
        tenantId,
        childWorkflowId,
        {
          ...childMetadata,
          parent_workflow_id: linkage.parentWorkflowId,
          parent_orchestrator_task_id: linkage.parentOrchestratorTaskId,
          parent_orchestrator_activation_id: linkage.parentOrchestratorActivationId,
          parent_work_item_id: linkage.parentWorkItemId,
          parent_stage_name: linkage.parentStageName,
          parent_context: linkage.parentContext ?? childMetadata.parent_context ?? null,
          parent_link_kind: 'orchestrator_child',
        },
      ],
    ),
  ]);
}
