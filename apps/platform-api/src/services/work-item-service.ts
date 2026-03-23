import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import {
  defaultColumnId,
  defaultStageName,
  hasBoardColumn,
  hasStage,
  parsePlaybookDefinition,
} from '../orchestration/playbook-model.js';
import { EventService } from './event-service.js';
import {
  WorkspaceMemoryScopeService,
  type WorkItemMemoryEntry,
  type WorkItemMemoryHistoryEntry,
} from './workspace-memory-scope-service.js';
import { areJsonValuesEquivalent } from './json-equivalence.js';
import { sanitizeSecretLikeValue } from './secret-redaction.js';
import { WorkflowActivationService } from './workflow-activation-service.js';
import { WorkflowActivationDispatchService } from './workflow-activation-dispatch-service.js';
import { loadWorkflowStageProjection } from './workflow-stage-projection.js';
import { reconcilePlannedWorkflowStages } from './workflow-stage-reconciliation.js';
import {
  ensureWorkflowBranch,
  type BranchTerminationPolicy,
} from './workflow-branch-service.js';

export interface CreateWorkItemInput {
  request_id?: string;
  parent_work_item_id?: string;
  branch_key?: string;
  stage_name?: string;
  title: string;
  goal?: string;
  acceptance_criteria?: string;
  column_id?: string;
  owner_role?: string;
  priority?: 'critical' | 'high' | 'normal' | 'low';
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface ListWorkflowWorkItemsInput {
  parent_work_item_id?: string;
  stage_name?: string;
  column_id?: string;
  grouped?: boolean;
}

export interface GetWorkflowWorkItemInput {
  include_children?: boolean;
}

export interface WorkItemReadModel extends Record<string, unknown> {
  id: string;
  workflow_id: string;
  parent_work_item_id: string | null;
  branch_id?: string | null;
  branch_status?: 'active' | 'completed' | 'blocked' | 'terminated' | null;
  stage_name: string | null;
  column_id: string | null;
  next_expected_actor: string | null;
  next_expected_action: string | null;
  blocked_state?: 'blocked' | null;
  blocked_reason?: string | null;
  escalation_status?: 'open' | null;
  rework_count: number;
  latest_handoff_completion?: string | null;
  latest_handoff_resolution?: string | null;
  unresolved_findings?: string[];
  focus_areas?: string[];
  known_risks?: string[];
  current_subject_revision?: number | null;
  required_assessment_count?: number;
  approved_assessment_count?: number;
  blocking_assessment_count?: number;
  pending_assessment_count?: number;
  retained_assessment_count?: number;
  invalidated_assessment_count?: number;
  assessment_status?: 'pending' | 'blocked' | 'approved' | null;
  gate_status?: string | null;
  gate_decision_feedback?: string | null;
  gate_decided_at?: string | Date | null;
  completed_at: string | Date | null;
  task_count: number;
  children_count: number;
  children_completed?: number;
  is_milestone: boolean;
}

export interface GroupedWorkItemReadModel extends WorkItemReadModel {
  children?: WorkItemReadModel[];
}

interface WorkflowStageContextRow {
  id: string;
  lifecycle: string | null;
  active_stage_name: string | null;
  definition: unknown;
}

const SUCCESSOR_BLOCKING_NEXT_ACTIONS = new Set(['assess', 'approve', 'rework', 'handoff']);

interface CheckpointPredecessorRow {
  id: string;
  title: string;
  stage_name: string | null;
  column_id: string;
  completed_at: Date | null;
  next_expected_actor: string | null;
  next_expected_action: string | null;
  blocked_state?: string | null;
  blocked_reason?: string | null;
  escalation_status?: string | null;
  human_gate: boolean;
  gate_status: string;
  latest_handoff_completion: string | null;
  latest_handoff_resolution: string | null;
}

interface NonTerminalTaskStateCountRow {
  state: string;
  count: number;
}

interface ParentWorkItemBranchRow {
  branch_id: string | null;
  branch_status: 'active' | 'completed' | 'blocked' | 'terminated' | null;
}

const WORK_ITEM_BASE_COLUMNS = [
  'id',
  'workflow_id',
  'parent_work_item_id',
  'branch_id',
  'request_id',
  'stage_name',
  'title',
  'goal',
  'acceptance_criteria',
  'column_id',
  'owner_role',
  'next_expected_actor',
  'next_expected_action',
  'blocked_state',
  'blocked_reason',
  'escalation_status',
  'rework_count',
  'priority',
  'notes',
  'created_by',
  'metadata',
  'completed_at',
  'created_at',
  'updated_at',
] as const;

function workItemColumnList(tableAlias?: string) {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  return WORK_ITEM_BASE_COLUMNS.map((column) => `${prefix}${column}`).join(',\n              ');
}

export class WorkItemService {
  private readonly memoryScopeService: WorkspaceMemoryScopeService;

  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
    private readonly activationService: WorkflowActivationService,
    private readonly activationDispatchService: WorkflowActivationDispatchService,
  ) {
    this.memoryScopeService = new WorkspaceMemoryScopeService(pool);
  }

  async listWorkflowWorkItems(
    tenantId: string,
    workflowId: string,
    input: ListWorkflowWorkItemsInput = {},
  ): Promise<WorkItemReadModel[] | GroupedWorkItemReadModel[]> {
    const workItems = await this.loadWorkflowWorkItems(tenantId, workflowId, input);
    return input.grouped ? groupWorkItems(workItems) : workItems;
  }

  async getWorkflowWorkItem(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    input: GetWorkflowWorkItemInput = {},
  ): Promise<WorkItemReadModel | GroupedWorkItemReadModel> {
    const [workItem] = await this.loadWorkflowWorkItems(tenantId, workflowId, { work_item_id: workItemId });
    if (!workItem) {
      throw new NotFoundError('Workflow work item not found');
    }
    if (!input.include_children && workItem.children_count === 0) {
      return workItem;
    }
    const children = await this.loadWorkflowWorkItems(tenantId, workflowId, {
      parent_work_item_id: workItemId,
    });
    return {
      ...workItem,
      children,
    };
  }

  async listWorkItemTasks(tenantId: string, workflowId: string, workItemId: string) {
    await this.loadWorkItemContext(tenantId, workflowId, workItemId);
    const result = await this.pool.query(
      `SELECT id,
              workflow_id,
              work_item_id,
              title,
              state,
              role,
              stage_name,
              activation_id,
              is_orchestrator_task,
              created_at,
              completed_at,
              depends_on
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND work_item_id = $3
        ORDER BY created_at ASC`,
      [tenantId, workflowId, workItemId],
    );
    return result.rows.map((row) =>
      sanitizeSecretLikeValue(row, {
        redactionValue: 'redacted://work-item-secret',
        allowSecretReferences: false,
      }) as Record<string, unknown>,
    );
  }

  async listWorkItemEvents(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    limit: number,
  ): Promise<Array<Record<string, unknown>>> {
    await this.loadWorkItemContext(tenantId, workflowId, workItemId);
    const result = await this.pool.query(
      `SELECT *
         FROM events
        WHERE tenant_id = $1
          AND (
            (entity_type = 'work_item' AND entity_id = $2::uuid)
            OR (
              COALESCE(data->>'workflow_id', '') = $3
              AND COALESCE(data->>'work_item_id', '') = $4
            )
          )
        ORDER BY created_at DESC, id DESC
        LIMIT $5`,
      [tenantId, workItemId, workflowId, workItemId, limit],
    );
    return result.rows.map((row) =>
      sanitizeSecretLikeValue(row, {
        redactionValue: 'redacted://work-item-secret',
        allowSecretReferences: false,
      }) as Record<string, unknown>,
    );
  }

  async getWorkItemMemory(
    tenantId: string,
    workflowId: string,
    workItemId: string,
  ): Promise<{ entries: WorkItemMemoryEntry[] }> {
    const context = await this.loadWorkItemContext(tenantId, workflowId, workItemId);
    if (!context.workspace_id) {
      return { entries: [] };
    }

    const workspaceResult = await this.pool.query<{ memory: unknown }>(
      `SELECT memory
         FROM workspaces
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1`,
      [tenantId, context.workspace_id],
    );

    const currentMemory = asRecord(workspaceResult.rows[0]?.memory);
    const entries = await this.memoryScopeService.listWorkItemMemoryEntries({
      tenantId,
      workspaceId: context.workspace_id,
      workflowId,
      workItemId,
      currentMemory,
    });
    return { entries };
  }

  async getWorkItemMemoryHistory(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    limit: number,
  ): Promise<{ history: WorkItemMemoryHistoryEntry[] }> {
    const context = await this.loadWorkItemContext(tenantId, workflowId, workItemId);
    if (!context.workspace_id) {
      return { history: [] };
    }

    const history = await this.memoryScopeService.listWorkItemMemoryHistory({
      tenantId,
      workspaceId: context.workspace_id,
      workflowId,
      workItemId,
      limit,
    });
    return { history };
  }

  async createWorkItem(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: CreateWorkItemInput,
    externalClient?: DatabaseClient,
  ) {
    if (!input.title.trim()) {
      throw new ValidationError('title is required');
    }

    const client = externalClient ?? (await this.pool.connect());
    const ownsClient = externalClient === undefined;
    try {
      if (ownsClient) {
        await client.query('BEGIN');
      }
      const workflow = await this.loadWorkflowForUpdate(identity.tenantId, workflowId, client);
      const definition = parsePlaybookDefinition(workflow.definition);
      const stageName = resolveWorkItemStageName(input.stage_name, workflow, definition);
      if (!stageName) {
        throw new ValidationError('stage_name is required for playbooks without a default stage');
      }
      if (!hasStage(definition, stageName)) {
        throw new ValidationError(`Unknown stage '${stageName}' for this playbook`);
      }

      const columnId = input.column_id ?? defaultColumnId(definition);
      if (!hasBoardColumn(definition, columnId)) {
        throw new ValidationError(`Unknown board column '${columnId}' for this playbook`);
      }

      const branchId = await this.resolveCreateWorkItemBranchId(
        identity.tenantId,
        workflowId,
        definition,
        input,
        client,
      );

      if (workflow.lifecycle === 'planned') {
        await this.assertSuccessorCheckpointReady(
          identity.tenantId,
          workflowId,
          definition,
          stageName,
          input.parent_work_item_id ?? null,
          client,
        );
        await this.assertPlannedStageEntryRoleCanStart(
          identity.tenantId,
          workflowId,
          definition,
          stageName,
          input.owner_role ?? null,
          client,
        );
        const reusableWorkItem = await this.reuseOpenPlannedChildCheckpoint(
          identity.tenantId,
          workflowId,
          input.parent_work_item_id ?? null,
          stageName,
          input.owner_role ?? null,
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
          humanGateContinuationForStage(definition, stageName).nextExpectedActor,
          humanGateContinuationForStage(definition, stageName).nextExpectedAction,
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
        if (ownsClient) {
          await client.query('COMMIT');
        }
        return toWorkItemReadModel(existing.rows[0] as Record<string, unknown>);
      }

      const workItem = result.rows[0];
      const actorType = actorTypeForIdentity(identity);

      if (workflow.lifecycle === 'planned') {
        await this.closeSupersededPredecessorWorkItem(
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

      await this.eventService.emit(
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

      const activation = await this.activationService.enqueueForWorkflow(
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

      await this.activationDispatchService.dispatchActivation(
        identity.tenantId,
        String(activation.id),
        client,
      );

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

  private async assertSuccessorCheckpointReady(
    tenantId: string,
    workflowId: string,
    definition: ReturnType<typeof parsePlaybookDefinition>,
    successorStageName: string,
    parentWorkItemId: string | null,
    client: DatabaseClient,
  ) {
    if (!parentWorkItemId) {
      return;
    }

    const predecessor = await this.loadCheckpointPredecessor(tenantId, workflowId, parentWorkItemId, client);
    if (!predecessor || predecessor.completed_at) {
      return;
    }

    if (predecessor.stage_name === successorStageName) {
      return;
    }

    const expectedSuccessorStageName = nextStageNameFor(definition, predecessor.stage_name);
    if (!expectedSuccessorStageName || successorStageName !== expectedSuccessorStageName) {
      throw new ValidationError(
        `Cannot create successor work item in stage '${successorStageName}' from predecessor ` +
          `'${predecessor.title}' (${predecessor.stage_name}). Expected the next planned stage ` +
          `'${expectedSuccessorStageName ?? 'none'}'.`,
      );
    }

    if (predecessor.human_gate && predecessor.gate_status !== 'approved') {
      throw new ValidationError(
        `Cannot create successor work item in stage '${successorStageName}' while predecessor ` +
          `'${predecessor.title}' (${predecessor.stage_name}) still awaits gate approval.`,
      );
    }
    if (predecessor.blocked_state === 'blocked') {
      throw new ValidationError(
        `Cannot create successor work item in stage '${successorStageName}' while predecessor ` +
          `'${predecessor.title}' (${predecessor.stage_name}) is blocked${predecessor.blocked_reason ? `: ${predecessor.blocked_reason}` : '.'}`,
      );
    }
    if (predecessor.escalation_status === 'open') {
      throw new ValidationError(
        `Cannot create successor work item in stage '${successorStageName}' while predecessor ` +
          `'${predecessor.title}' (${predecessor.stage_name}) still has an open escalation.`,
      );
    }

    if (predecessor.latest_handoff_completion !== 'full') {
      throw new ValidationError(
        `Cannot create successor work item in stage '${successorStageName}' before predecessor ` +
          `'${predecessor.title}' (${predecessor.stage_name}) has a full handoff. ` +
          `Wait for the checkpoint specialist to complete and submit the handoff first.`,
      );
    }
    if (
      predecessor.latest_handoff_resolution === 'request_changes'
      || predecessor.latest_handoff_resolution === 'rejected'
    ) {
      throw new ValidationError(
        `Cannot create successor work item in stage '${successorStageName}' while predecessor ` +
          `'${predecessor.title}' (${predecessor.stage_name}) still requires follow-up after a resolution of ` +
          `'${predecessor.latest_handoff_resolution}'.`,
      );
    }
    if (
      predecessor.next_expected_actor
      && predecessor.next_expected_action
      && SUCCESSOR_BLOCKING_NEXT_ACTIONS.has(predecessor.next_expected_action)
    ) {
      throw new ValidationError(
        `Cannot create successor work item in stage '${successorStageName}' while predecessor ` +
          `'${predecessor.title}' (${predecessor.stage_name}) still requires ` +
          `${describePendingContinuation(predecessor.next_expected_action)} by ` +
          `'${predecessor.next_expected_actor}'.`,
      );
    }

    const nonTerminalTaskStates = await this.loadNonTerminalWorkItemTaskStateCounts(
      tenantId,
      workflowId,
      parentWorkItemId,
      client,
    );
    if (shouldBlockSuccessorCheckpointForOpenTasks(definition, predecessor.stage_name, nonTerminalTaskStates)) {
      throw new ValidationError(
        `Cannot create successor work item in stage '${successorStageName}' while predecessor ` +
          `'${predecessor.title}' (${predecessor.stage_name}) still has non-terminal tasks. ` +
          `Wait for the current checkpoint task to finish before routing to the next stage.`,
      );
    }
  }

  private async closeSupersededPredecessorWorkItem(
    identity: ApiKeyIdentity,
    workflowId: string,
    definition: ReturnType<typeof parsePlaybookDefinition>,
    successorStageName: string,
    successorWorkItemId: string,
    parentWorkItemId: string | null,
    client: DatabaseClient,
  ) {
    if (!parentWorkItemId) {
      return;
    }

    const predecessor = await this.loadCheckpointPredecessor(
      identity.tenantId,
      workflowId,
      parentWorkItemId,
      client,
    );
    if (!predecessor || predecessor.completed_at) {
      return;
    }

    const predecessorStageName = predecessor.stage_name;
    if (!shouldAutoClosePredecessorCheckpoint(definition, predecessorStageName, successorStageName)) {
      return;
    }
    if (predecessor.human_gate && predecessor.gate_status !== 'approved') {
      return;
    }

    if (
      (await this.countNonTerminalWorkItemTasks(
        identity.tenantId,
        workflowId,
        parentWorkItemId,
        client,
      )) > 0
    ) {
      return;
    }

    const terminalColumnId = terminalColumnIdFor(definition) ?? predecessor.column_id;
    const completedAt = new Date();
    const updateResult = await client.query<{ id: string }>(
      `UPDATE workflow_work_items
          SET column_id = $4,
              completed_at = COALESCE(completed_at, $5),
              next_expected_actor = NULL,
              next_expected_action = NULL,
              metadata = COALESCE(metadata, '{}'::jsonb) - 'orchestrator_finish_state',
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3
          AND completed_at IS NULL
      RETURNING id`,
      [identity.tenantId, workflowId, parentWorkItemId, terminalColumnId, completedAt],
    );
    if (!updateResult.rowCount) {
      return;
    }

    const baseData = {
      workflow_id: workflowId,
      work_item_id: parentWorkItemId,
      stage_name: predecessor.stage_name,
      successor_work_item_id: successorWorkItemId,
      successor_stage_name: successorStageName,
      previous_column_id: predecessor.column_id,
      column_id: terminalColumnId,
      completed_at: completedAt.toISOString(),
    };
    await this.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'work_item.updated',
        entityType: 'work_item',
        entityId: parentWorkItemId,
        actorType: actorTypeForIdentity(identity),
        actorId: identity.keyPrefix,
        data: baseData,
      },
      client,
    );
    if (terminalColumnId !== predecessor.column_id) {
      await this.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'work_item.moved',
          entityType: 'work_item',
          entityId: parentWorkItemId,
          actorType: actorTypeForIdentity(identity),
          actorId: identity.keyPrefix,
          data: baseData,
        },
        client,
      );
    }
    await this.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'work_item.completed',
        entityType: 'work_item',
        entityId: parentWorkItemId,
        actorType: actorTypeForIdentity(identity),
        actorId: identity.keyPrefix,
        data: baseData,
      },
      client,
    );
  }

  private async resolveCreateWorkItemBranchId(
    tenantId: string,
    workflowId: string,
    definition: ReturnType<typeof parsePlaybookDefinition>,
    input: CreateWorkItemInput,
    client: DatabaseClient,
  ) {
    const needsParentBranchLookup = Boolean(input.parent_work_item_id) && (
      Boolean(input.branch_key?.trim()) || definition.branch_policies.length > 0
    );
    const parentBranch = needsParentBranchLookup
      ? await this.loadParentWorkItemBranch(
          tenantId,
          workflowId,
          input.parent_work_item_id ?? null,
          client,
        )
      : null;
    if (parentBranch?.branch_status === 'terminated') {
      throw new ConflictError('Cannot create new work items for a terminated branch');
    }

    const branchKey = input.branch_key?.trim();
    if (!branchKey) {
      return parentBranch?.branch_id ?? null;
    }

    const authoredPolicy = definition.branch_policies.find((entry) => entry.branch_key === branchKey);
    if (!authoredPolicy) {
      throw new ValidationError(`Unknown branch_key '${branchKey}' for this playbook`);
    }

    return ensureWorkflowBranch(client, {
      tenantId,
      workflowId,
      parentBranchId: parentBranch?.branch_id ?? null,
      parentSubjectRef: { kind: 'workflow', workflow_id: workflowId },
      branchKey,
      terminationPolicy: authoredPolicy.termination_policy as BranchTerminationPolicy,
      metadata: {},
    });
  }

  private async loadParentWorkItemBranch(
    tenantId: string,
    workflowId: string,
    parentWorkItemId: string | null,
    client: DatabaseClient,
  ) {
    if (!parentWorkItemId) {
      return null;
    }
    const result = await client.query<ParentWorkItemBranchRow>(
      `SELECT wi.branch_id,
              branch.branch_status
         FROM workflow_work_items wi
         LEFT JOIN workflow_branches branch
           ON branch.tenant_id = wi.tenant_id
          AND branch.workflow_id = wi.workflow_id
          AND branch.id = wi.branch_id
        WHERE wi.tenant_id = $1
          AND wi.workflow_id = $2
          AND wi.id = $3
        LIMIT 1`,
      [tenantId, workflowId, parentWorkItemId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Parent workflow work item not found');
    }
    return result.rows[0];
  }

  private async assertPlannedStageEntryRoleCanStart(
    tenantId: string,
    workflowId: string,
    definition: ReturnType<typeof parsePlaybookDefinition>,
    stageName: string,
    ownerRole: string | null,
    client: DatabaseClient,
  ) {
    const normalizedOwnerRole = ownerRole?.trim() ?? null;
    if (!normalizedOwnerRole) {
      return;
    }

    const starterRoles = starterRolesForPlannedStage(definition, stageName);
    if (starterRoles.length === 0 || starterRoles.includes(normalizedOwnerRole)) {
      return;
    }

    const existingStageWorkItems = await this.countStageWorkItems(
      tenantId,
      workflowId,
      stageName,
      client,
    );
    if (existingStageWorkItems > 0) {
      return;
    }

    throw new ValidationError(
      `Cannot seed planned stage '${stageName}' with role '${normalizedOwnerRole}' before the required upstream handoff exists. ` +
        `Start with one of: ${starterRoles.join(', ')}.`,
    );
  }

  private async reuseOpenPlannedChildCheckpoint(
    tenantId: string,
    workflowId: string,
    parentWorkItemId: string | null,
    stageName: string,
    ownerRole: string | null,
    client: DatabaseClient,
  ): Promise<Record<string, unknown> | null> {
    if (!parentWorkItemId) {
      return null;
    }

    const existing = await client.query(
      `SELECT ${workItemColumnList()}
         FROM workflow_work_items
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND parent_work_item_id = $3
          AND stage_name = $4
          AND COALESCE(owner_role, '') = COALESCE($5, '')
          AND completed_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE`,
      [tenantId, workflowId, parentWorkItemId, stageName, ownerRole],
    );
    if (!existing.rowCount) {
      return null;
    }

    const workItem = existing.rows[0] as Record<string, unknown>;
    if (!shouldResetReusableChildCheckpoint(workItem)) {
      return workItem;
    }

    const reset = await client.query(
      `UPDATE workflow_work_items
          SET next_expected_actor = NULL,
              next_expected_action = NULL,
              metadata = COALESCE(metadata, '{}'::jsonb) - 'orchestrator_finish_state',
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3
      RETURNING ${workItemColumnList()}`,
      [tenantId, workflowId, workItem.id],
    );
    return (reset.rows[0] as Record<string, unknown> | undefined) ?? workItem;
  }

  private async loadCheckpointPredecessor(
    tenantId: string,
    workflowId: string,
    parentWorkItemId: string,
    client: DatabaseClient,
  ) {
    const predecessorResult = await client.query<CheckpointPredecessorRow>(
      `SELECT wi.id,
              wi.title,
              wi.stage_name,
              wi.column_id,
              wi.completed_at,
              wi.next_expected_actor,
              wi.next_expected_action,
              wi.blocked_state,
              wi.blocked_reason,
              wi.escalation_status,
              COALESCE(ws.human_gate, false) AS human_gate,
              COALESCE(ws.gate_status, 'not_requested') AS gate_status,
              latest_handoff.latest_handoff_completion,
              latest_handoff.latest_handoff_resolution
         FROM workflow_work_items wi
         LEFT JOIN workflow_stages ws
           ON ws.tenant_id = wi.tenant_id
          AND ws.workflow_id = wi.workflow_id
          AND ws.name = wi.stage_name
         LEFT JOIN LATERAL (
           SELECT th.completion AS latest_handoff_completion,
                  th.resolution AS latest_handoff_resolution
             FROM task_handoffs th
            WHERE th.tenant_id = wi.tenant_id
              AND th.workflow_id = wi.workflow_id
              AND th.work_item_id = wi.id
            ORDER BY th.sequence DESC, th.created_at DESC
            LIMIT 1
         ) latest_handoff ON true
        WHERE wi.tenant_id = $1
          AND wi.workflow_id = $2
          AND wi.id = $3
        LIMIT 1
        FOR UPDATE OF wi`,
      [tenantId, workflowId, parentWorkItemId],
    );
    return predecessorResult.rows[0] ?? null;
  }

  private async countNonTerminalWorkItemTasks(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    client: DatabaseClient,
  ) {
    const taskResult = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND work_item_id = $3
          AND state NOT IN ('completed', 'failed', 'cancelled')`,
      [tenantId, workflowId, workItemId],
    );
    return taskResult.rows[0]?.count ?? 0;
  }

  private async countStageWorkItems(
    tenantId: string,
    workflowId: string,
    stageName: string,
    client: DatabaseClient,
  ) {
    const result = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM workflow_work_items
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND stage_name = $3`,
      [tenantId, workflowId, stageName],
    );
    return result.rows[0]?.count ?? 0;
  }

  private async loadNonTerminalWorkItemTaskStateCounts(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    client: DatabaseClient,
  ) {
    const taskResult = await client.query<NonTerminalTaskStateCountRow>(
      `SELECT state, COUNT(*)::int AS count
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND work_item_id = $3
          AND state NOT IN ('completed', 'failed', 'cancelled')
        GROUP BY state`,
      [tenantId, workflowId, workItemId],
    );
    return taskResult.rows.reduce((counts, row) => {
      counts.set(row.state, row.count);
      return counts;
    }, new Map<string, number>());
  }

  private async loadWorkflowForUpdate(
    tenantId: string,
    workflowId: string,
    client: DatabaseClient,
  ) {
    const result = await client.query(
      `SELECT w.id,
              w.lifecycle,
              p.definition
         FROM workflows w
         JOIN playbooks p
           ON p.tenant_id = w.tenant_id
          AND p.id = w.playbook_id
        WHERE w.tenant_id = $1
          AND w.id = $2
        FOR UPDATE OF w`,
      [tenantId, workflowId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Playbook workflow not found');
    }
    const workflow = result.rows[0] as WorkflowStageContextRow;
    if (Object.hasOwn(workflow, 'active_stage_name')) {
      return {
        ...workflow,
        active_stage_name: typeof workflow.active_stage_name === 'string' ? workflow.active_stage_name : null,
      } satisfies WorkflowStageContextRow;
    }
    const projection = await loadWorkflowStageProjection(client, tenantId, workflowId, {
      lifecycle: workflow.lifecycle === 'ongoing' ? 'ongoing' : 'planned',
      definition: workflow.definition,
    });
    return {
      ...workflow,
      active_stage_name: projection.currentStage,
    } satisfies WorkflowStageContextRow;
  }

  private async loadWorkItemContext(tenantId: string, workflowId: string, workItemId: string) {
    const result = await this.pool.query<{ id: string; workflow_id: string; workspace_id: string | null }>(
      `SELECT wi.id, wi.workflow_id, w.workspace_id
         FROM workflow_work_items wi
         JOIN workflows w
           ON w.tenant_id = wi.tenant_id
          AND w.id = wi.workflow_id
        WHERE wi.tenant_id = $1
          AND wi.workflow_id = $2
          AND wi.id = $3
        LIMIT 1`,
      [tenantId, workflowId, workItemId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workflow work item not found');
    }
    return result.rows[0];
  }

  private async loadWorkflowWorkItems(
    tenantId: string,
    workflowId: string,
    input: ListWorkflowWorkItemsInput & { work_item_id?: string } = {},
  ) {
    const values: unknown[] = [tenantId, workflowId];
    const conditions = ['wi.tenant_id = $1', 'wi.workflow_id = $2'];

    if (input.work_item_id) {
      values.push(input.work_item_id);
      conditions.push(`wi.id = $${values.length}`);
    }
    if (input.parent_work_item_id) {
      values.push(input.parent_work_item_id);
      conditions.push(`wi.parent_work_item_id = $${values.length}`);
    }
    if (input.stage_name) {
      values.push(input.stage_name);
      conditions.push(`wi.stage_name = $${values.length}`);
    }
    if (input.column_id) {
      values.push(input.column_id);
      conditions.push(`wi.column_id = $${values.length}`);
    }

    const result = await this.pool.query(
      `SELECT ${workItemColumnList('wi')},
              branch.branch_status,
              COUNT(DISTINCT t.id)::int AS task_count,
              COUNT(DISTINCT child.id)::int AS children_count,
              COUNT(DISTINCT child.id) FILTER (WHERE child.completed_at IS NOT NULL)::int AS children_completed,
              latest_handoff.latest_handoff_completion,
              latest_handoff.latest_handoff_resolution,
              latest_handoff.unresolved_findings,
              latest_handoff.focus_areas,
              latest_handoff.known_risks,
              latest_delivery.subject_revision AS current_subject_revision,
              COALESCE(assessment_requirements.required_assessment_count, 0)::int AS required_assessment_count,
              COALESCE(assessment_rollup.approved_assessment_count, 0)::int AS approved_assessment_count,
              COALESCE(assessment_rollup.blocking_assessment_count, 0)::int AS blocking_assessment_count,
              COALESCE(assessment_rollup.retained_assessment_count, 0)::int AS retained_assessment_count,
              COALESCE(assessment_rollup.invalidated_assessment_count, 0)::int AS invalidated_assessment_count,
              GREATEST(
                COALESCE(assessment_requirements.required_assessment_count, 0)::int
                  - COALESCE(assessment_rollup.approved_assessment_count, 0)::int
                  - COALESCE(assessment_rollup.blocking_assessment_count, 0)::int,
                0
              )::int AS pending_assessment_count,
              CASE
                WHEN COALESCE(assessment_requirements.required_assessment_count, 0) = 0 THEN NULL
                WHEN COALESCE(assessment_rollup.blocking_assessment_count, 0) > 0 THEN 'blocked'
                WHEN COALESCE(assessment_rollup.approved_assessment_count, 0) >= COALESCE(assessment_requirements.required_assessment_count, 0)
                  THEN 'approved'
                ELSE 'pending'
              END AS assessment_status,
              latest_gate.gate_status,
              latest_gate.gate_decision_feedback,
              latest_gate.gate_decided_at
         FROM workflow_work_items wi
         LEFT JOIN workflows wf
           ON wf.tenant_id = wi.tenant_id
          AND wf.id = wi.workflow_id
         LEFT JOIN playbooks pb
           ON pb.tenant_id = wf.tenant_id
          AND pb.id = wf.playbook_id
         LEFT JOIN tasks t
           ON t.tenant_id = wi.tenant_id
          AND t.work_item_id = wi.id
         LEFT JOIN workflow_work_items child
           ON child.tenant_id = wi.tenant_id
          AND child.parent_work_item_id = wi.id
         LEFT JOIN workflow_stages ws
           ON ws.tenant_id = wi.tenant_id
          AND ws.workflow_id = wi.workflow_id
          AND ws.name = wi.stage_name
         LEFT JOIN workflow_branches branch
           ON branch.tenant_id = wi.tenant_id
          AND branch.workflow_id = wi.workflow_id
          AND branch.id = wi.branch_id
         LEFT JOIN LATERAL (
           SELECT th.completion AS latest_handoff_completion,
                  th.resolution AS latest_handoff_resolution,
                  array_cat(
                    COALESCE(
                      ARRAY(SELECT jsonb_array_elements_text(COALESCE(th.remaining_items, '[]'::jsonb))),
                      ARRAY[]::text[]
                    ),
                    COALESCE(
                      ARRAY(SELECT jsonb_array_elements_text(COALESCE(th.blockers, '[]'::jsonb))),
                      ARRAY[]::text[]
                    )
                  ) AS unresolved_findings,
                  th.focus_areas,
                  th.known_risks
             FROM task_handoffs th
            WHERE th.tenant_id = wi.tenant_id
              AND th.workflow_id = wi.workflow_id
              AND th.work_item_id = wi.id
            ORDER BY th.sequence DESC, th.created_at DESC
            LIMIT 1
         ) latest_handoff ON true
         LEFT JOIN LATERAL (
           SELECT th.task_id AS subject_task_id,
                  th.role AS subject_role,
                  NULLIF(COALESCE(NULLIF(th.role_data->>'subject_revision', '')::int, 0), 0) AS subject_revision
             FROM task_handoffs th
            WHERE th.tenant_id = wi.tenant_id
              AND th.workflow_id = wi.workflow_id
              AND th.work_item_id = wi.id
              AND COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'
              AND th.completion = 'full'
            ORDER BY th.sequence DESC, th.created_at DESC
            LIMIT 1
         ) latest_delivery ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(DISTINCT rule.assessed_by)::int AS required_assessment_count,
                  COALESCE(
                    ARRAY_AGG(DISTINCT rule.assessed_by) FILTER (WHERE rule.assessed_by IS NOT NULL),
                    ARRAY[]::text[]
                  ) AS required_assessor_roles,
                  COALESCE(
                    jsonb_agg(
                      DISTINCT jsonb_build_object(
                        'assessed_by', rule.assessed_by,
                        'assessment_retention', COALESCE(rule.revision_policy->>'assessment_retention', 'invalidate_all'),
                        'optional', COALESCE(rule.optional, false),
                        'materiality', COALESCE(rule.materiality, 'material')
                      )
                    ) FILTER (WHERE rule.assessed_by IS NOT NULL),
                    '[]'::jsonb
                  ) AS required_rules
             FROM jsonb_to_recordset(COALESCE(pb.definition->'assessment_rules', '[]'::jsonb)) AS rule(
               subject_role text,
               assessed_by text,
               checkpoint text,
               required boolean,
               optional boolean,
               materiality text,
               revision_policy jsonb
             )
            WHERE latest_delivery.subject_role IS NOT NULL
              AND rule.subject_role = latest_delivery.subject_role
              AND (rule.checkpoint IS NULL OR rule.checkpoint = wi.stage_name)
              AND COALESCE(rule.required, CASE WHEN rule.optional IS TRUE THEN FALSE ELSE TRUE END)
         ) assessment_requirements ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (
                    WHERE COALESCE(current_assessment.current_resolution, retained_prior.retained_resolution) = 'approved'
                  )::int AS approved_assessment_count,
                  COUNT(*) FILTER (
                    WHERE COALESCE(current_assessment.current_resolution, retained_prior.retained_resolution) IN ('request_changes', 'rejected')
                  )::int AS blocking_assessment_count,
                  COUNT(*) FILTER (
                    WHERE current_assessment.current_resolution IS NULL
                      AND retained_prior.retained_resolution IS NOT NULL
                  )::int AS retained_assessment_count,
                  COUNT(*) FILTER (
                    WHERE current_assessment.current_resolution IS NULL
                      AND retained_prior.invalidated_resolution IS NOT NULL
                  )::int AS invalidated_assessment_count
             FROM jsonb_to_recordset(COALESCE(assessment_requirements.required_rules, '[]'::jsonb)) AS rule(
               assessed_by text,
               assessment_retention text,
               optional boolean,
               materiality text
             )
             LEFT JOIN LATERAL (
               SELECT assessment_handoff.resolution AS current_resolution
                 FROM task_handoffs assessment_handoff
                WHERE assessment_handoff.tenant_id = wi.tenant_id
                  AND assessment_handoff.workflow_id = wi.workflow_id
                  AND COALESCE(assessment_handoff.role_data->>'task_kind', '') = 'assessment'
                  AND COALESCE(assessment_handoff.role_data->>'subject_task_id', '') = COALESCE(latest_delivery.subject_task_id::text, '')
                  AND assessment_handoff.role = rule.assessed_by
                  AND COALESCE(NULLIF(assessment_handoff.role_data->>'subject_revision', '')::int, -1) = COALESCE(latest_delivery.subject_revision, -1)
                ORDER BY assessment_handoff.sequence DESC, assessment_handoff.created_at DESC
                LIMIT 1
             ) current_assessment ON true
             LEFT JOIN LATERAL (
               SELECT CASE
                        WHEN rule.assessment_retention = 'retain_named_assessors'
                          THEN prior_assessment.resolution
                        WHEN rule.assessment_retention = 'retain_advisory_only'
                          AND COALESCE(rule.optional, false)
                          THEN prior_assessment.resolution
                        WHEN rule.assessment_retention = 'retain_non_material_only'
                          AND COALESCE(rule.materiality, 'material') = 'non_material'
                          THEN prior_assessment.resolution
                        ELSE NULL
                      END AS retained_resolution,
                      CASE
                        WHEN rule.assessment_retention = 'invalidate_all'
                          THEN prior_assessment.resolution
                        WHEN rule.assessment_retention = 'retain_advisory_only'
                          AND NOT COALESCE(rule.optional, false)
                          THEN prior_assessment.resolution
                        WHEN rule.assessment_retention = 'retain_non_material_only'
                          AND COALESCE(rule.materiality, 'material') <> 'non_material'
                          THEN prior_assessment.resolution
                        ELSE NULL
                      END AS invalidated_resolution
                 FROM LATERAL (
                   SELECT assessment_handoff.resolution
                     FROM task_handoffs assessment_handoff
                    WHERE assessment_handoff.tenant_id = wi.tenant_id
                      AND assessment_handoff.workflow_id = wi.workflow_id
                      AND COALESCE(assessment_handoff.role_data->>'task_kind', '') = 'assessment'
                      AND COALESCE(assessment_handoff.role_data->>'subject_task_id', '') = COALESCE(latest_delivery.subject_task_id::text, '')
                      AND assessment_handoff.role = rule.assessed_by
                      AND COALESCE(NULLIF(assessment_handoff.role_data->>'subject_revision', '')::int, -1) < COALESCE(latest_delivery.subject_revision, -1)
                    ORDER BY COALESCE(NULLIF(assessment_handoff.role_data->>'subject_revision', '')::int, -1) DESC,
                             assessment_handoff.sequence DESC,
                             assessment_handoff.created_at DESC
                    LIMIT 1
                 ) prior_assessment
             ) retained_prior ON current_assessment.current_resolution IS NULL
         ) assessment_rollup ON true
         LEFT JOIN LATERAL (
           SELECT g.status AS gate_status,
                  g.decision_feedback AS gate_decision_feedback,
                  g.decided_at AS gate_decided_at
             FROM workflow_stage_gates g
            WHERE g.tenant_id = wi.tenant_id
              AND g.workflow_id = wi.workflow_id
              AND g.stage_id = ws.id
            ORDER BY g.requested_at DESC, g.created_at DESC
            LIMIT 1
         ) latest_gate ON true
        WHERE ${conditions.join(' AND ')}
        GROUP BY wi.id,
                 latest_handoff.latest_handoff_completion,
                 latest_handoff.latest_handoff_resolution,
                 latest_handoff.unresolved_findings,
                 latest_handoff.focus_areas,
                 latest_handoff.known_risks,
                 latest_delivery.subject_revision,
                 assessment_requirements.required_assessment_count,
                 assessment_rollup.approved_assessment_count,
                 assessment_rollup.blocking_assessment_count,
                 assessment_rollup.retained_assessment_count,
                 assessment_rollup.invalidated_assessment_count,
                 branch.branch_status,
                 latest_gate.gate_status,
                 latest_gate.gate_decision_feedback,
                 latest_gate.gate_decided_at
        ORDER BY wi.created_at ASC`,
      values,
    );
    return result.rows.map(toWorkItemReadModel);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resolveWorkItemStageName(
  inputStageName: string | undefined,
  _workflow: { lifecycle: string | null; active_stage_name: string | null },
  definition: ReturnType<typeof parsePlaybookDefinition>,
): string | null {
  if (inputStageName) {
    return inputStageName;
  }
  return defaultStageName(definition);
}

function shouldAutoClosePredecessorCheckpoint(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  predecessorStageName: string | null,
  successorStageName: string,
) {
  if (!predecessorStageName || predecessorStageName === successorStageName) {
    return false;
  }

  const stageNames = definition.stages.map((stage) => stage.name);
  const predecessorIndex = stageNames.indexOf(predecessorStageName);
  const successorIndex = stageNames.indexOf(successorStageName);
  if (predecessorIndex < 0 || successorIndex < 0) {
    return false;
  }
  return successorIndex === predecessorIndex + 1;
}

function humanGateContinuationForStage(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  stageName: string,
) {
  const stage = definition.stages.find((entry) => entry.name === stageName);
  if (!stage?.human_gate) {
    return { nextExpectedActor: null, nextExpectedAction: null };
  }
  return { nextExpectedActor: 'human', nextExpectedAction: 'approve' };
}

function nextStageNameFor(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  currentStageName: string | null,
) {
  if (!currentStageName) {
    return null;
  }
  const currentIndex = definition.stages.findIndex((stage) => stage.name === currentStageName);
  if (currentIndex < 0) {
    return null;
  }
  return definition.stages[currentIndex + 1]?.name ?? null;
}

function shouldBlockSuccessorCheckpointForOpenTasks(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  predecessorStageName: string | null,
  taskStateCounts: Map<string, number>,
) {
  void definition;
  void predecessorStageName;
  return taskStateCounts.size > 0;
}

function terminalColumnIdFor(definition: ReturnType<typeof parsePlaybookDefinition>) {
  return definition.board.columns.find((column) => column.is_terminal)?.id ?? null;
}

function describePendingContinuation(action: string) {
  switch (action) {
    case 'approve':
      return 'approval';
    case 'rework':
      return 'rework';
    case 'handoff':
      return 'handoff';
    default:
      return 'assessment';
  }
}

function createdByForIdentity(identity: ApiKeyIdentity): 'api' | 'manual' | 'orchestrator' | 'webhook' {
  if (identity.ownerType === 'webhook_trigger' || identity.ownerType === 'scheduled_trigger') {
    return 'webhook';
  }
  if (identity.ownerType === 'agent') {
    return 'orchestrator';
  }
  return identity.scope === 'admin' ? 'manual' : 'api';
}

function actorTypeForIdentity(identity: ApiKeyIdentity): string {
  return identity.ownerType === 'webhook_trigger' || identity.ownerType === 'scheduled_trigger'
    ? 'system'
    : identity.scope;
}

function toWorkItemReadModel(row: Record<string, unknown>): WorkItemReadModel {
  const sanitizedRow = sanitizeSecretLikeValue(row, {
    redactionValue: 'redacted://work-item-secret',
    allowSecretReferences: false,
  }) as Record<string, unknown>;
  const childrenCount = readCount(sanitizedRow.children_count);
  const completedAt =
    typeof sanitizedRow.completed_at === 'string' || sanitizedRow.completed_at instanceof Date
      ? sanitizedRow.completed_at
      : null;
  const completedWorkItem = completedAt !== null;
  return {
    ...sanitizedRow,
    id: String(sanitizedRow.id ?? ''),
    workflow_id: String(sanitizedRow.workflow_id ?? ''),
    parent_work_item_id: typeof sanitizedRow.parent_work_item_id === 'string' ? sanitizedRow.parent_work_item_id : null,
    branch_id: typeof sanitizedRow.branch_id === 'string' ? sanitizedRow.branch_id : null,
    branch_status:
      typeof sanitizedRow.branch_status === 'string'
        ? sanitizedRow.branch_status as WorkItemReadModel['branch_status']
        : null,
    stage_name: typeof sanitizedRow.stage_name === 'string' ? sanitizedRow.stage_name : null,
    column_id: typeof sanitizedRow.column_id === 'string' ? sanitizedRow.column_id : null,
    next_expected_actor:
      completedWorkItem
        ? null
        : typeof sanitizedRow.next_expected_actor === 'string'
          ? sanitizedRow.next_expected_actor
          : null,
    next_expected_action:
      completedWorkItem
        ? null
        : typeof sanitizedRow.next_expected_action === 'string'
          ? sanitizedRow.next_expected_action
          : null,
    blocked_state:
      typeof sanitizedRow.blocked_state === 'string'
        ? sanitizedRow.blocked_state as WorkItemReadModel['blocked_state']
        : null,
    blocked_reason:
      typeof sanitizedRow.blocked_reason === 'string'
        ? sanitizedRow.blocked_reason
        : null,
    escalation_status:
      typeof sanitizedRow.escalation_status === 'string'
        ? sanitizedRow.escalation_status as WorkItemReadModel['escalation_status']
        : null,
    rework_count: readCount(sanitizedRow.rework_count),
    latest_handoff_completion:
      typeof sanitizedRow.latest_handoff_completion === 'string'
        ? sanitizedRow.latest_handoff_completion
        : null,
    latest_handoff_resolution:
      typeof sanitizedRow.latest_handoff_resolution === 'string'
        ? sanitizedRow.latest_handoff_resolution
        : null,
    unresolved_findings: completedWorkItem ? [] : readStringArray(sanitizedRow.unresolved_findings),
    focus_areas: completedWorkItem ? [] : readStringArray(sanitizedRow.focus_areas),
    known_risks: readStringArray(sanitizedRow.known_risks),
    current_subject_revision: readOptionalCount(sanitizedRow.current_subject_revision),
    required_assessment_count: readCount(sanitizedRow.required_assessment_count),
    approved_assessment_count: readCount(sanitizedRow.approved_assessment_count),
    blocking_assessment_count: readCount(sanitizedRow.blocking_assessment_count),
    pending_assessment_count: readCount(sanitizedRow.pending_assessment_count),
    retained_assessment_count: readCount(sanitizedRow.retained_assessment_count),
    invalidated_assessment_count: readCount(sanitizedRow.invalidated_assessment_count),
    assessment_status:
      typeof sanitizedRow.assessment_status === 'string'
        ? sanitizedRow.assessment_status as WorkItemReadModel['assessment_status']
        : null,
    gate_status: typeof sanitizedRow.gate_status === 'string' ? sanitizedRow.gate_status : null,
    gate_decision_feedback:
      typeof sanitizedRow.gate_decision_feedback === 'string'
        ? sanitizedRow.gate_decision_feedback
        : null,
    gate_decided_at:
      typeof sanitizedRow.gate_decided_at === 'string' || sanitizedRow.gate_decided_at instanceof Date
        ? sanitizedRow.gate_decided_at
        : null,
    completed_at: completedAt,
    task_count: readCount(sanitizedRow.task_count),
    children_count: childrenCount,
    children_completed: readCount(sanitizedRow.children_completed),
    is_milestone: childrenCount > 0,
  } as WorkItemReadModel;
}

function groupWorkItems(workItems: WorkItemReadModel[]): GroupedWorkItemReadModel[] {
  const grouped = new Map<string, GroupedWorkItemReadModel>();
  const roots: GroupedWorkItemReadModel[] = [];

  for (const item of workItems) {
    grouped.set(String(item.id), { ...item });
  }

  for (const item of grouped.values()) {
    const parentId = typeof item.parent_work_item_id === 'string' ? item.parent_work_item_id : null;
    if (!parentId) {
      roots.push(item);
      continue;
    }
    const parent = grouped.get(parentId);
    if (!parent) {
      roots.push(item);
      continue;
    }
    const existingChildren = Array.isArray(parent.children)
      ? (parent.children as WorkItemReadModel[])
      : [];
    const children = [...existingChildren, item] as WorkItemReadModel[];
    parent.children = children;
  }

  return roots;
}

function readCount(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function readOptionalCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function assertMatchingCreateWorkItemReplay(
  existing: Record<string, unknown>,
  expected: {
    parent_work_item_id: string | null;
    branch_id: string | null;
    stage_name: string;
    title: string;
    goal: string | null;
    acceptance_criteria: string | null;
    column_id: string;
    owner_role: string | null;
    priority: string;
    notes: string | null;
    metadata: Record<string, unknown>;
  },
): void {
  if (
    (existing.parent_work_item_id ?? null) !== expected.parent_work_item_id ||
    (existing.branch_id ?? null) !== expected.branch_id ||
    existing.stage_name !== expected.stage_name ||
    existing.title !== expected.title ||
    (existing.goal ?? null) !== expected.goal ||
    (existing.acceptance_criteria ?? null) !== expected.acceptance_criteria ||
    existing.column_id !== expected.column_id ||
    (existing.owner_role ?? null) !== expected.owner_role ||
    existing.priority !== expected.priority ||
    (existing.notes ?? null) !== expected.notes ||
    !areJsonValuesEquivalent(asRecord(existing.metadata), expected.metadata)
  ) {
    throw new ConflictError('work item request_id replay does not match the existing work item');
  }
}

function shouldResetReusableChildCheckpoint(workItem: Record<string, unknown>) {
  const metadata = asRecord(workItem.metadata);
  return Boolean(
    (typeof workItem.next_expected_actor === 'string' && workItem.next_expected_actor.length > 0)
    || (typeof workItem.next_expected_action === 'string' && workItem.next_expected_action.length > 0)
    || metadata.orchestrator_finish_state,
  );
}

function starterRolesForPlannedStage(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  stageName: string,
) {
  const stage = definition.stages.find((entry) => entry.name === stageName);
  const stageRoles = stage?.involves?.filter((role) => role.trim().length > 0) ?? [];
  if (stageRoles.length === 0) {
    return [];
  }

  const blockedRoles = new Set(
    definition.handoff_rules
      .filter(
        (rule) =>
          rule.required !== false
          && (!rule.checkpoint || rule.checkpoint === stageName)
          && stageRoles.includes(rule.from_role)
          && stageRoles.includes(rule.to_role),
      )
      .map((rule) => rule.to_role),
  );

  return stageRoles.filter((role) => !blockedRoles.has(role));
}
