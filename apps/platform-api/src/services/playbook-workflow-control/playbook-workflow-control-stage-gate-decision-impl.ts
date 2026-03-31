
import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import { blockedColumnId, type PlaybookDefinition } from '../../orchestration/playbook-model.js';
import { blockWorkflowStageItems } from '../work-item-service/work-item-blocking.js';
import type {
  StageGateDecisionInput,
  WorkflowStageGateRow,
  WorkflowStageRow,
} from './playbook-workflow-control-types.js';
import {
  gateArtifactTaskIds,
  nullableText,
  singleResolvedOwnerRole,
} from './playbook-workflow-control-utils.js';

export async function loadGateRequestChangeTargetsImpl(this: any,
  tenantId: string,
  workflowId: string,
  gate: WorkflowStageGateRow,
  db: DatabaseClient | DatabasePool,
) {
  const artifactTaskIds = gateArtifactTaskIds(gate.key_artifacts);
  if (artifactTaskIds.length === 0) {
    return [] as Array<{ task_id: string; owner_role: string | null }>;
  }

  const result = await db.query<{ id: string; owner_role: string | null }>(
    `SELECT t.id,
            COALESCE(wi.owner_role, NULLIF(BTRIM(t.role), '')) AS owner_role
       FROM tasks t
       LEFT JOIN workflow_work_items wi
         ON wi.tenant_id = t.tenant_id
        AND wi.workflow_id = t.workflow_id
        AND wi.id = t.work_item_id
      WHERE t.tenant_id = $1
        AND t.workflow_id = $2
        AND t.id = ANY($3::uuid[])`,
    [tenantId, workflowId, artifactTaskIds],
  );

  return result.rows.map((row) => ({
    task_id: row.id,
    owner_role: row.owner_role,
  }));
}

export async function reactivateApprovedStageIfAwaitingGateImpl(this: any,
  tenantId: string,
  workflowId: string,
  stage: WorkflowStageRow,
  db: DatabaseClient | DatabasePool,
) {
  if (stage.gate_status !== 'approved' || stage.status !== 'awaiting_gate') {
    return stage;
  }

  const result = await db.query<WorkflowStageRow>(
    `UPDATE workflow_stages
        SET status = 'active',
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND name = $3
        AND gate_status = 'approved'
        AND status = 'awaiting_gate'
    RETURNING id, name, position, goal, guidance, status, gate_status,
              iteration_count, summary, metadata, started_at, completed_at, updated_at`,
    [tenantId, workflowId, stage.name],
  );
  return result.rows[0] ?? { ...stage, status: 'active' };
}

export async function hasNewGateRelatedHandoffSinceGateDecisionImpl(this: any,
  tenantId: string,
  workflowId: string,
  gate: WorkflowStageGateRow | null,
  stageName: string,
  decidedAt: Date,
  db: DatabaseClient | DatabasePool,
) {
  const artifactTaskIds = gateArtifactTaskIds(gate?.key_artifacts);
  if (artifactTaskIds.length > 0) {
    const artifactResult = await db.query<{ has_rework: boolean }>(
      `SELECT EXISTS (
          SELECT 1
            FROM task_handoffs h
           WHERE h.tenant_id = $1
             AND h.workflow_id = $2
             AND h.task_id = ANY($3::uuid[])
             AND h.created_at > $4
        ) AS has_rework`,
      [tenantId, workflowId, artifactTaskIds, decidedAt],
    );
    return artifactResult.rows[0]?.has_rework ?? false;
  }

  const result = await db.query<{ has_rework: boolean }>(
    `SELECT EXISTS (
        SELECT 1
          FROM task_handoffs h
          JOIN tasks t
            ON t.tenant_id = h.tenant_id
           AND t.id = h.task_id
         WHERE h.tenant_id = $1
           AND h.workflow_id = $2
           AND h.stage_name = $3
           AND h.created_at > $4
           AND COALESCE(t.is_orchestrator_task, FALSE) = FALSE
      ) AS has_rework`,
    [tenantId, workflowId, stageName, decidedAt],
  );
  return result.rows[0]?.has_rework ?? false;
}

export async function applyGateDecisionImpl(this: any,
  identity: ApiKeyIdentity,
  workflowId: string,
  stage: WorkflowStageRow,
  gate: WorkflowStageGateRow,
  input: StageGateDecisionInput,
  definition: PlaybookDefinition,
  client?: DatabaseClient,
) {
  const db = client ?? this.deps.pool;
  const decisionState =
    input.action === 'approve'
      ? { gate_status: 'approved', status: 'active', iterations: stage.iteration_count }
      : input.action === 'request_changes'
        ? { gate_status: 'changes_requested', status: 'active', iterations: stage.iteration_count + 1 }
        : input.action === 'block'
          ? { gate_status: 'blocked', status: 'blocked', iterations: stage.iteration_count + 1 }
          : { gate_status: 'rejected', status: 'blocked', iterations: stage.iteration_count + 1 };
  const feedback = nullableText(input.feedback);

  const updatedGateResult = await db.query<WorkflowStageGateRow>(
    `UPDATE workflow_stage_gates
        SET status = $4,
            decision_feedback = $5,
            decided_by_type = $6,
            decided_by_id = $7,
            decided_at = now(),
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
    RETURNING id, workflow_id, stage_id, stage_name, status, request_summary, recommendation,
              concerns, key_artifacts, requested_by_type, requested_by_id, requested_at,
              updated_at, subject_revision, decided_by_type, decided_by_id, decision_feedback,
              requested_by_work_item_id,
              decided_at, superseded_at, superseded_by_revision`,
    [
      identity.tenantId,
      workflowId,
      gate.id,
      decisionState.gate_status,
      feedback,
      identity.scope,
      identity.keyPrefix,
    ],
  );

  const updatedStage = await db.query<WorkflowStageRow>(
    `UPDATE workflow_stages
        SET gate_status = $4,
            status = $5,
            iteration_count = $6,
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND name = $3
    RETURNING id, name, position, goal, guidance, status, gate_status,
              iteration_count, summary, metadata, started_at, completed_at, updated_at`,
    [
      identity.tenantId,
      workflowId,
      stage.name,
      decisionState.gate_status,
      decisionState.status,
      decisionState.iterations,
    ],
  );

  if (input.action === 'request_changes') {
    const changeTargets = await this.loadGateRequestChangeTargets(
      identity.tenantId,
      workflowId,
      gate,
      db,
    );
    const nextExpectedActor = singleResolvedOwnerRole(changeTargets);
    if (this.deps.subjectTaskChangeService) {
      const feedbackText = feedback ?? 'Changes requested during human gate review.';
      for (const target of changeTargets) {
        await this.deps.subjectTaskChangeService.requestTaskChanges(
          identity,
          target.task_id,
          { feedback: feedbackText },
          client,
        );
      }
    }
    await db.query(
      `UPDATE workflow_work_items
          SET next_expected_actor = COALESCE($4, owner_role, next_expected_actor),
              next_expected_action = 'rework',
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND stage_name = $3
          AND completed_at IS NULL`,
      [identity.tenantId, workflowId, stage.name, nextExpectedActor],
    );
  } else {
    await db.query(
      `UPDATE workflow_work_items
          SET next_expected_actor = NULL,
              next_expected_action = NULL,
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
        AND stage_name = $3
        AND next_expected_action IN ('approve', 'rework')`,
      [identity.tenantId, workflowId, stage.name],
    );
    if (input.action === 'block') {
      await blockWorkflowStageItems(db, {
        tenantId: identity.tenantId,
        workflowId,
        stageName: stage.name,
        reason: feedback,
        blockedColumnId: blockedColumnId(definition),
      });
    }
  }

  await this.deps.eventService.emit(
    {
      tenantId: identity.tenantId,
      type: `stage.gate.${input.action}`,
      entityType: 'gate',
      entityId: gate.id,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: {
        workflow_id: workflowId,
        stage_name: stage.name,
        feedback,
        gate_id: gate.id,
      },
    },
    client,
  );

  const activation = await this.deps.activationService.enqueueForWorkflow(
    {
      tenantId: identity.tenantId,
      workflowId,
      reason: `stage.gate.${input.action}`,
      eventType: `stage.gate.${input.action}`,
      payload: {
        stage_name: stage.name,
        feedback,
        gate_id: gate.id,
        ...(updatedGateResult.rows[0]?.requested_by_work_item_id
          ? { work_item_id: updatedGateResult.rows[0].requested_by_work_item_id }
          : {}),
      },
      actorType: identity.scope,
      actorId: identity.keyPrefix,
    },
    client,
  );
  await this.deps.activationDispatchService.dispatchActivation(
    identity.tenantId,
    String(activation.id),
    client,
  );

  await this.deps.stateService.recomputeWorkflowState(identity.tenantId, workflowId, client, {
    actorType: identity.scope,
    actorId: identity.keyPrefix,
  });
  return {
    gate: updatedGateResult.rows[0],
    stage: updatedStage.rows[0],
    activation,
  };
}
