import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import type { EventService } from '../event-service.js';
import { NotFoundError } from '../../errors/domain-errors.js';
import {
  activeColumnId,
  defaultColumnId,
  parsePlaybookDefinition,
} from '../../orchestration/playbook-model.js';
import type { PlaybookWorkflowControlService } from '../playbook-workflow-control/playbook-workflow-control-service.js';
import type { TaskService } from '../task-service.js';
import {
  completionCalloutsSchema,
  mergeCompletionCallouts,
  normalizeCompletionCalloutsInput,
} from './types.js';
import { supersedeCurrentFinalDeliverablesForWorkItem } from '../workflow-deliverable-lifecycle-service.js';
import {
  buildReplayConflictOperatorGuidance,
  type ReplayConflictOperatorField,
} from './recovery-helpers/replay-conflict-guidance.js';

export interface RerunTaskWithCorrectedBriefInput {
  request_id: string;
  corrected_input: Record<string, unknown>;
}

export interface ReattachOrReplaceStaleOwnerInput {
  request_id: string;
  reason: string;
  preferred_agent_id?: string;
  preferred_worker_id?: string;
}

export interface ReopenWorkItemForMissingHandoffInput {
  reason: string;
}

export interface WaivePreferredStepInput {
  code: string;
  reason: string;
  summary?: string;
  role?: string;
}

interface GuidedClosureRecoveryHelpersDependencies {
  pool: DatabasePool;
  eventService: EventService;
  taskService: Pick<TaskService, 'updateTaskInput' | 'retryTask' | 'reassignTask'>;
  workflowControlService: Pick<PlaybookWorkflowControlService, 'completeWorkItem' | 'completeWorkflow'>;
}

interface RecoveryWorkItemRow {
  id: string;
  workflow_id: string;
  stage_name: string;
  column_id: string;
  completed_at: Date | null;
  workflow_state: string | null;
  workflow_metadata: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  completion_callouts: Record<string, unknown>;
  definition: unknown;
  updated_at: Date;
}

export interface ReplayConflictOperatorField {
  field: string;
  persisted_value: string | null;
  submitted_value: string | null;
  operator_message: string;
}

export { buildReplayConflictOperatorGuidance };
export type { ReplayConflictOperatorField };

export class GuidedClosureRecoveryHelpersService {
  constructor(private readonly deps: GuidedClosureRecoveryHelpersDependencies) {}

  async rerunTaskWithCorrectedBrief(
    identity: ApiKeyIdentity,
    taskId: string,
    input: RerunTaskWithCorrectedBriefInput,
    client?: DatabaseClient,
  ): Promise<Record<string, unknown>> {
    if (client) {
      await this.deps.taskService.updateTaskInput(
        identity.tenantId,
        taskId,
        input.corrected_input,
        client,
      );
      return this.deps.taskService.retryTask(
        identity,
        taskId,
        { force: true },
        client,
      );
    }

    const db = await this.deps.pool.connect();
    try {
      await db.query('BEGIN');
      const retried = await this.rerunTaskWithCorrectedBrief(identity, taskId, input, db);
      await db.query('COMMIT');
      return retried;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }

  async reattachOrReplaceStaleOwner(
    identity: ApiKeyIdentity,
    taskId: string,
    input: ReattachOrReplaceStaleOwnerInput,
    client?: DatabaseClient,
  ): Promise<Record<string, unknown>> {
    return this.deps.taskService.reassignTask(
      identity,
      taskId,
      {
        reason: input.reason,
        preferred_agent_id: input.preferred_agent_id,
        preferred_worker_id: input.preferred_worker_id,
      },
      client,
    );
  }

  async closeWorkItemWithCallouts(
    identity: ApiKeyIdentity,
    workflowId: string,
    workItemId: string,
    input: {
      acting_task_id?: string | null;
      completion_callouts?: unknown;
      waived_steps?: unknown;
      unresolved_advisory_items?: unknown;
      completion_notes?: unknown;
    },
    client?: DatabaseClient,
  ) {
    const completionCallouts = normalizeCompletionCalloutsInput(input);
    return this.deps.workflowControlService.completeWorkItem(
      identity,
      workflowId,
      workItemId,
      {
        acting_task_id: input.acting_task_id ?? null,
        completion_callouts: completionCallouts,
      },
      client,
    );
  }

  async closeWorkflowWithCallouts(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: {
      summary: string;
      final_artifacts?: string[];
      completion_callouts?: unknown;
      waived_steps?: unknown;
      unresolved_advisory_items?: unknown;
      completion_notes?: unknown;
    },
    client?: DatabaseClient,
  ) {
    const completionCallouts = normalizeCompletionCalloutsInput(input);
    return this.deps.workflowControlService.completeWorkflow(
      identity,
      workflowId,
      {
        summary: input.summary,
        final_artifacts: input.final_artifacts,
        completion_callouts: completionCallouts,
      },
      client,
    );
  }

  async waivePreferredStep(
    identity: ApiKeyIdentity,
    workflowId: string,
    workItemId: string,
    input: WaivePreferredStepInput,
    client?: DatabaseClient,
  ) {
    if (client) {
      return this.waivePreferredStepInTransaction(identity, workflowId, workItemId, input, client);
    }

    const db = await this.deps.pool.connect();
    try {
      await db.query('BEGIN');
      const waived = await this.waivePreferredStepInTransaction(identity, workflowId, workItemId, input, db);
      await db.query('COMMIT');
      return waived;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }

  async reopenWorkItemForMissingHandoff(
    identity: ApiKeyIdentity,
    workflowId: string,
    workItemId: string,
    input: ReopenWorkItemForMissingHandoffInput,
    client?: DatabaseClient,
  ) {
    if (client) {
      return this.reopenWorkItemForMissingHandoffInTransaction(identity, workflowId, workItemId, input, client);
    }

    const db = await this.deps.pool.connect();
    try {
      await db.query('BEGIN');
      const reopened = await this.reopenWorkItemForMissingHandoffInTransaction(identity, workflowId, workItemId, input, db);
      await db.query('COMMIT');
      return reopened;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }

  private async waivePreferredStepInTransaction(
    identity: ApiKeyIdentity,
    workflowId: string,
    workItemId: string,
    input: WaivePreferredStepInput,
    db: DatabaseClient,
  ) {
    const current = await this.loadRecoveryWorkItem(identity.tenantId, workflowId, workItemId, db);
    const mergedCallouts = mergeCompletionCallouts(current.completion_callouts, {
      waived_steps: [{
        code: input.code,
        reason: input.reason,
        ...(input.summary ? { summary: input.summary } : {}),
        ...(input.role ? { role: input.role } : {}),
      }],
    });
    const updated = await db.query<RecoveryWorkItemRow>(
      `UPDATE workflow_work_items
          SET completion_callouts = $4::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3
      RETURNING id,
                workflow_id,
                stage_name,
                column_id,
                completed_at,
                metadata,
                completion_callouts,
                updated_at,
                $5::jsonb AS definition`,
      [
        identity.tenantId,
        workflowId,
        workItemId,
        mergedCallouts,
        current.definition,
      ],
    );
    await this.deps.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'work_item.updated',
        entityType: 'work_item',
        entityId: workItemId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: {
          workflow_id: workflowId,
          work_item_id: workItemId,
          stage_name: current.stage_name,
          completion_callouts: mergedCallouts,
        },
      },
      db,
    );
    return toRecoveryWorkItemResponse(updated.rows[0]);
  }

  private async reopenWorkItemForMissingHandoffInTransaction(
    identity: ApiKeyIdentity,
    workflowId: string,
    workItemId: string,
    input: ReopenWorkItemForMissingHandoffInput,
    db: DatabaseClient,
  ) {
    const current = await this.loadRecoveryWorkItem(identity.tenantId, workflowId, workItemId, db);
    if (!current.completed_at) {
      return toRecoveryWorkItemResponse(current);
    }

    const definition = parsePlaybookDefinition(current.definition as Record<string, unknown>);
    const reopenColumnId = resolveRecoveryReopenColumnId(current, definition);
    const updated = await db.query<RecoveryWorkItemRow>(
      `UPDATE workflow_work_items
          SET column_id = $4,
              completed_at = NULL,
              next_expected_actor = NULL,
              next_expected_action = NULL,
              metadata = jsonb_set(
                COALESCE(metadata, '{}'::jsonb) - 'orchestrator_finish_state',
                '{guided_closure,last_reopen_reason}',
                to_jsonb($5::text),
                true
              ),
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3
      RETURNING id,
                workflow_id,
                stage_name,
                column_id,
                completed_at,
                metadata,
                completion_callouts,
                updated_at,
                $6::jsonb AS definition`,
      [
        identity.tenantId,
        workflowId,
        workItemId,
        reopenColumnId,
        input.reason,
        current.definition,
      ],
    );
    const reopened = updated.rows[0];
    await supersedeCurrentFinalDeliverablesForWorkItem(
      db,
      identity.tenantId,
      workflowId,
      workItemId,
    );
    await emitRecoveryWorkItemEvents(
      this.deps.eventService,
      identity,
      workflowId,
      current,
      reopened,
      db,
    );
    return toRecoveryWorkItemResponse(reopened);
  }

  private async loadRecoveryWorkItem(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    db: DatabaseClient,
  ) {
    const result = await db.query<RecoveryWorkItemRow>(
      `SELECT wi.id,
              wi.workflow_id,
              wi.stage_name,
              wi.column_id,
              wi.completed_at,
              w.state AS workflow_state,
              w.metadata AS workflow_metadata,
              wi.metadata,
              wi.completion_callouts,
              wi.updated_at,
              p.definition
         FROM workflow_work_items wi
         JOIN workflows w
           ON w.tenant_id = wi.tenant_id
          AND w.id = wi.workflow_id
         JOIN playbooks p
           ON p.tenant_id = w.tenant_id
          AND p.id = w.playbook_id
        WHERE wi.tenant_id = $1
          AND wi.workflow_id = $2
          AND wi.id = $3
        LIMIT 1
        FOR UPDATE OF wi`,
      [tenantId, workflowId, workItemId],
    );
    const workItem = result.rows[0];
    if (!workItem) {
      throw new NotFoundError('Workflow work item not found');
    }
    return {
      ...workItem,
      metadata: workItem.metadata ?? {},
      completion_callouts: completionCalloutsSchema.parse(workItem.completion_callouts ?? {}),
    };
  }
}

function toRecoveryWorkItemResponse(row: RecoveryWorkItemRow) {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    stage_name: row.stage_name,
    column_id: row.column_id,
    completed_at: row.completed_at?.toISOString() ?? null,
    metadata: row.metadata ?? {},
    completion_callouts: completionCalloutsSchema.parse(row.completion_callouts ?? {}),
    updated_at: row.updated_at.toISOString(),
  };
}

function resolveRecoveryReopenColumnId(
  current: RecoveryWorkItemRow,
  definition: ReturnType<typeof parsePlaybookDefinition>,
): string {
  if (
    current.workflow_state === 'paused'
    || current.workflow_state === 'cancelled'
    || hasPendingWorkflowCancel(current.workflow_metadata)
  ) {
    return current.column_id;
  }
  return activeColumnId(definition) ?? defaultColumnId(definition) ?? current.column_id;
}

function hasPendingWorkflowCancel(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }
  const value = (metadata as Record<string, unknown>).cancel_requested_at;
  return typeof value === 'string' && value.trim().length > 0;
}

async function emitRecoveryWorkItemEvents(
  eventService: EventService,
  identity: ApiKeyIdentity,
  workflowId: string,
  previous: RecoveryWorkItemRow,
  current: RecoveryWorkItemRow,
  db: DatabaseClient,
) {
  const data = {
    workflow_id: workflowId,
    work_item_id: current.id,
    previous_stage_name: previous.stage_name,
    stage_name: current.stage_name,
    previous_column_id: previous.column_id,
    column_id: current.column_id,
    completed_at: current.completed_at?.toISOString() ?? null,
  };
  await eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'work_item.updated',
      entityType: 'work_item',
      entityId: current.id,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data,
    },
    db,
  );
  if (previous.column_id !== current.column_id) {
    await eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'work_item.moved',
        entityType: 'work_item',
        entityId: current.id,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data,
      },
      db,
    );
  }
  if (previous.completed_at && !current.completed_at) {
    await eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'work_item.reopened',
        entityType: 'work_item',
        entityId: current.id,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data,
      },
      db,
    );
  }
}
