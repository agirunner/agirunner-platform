import type { ApiKeyIdentity } from '../../auth/api-key.js';
import { ValidationError } from '../../errors/domain-errors.js';
import {
  defaultColumnId,
  hasBoardColumn,
  hasStage,
  parsePlaybookDefinition,
} from '../../orchestration/playbook-model.js';
import {
  PLATFORM_CONTROL_PLANE_IDEMPOTENT_MUTATION_REPLAY_ID,
  mustGetSafetynetEntry,
} from '../safetynet/registry.js';
import { logSafetynetTriggered } from '../safetynet/logging.js';
import type { DatabaseClient } from '../../db/database.js';
import type {
  CreateWorkItemInput,
  CreateWorkItemOptions,
  WorkItemReadModel,
  WorkItemServiceDependencies,
} from './types.js';
import {
  actorTypeForIdentity,
  assertMatchingCreateWorkItemReplay,
  createdByForIdentity,
  resolveWorkItemStageName,
  toWorkItemReadModel,
} from './shared.js';
import { workItemColumnList } from './types.js';
import {
  assertPlannedStageEntryRoleCanStart,
  resolveCreateWorkItemBranchId,
  resolveHumanGateContinuation,
  reuseOpenPlannedChildCheckpoint,
} from './mutation-checks.js';
import {
  assertSuccessorCheckpointReady,
  closeSupersededPredecessorWorkItem,
} from './mutation-successor.js';
import {
  assertWorkflowAcceptsWorkItemMutation,
  loadWorkflowForUpdate,
} from './mutation-context.js';
import { reconcilePlannedWorkflowStages } from '../workflow-stage/workflow-stage-reconciliation.js';

const IDEMPOTENT_MUTATION_REPLAY_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_CONTROL_PLANE_IDEMPOTENT_MUTATION_REPLAY_ID,
);

export async function createWorkItem(
  deps: WorkItemServiceDependencies,
  identity: ApiKeyIdentity,
  workflowId: string,
  input: CreateWorkItemInput,
  externalClient?: DatabaseClient,
  options: CreateWorkItemOptions = {},
): Promise<WorkItemReadModel> {
  if (!input.title.trim()) {
    throw new ValidationError('title is required');
  }

  const client = externalClient ?? (await deps.pool.connect());
  const ownsClient = externalClient === undefined;
  try {
    if (ownsClient) {
      await client.query('BEGIN');
    }
    const workflow = await loadWorkflowForUpdate(identity.tenantId, workflowId, client);
    assertWorkflowAcceptsWorkItemMutation(workflow);
    const definition = parsePlaybookDefinition(workflow.definition);
    const stageName = resolveWorkItemStageName(input.stage_name, workflow, definition);
    if (!stageName) {
      throw new ValidationError('stage_name is required for playbooks without a default stage');
    }
    if (!hasStage(definition, stageName)) {
      throw new ValidationError(`Unknown stage '${stageName}' for this playbook`, {
        recovery_hint: 'orchestrator_guided_recovery',
        reason_code: 'unknown_stage_name',
        requested_stage_name: stageName,
        authored_stage_names: definition.stages.map((stage) => stage.name),
      });
    }

    const columnId = input.column_id ?? defaultColumnId(definition);
    if (!hasBoardColumn(definition, columnId)) {
      throw new ValidationError(`Unknown board column '${columnId}' for this playbook`);
    }

    const branchId = await resolveCreateWorkItemBranchId(
      identity.tenantId,
      workflowId,
      definition,
      input,
      client,
    );
    const humanGateContinuation = await resolveHumanGateContinuation(
      identity.tenantId,
      workflowId,
      definition,
      stageName,
      client,
    );

    if (workflow.lifecycle === 'planned') {
      await assertSuccessorCheckpointReady(
        identity.tenantId,
        workflowId,
        definition,
        stageName,
        input.parent_work_item_id ?? null,
        client,
      );
      await assertPlannedStageEntryRoleCanStart(
        identity.tenantId,
        workflowId,
        definition,
        stageName,
        input.owner_role ?? null,
        client,
      );
      const reusableWorkItem = await reuseOpenPlannedChildCheckpoint(
        identity.tenantId,
        workflowId,
        input.parent_work_item_id ?? null,
        stageName,
        input.owner_role ?? null,
        {
          title: input.title.trim(),
          goal: input.goal?.trim(),
          acceptance_criteria: input.acceptance_criteria?.trim(),
          column_id: columnId,
          priority: input.priority ?? 'normal',
          notes: input.notes?.trim(),
          metadata: input.metadata,
        },
        client,
      );
      if (reusableWorkItem) {
        if (ownsClient) {
          await client.query('COMMIT');
        }
        return toWorkItemReadModel(reusableWorkItem);
      }
    }

    const result = await client.query(
      `INSERT INTO workflow_work_items (
         tenant_id, workflow_id, parent_work_item_id, request_id, stage_name, title, goal,
         acceptance_criteria, column_id, owner_role, next_expected_actor, next_expected_action, rework_count,
         priority, notes, created_by, metadata, branch_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (tenant_id, workflow_id, request_id)
       WHERE request_id IS NOT NULL
       DO NOTHING
       RETURNING ${workItemColumnList()}`,
      [
        identity.tenantId,
        workflowId,
        input.parent_work_item_id ?? null,
        input.request_id ?? null,
        stageName,
        input.title.trim(),
        input.goal?.trim() ?? null,
        input.acceptance_criteria?.trim() ?? null,
        columnId,
        input.owner_role ?? null,
        humanGateContinuation.nextExpectedActor,
        humanGateContinuation.nextExpectedAction,
        0,
        input.priority ?? 'normal',
        input.notes?.trim() ?? null,
        createdByForIdentity(identity),
        input.metadata ?? {},
        branchId,
      ],
    );
    if (!result.rowCount) {
      if (!input.request_id?.trim()) {
        throw new Error('Failed to create workflow work item');
      }
      const existing = await client.query(
        `SELECT ${workItemColumnList()}
           FROM workflow_work_items
          WHERE tenant_id = $1
            AND workflow_id = $2
            AND request_id = $3
          LIMIT 1`,
        [identity.tenantId, workflowId, input.request_id.trim()],
      );
      if (!existing.rowCount) {
        throw new Error('Failed to load existing workflow work item after conflict');
      }
      assertMatchingCreateWorkItemReplay(existing.rows[0] as Record<string, unknown>, {
        parent_work_item_id: input.parent_work_item_id ?? null,
        branch_id: branchId,
        stage_name: stageName,
        title: input.title.trim(),
        goal: input.goal?.trim() ?? null,
        acceptance_criteria: input.acceptance_criteria?.trim() ?? null,
        column_id: columnId,
        owner_role: input.owner_role ?? null,
        priority: input.priority ?? 'normal',
        notes: input.notes?.trim() ?? null,
        metadata: input.metadata ?? {},
      });
      logSafetynetTriggered(
        IDEMPOTENT_MUTATION_REPLAY_SAFETYNET,
        'idempotent work item create replay returned stored work item',
        { workflow_id: workflowId, request_id: input.request_id.trim() },
      );
      if (ownsClient) {
        await client.query('COMMIT');
      }
      return toWorkItemReadModel(existing.rows[0] as Record<string, unknown>);
    }

    const workItem = result.rows[0];
    const actorType = actorTypeForIdentity(identity);

    if (workflow.lifecycle === 'planned') {
      await closeSupersededPredecessorWorkItem(
        deps,
        identity,
        workflowId,
        definition,
        stageName,
        workItem.id as string,
        input.parent_work_item_id ?? null,
        client,
      );
      await reconcilePlannedWorkflowStages(client, identity.tenantId, workflowId);
    }

    await deps.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'work_item.created',
        entityType: 'work_item',
        entityId: workItem.id,
        actorType,
        actorId: identity.keyPrefix,
        data: {
          workflow_id: workflowId,
          work_item_id: workItem.id,
          stage_name: workItem.stage_name,
          column_id: workItem.column_id,
        },
      },
      client,
    );

    if (options.dispatchActivation !== false) {
      const activation = await deps.activationService.enqueueForWorkflow(
        {
          tenantId: identity.tenantId,
          workflowId,
          requestId: input.request_id ? `work-item:${input.request_id}` : undefined,
          reason: 'work_item.created',
          eventType: 'work_item.created',
          payload: { work_item_id: workItem.id, stage_name: workItem.stage_name },
          actorType,
          actorId: identity.keyPrefix,
        },
        client,
      );

      await deps.activationDispatchService.dispatchActivation(
        identity.tenantId,
        String(activation.id),
        client,
      );
    }

    if (ownsClient) {
      await client.query('COMMIT');
    }
    return toWorkItemReadModel(workItem as Record<string, unknown>);
  } catch (error) {
    if (ownsClient) {
      await client.query('ROLLBACK');
    }
    throw error;
  } finally {
    if (ownsClient) {
      client.release();
    }
  }
}
