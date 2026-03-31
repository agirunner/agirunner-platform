
import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient } from '../../db/database.js';
import { ConflictError, ValidationError } from '../../errors/domain-errors.js';
import {
  hasBoardColumn,
  hasStage,
  parsePlaybookDefinition,
} from '../../orchestration/playbook-model.js';
import { normalizeCompletionCalloutsInput } from '../guided-closure/types.js';
import { reconcilePlannedWorkflowStages } from '../workflow-stage/workflow-stage-reconciliation.js';
import {
  loadOpenWorkItemEscalation,
  resolveWorkItemEscalation,
} from '../work-item-service/work-item-escalations.js';
import type {
  CompleteWorkflowWorkItemInput,
  ResolveWorkflowWorkItemEscalationInput,
  UpdateWorkflowWorkItemInput,
} from './playbook-workflow-control-types.js';
import {
  buildWorkItemUpdatePayload,
  emitWorkItemUpdateEvents,
  normalizeWorkItemUpdate,
  nullableText,
  sameNormalizedWorkItem,
  stripOrchestratorFinishState,
  terminalColumnIdFor,
  toWorkItemResponse,
} from './playbook-workflow-control-utils.js';

export async function updateWorkItemInTransactionImpl(this: any,
  identity: ApiKeyIdentity,
  workflowId: string,
  workItemId: string,
  input: UpdateWorkflowWorkItemInput,
  db: DatabaseClient,
) {
  const workflow = await this.loadWorkflow(identity.tenantId, workflowId, db);
  const definition = parsePlaybookDefinition(workflow.definition);
  const workItem = await this.loadWorkItem(identity.tenantId, workflowId, workItemId, db);

  const nextStageName = input.stage_name ?? workItem.stage_name;
  const nextColumnId = input.column_id ?? workItem.column_id;
  const nextParentWorkItemId =
    input.parent_work_item_id === undefined ? workItem.parent_work_item_id : input.parent_work_item_id;
  if (!hasStage(definition, nextStageName)) {
    throw new ValidationError(`Unknown stage '${nextStageName}' for this workflow`);
  }
  if (!hasBoardColumn(definition, nextColumnId)) {
    throw new ValidationError(`Unknown board column '${nextColumnId}' for this workflow`);
  }
  await this.assertValidParentChange(identity.tenantId, workflowId, workItemId, nextParentWorkItemId, db);

  const terminalColumns = new Set(
    definition.board.columns.filter((column) => column.is_terminal).map((column) => column.id),
  );
  const normalizedUpdate = normalizeWorkItemUpdate(workItem, input, {
    parentWorkItemId: nextParentWorkItemId,
    stageName: nextStageName,
    columnId: nextColumnId,
    terminalColumns,
  });
  if (
    normalizedUpdate.completed_at !== null
    && workItem.completed_at === null
  ) {
    await this.assertWorkItemHasNoActiveTasks(
      identity.tenantId,
      workflowId,
      workItemId,
      workItem.title,
      null,
      db,
    );
    await this.assertNoPendingBlockingContinuation(
      identity.tenantId,
      workflowId,
      workItem,
      db,
    );
    await this.assertWorkItemHasNoBlockingAssessmentResolution(
      identity.tenantId,
      workflowId,
      workItemId,
      workItem.title,
      db,
    );
  }
  if (sameNormalizedWorkItem(workItem, normalizedUpdate)) {
    return toWorkItemResponse(workItem);
  }

  const result = await db.query<WorkflowWorkItemRow>(
    `UPDATE workflow_work_items
        SET parent_work_item_id = $4,
            title = $5,
            goal = $6,
            acceptance_criteria = $7,
            stage_name = $8,
            column_id = $9,
            owner_role = $10,
            next_expected_actor = $11,
            next_expected_action = $12,
            priority = $13,
            notes = $14,
            completed_at = $15,
            metadata = $16::jsonb,
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
    RETURNING id,
              parent_work_item_id,
              stage_name,
              title,
              goal,
              acceptance_criteria,
              column_id,
              owner_role,
              next_expected_actor,
              next_expected_action,
              escalation_status,
              rework_count,
              priority,
              notes,
              completed_at,
              metadata,
              updated_at`,
    [
      identity.tenantId,
      workflowId,
      workItemId,
      normalizedUpdate.parent_work_item_id,
      normalizedUpdate.title,
      normalizedUpdate.goal,
      normalizedUpdate.acceptance_criteria,
      normalizedUpdate.stage_name,
      normalizedUpdate.column_id,
      normalizedUpdate.owner_role,
      normalizedUpdate.next_expected_actor,
      normalizedUpdate.next_expected_action,
      normalizedUpdate.priority,
      normalizedUpdate.notes,
      normalizedUpdate.completed_at,
      normalizedUpdate.metadata,
    ],
  );

  const updatedWorkItem = result.rows[0];
  if (workflow.lifecycle === 'planned') {
    await reconcilePlannedWorkflowStages(db, identity.tenantId, workflowId);
  }
  await emitWorkItemUpdateEvents(this.deps, identity, workflowId, workItem, updatedWorkItem, db);
  const activation = await this.deps.activationService.enqueueForWorkflow(
    {
      tenantId: identity.tenantId,
      workflowId,
      reason: 'work_item.updated',
      eventType: 'work_item.updated',
      payload: buildWorkItemUpdatePayload(workItem, updatedWorkItem),
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
  await this.deps.stateService.recomputeWorkflowState(identity.tenantId, workflowId, db, {
    actorType: identity.scope,
    actorId: identity.keyPrefix,
  });
  return toWorkItemResponse(updatedWorkItem);
}

export async function completeWorkItemInTransactionImpl(this: any,
  identity: ApiKeyIdentity,
  workflowId: string,
  workItemId: string,
  input: CompleteWorkflowWorkItemInput,
  db: DatabaseClient,
) {
  const workflow = await this.loadWorkflow(identity.tenantId, workflowId, db);
  const definition = parsePlaybookDefinition(workflow.definition);
  const terminalColumnId = terminalColumnIdFor(definition);
  if (!terminalColumnId) {
    throw new ValidationError('This workflow has no terminal board column configured');
  }
  const workItem = await this.loadWorkItem(identity.tenantId, workflowId, workItemId, db);
  if (workItem.completed_at && workItem.column_id === terminalColumnId) {
    return toWorkItemResponse(workItem);
  }

  const completionCallouts = normalizeCompletionCalloutsInput(input);
  const allowAdvisoryCarryForward = completionCallouts.unresolved_advisory_items.length > 0;
  await this.assertWorkItemHasNoActiveTasks(
    identity.tenantId,
    workflowId,
    workItemId,
    workItem.title,
    input.acting_task_id ?? null,
    db,
  );
  await this.assertNoPendingBlockingContinuation(
    identity.tenantId,
    workflowId,
    workItem,
    db,
    allowAdvisoryCarryForward,
  );
  await this.assertWorkItemHasNoBlockingAssessmentResolution(
    identity.tenantId,
    workflowId,
    workItemId,
    workItem.title,
    db,
  );

  const result = await db.query<WorkflowWorkItemRow>(
    `UPDATE workflow_work_items
        SET parent_work_item_id = $4,
            title = $5,
            goal = $6,
            acceptance_criteria = $7,
            stage_name = $8,
            column_id = $9,
            owner_role = $10,
            next_expected_actor = NULL,
            next_expected_action = NULL,
            priority = $11,
            notes = $12,
            completed_at = COALESCE(completed_at, now()),
            metadata = $13::jsonb,
            completion_callouts = $14::jsonb,
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
    RETURNING id,
              parent_work_item_id,
              stage_name,
              title,
              goal,
              acceptance_criteria,
              column_id,
              owner_role,
              next_expected_actor,
              next_expected_action,
              blocked_state,
              blocked_reason,
              escalation_status,
              rework_count,
              priority,
              notes,
              completed_at,
              metadata,
              completion_callouts,
              updated_at`,
    [
      identity.tenantId,
      workflowId,
      workItemId,
      workItem.parent_work_item_id,
      workItem.title,
      workItem.goal,
      workItem.acceptance_criteria,
      workItem.stage_name,
      terminalColumnId,
      workItem.owner_role,
      workItem.priority,
      workItem.notes,
      stripOrchestratorFinishState(workItem.metadata),
      completionCallouts,
    ],
  );
  const updatedWorkItem = result.rows[0];
  await this.deps.workflowDeliverableService?.reconcileWorkflowRollupsForCompletedWorkItem(
    identity.tenantId,
    workflowId,
    workItemId,
    db,
  );
  if (workflow.lifecycle === 'planned') {
    await reconcilePlannedWorkflowStages(db, identity.tenantId, workflowId);
  }
  await emitWorkItemUpdateEvents(this.deps, identity, workflowId, workItem, updatedWorkItem, db);
  const activation = await this.deps.activationService.enqueueForWorkflow(
    {
      tenantId: identity.tenantId,
      workflowId,
      reason: 'work_item.updated',
      eventType: 'work_item.updated',
      payload: buildWorkItemUpdatePayload(workItem, updatedWorkItem),
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
  await this.deps.stateService.recomputeWorkflowState(identity.tenantId, workflowId, db, {
    actorType: identity.scope,
    actorId: identity.keyPrefix,
  });
  return toWorkItemResponse(updatedWorkItem);
}

export async function resolveWorkItemEscalationInTransactionImpl(this: any,
  identity: ApiKeyIdentity,
  workflowId: string,
  workItemId: string,
  input: ResolveWorkflowWorkItemEscalationInput,
  db: DatabaseClient,
) {
  const workflow = await this.loadWorkflow(identity.tenantId, workflowId, db);
  const workItem = await this.loadWorkItem(identity.tenantId, workflowId, workItemId, db);
  if (workItem.escalation_status !== 'open') {
    throw new ConflictError('No open escalation exists for this work item');
  }

  const escalation = await loadOpenWorkItemEscalation(
    db,
    identity.tenantId,
    workflowId,
    workItemId,
  );
  if (!escalation) {
    throw new ConflictError('No open escalation exists for this work item');
  }

  await resolveWorkItemEscalation(db, {
    tenantId: identity.tenantId,
    workflowId,
    workItemId,
    escalationId: escalation.id,
    resolutionAction: input.action,
    feedback: nullableText(input.feedback),
    resolvedByType: identity.scope,
    resolvedById: identity.keyPrefix,
  });

  const updatedWorkItem = await this.loadWorkItem(identity.tenantId, workflowId, workItemId, db);
  await this.deps.eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'work_item.escalation_resolved',
      entityType: 'work_item',
      entityId: workItemId,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: {
        workflow_id: workflowId,
        work_item_id: workItemId,
        escalation_id: escalation.id,
        action: input.action,
        feedback: nullableText(input.feedback),
      },
    },
    db,
  );
  const activation = await this.deps.activationService.enqueueForWorkflow(
    {
      tenantId: identity.tenantId,
      workflowId,
      reason: 'work_item.escalation_resolved',
      eventType: 'work_item.escalation_resolved',
      payload: {
        work_item_id: workItemId,
        escalation_id: escalation.id,
        action: input.action,
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
  await this.deps.stateService.recomputeWorkflowState(identity.tenantId, workflowId, db, {
    actorType: identity.scope,
    actorId: identity.keyPrefix,
  });
  if (workflow.lifecycle === 'planned') {
    await reconcilePlannedWorkflowStages(db, identity.tenantId, workflowId);
  }
  return toWorkItemResponse(updatedWorkItem);
}
