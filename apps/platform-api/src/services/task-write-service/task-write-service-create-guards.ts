import { isOperatorScope } from '../../auth/scope.js';
import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../errors/domain-errors.js';
import { parsePlaybookDefinition } from '../../orchestration/playbook-model.js';
import {
  readRequiredPositiveIntegerRuntimeDefault,
  TASK_DEFAULT_TIMEOUT_MINUTES_RUNTIME_KEY,
} from '../runtime-defaults/runtime-default-values.js';
import type { CreateTaskInput } from '../task/task-service.types.js';
import type { LinkedWorkItemRow, TaskWriteDependencies, WorkflowMutationGuardRow, WorkflowPlaybookDefinitionRow } from './task-write-service.types.js';
import {
  asNullableString,
  asRecord,
  buildExpectedCreateTaskIntent,
  buildExpectedCreateTaskReplay,
  findNextStageForRole,
  isClosedPlannedStage,
  matchesCreateTaskIntent,
} from './task-write-service.helpers.js';
import {
  ACTIVE_TASK_DUPLICATE_GUARD_STATES,
  REUSABLE_TASK_DUPLICATE_GUARD_STATES,
} from './task-write-service-duplicate-guard-states.js';

const ORCHESTRATOR_GUIDED_RECOVERY_HINT = 'orchestrator_guided_recovery';

export class TaskWriteCreateGuards {
  constructor(private readonly deps: TaskWriteDependencies) {}

  private async assertWorkflowAcceptsTaskMutation(
    tenantId: string,
    workflowId: string | null,
    db: DatabaseClient | DatabasePool,
  ) {
    if (!workflowId) {
      return;
    }
    const result = await db.query<WorkflowMutationGuardRow>(
      `SELECT id, state, metadata
         FROM workflows
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1`,
      [tenantId, workflowId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workflow not found');
    }
    const workflow = result.rows[0];
    const metadata = asRecord(workflow.metadata);
    if (typeof metadata.cancel_requested_at === 'string' && metadata.cancel_requested_at.trim().length > 0) {
      throw new ConflictError('Workflow cancellation is already in progress');
    }
    if (
      workflow.state === 'paused'
      || (typeof metadata.pause_requested_at === 'string' && metadata.pause_requested_at.trim().length > 0)
    ) {
      throw new ConflictError('Workflow is paused');
    }
    if (workflow.state === 'cancelled') {
      throw new ConflictError('Cancelled workflows cannot accept new tasks');
    }
    if (workflow.state === 'completed') {
      throw new ConflictError('Completed workflows cannot accept new tasks');
    }
    if (workflow.state === 'failed') {
      throw new ConflictError('Failed workflows cannot accept new tasks');
    }
  }

  private async resolveTimeoutMinutes(
    tenantId: string,
    input: CreateTaskInput,
    db: DatabaseClient | DatabasePool,
  ): Promise<number> {
    if (typeof input.timeout_minutes === 'number' && Number.isInteger(input.timeout_minutes) && input.timeout_minutes > 0) {
      return input.timeout_minutes;
    }

    return readRequiredPositiveIntegerRuntimeDefault(
      db,
      tenantId,
      TASK_DEFAULT_TIMEOUT_MINUTES_RUNTIME_KEY,
    );
  }

  private async findExistingReusableTaskForWorkItemRole(
    tenantId: string,
    input: CreateTaskInput,
    dependencies: string[],
    metadata: Record<string, unknown>,
    db: DatabaseClient | DatabasePool,
  ) {
    if (
      input.is_orchestrator_task ||
      !input.workflow_id ||
      !input.work_item_id ||
      !input.role?.trim()
    ) {
      return null;
    }

    const result = await db.query(
      `SELECT *
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND work_item_id = $3
          AND role = $4
          AND state = ANY($5::task_state[])
        ORDER BY
          CASE state
            WHEN 'in_progress' THEN 0
            WHEN 'claimed' THEN 1
            WHEN 'ready' THEN 2
            WHEN 'awaiting_approval' THEN 3
            WHEN 'output_pending_assessment' THEN 4
            WHEN 'pending' THEN 5
            WHEN 'escalated' THEN 6
            ELSE 7
          END,
          created_at DESC`,
      [
        tenantId,
        input.workflow_id,
        input.work_item_id,
        input.role.trim(),
        REUSABLE_TASK_DUPLICATE_GUARD_STATES,
      ],
    );
    if (!result.rowCount) {
      return null;
    }

    const expectedIntent = buildExpectedCreateTaskIntent(input, dependencies, metadata);
    for (const row of result.rows as Record<string, unknown>[]) {
      if (
        typeof row.state === 'string'
        && (ACTIVE_TASK_DUPLICATE_GUARD_STATES as readonly string[]).includes(row.state)
      ) {
        return row;
      }
      if (matchesCreateTaskIntent(row, expectedIntent)) {
        return row;
      }
    }

    return null;
  }

  private async findExistingByRequestId(
    tenantId: string,
    requestId: string,
    workflowId: string | null,
    db: DatabaseClient | DatabasePool,
  ) {
    const normalizedRequestId = requestId.trim();
    const result = workflowId
      ? await db.query(
          `SELECT *
             FROM tasks
            WHERE tenant_id = $1
              AND workflow_id = $2
              AND request_id = $3
            LIMIT 1`,
          [tenantId, workflowId, normalizedRequestId],
        )
      : await db.query(
          `SELECT *
             FROM tasks
            WHERE tenant_id = $1
              AND workflow_id IS NULL
              AND request_id = $2
            LIMIT 1`,
          [tenantId, normalizedRequestId],
        );
    return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
  }

  private async assertLinkedWorkItem(
    tenantId: string,
    input: CreateTaskInput,
    db: DatabaseClient | DatabasePool,
  ) {
    if (!input.work_item_id) {
      return;
    }
    const linkedWorkItem = await this.loadLinkedWorkItem(tenantId, input.work_item_id, db);
    if (input.workflow_id && linkedWorkItem.workflow_id !== input.workflow_id) {
      throw new ValidationError('work_item_id must belong to workflow_id');
    }
    if (linkedWorkItem.branch_status === 'terminated') {
      throw new ConflictError('Cannot create new tasks for terminated branch');
    }
    if (
      input.branch_id
      && linkedWorkItem.branch_id
      && linkedWorkItem.branch_id !== input.branch_id
    ) {
      throw new ValidationError('branch_id must match the linked work item branch');
    }
    if (input.stage_name && linkedWorkItem.stage_name !== input.stage_name) {
      throw new ValidationError(
        `stage_name '${input.stage_name}' does not match linked work item stage ` +
          `'${linkedWorkItem.stage_name}'. For planned workflows, create or move a work item ` +
          `in stage '${input.stage_name}' before creating tasks for that stage.`,
        buildRecoverableCreateTaskDetails({
          reasonCode: 'task_stage_mismatch',
          workflowId: linkedWorkItem.workflow_id,
          workItemId: input.work_item_id ?? null,
          requestedRole: input.role?.trim() ?? null,
          linkedWorkItemStageName: linkedWorkItem.stage_name,
          requestedStageName: input.stage_name,
        }),
      );
    }
    await this.assertPlannedStageRoleMembership(tenantId, input, linkedWorkItem, db);
    if (
      input.role
      && linkedWorkItem.next_expected_actor
      && linkedWorkItem.next_expected_actor !== input.role
    ) {
      throw new ConflictError(
        `Cannot create task for role '${input.role}' on work item '${input.work_item_id}' ` +
          `because the next expected actor is '${linkedWorkItem.next_expected_actor}'` +
          (linkedWorkItem.next_expected_action
            ? ` for action '${linkedWorkItem.next_expected_action}'`
            : '') +
          '. Resolve the current workflow expectation before dispatching a different role.',
        buildRecoverableCreateTaskDetails({
          reasonCode: 'next_expected_actor_mismatch',
          workflowId: linkedWorkItem.workflow_id,
          workItemId: input.work_item_id ?? null,
          requestedRole: input.role.trim(),
          linkedWorkItemStageName: linkedWorkItem.stage_name,
          requestedStageName: input.stage_name ?? linkedWorkItem.stage_name,
          nextExpectedActor: linkedWorkItem.next_expected_actor,
          nextExpectedAction: linkedWorkItem.next_expected_action,
        }),
      );
    }
    if (isClosedPlannedStage(linkedWorkItem)) {
      throw new ConflictError(
        `Cannot create new tasks for planned workflow stage '${linkedWorkItem.stage_name}' after it has been approved or completed`,
      );
    }
  }

  private async assertPlannedStageRoleMembership(
    tenantId: string,
    input: CreateTaskInput,
    linkedWorkItem: LinkedWorkItemRow,
    db: DatabaseClient | DatabasePool,
  ) {
    if (
      linkedWorkItem.workflow_lifecycle !== 'planned'
      || input.is_orchestrator_task
      || !input.role?.trim()
    ) {
      return;
    }

    const definition = await this.loadWorkflowPlaybookDefinition(
      tenantId,
      linkedWorkItem.workflow_id,
      db,
    );
    if (!definition) {
      return;
    }

    const roleName = input.role.trim();
    const definedRoles = definition.roles.filter((role) => role.trim().length > 0);
    if (definedRoles.length > 0 && !definedRoles.includes(roleName)) {
      throw new ValidationError(
        `Role '${roleName}' is not defined in planned workflow playbook '${linkedWorkItem.workflow_id}'.`,
        buildRecoverableCreateTaskDetails({
          reasonCode: 'role_not_defined_in_playbook',
          workflowId: linkedWorkItem.workflow_id,
          workItemId: input.work_item_id ?? null,
          requestedRole: roleName,
          linkedWorkItemStageName: linkedWorkItem.stage_name,
          requestedStageName: input.stage_name ?? linkedWorkItem.stage_name,
          definedRoles,
        }),
      );
    }

    const stage = definition.stages.find((entry) => entry.name === linkedWorkItem.stage_name);
    const allowedRoles = stage?.involves ?? [];
    if (allowedRoles.length === 0 || allowedRoles.includes(roleName)) {
      return;
    }

    const successorStageName = findNextStageForRole(
      definition.stages,
      linkedWorkItem.stage_name,
      roleName,
    );
    if (successorStageName) {
      throw new ValidationError(
        `Role '${roleName}' is not allowed on planned workflow stage ` +
          `'${linkedWorkItem.stage_name}'. Route successor work into stage ` +
          `'${successorStageName}' before dispatching role '${roleName}'.`,
        buildRecoverableCreateTaskDetails({
          reasonCode: 'role_routes_to_successor_stage',
          workflowId: linkedWorkItem.workflow_id,
          workItemId: input.work_item_id ?? null,
          requestedRole: roleName,
          linkedWorkItemStageName: linkedWorkItem.stage_name,
          requestedStageName: input.stage_name ?? linkedWorkItem.stage_name,
          allowedRoles,
          successorStageName,
          nextExpectedActor: linkedWorkItem.next_expected_actor,
          nextExpectedAction: linkedWorkItem.next_expected_action,
        }),
      );
    }

    throw new ValidationError(
      `Role '${roleName}' is not allowed on planned workflow stage ` +
        `'${linkedWorkItem.stage_name}'.`,
      buildRecoverableCreateTaskDetails({
        reasonCode: 'role_not_allowed_on_stage',
        workflowId: linkedWorkItem.workflow_id,
        workItemId: input.work_item_id ?? null,
        requestedRole: roleName,
        linkedWorkItemStageName: linkedWorkItem.stage_name,
        requestedStageName: input.stage_name ?? linkedWorkItem.stage_name,
        allowedRoles,
        nextExpectedActor: linkedWorkItem.next_expected_actor,
        nextExpectedAction: linkedWorkItem.next_expected_action,
      }),
    );
  }


  private async loadLinkedWorkItem(
    tenantId: string,
    workItemId: string,
    db: DatabaseClient | DatabasePool,
  ): Promise<LinkedWorkItemRow> {
    const result = await db.query<LinkedWorkItemRow>(
      `SELECT wi.workflow_id,
              w.state AS workflow_state,
              w.metadata AS workflow_metadata,
              wi.metadata AS work_item_metadata,
              wi.completed_at::text AS work_item_completed_at,
              wi.parent_work_item_id,
              wi.branch_id,
              branch.branch_status,
              wi.stage_name,
              wi.owner_role,
              wi.next_expected_actor,
              wi.next_expected_action,
              w.lifecycle AS workflow_lifecycle,
              ws.status AS stage_status,
              ws.gate_status AS stage_gate_status
         FROM workflow_work_items wi
         JOIN workflows w
           ON w.tenant_id = wi.tenant_id
          AND w.id = wi.workflow_id
         LEFT JOIN workflow_stages ws
           ON ws.tenant_id = wi.tenant_id
          AND ws.workflow_id = wi.workflow_id
          AND ws.name = wi.stage_name
         LEFT JOIN workflow_branches branch
           ON branch.tenant_id = wi.tenant_id
          AND branch.workflow_id = wi.workflow_id
          AND branch.id = wi.branch_id
        WHERE wi.tenant_id = $1
          AND wi.id = $2`,
      [tenantId, workItemId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workflow work item not found');
    }
    return result.rows[0];
  }

  private async loadWorkflowPlaybookDefinition(
    tenantId: string,
    workflowId: string,
    db: DatabaseClient | DatabasePool,
  ) {
    const result = await db.query<WorkflowPlaybookDefinitionRow>(
      `SELECT pb.definition
         FROM workflows w
         JOIN playbooks pb
           ON pb.tenant_id = w.tenant_id
          AND pb.id = w.playbook_id
        WHERE w.tenant_id = $1
          AND w.id = $2
        LIMIT 1`,
      [tenantId, workflowId],
    );
    if (!result.rowCount) {
      return null;
    }
    return parsePlaybookDefinition(result.rows[0].definition);
  }
}

function buildRecoverableCreateTaskDetails(input: {
  reasonCode:
    | 'task_stage_mismatch'
    | 'next_expected_actor_mismatch'
    | 'role_not_defined_in_playbook'
    | 'role_routes_to_successor_stage'
    | 'role_not_allowed_on_stage';
  workflowId: string;
  workItemId: string | null;
  requestedRole: string | null;
  linkedWorkItemStageName: string;
  requestedStageName: string | null;
  definedRoles?: string[];
  allowedRoles?: string[];
  successorStageName?: string | null;
  nextExpectedActor?: string | null;
  nextExpectedAction?: string | null;
}) {
  return {
    recovery_hint: ORCHESTRATOR_GUIDED_RECOVERY_HINT,
    reason_code: input.reasonCode,
    workflow_id: input.workflowId,
    work_item_id: input.workItemId,
    requested_role: input.requestedRole,
    linked_work_item_stage_name: input.linkedWorkItemStageName,
    requested_stage_name: input.requestedStageName,
    defined_roles: input.definedRoles ?? [],
    allowed_roles: input.allowedRoles ?? [],
    successor_stage_name: input.successorStageName ?? null,
    next_expected_actor: input.nextExpectedActor ?? null,
    next_expected_action: input.nextExpectedAction ?? null,
  } satisfies Record<string, unknown>;
}
