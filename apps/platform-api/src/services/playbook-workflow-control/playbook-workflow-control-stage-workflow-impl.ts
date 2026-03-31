
import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient } from '../../db/database.js';
import { ConflictError, ValidationError } from '../../errors/domain-errors.js';
import { parsePlaybookDefinition } from '../../orchestration/playbook-model.js';
import {
  mergeCompletionCallouts,
  normalizeCompletionCalloutsInput,
} from '../guided-closure/types.js';
import { reconcilePlannedWorkflowStages } from '../workflow-stage/workflow-stage-reconciliation.js';
import type { AdvanceStageInput, CompleteWorkflowInput } from './playbook-workflow-control-types.js';
import {
  isIdempotentStageAdvance,
  nextStageNameFor,
  normalizeStringArray,
  nullableText,
  readCompletionArtifacts,
  readCompletionSummary,
  readWorkflowCompletionCallouts,
  terminalColumnIdFor,
} from './playbook-workflow-control-utils.js';

export async function advanceStageInTransactionImpl(this: any,
  identity: ApiKeyIdentity,
  workflowId: string,
  stageName: string,
  input: AdvanceStageInput,
  db: DatabaseClient,
) {
  const workflow = await this.loadWorkflow(identity.tenantId, workflowId, db);
  if (workflow.lifecycle !== 'planned') {
    throw new ConflictError('Stage advancement is only supported for planned playbook workflows');
  }

  const definition = parsePlaybookDefinition(workflow.definition);
  const sourceStage = await this.loadStage(identity.tenantId, workflowId, stageName, db);
  const expectedNextStageName = nextStageNameFor(definition, sourceStage.name);
  if (!expectedNextStageName) {
    throw new ValidationError('No next stage is available; use complete_workflow for the final stage');
  }
  const nextStageName = input.to_stage_name ?? expectedNextStageName;
  if (nextStageName !== expectedNextStageName) {
    throw new ValidationError(
      `Stage '${stageName}' may only advance to the immediate next planned stage ` +
        `'${expectedNextStageName}', not '${nextStageName}'.`,
    );
  }
  if (workflow.active_stage_name !== sourceStage.name) {
    if (isIdempotentStageAdvance(workflow.active_stage_name, sourceStage, nextStageName)) {
      return {
        completed_stage: stageName,
        next_stage: nextStageName,
      };
    }
    throw new ValidationError(`Stage '${stageName}' is not the current workflow stage`);
  }
  if (sourceStage.gate_status === 'awaiting_approval') {
    throw new ValidationError(`Stage '${stageName}' requires human approval before it can advance`);
  }

  const nextStage = await this.loadStage(identity.tenantId, workflowId, nextStageName, db);
  await this.assertStageHasNoPendingBlockingContinuation(
    identity.tenantId,
    workflowId,
    sourceStage.name,
    db,
  );
  await this.assertStageHasNoBlockingAssessmentResolution(
    identity.tenantId,
    workflowId,
    sourceStage.name,
    db,
  );
  await this.completeOpenCheckpointWorkItems(
    identity.tenantId,
    workflowId,
    sourceStage.name,
    terminalColumnIdFor(definition),
    db,
  );
  await db.query(
    `UPDATE workflow_stages
        SET status = 'completed',
            completed_at = now(),
            summary = COALESCE($4, summary),
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND name = $3`,
    [identity.tenantId, workflowId, stageName, nullableText(input.summary)],
  );
  await db.query(
    `UPDATE workflow_stages
        SET status = 'active',
            started_at = COALESCE(started_at, now()),
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND name = $3`,
    [identity.tenantId, workflowId, nextStage.name],
  );

  await this.deps.eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'stage.completed',
      entityType: 'workflow',
      entityId: workflowId,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: { stage_name: stageName, summary: nullableText(input.summary) },
    },
    db,
  );
  await this.deps.eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'stage.started',
      entityType: 'workflow',
      entityId: workflowId,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: { stage_name: nextStage.name },
    },
    db,
  );
  await this.deps.stateService.recomputeWorkflowState(identity.tenantId, workflowId, db, {
    actorType: identity.scope,
    actorId: identity.keyPrefix,
  });

  const activation = await this.deps.activationService.enqueueForWorkflow(
    {
      tenantId: identity.tenantId,
      workflowId,
      reason: 'stage.started',
      eventType: 'stage.started',
      payload: {
        stage_name: nextStage.name,
        previous_stage_name: stageName,
      },
      actorType: identity.scope,
      actorId: identity.keyPrefix,
    },
    db,
  );
  await this.deps.activationDispatchService.dispatchActivation(
    identity.tenantId,
    String(activation.id),
    db,
  );

  return {
    completed_stage: stageName,
    next_stage: nextStage.name,
  };
}

export async function completeWorkflowInTransactionImpl(this: any,
  identity: ApiKeyIdentity,
  workflowId: string,
  input: CompleteWorkflowInput,
  db: DatabaseClient,
) {
  let workflow = await this.loadWorkflow(identity.tenantId, workflowId, db);
  if (workflow.lifecycle !== 'planned') {
    throw new ConflictError('Only planned playbook workflows can be completed by the orchestrator');
  }
  const definition = parsePlaybookDefinition(workflow.definition);
  if (workflow.state === 'completed') {
    return {
      workflow_id: workflowId,
      state: 'completed',
      summary: readCompletionSummary(workflow) ?? input.summary.trim(),
      final_artifacts: readCompletionArtifacts(workflow),
      completion_callouts: readWorkflowCompletionCallouts(workflow),
    };
  }

  await this.assertWorkflowHasNoActiveNonOrchestratorTasks(identity.tenantId, workflowId, db);

  const finalArtifacts = normalizeStringArray(input.final_artifacts);
  const requestedCompletionCallouts = normalizeCompletionCalloutsInput(input);
  const allowAdvisoryCarryForward = requestedCompletionCallouts.unresolved_advisory_items.length > 0;
  const completedStageNames = new Set<string>();
  for (let remainingStages = Math.max(definition.stages.length, 1); remainingStages > 0; remainingStages -= 1) {
    await reconcilePlannedWorkflowStages(db, identity.tenantId, workflowId);
    workflow = await this.loadWorkflow(identity.tenantId, workflowId, db);
    if (!workflow.active_stage_name) {
      break;
    }
    const stage = await this.loadStage(identity.tenantId, workflowId, workflow.active_stage_name, db);
    if (completedStageNames.has(stage.name)) {
      break;
    }
    if (stage.gate_status === 'awaiting_approval') {
      throw new ValidationError(`Stage '${stage.name}' requires human approval before workflow completion`);
    }
    await this.assertStageHasNoPendingBlockingContinuation(
      identity.tenantId,
      workflowId,
      stage.name,
      db,
      allowAdvisoryCarryForward,
    );
    await this.assertStageHasNoBlockingAssessmentResolution(
      identity.tenantId,
      workflowId,
      stage.name,
      db,
    );
    await this.completeOpenCheckpointWorkItems(
      identity.tenantId,
      workflowId,
      stage.name,
      terminalColumnIdFor(definition),
      db,
    );
    if (stage.status !== 'completed') {
      await db.query(
        `UPDATE workflow_stages
            SET status = 'completed',
                completed_at = COALESCE(completed_at, now()),
                summary = COALESCE($4, summary),
                updated_at = now()
          WHERE tenant_id = $1
            AND workflow_id = $2
            AND name = $3`,
        [identity.tenantId, workflowId, stage.name, input.summary.trim()],
      );
      await this.deps.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'stage.completed',
          entityType: 'workflow',
          entityId: workflowId,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: { stage_name: stage.name, summary: input.summary.trim() },
        },
        db,
      );
    }
    completedStageNames.add(stage.name);
  }

  await reconcilePlannedWorkflowStages(db, identity.tenantId, workflowId);

  const incompleteStages = await db.query<{ name: string }>(
    `SELECT name
       FROM workflow_stages
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND status <> 'completed'
      LIMIT 1`,
    [identity.tenantId, workflowId],
  );
  if (incompleteStages.rowCount) {
    throw new ValidationError(`Workflow still has incomplete stage '${incompleteStages.rows[0].name}'`);
  }

  const workItemCallouts = await this.loadWorkflowCompletionCallouts(
    identity.tenantId,
    workflowId,
    db,
  );
  const aggregatedCompletionCallouts = mergeCompletionCallouts(
    ...workItemCallouts,
    requestedCompletionCallouts,
  );

  await db.query(
    `UPDATE workflows
        SET orchestration_state = jsonb_set(
              jsonb_set(
                COALESCE(orchestration_state, '{}'::jsonb),
                '{completion_summary}',
                to_jsonb($3::text),
                true
              ),
              '{final_artifacts}',
              $4::jsonb,
              true
            ),
            completion_callouts = $5::jsonb,
            updated_at = now()
      WHERE tenant_id = $1
        AND id = $2`,
    [
      identity.tenantId,
      workflowId,
      input.summary.trim(),
      JSON.stringify(finalArtifacts),
      aggregatedCompletionCallouts,
    ],
  );
  const state = await this.deps.stateService.recomputeWorkflowState(identity.tenantId, workflowId, db, {
    actorType: identity.scope,
    actorId: identity.keyPrefix,
  });
  if (state !== 'completed') {
    throw new ConflictError('Workflow could not be completed');
  }
  await db.query(
    `UPDATE workflow_activations
        SET state = 'completed',
            consumed_at = COALESCE(consumed_at, now()),
            completed_at = COALESCE(completed_at, now()),
            dispatch_token = NULL,
            summary = COALESCE(summary, 'Ignored activation because workflow is already completed.')
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND state = 'queued'
        AND activation_id IS NULL
        AND consumed_at IS NULL`,
    [identity.tenantId, workflowId],
  );
  await this.deps.eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'workflow.completed',
      entityType: 'workflow',
      entityId: workflowId,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: {
        summary: input.summary.trim(),
        final_artifacts: finalArtifacts,
        completion_callouts: aggregatedCompletionCallouts,
      },
    },
    db,
  );
  return {
    workflow_id: workflowId,
    state,
    summary: input.summary.trim(),
    final_artifacts: finalArtifacts,
    completion_callouts: aggregatedCompletionCallouts,
  };
}
