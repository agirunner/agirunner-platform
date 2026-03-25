import type { ApiKeyIdentity } from '../auth/api-key.js';
import { isOperatorScope } from '../auth/scope.js';
import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';
import { areJsonValuesEquivalent } from './json-equivalence.js';
import { PlaybookTaskParallelismService } from './playbook-task-parallelism-service.js';
import { resolveWorkspaceStorageBinding, buildGitRemoteResourceBindings } from './workspace-storage.js';
import {
  readRequiredPositiveIntegerRuntimeDefault,
  TASK_LLM_MAX_RETRIES_RUNTIME_KEY,
  TASK_DEFAULT_TIMEOUT_MINUTES_RUNTIME_KEY,
  TASK_MAX_ITERATIONS_RUNTIME_KEY,
} from './runtime-default-values.js';
import {
  mergeLifecyclePolicy,
  readTemplateLifecyclePolicy,
} from './task-lifecycle-policy.js';
import type { CreateTaskInput, TaskServiceConfig } from './task-service.types.js';
import {
  PLATFORM_CONTROL_PLANE_IDEMPOTENT_MUTATION_REPLAY_ID,
  mustGetSafetynetEntry,
} from './safetynet/registry.js';
import { logSafetynetTriggered } from './safetynet/logging.js';

interface TaskWriteDependencies {
  pool: DatabasePool;
  eventService: EventService;
  config: TaskServiceConfig;
  hasOrchestratorPermission: (
    tenantId: string,
    agentId: string,
    workflowId: string,
    permission: string,
  ) => Promise<boolean>;
  subtaskPermission: string;
  loadTaskOrThrow: (tenantId: string, taskId: string) => Promise<Record<string, unknown>>;
  toTaskResponse: (task: Record<string, unknown>) => Record<string, unknown>;
  parallelismService: PlaybookTaskParallelismService;
}

interface ParentTaskRow {
  id: string;
  workflow_id: string | null;
  workspace_id: string | null;
  assigned_agent_id: string | null;
  assigned_worker_id: string | null;
  parent_id: string | null;
}

interface LinkedWorkItemRow {
  workflow_id: string;
  parent_work_item_id: string | null;
  branch_id: string | null;
  branch_status: 'active' | 'completed' | 'blocked' | 'terminated' | null;
  stage_name: string;
  workflow_lifecycle: string | null;
  stage_status: string | null;
  stage_gate_status: string | null;
  owner_role: string | null;
  next_expected_actor: string | null;
  next_expected_action: string | null;
}

interface WorkflowPlaybookDefinitionRow {
  definition: unknown;
}

const DEFAULT_MAX_SUBTASK_DEPTH = 3;
const DEFAULT_MAX_SUBTASKS_PER_PARENT = 20;
const DEFAULT_REPOSITORY_TASK_TEMPLATE = 'execution-workspace';
const secretLikeKeyPattern = /(secret|token|password|api[_-]?key|credential|authorization|private[_-]?key|known_hosts)/i;
const ACTIVE_TASK_DUPLICATE_GUARD_STATES = [
  'pending',
  'ready',
  'claimed',
  'in_progress',
  'awaiting_approval',
  'output_pending_assessment',
  'escalated',
] as const;
const REUSABLE_TASK_DUPLICATE_GUARD_STATES = [
  ...ACTIVE_TASK_DUPLICATE_GUARD_STATES,
  'completed',
] as const;
const IDEMPOTENT_MUTATION_REPLAY_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_CONTROL_PLANE_IDEMPOTENT_MUTATION_REPLAY_ID,
);

export class TaskWriteService {
  constructor(private readonly deps: TaskWriteDependencies) {}

  async createTask(
    identity: ApiKeyIdentity,
    input: CreateTaskInput,
    db: DatabaseClient | DatabasePool = this.deps.pool,
  ) {
    if (!input.title?.trim()) throw new ValidationError('title is required');
    assertNoPlaintextSecrets('task create payload', {
      credentials: input.credentials,
      input: input.input,
      context: input.context,
      role_config: input.role_config,
      environment: input.environment,
      resource_bindings: input.resource_bindings,
      metadata: input.metadata,
    });
    let normalizedInput = stripRedactedTaskSecretPlaceholders(input);
    normalizedInput = normalizedInput.parent_id
      ? await this.applyParentTaskPolicies(identity, normalizedInput)
      : normalizedInput;
    normalizedInput = await this.applyLinkedWorkItemDefaults(identity.tenantId, normalizedInput, db);
    this.assertWorkflowTaskLinkage(normalizedInput);
    await this.assertLinkedWorkItem(identity.tenantId, normalizedInput, db);
    normalizedInput = await this.applyWorkflowExecutionDefaults(identity.tenantId, normalizedInput, db);
    normalizedInput = await this.applyPlaybookTaskExecutionDefaults(identity.tenantId, normalizedInput, db);
    normalizedInput = await this.materializeTaskLoopExecutionDefaults(identity.tenantId, normalizedInput, db);
    normalizedInput = await this.applyPlaybookRuleDerivedTaskReviewPolicy(identity.tenantId, normalizedInput, db);
    normalizedInput = normalizeTaskContractInput(normalizedInput);
    const executionBackend = resolveTaskExecutionBackend(normalizedInput);
    const dependencies = normalizedInput.depends_on ?? [];
    const metadata = {
      ...(normalizedInput.metadata ?? {}),
      ...(normalizedInput.branch_id ? { branch_id: normalizedInput.branch_id } : {}),
      ...selectPersistedSubjectLinkage(normalizedInput),
      ...(normalizedInput.retry_policy
        ? { lifecycle_policy: { retry_policy: readTemplateLifecyclePolicy({ retry_policy: normalizedInput.retry_policy }, 'retry_policy')?.retry_policy } }
        : {}),
      ...(normalizedInput.description ? { description: normalizedInput.description } : {}),
      ...(normalizedInput.type ? { task_type: normalizedInput.type } : {}),
      ...(normalizedInput.task_kind ? { task_kind: normalizedInput.task_kind } : {}),
      ...(normalizedInput.credentials ? { credential_refs: normalizedInput.credentials } : {}),
      ...(normalizedInput.parent_id ? { parent_id: normalizedInput.parent_id } : {}),
      ...(normalizedInput.assessment_prompt
        ? { assessment_prompt: normalizedInput.assessment_prompt }
        : {}),
    };
    if (normalizedInput.request_id?.trim()) {
      const existing = await this.findExistingByRequestId(
        identity.tenantId,
        normalizedInput.request_id,
        normalizedInput.workflow_id ?? null,
        db,
      );
      if (existing) {
        assertMatchingCreateTaskReplay(
          existing,
          buildExpectedCreateTaskReplay(
            normalizedInput,
            dependencies,
            metadata,
          ),
        );
        logSafetynetTriggered(
          IDEMPOTENT_MUTATION_REPLAY_SAFETYNET,
          'idempotent task create replay returned stored task',
          {
            workflow_id: normalizedInput.workflow_id ?? null,
            work_item_id: normalizedInput.work_item_id ?? null,
            request_id: normalizedInput.request_id.trim(),
          },
        );
        return this.deps.toTaskResponse(existing);
      }
    }

    if (dependencies.length > 0) {
      const check = await db.query(
        'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [identity.tenantId, dependencies],
      );
      if (check.rowCount !== dependencies.length)
        throw new NotFoundError('One or more dependency tasks were not found');
    }

    const existingReusableTask = await this.findExistingReusableTaskForWorkItemRole(
      identity.tenantId,
      normalizedInput,
      dependencies,
      metadata,
      db,
    );
    if (existingReusableTask) {
      return this.deps.toTaskResponse(existingReusableTask);
    }

    const hasUnfinishedDependencies = await this.hasUnfinishedDependencies(identity.tenantId, dependencies, db);
    const initialState = await this.resolveInitialState(identity.tenantId, normalizedInput, hasUnfinishedDependencies);
    const timeoutMinutes = await this.resolveTimeoutMinutes(identity.tenantId, normalizedInput, db);

    const insertResult = await db.query(
      `INSERT INTO tasks (
        tenant_id, workflow_id, work_item_id, workspace_id, title, role, stage_name, priority, state, depends_on,
        input, context, role_config, environment,
        resource_bindings, activation_id, request_id, is_orchestrator_task, timeout_minutes, token_budget, cost_cap_usd, auto_retry, max_retries, max_iterations, llm_max_retries, branch_id, execution_backend, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid[],$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
      ON CONFLICT DO NOTHING
      RETURNING *`,
      [
        identity.tenantId,
        normalizedInput.workflow_id ?? null,
        normalizedInput.work_item_id ?? null,
        normalizedInput.workspace_id ?? null,
        normalizedInput.title,
        normalizedInput.role ?? null,
        normalizedInput.stage_name ?? null,
        normalizedInput.priority ?? 'normal',
        initialState,
        dependencies,
        normalizedInput.input ?? {},
        normalizedInput.context ?? {},
        normalizedInput.role_config ?? null,
        normalizedInput.environment ?? null,
        JSON.stringify(normalizedInput.resource_bindings ?? []),
        normalizedInput.activation_id ?? null,
        normalizedInput.request_id?.trim() ?? null,
        normalizedInput.is_orchestrator_task ?? false,
        timeoutMinutes,
        normalizedInput.token_budget ?? null,
        normalizedInput.cost_cap_usd ?? null,
        normalizedInput.auto_retry ?? false,
        normalizedInput.max_retries ?? 0,
        normalizedInput.max_iterations ?? null,
        normalizedInput.llm_max_retries ?? null,
        normalizedInput.branch_id ?? null,
        executionBackend,
        metadata,
      ],
    );
    if (!insertResult.rowCount) {
      const replayRequestId = normalizedInput.request_id?.trim();
      const existing = replayRequestId
        ? await this.findExistingByRequestId(
            identity.tenantId,
            replayRequestId,
            normalizedInput.workflow_id ?? null,
            db,
          )
        : null;
      if (existing) {
        assertMatchingCreateTaskReplay(
          existing,
          buildExpectedCreateTaskReplay(
            normalizedInput,
            dependencies,
            metadata,
          ),
        );
        logSafetynetTriggered(
          IDEMPOTENT_MUTATION_REPLAY_SAFETYNET,
          'idempotent task create replay returned stored task after insert conflict',
          {
            workflow_id: normalizedInput.workflow_id ?? null,
            work_item_id: normalizedInput.work_item_id ?? null,
            request_id: replayRequestId,
          },
        );
        return this.deps.toTaskResponse(existing);
      }
      throw new ConflictError('Task request conflicted but the existing task could not be loaded');
    }

    const task = insertResult.rows[0] as Record<string, unknown>;
    await this.deps.eventService.emit({
      tenantId: identity.tenantId,
      type: 'task.created',
      entityType: 'task',
      entityId: task.id as string,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: { state: initialState },
    }, 'release' in db ? db : undefined);

    return this.deps.toTaskResponse(task);
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
      );
    }

    throw new ValidationError(
      `Role '${roleName}' is not allowed on planned workflow stage ` +
        `'${linkedWorkItem.stage_name}'.`,
    );
  }

  private async applyLinkedWorkItemDefaults(
    tenantId: string,
    input: CreateTaskInput,
    db: DatabaseClient | DatabasePool,
  ): Promise<CreateTaskInput> {
    if (!input.work_item_id) {
      return input;
    }
    const linkedWorkItem = await this.loadLinkedWorkItem(tenantId, input.work_item_id, db);
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

  private async applyParentTaskPolicies(identity: ApiKeyIdentity, input: CreateTaskInput) {
    const parentTask = await this.loadParentTask(identity.tenantId, input.parent_id as string);
    await this.assertSubtaskDepth(identity.tenantId, parentTask);
    await this.assertSubtaskCount(identity.tenantId, parentTask.id);
    await this.assertParentPermission(identity, parentTask);

    return {
      ...input,
      workflow_id: input.workflow_id ?? parentTask.workflow_id ?? undefined,
      workspace_id: input.workspace_id ?? parentTask.workspace_id ?? undefined,
    };
  }

  private async loadParentTask(tenantId: string, parentId: string): Promise<ParentTaskRow> {
    const result = await this.deps.pool.query<ParentTaskRow>(
      `SELECT id, workflow_id, workspace_id, assigned_agent_id, assigned_worker_id, metadata->>'parent_id' AS parent_id
         FROM tasks
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, parentId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Parent task not found');
    }
    return result.rows[0];
  }

  private async assertSubtaskDepth(tenantId: string, parentTask: ParentTaskRow) {
    const maxDepth = this.deps.config.TASK_MAX_SUBTASK_DEPTH ?? DEFAULT_MAX_SUBTASK_DEPTH;
    let depth = 1;
    let currentParentId = parentTask.parent_id;

    while (currentParentId) {
      depth += 1;
      if (depth >= maxDepth) {
        throw new ValidationError(`Sub-task depth limit of ${maxDepth} would be exceeded`);
      }

      const result = await this.deps.pool.query<{ parent_id: string | null }>(
        `SELECT metadata->>'parent_id' AS parent_id
           FROM tasks
          WHERE tenant_id = $1
            AND id = $2`,
        [tenantId, currentParentId],
      );
      if (!result.rowCount) {
        break;
      }
      currentParentId = result.rows[0].parent_id;
    }
  }

  private async assertSubtaskCount(tenantId: string, parentId: string) {
    const result = await this.deps.pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
         FROM tasks
        WHERE tenant_id = $1
          AND metadata->>'parent_id' = $2`,
      [tenantId, parentId],
    );
    const count = Number(result.rows[0]?.total ?? '0');
    const maxSubtasks =
      this.deps.config.TASK_MAX_SUBTASKS_PER_PARENT ?? DEFAULT_MAX_SUBTASKS_PER_PARENT;
    if (count >= maxSubtasks) {
      throw new ValidationError(
        `Sub-task count limit of ${maxSubtasks} would be exceeded`,
      );
    }
  }

  private async assertParentPermission(identity: ApiKeyIdentity, parentTask: ParentTaskRow) {
    if (isOperatorScope(identity.scope)) {
      return;
    }

    if (identity.scope === 'agent' && identity.ownerId === parentTask.assigned_agent_id) {
      return;
    }

    if (identity.scope === 'worker' && identity.ownerId === parentTask.assigned_worker_id) {
      return;
    }

    if (
      identity.scope === 'agent' &&
      identity.ownerId &&
      parentTask.workflow_id &&
      (await this.deps.hasOrchestratorPermission(
        identity.tenantId,
        identity.ownerId,
        parentTask.workflow_id,
        this.deps.subtaskPermission,
      ))
    ) {
      return;
    }

    throw new ForbiddenError('Only the assigned parent owner or an active orchestrator grant can create sub-tasks');
  }

  private async resolveInitialState(
    tenantId: string,
    input: CreateTaskInput,
    hasUnfinishedDependencies: boolean,
  ) {
    if (hasUnfinishedDependencies) {
      return 'pending';
    }

    const shouldQueue = await this.deps.parallelismService.shouldQueueForCapacity(tenantId, {
      workflowId: input.workflow_id ?? null,
      workItemId: input.work_item_id ?? null,
      isOrchestratorTask: input.is_orchestrator_task ?? false,
      currentState: null,
    });
    if (shouldQueue) {
      return 'pending';
    }
    return 'ready';
  }

  private async hasUnfinishedDependencies(
    tenantId: string,
    dependencies: string[],
    db: DatabaseClient | DatabasePool,
  ): Promise<boolean> {
    if (dependencies.length === 0) {
      return false;
    }

    const unfinishedDeps = await db.query(
      "SELECT 1 FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND state <> 'completed' LIMIT 1",
      [tenantId, dependencies],
    );
    return (unfinishedDeps.rowCount ?? 0) > 0;
  }

  async updateTask(tenantId: string, taskId: string, payload: Record<string, unknown>) {
    if ('state' in payload)
      throw new ConflictError('Task state cannot be changed via PATCH /tasks/:id');
    assertNoPlaintextSecrets('task update payload', {
      metadata: payload.metadata,
    });
    const task = await this.deps.loadTaskOrThrow(tenantId, taskId);

    const nextMetadata = {
      ...((task.metadata ?? {}) as Record<string, unknown>),
      ...(typeof payload.description === 'string' ? { description: payload.description } : {}),
      ...(typeof payload.parent_id === 'string' ? { parent_id: payload.parent_id } : {}),
      ...(payload.metadata && typeof payload.metadata === 'object'
        ? (payload.metadata as Record<string, unknown>)
        : {}),
    };

    const result = await this.deps.pool.query(
      `UPDATE tasks SET title = COALESCE($3, title), priority = COALESCE($4::task_priority, priority),
        metadata = $5,
        timeout_minutes = COALESCE($6, timeout_minutes),
        input = CASE WHEN $7::jsonb IS NULL THEN input ELSE jsonb_set(input, '{description}', to_jsonb($7::text), true) END
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [
        tenantId,
        taskId,
        (payload.title as string | undefined) ?? null,
        (payload.priority as string | undefined) ?? null,
        nextMetadata,
        (payload.timeout_minutes as number | undefined) ?? null,
        (payload.description as string | undefined) ?? null,
      ],
    );

    if (!result.rowCount) throw new NotFoundError('Task not found');
    return this.deps.toTaskResponse(result.rows[0] as Record<string, unknown>);
  }

  async updateTaskInput(
    tenantId: string,
    taskId: string,
    input: Record<string, unknown>,
    db: DatabaseClient | DatabasePool = this.deps.pool,
  ) {
    assertNoPlaintextSecrets('task input update payload', { input });
    const task = await this.deps.loadTaskOrThrow(tenantId, taskId);
    const currentState = String(task.state ?? '');
    if (currentState === 'completed' || currentState === 'cancelled') {
      throw new ConflictError('Terminal tasks cannot be edited');
    }

    const result = await db.query(
      `UPDATE tasks
          SET input = $3::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
        RETURNING *`,
      [tenantId, taskId, input],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Task not found');
    }

    const updatedTask = result.rows[0] as Record<string, unknown>;
    await this.deps.eventService.emit({
      tenantId,
      type: 'task.input_updated',
      entityType: 'task',
      entityId: taskId,
      actorType: 'agent',
      data: {
        workflow_id: updatedTask.workflow_id ?? null,
        work_item_id: updatedTask.work_item_id ?? null,
        stage_name: updatedTask.stage_name ?? null,
      },
    }, 'release' in db ? db : undefined);
    return this.deps.toTaskResponse(updatedTask);
  }
}

function resolveTaskExecutionBackend(input: CreateTaskInput): 'runtime_only' | 'runtime_plus_task' {
  if (input.is_orchestrator_task) {
    if (input.execution_backend && input.execution_backend !== 'runtime_only') {
      throw new ValidationError('orchestrator tasks must use execution_backend runtime_only');
    }
    return 'runtime_only';
  }

  if (input.execution_backend && input.execution_backend !== 'runtime_plus_task') {
    throw new ValidationError('specialist tasks must use execution_backend runtime_plus_task');
  }
  return 'runtime_plus_task';
}

function mergeWorkspaceStorageBindings(
  bindings: Record<string, unknown>[],
  storage: ReturnType<typeof resolveWorkspaceStorageBinding>,
): Record<string, unknown>[] {
  const nonGitBindings = bindings.filter((binding) => !isGitRepositoryBinding(binding));
  return [
    ...nonGitBindings,
    ...buildGitRemoteResourceBindings(storage),
  ];
}

function normalizeResourceBindings(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
}

function isGitRepositoryBinding(binding: Record<string, unknown>): boolean {
  return asNullableString(binding.type) === 'git_repository';
}

function stripWorkspaceStorageOverrides(
  environment: Record<string, unknown>,
): Record<string, unknown> {
  const {
    repository_url: _repositoryURL,
    branch: _branch,
    base_branch: _baseBranch,
    git_user_name: _gitUserName,
    gitUserName: _legacyGitUserName,
    git_user_email: _gitUserEmail,
    gitUserEmail: _legacyGitUserEmail,
    ...rest
  } = environment;
  return rest;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeTaskContractInput(input: CreateTaskInput): CreateTaskInput {
  const taskKind = resolveTaskKind(input);
  const persistedTaskKind = shouldPersistTaskKind(input, taskKind) ? taskKind : undefined;
  assertTaskKindIsValidForInput(taskKind, input);
  return {
    ...input,
    task_kind: persistedTaskKind,
    input: mergeSubjectLinkageIntoInput(input),
  };
}

function resolveTaskKind(input: CreateTaskInput): NonNullable<CreateTaskInput['task_kind']> {
  if (input.is_orchestrator_task) {
    return 'orchestrator';
  }
  if (input.task_kind) {
    return input.task_kind;
  }
  if (input.type === 'assessment') {
    return 'assessment';
  }
  return 'delivery';
}

function shouldPersistTaskKind(
  input: CreateTaskInput,
  taskKind: NonNullable<CreateTaskInput['task_kind']>,
) {
  return input.task_kind !== undefined || taskKind === 'orchestrator' || taskKind === 'assessment' || taskKind === 'approval';
}

function assertTaskKindIsValidForInput(
  taskKind: NonNullable<CreateTaskInput['task_kind']>,
  input: CreateTaskInput,
) {
  if (taskKind === 'orchestrator' && !input.is_orchestrator_task) {
    throw new ValidationError('task_kind orchestrator requires is_orchestrator_task=true');
  }
  if (taskKind !== 'orchestrator' && input.is_orchestrator_task) {
    throw new ValidationError('orchestrator tasks must declare task_kind orchestrator');
  }

  const subjectTaskId = readOptionalSubjectString(input.subject_task_id)
    ?? readOptionalSubjectString(input.input?.subject_task_id);
  const subjectWorkItemId = readOptionalSubjectString(input.subject_work_item_id)
    ?? readOptionalSubjectString(input.input?.subject_work_item_id);
  const subjectHandoffId = readOptionalSubjectString(input.subject_handoff_id)
    ?? readOptionalSubjectString(input.input?.subject_handoff_id);
  const subjectRevision = readOptionalPositiveInteger(input.subject_revision)
    ?? readOptionalPositiveInteger(input.input?.subject_revision);

  if (taskKind === 'assessment') {
    if (!subjectTaskId) {
      throw new ValidationError('subject_task_id is required for assessment tasks');
    }
    if (subjectRevision === null) {
      throw new ValidationError('subject_revision is required for assessment tasks');
    }
  }

  if (taskKind === 'approval') {
    if (!subjectTaskId && !subjectWorkItemId && !subjectHandoffId) {
      throw new ValidationError('approval tasks require explicit subject linkage');
    }
    if (subjectRevision === null) {
      throw new ValidationError('subject_revision is required for approval tasks');
    }
  }
}

function mergeSubjectLinkageIntoInput(input: CreateTaskInput): Record<string, unknown> {
  const nextInput = {
    ...(input.input ?? {}),
  };
  const subjectTaskId = readOptionalSubjectString(input.subject_task_id);
  const subjectWorkItemId = readOptionalSubjectString(input.subject_work_item_id);
  const subjectHandoffId = readOptionalSubjectString(input.subject_handoff_id);
  const subjectRevision = readOptionalPositiveInteger(input.subject_revision);
  if (subjectTaskId) {
    nextInput.subject_task_id = subjectTaskId;
  }
  if (subjectWorkItemId) {
    nextInput.subject_work_item_id = subjectWorkItemId;
  }
  if (subjectHandoffId) {
    nextInput.subject_handoff_id = subjectHandoffId;
  }
  if (subjectRevision !== null) {
    nextInput.subject_revision = subjectRevision;
  }
  return nextInput;
}

function selectPersistedSubjectLinkage(input: CreateTaskInput): Record<string, unknown> {
  const subjectTaskId = readOptionalSubjectString(input.subject_task_id)
    ?? readOptionalSubjectString(input.input?.subject_task_id);
  const subjectWorkItemId = readOptionalSubjectString(input.subject_work_item_id)
    ?? readOptionalSubjectString(input.input?.subject_work_item_id);
  const subjectHandoffId = readOptionalSubjectString(input.subject_handoff_id)
    ?? readOptionalSubjectString(input.input?.subject_handoff_id);
  const subjectRevision = readOptionalPositiveInteger(input.subject_revision)
    ?? readOptionalPositiveInteger(input.input?.subject_revision);

  return {
    ...(subjectTaskId ? { subject_task_id: subjectTaskId } : {}),
    ...(subjectWorkItemId ? { subject_work_item_id: subjectWorkItemId } : {}),
    ...(subjectHandoffId ? { subject_handoff_id: subjectHandoffId } : {}),
    ...(subjectRevision !== null ? { subject_revision: subjectRevision } : {}),
  };
}

function readOptionalSubjectString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readOptionalPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function isClosedPlannedStage(workItem: LinkedWorkItemRow) {
  if (workItem.workflow_lifecycle !== 'planned') {
    return false;
  }
  return workItem.stage_status === 'completed' || workItem.stage_gate_status === 'approved';
}

function findNextStageForRole(
  stages: Array<{ name: string; involves?: string[] }>,
  currentStageName: string,
  role: string,
) {
  const currentStageIndex = stages.findIndex((entry) => entry.name === currentStageName);
  if (currentStageIndex < 0) {
    return null;
  }

  for (const stage of stages.slice(currentStageIndex + 1)) {
    if (stage.involves?.includes(role)) {
      return stage.name;
    }
  }

  return null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function buildExpectedCreateTaskReplay(
  input: CreateTaskInput,
  dependencies: string[],
  metadata: Record<string, unknown>,
) {
  return {
    workflow_id: input.workflow_id ?? null,
    work_item_id: input.work_item_id ?? null,
    branch_id: input.branch_id ?? null,
    workspace_id: input.workspace_id ?? null,
    role: input.role ?? null,
    stage_name: input.stage_name ?? null,
    depends_on: dependencies,
    context: input.context ?? {},
    role_config: input.role_config ?? null,
    environment: input.environment ?? null,
    resource_bindings: input.resource_bindings ?? [],
    activation_id: input.activation_id ?? null,
    is_orchestrator_task: input.is_orchestrator_task ?? false,
    token_budget: input.token_budget ?? null,
    cost_cap_usd: input.cost_cap_usd ?? null,
    auto_retry: input.auto_retry ?? false,
    max_retries: input.max_retries ?? 0,
    max_iterations: input.max_iterations ?? null,
    llm_max_retries: input.llm_max_retries ?? null,
    metadata: selectReplayStableMetadata(metadata),
  };
}

function buildExpectedCreateTaskIntent(
  input: CreateTaskInput,
  dependencies: string[],
  metadata: Record<string, unknown>,
) {
  return {
    title: input.title,
    priority: input.priority ?? 'normal',
    input: input.input ?? {},
    workflow_id: input.workflow_id ?? null,
    work_item_id: input.work_item_id ?? null,
    branch_id: input.branch_id ?? null,
    workspace_id: input.workspace_id ?? null,
    role: input.role ?? null,
    stage_name: input.stage_name ?? null,
    depends_on: dependencies,
    context: input.context ?? {},
    role_config: input.role_config ?? null,
    environment: input.environment ?? null,
    resource_bindings: input.resource_bindings ?? [],
    is_orchestrator_task: input.is_orchestrator_task ?? false,
    token_budget: input.token_budget ?? null,
    cost_cap_usd: input.cost_cap_usd ?? null,
    auto_retry: input.auto_retry ?? false,
    max_retries: input.max_retries ?? 0,
    max_iterations: input.max_iterations ?? null,
    llm_max_retries: input.llm_max_retries ?? null,
    metadata: selectIntentStableMetadata(metadata),
  };
}

function assertMatchingCreateTaskReplay(
  existing: Record<string, unknown>,
  expected: ReturnType<typeof buildExpectedCreateTaskReplay>,
) {
  const existingMetadata = asRecord(existing.metadata);
  if (
    (existing.workflow_id ?? null) !== expected.workflow_id ||
    (existing.work_item_id ?? null) !== expected.work_item_id ||
    (existing.branch_id ?? null) !== expected.branch_id ||
    (existing.workspace_id ?? null) !== expected.workspace_id ||
    (existing.role ?? null) !== expected.role ||
    (existing.stage_name ?? null) !== expected.stage_name ||
    !areJsonValuesEquivalent(existing.depends_on ?? [], expected.depends_on) ||
    !areJsonValuesEquivalent(asRecord(existing.context), expected.context) ||
    !areJsonValuesEquivalent(existing.role_config ?? null, expected.role_config) ||
    !areJsonValuesEquivalent(existing.environment ?? null, expected.environment) ||
    !areJsonValuesEquivalent(normalizeResourceBindings(existing.resource_bindings), expected.resource_bindings) ||
    (existing.activation_id ?? null) !== expected.activation_id ||
    Boolean(existing.is_orchestrator_task) !== expected.is_orchestrator_task ||
    (existing.token_budget ?? null) !== expected.token_budget ||
    asNullableNumber(existing.cost_cap_usd) !== expected.cost_cap_usd ||
    Boolean(existing.auto_retry) !== expected.auto_retry ||
    Number(existing.max_retries ?? 0) !== expected.max_retries ||
    asNullableNumber(existing.max_iterations) !== expected.max_iterations ||
    asNullableNumber(existing.llm_max_retries) !== expected.llm_max_retries ||
    !hasMatchingCreateMetadata(existingMetadata, expected.metadata)
  ) {
    throw new ConflictError('task request_id replay does not match the existing task');
  }
}

function matchesCreateTaskIntent(
  existing: Record<string, unknown>,
  expected: ReturnType<typeof buildExpectedCreateTaskIntent>,
) {
  const existingMetadata = asRecord(existing.metadata);
  return (
    (existing.title ?? null) === expected.title &&
    (existing.priority ?? 'normal') === expected.priority &&
    areJsonValuesEquivalent(asRecord(existing.input), expected.input) &&
    (existing.workflow_id ?? null) === expected.workflow_id &&
    (existing.work_item_id ?? null) === expected.work_item_id &&
    (existing.branch_id ?? null) === expected.branch_id &&
    (existing.workspace_id ?? null) === expected.workspace_id &&
    (existing.role ?? null) === expected.role &&
    (existing.stage_name ?? null) === expected.stage_name &&
    areJsonValuesEquivalent(existing.depends_on ?? [], expected.depends_on) &&
    areJsonValuesEquivalent(asRecord(existing.context), expected.context) &&
    areJsonValuesEquivalent(existing.role_config ?? null, expected.role_config) &&
    areJsonValuesEquivalent(existing.environment ?? null, expected.environment) &&
    areJsonValuesEquivalent(normalizeResourceBindings(existing.resource_bindings), expected.resource_bindings) &&
    Boolean(existing.is_orchestrator_task) === expected.is_orchestrator_task &&
    (existing.token_budget ?? null) === expected.token_budget &&
    asNullableNumber(existing.cost_cap_usd) === expected.cost_cap_usd &&
    Boolean(existing.auto_retry) === expected.auto_retry &&
    Number(existing.max_retries ?? 0) === expected.max_retries &&
    asNullableNumber(existing.max_iterations) === expected.max_iterations &&
    asNullableNumber(existing.llm_max_retries) === expected.llm_max_retries &&
    hasMatchingCreateMetadata(existingMetadata, expected.metadata)
  );
}

function hasMatchingCreateMetadata(
  existing: Record<string, unknown>,
  expected: Record<string, unknown>,
) {
  return Object.entries(expected).every(([key, value]) => areJsonValuesEquivalent(existing[key], value));
}

function selectReplayStableMetadata(metadata: Record<string, unknown>) {
  const stable: Record<string, unknown> = {};
  for (const key of ['branch_id', 'lifecycle_policy', 'task_type', 'task_kind', 'credential_refs', 'assessment_prompt']) {
    if (key in metadata) {
      stable[key] = metadata[key];
    }
  }
  return stable;
}

function selectIntentStableMetadata(metadata: Record<string, unknown>) {
  const stable = selectReplayStableMetadata(metadata);
  for (const key of ['description', 'parent_id']) {
    if (key in metadata) {
      stable[key] = metadata[key];
    }
  }
  return stable;
}

function assertNoPlaintextSecrets(scope: string, sections: Record<string, unknown>) {
  const violations: string[] = [];
  for (const [section, value] of Object.entries(sections)) {
    collectPlaintextSecretPaths(value, section, false, violations);
  }
  if (violations.length === 0) {
    return;
  }
  throw new ValidationError(
    `${scope} contains secret-bearing fields that must use secret references or claim-time credential delivery`,
    { secret_paths: violations },
  );
}

function collectPlaintextSecretPaths(
  value: unknown,
  path: string,
  inheritedSecret: boolean,
  violations: string[],
) {
  if (typeof value === 'string') {
    if (inheritedSecret && value.trim().length > 0 && !isAllowedSecretReference(value)) {
      violations.push(path);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectPlaintextSecretPaths(item, `${path}[${index}]`, inheritedSecret, violations));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path.length > 0 ? `${path}.${key}` : key;
    collectPlaintextSecretPaths(nestedValue, childPath, inheritedSecret || isSecretLikeKey(key), violations);
  }
}

function isAllowedSecretReference(value: string): boolean {
  const normalized = value.trim();
  return normalized.startsWith('secret:') || normalized.startsWith('redacted://');
}

function isSecretLikeKey(key: string): boolean {
  return secretLikeKeyPattern.test(key);
}

function stripRedactedTaskSecretPlaceholders<T>(value: T): T {
  const sanitized = stripRedactedSecretPlaceholders(value, false);
  return (sanitized ?? value) as T;
}

function stripRedactedSecretPlaceholders(value: unknown, inheritedSecret: boolean): unknown {
  if (typeof value === 'string') {
    if (inheritedSecret && isRedactedSecretPlaceholder(value)) {
      return undefined;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => stripRedactedSecretPlaceholders(item, inheritedSecret))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const next: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    const sanitized = stripRedactedSecretPlaceholders(
      nestedValue,
      inheritedSecret || isSecretLikeKey(key),
    );
    if (sanitized !== undefined) {
      next[key] = sanitized;
    }
  }
  return next;
}

function isRedactedSecretPlaceholder(value: string): boolean {
  return value.trim().startsWith('redacted://');
}
