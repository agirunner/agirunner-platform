
import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient } from '../../db/database.js';
import { ConflictError } from '../../errors/domain-errors.js';
import { parsePlaybookDefinition } from '../../orchestration/playbook-model.js';
import { toGateResponse } from '../workflow-stage/workflow-stage-gate-service.js';
import {
  gateRequiresSupersession,
  loadLatestStageSubjectRevision,
  supersedeStageGatesForRevision,
} from '../workflow-stage/workflow-stage-gate-revisions.js';
import type {
  StageGateDecisionInput,
  StageGateRequestInput,
  WorkflowStageGateRow,
  WorkflowStageRow,
} from './playbook-workflow-control-types.js';
import {
  buildStageGateWaitContinuationContract,
  isFollowOnGateDecisionAllowed,
  isIdempotentGateDecision,
  isIdempotentGateRequest,
  normalizeArtifactList,
  normalizeConcernList,
  nullableText,
  parseOptionalTimestamp,
  toStageDecisionResponse,
  toStageResponse,
} from './playbook-workflow-control-utils.js';

export async function requestStageGateApprovalInTransactionImpl(this: any,
  identity: ApiKeyIdentity,
  workflowId: string,
  stageName: string,
  input: StageGateRequestInput,
  db: DatabaseClient,
) {
  const workflow = await this.loadWorkflow(identity.tenantId, workflowId, db);
  if (workflow.lifecycle !== 'planned') {
    throw new ConflictError('Stage gate approvals are only supported for planned playbook workflows');
  }
  const definition = parsePlaybookDefinition(workflow.definition);

  const stage = await this.loadStage(identity.tenantId, workflowId, stageName, db);
  const subjectRevision = await loadLatestStageSubjectRevision(
    db,
    identity.tenantId,
    workflowId,
    stageName,
  );
  let latestGate = stage.gate_status === 'approved'
    ? await this.loadLatestGateForStage(identity.tenantId, workflowId, stage.id, db)
    : null;
  if (
    stage.gate_status === 'approved'
    && latestGate
    && gateRequiresSupersession(
      subjectRevision,
      latestGate.subject_revision,
      latestGate.superseded_at,
      undefined,
    )
  ) {
    await supersedeStageGatesForRevision(db, {
      tenantId: identity.tenantId,
      workflowId,
      stageId: stage.id,
      subjectRevision,
    });
    latestGate = null;
  } else if (stage.gate_status === 'approved') {
    return toStageResponse(
      await this.reactivateApprovedStageIfAwaitingGate(identity.tenantId, workflowId, stage, db),
    );
  }

  const existingGate = await this.loadAwaitingGate(identity.tenantId, workflowId, stage.id, db);
  if (existingGate) {
    return {
      ...toStageResponse(stage),
      continuation_contract: buildStageGateWaitContinuationContract(
        definition,
        stage.name,
        existingGate.status,
      ),
    };
  }

  latestGate ??= await this.loadLatestGateForStage(identity.tenantId, workflowId, stage.id, db);
  if (
    latestGate?.status === 'changes_requested'
    && latestGate.decided_at
    && !(await this.hasNewGateRelatedHandoffSinceGateDecision(
      identity.tenantId,
      workflowId,
      latestGate,
      stage.name,
      latestGate.decided_at,
      db,
    ))
  ) {
    throw new ConflictError(
      `Stage '${stageName}' was sent back with changes requested. Complete corrective work and submit a new stage handoff before requesting approval again.`,
    );
  }

  const recommendation = nullableText(input.recommendation);
  const keyArtifacts = normalizeArtifactList(input.key_artifacts);
  const concerns = normalizeConcernList(input.concerns);
  const gateResult = await db.query<WorkflowStageGateRow>(
    `INSERT INTO workflow_stage_gates (
        tenant_id, workflow_id, stage_id, stage_name, request_summary,
        recommendation, concerns, key_artifacts, status,
        requested_by_type, requested_by_id, requested_at, subject_revision, requested_by_work_item_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, 'awaiting_approval', $9, $10, now(), $11,
        (
          SELECT CASE
            WHEN (
              SELECT COUNT(*)
              FROM workflow_work_items wi
              WHERE wi.tenant_id = $1
                AND wi.workflow_id = $2
                AND wi.stage_name = $4
                AND wi.completed_at IS NULL
            ) = 1 THEN (
              SELECT wi.id
              FROM workflow_work_items wi
              WHERE wi.tenant_id = $1
                AND wi.workflow_id = $2
                AND wi.stage_name = $4
                AND wi.completed_at IS NULL
              ORDER BY wi.created_at ASC, wi.id ASC
              LIMIT 1
            )
            ELSE NULL
          END
        )
      )
    RETURNING id, workflow_id, stage_id, stage_name, status, request_summary, recommendation,
              concerns, key_artifacts, requested_by_type, requested_by_id, requested_at,
              updated_at, subject_revision, decided_by_type, decided_by_id, decision_feedback, decided_at,
              requested_by_work_item_id,
              superseded_at, superseded_by_revision`,
    [
      identity.tenantId,
      workflowId,
      stage.id,
      stageName,
      input.summary.trim(),
      recommendation,
      JSON.stringify(concerns),
      JSON.stringify(keyArtifacts),
      identity.scope,
      identity.keyPrefix,
      subjectRevision,
    ],
  );
  const gate = gateResult.rows[0];
  const result = await db.query<WorkflowStageRow>(
    `UPDATE workflow_stages
        SET status = 'awaiting_gate',
            gate_status = 'awaiting_approval',
            summary = $4,
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND name = $3
    RETURNING id, name, position, goal, guidance, status, gate_status,
              iteration_count, summary, metadata, started_at, completed_at, updated_at`,
    [identity.tenantId, workflowId, stageName, input.summary.trim()],
  );

  await this.deps.eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'stage.gate_requested',
      entityType: 'gate',
      entityId: gate.id,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: {
        workflow_id: workflowId,
        stage_name: stageName,
        gate_id: gate.id,
        request_summary: input.summary.trim(),
        recommendation,
      },
    },
    db,
  );
  await this.deps.stateService.recomputeWorkflowState(identity.tenantId, workflowId, db, {
    actorType: identity.scope,
    actorId: identity.keyPrefix,
  });
  return {
    ...toStageResponse(result.rows[0]),
    continuation_contract: buildStageGateWaitContinuationContract(
      definition,
      stage.name,
      gate.status,
    ),
  };
}

export async function actOnStageGateInTransactionImpl(this: any,
  identity: ApiKeyIdentity,
  workflowId: string,
  stageName: string,
  input: StageGateDecisionInput,
  db: DatabaseClient,
) {
  const workflow = await this.loadWorkflow(identity.tenantId, workflowId, db);
  if (workflow.lifecycle !== 'planned') {
    throw new ConflictError('Stage gate approvals are only supported for planned playbook workflows');
  }
  const definition = parsePlaybookDefinition(workflow.definition);

  const stage = await this.loadStage(identity.tenantId, workflowId, stageName, db);

  const gate = await this.loadAwaitingGate(identity.tenantId, workflowId, stage.id, db);
  if (!gate) {
    const latestGate = await this.loadLatestGateForStage(identity.tenantId, workflowId, stage.id, db);
    if (isIdempotentGateDecision(latestGate, input)) {
      return toStageDecisionResponse(
        await this.reactivateApprovedStageIfAwaitingGate(identity.tenantId, workflowId, stage, db),
      );
    }
    if (isFollowOnGateDecisionAllowed(latestGate, input)) {
      const outcome = await this.applyGateDecision(identity, workflowId, stage, latestGate, input, definition, db);
      return toStageDecisionResponse(outcome.stage, outcome.activation);
    }
    throw new ConflictError('No pending gate approval exists for this stage');
  }
  const outcome = await this.applyGateDecision(identity, workflowId, stage, gate, input, definition, db);
  return toStageDecisionResponse(outcome.stage, outcome.activation);
}

export async function actOnGateInTransactionImpl(this: any,
  identity: ApiKeyIdentity,
  gateId: string,
  input: StageGateDecisionInput,
  db: DatabaseClient,
) {
  const gate = await this.loadAwaitingGateById(identity.tenantId, gateId, db);
  if (!gate) {
    const existingGate = await this.loadGateById(identity.tenantId, gateId, db);
    if (isIdempotentGateDecision(existingGate, input)) {
      return toGateResponse(existingGate);
    }
    if (isFollowOnGateDecisionAllowed(existingGate, input)) {
      const workflow = await this.loadWorkflow(identity.tenantId, existingGate.workflow_id, db);
      if (workflow.lifecycle !== 'planned') {
        throw new ConflictError('Stage gate approvals are only supported for planned playbook workflows');
      }
      const definition = parsePlaybookDefinition(workflow.definition);
      const stage = await this.loadStage(identity.tenantId, workflow.id, existingGate.stage_name, db);
      const outcome = await this.applyGateDecision(identity, workflow.id, stage, existingGate, input, definition, db);
      return toGateResponse({
        ...outcome.gate,
        resume_activation_id: outcome.activation.activation_id ?? outcome.activation.id,
        resume_activation_state: outcome.activation.state,
        resume_activation_event_type: outcome.activation.event_type,
        resume_activation_reason: outcome.activation.reason,
        resume_activation_queued_at: parseOptionalTimestamp(outcome.activation.queued_at),
        resume_activation_started_at: parseOptionalTimestamp(outcome.activation.started_at),
        resume_activation_completed_at: parseOptionalTimestamp(outcome.activation.completed_at),
        resume_activation_summary: outcome.activation.summary,
        resume_activation_error: outcome.activation.error,
      });
    }
    throw new ConflictError('No pending gate approval exists for this gate');
  }
  const workflow = await this.loadWorkflow(identity.tenantId, gate.workflow_id, db);
  if (workflow.lifecycle !== 'planned') {
    throw new ConflictError('Stage gate approvals are only supported for planned playbook workflows');
  }
  const definition = parsePlaybookDefinition(workflow.definition);

  const stage = await this.loadStage(identity.tenantId, workflow.id, gate.stage_name, db);
  const outcome = await this.applyGateDecision(identity, workflow.id, stage, gate, input, definition, db);
  return toGateResponse({
    ...outcome.gate,
    resume_activation_id: outcome.activation.activation_id ?? outcome.activation.id,
    resume_activation_state: outcome.activation.state,
    resume_activation_event_type: outcome.activation.event_type,
    resume_activation_reason: outcome.activation.reason,
    resume_activation_queued_at: parseOptionalTimestamp(outcome.activation.queued_at),
    resume_activation_started_at: parseOptionalTimestamp(outcome.activation.started_at),
    resume_activation_completed_at: parseOptionalTimestamp(outcome.activation.completed_at),
    resume_activation_summary: outcome.activation.summary,
    resume_activation_error: outcome.activation.error,
  });
}
