import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/domain-errors.js';
import { parsePlaybookDefinition } from '../../orchestration/playbook-model.js';
import { mergeLifecyclePolicy, readTemplateLifecyclePolicy } from '../task-lifecycle-policy.js';
import {
  readRequiredPositiveIntegerRuntimeDefault,
  TASK_LLM_MAX_RETRIES_RUNTIME_KEY,
  TASK_MAX_ITERATIONS_RUNTIME_KEY,
} from '../runtime-defaults/runtime-default-values.js';
import {
  DEFAULT_REPOSITORY_TASK_TEMPLATE,
  asNullableString,
  asRecord,
  mergeWorkspaceStorageBindings,
  normalizeResourceBindings,
  stripWorkspaceStorageOverrides,
} from './task-write-service.helpers.js';
import type { CreateTaskInput } from '../task-service.types.js';
import type { LinkedWorkItemRow, TaskWriteDependencies, WorkflowPlaybookDefinitionRow } from './task-write-service.types.js';
import { resolveWorkspaceStorageBinding } from '../workspace-storage.js';

export class TaskWriteCreateDefaults {
  constructor(private readonly deps: TaskWriteDependencies) {}

  private async applyLinkedWorkItemDefaults(
    tenantId: string,
    input: CreateTaskInput,
    db: DatabaseClient | DatabasePool,
  ): Promise<CreateTaskInput> {
    if (!input.work_item_id) {
      return input;
    }
    const linkedWorkItem = await this.loadLinkedWorkItem(tenantId, input.work_item_id, db);
    this.assertLinkedWorkItemAcceptsTaskMutation(linkedWorkItem);
    return {
      ...input,
      workflow_id: input.workflow_id ?? linkedWorkItem.workflow_id,
      branch_id: input.branch_id ?? linkedWorkItem.branch_id ?? undefined,
      stage_name: input.stage_name ?? linkedWorkItem.stage_name,
    };
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

  private async applyWorkflowExecutionDefaults(
    tenantId: string,
    input: CreateTaskInput,
    db: DatabaseClient | DatabasePool,
  ): Promise<CreateTaskInput> {
    if (!input.workflow_id || input.is_orchestrator_task) {
      return input;
    }

    const result = await db.query<{
      repository_url: string | null;
      settings: Record<string, unknown> | null;
      git_branch: string | null;
      parameters: Record<string, unknown> | null;
    }>(
      `SELECT p.repository_url,
              p.settings,
              w.git_branch,
              w.parameters
         FROM workflows w
         LEFT JOIN workspaces p
           ON p.tenant_id = w.tenant_id
          AND p.id = w.workspace_id
        WHERE w.tenant_id = $1
          AND w.id = $2
        LIMIT 1`,
      [tenantId, input.workflow_id],
    );
    if (!result.rowCount) {
      return input;
    }

    const workflow = result.rows[0];
    const storage = resolveWorkspaceStorageBinding({
      repository_url: workflow.repository_url,
      settings: workflow.settings,
    });
    const nextEnvironment = stripWorkspaceStorageOverrides(asRecord(input.environment));
    if (storage.type === 'git_remote') {
      if (storage.repository_url) {
        nextEnvironment.repository_url = storage.repository_url;
      }
      if (storage.default_branch) {
        nextEnvironment.branch = storage.default_branch;
        nextEnvironment.base_branch = storage.default_branch;
      }
      if (storage.git_user_name) {
        nextEnvironment.git_user_name = storage.git_user_name;
      }
      if (storage.git_user_email) {
        nextEnvironment.git_user_email = storage.git_user_email;
      }
      if (!asNullableString(nextEnvironment.template) && !asNullableString(nextEnvironment.image)) {
        nextEnvironment.template = DEFAULT_REPOSITORY_TASK_TEMPLATE;
      }
    }
    const nextBindings = mergeWorkspaceStorageBindings(
      normalizeResourceBindings(input.resource_bindings),
      storage,
    );
    const hasEnvironment = Object.keys(nextEnvironment).length > 0;
    const hasBindings = nextBindings.length > 0 || Array.isArray(input.resource_bindings);

    return {
      ...input,
      ...(hasEnvironment ? { environment: nextEnvironment } : {}),
      ...(hasBindings ? { resource_bindings: nextBindings } : {}),
    };
  }

  private async applyPlaybookRuleDerivedTaskReviewPolicy(
    tenantId: string,
    input: CreateTaskInput,
    db: DatabaseClient | DatabasePool,
  ): Promise<CreateTaskInput> {
    void tenantId;
    void db;
    return input;
  }

  private async applyPlaybookTaskExecutionDefaults(
    tenantId: string,
    input: CreateTaskInput,
    db: DatabaseClient | DatabasePool,
  ): Promise<CreateTaskInput> {
    if (!input.workflow_id) {
      return input;
    }
    if (input.max_iterations != null && input.llm_max_retries != null) {
      return input;
    }
    const definition = await this.loadWorkflowPlaybookDefinition(tenantId, input.workflow_id, db);
    if (!definition?.orchestrator) {
      return input;
    }
    const existingMetadata = asRecord(input.metadata);
    const existingLifecyclePolicy = readTemplateLifecyclePolicy(
      existingMetadata.lifecycle_policy,
      'metadata.lifecycle_policy',
    );
    const playbookLifecyclePolicy = definition.orchestrator.max_rework_iterations != null
      && definition.orchestrator.max_rework_iterations > 0
      ? {
          rework: {
            max_cycles: definition.orchestrator.max_rework_iterations,
          },
        }
      : undefined;
    const mergedLifecyclePolicy = mergeLifecyclePolicy(
      playbookLifecyclePolicy,
      existingLifecyclePolicy,
    );

    return {
      ...input,
      max_iterations: input.max_iterations ?? definition.orchestrator.max_iterations,
      llm_max_retries: input.llm_max_retries ?? definition.orchestrator.llm_max_retries,
      ...(mergedLifecyclePolicy
        ? {
            metadata: {
              ...existingMetadata,
              lifecycle_policy: mergedLifecyclePolicy,
            },
          }
        : {}),
    };
  }

  private async materializeTaskLoopExecutionDefaults(
    tenantId: string,
    input: CreateTaskInput,
    db: DatabaseClient | DatabasePool,
  ): Promise<CreateTaskInput> {
    const maxIterations = input.max_iterations ?? await readRequiredPositiveIntegerRuntimeDefault(
      db,
      tenantId,
      TASK_MAX_ITERATIONS_RUNTIME_KEY,
    );
    const llmMaxRetries = input.llm_max_retries ?? await readRequiredPositiveIntegerRuntimeDefault(
      db,
      tenantId,
      TASK_LLM_MAX_RETRIES_RUNTIME_KEY,
    );

    return {
      ...input,
      max_iterations: maxIterations,
      llm_max_retries: llmMaxRetries,
    };
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

  private assertWorkflowTaskLinkage(input: CreateTaskInput) {
    if (!input.workflow_id || input.is_orchestrator_task) {
      return;
    }
    if (input.work_item_id) {
      return;
    }
    throw new ValidationError('workflow tasks must be linked to a work item');
  }

  private assertLinkedWorkItemAcceptsTaskMutation(linkedWorkItem: LinkedWorkItemRow) {
    const metadata = asRecord(linkedWorkItem.workflow_metadata);
    const workItemMetadata = asRecord(linkedWorkItem.work_item_metadata);
    if (typeof metadata.cancel_requested_at === 'string' && metadata.cancel_requested_at.trim().length > 0) {
      throw new ConflictError('Workflow cancellation is already in progress');
    }
    if (
      linkedWorkItem.workflow_state === 'paused'
      || (typeof metadata.pause_requested_at === 'string' && metadata.pause_requested_at.trim().length > 0)
    ) {
      throw new ConflictError('Workflow is paused');
    }
    if (linkedWorkItem.workflow_state === 'cancelled') {
      throw new ConflictError('Cancelled workflows cannot accept new tasks');
    }
    if (linkedWorkItem.workflow_state === 'completed') {
      throw new ConflictError('Completed workflows cannot accept new tasks');
    }
    if (linkedWorkItem.workflow_state === 'failed') {
      throw new ConflictError('Failed workflows cannot accept new tasks');
    }
    if (
      typeof workItemMetadata.cancel_requested_at === 'string'
      && workItemMetadata.cancel_requested_at.trim().length > 0
    ) {
      throw new ConflictError('Cancelled workflow work items cannot accept new tasks');
    }
    if (
      typeof linkedWorkItem.work_item_completed_at === 'string'
      && linkedWorkItem.work_item_completed_at.trim().length > 0
    ) {
      throw new ConflictError('Completed workflow work items cannot accept new tasks');
    }
    if (
      typeof workItemMetadata.pause_requested_at === 'string'
      && workItemMetadata.pause_requested_at.trim().length > 0
    ) {
      throw new ConflictError('Workflow work item is paused');
    }
  }

}
