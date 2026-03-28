import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { AgentBusyError, ForbiddenError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import {
  isExternalSecretReference,
  readOAuthToken,
  readProviderSecret,
} from '../lib/oauth-crypto.js';
import { logTaskGovernanceTransition } from '../logging/task-governance-log.js';
import type { LogService } from '../logging/log-service.js';
import { parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import { assertValidTransition, type TaskState } from '../orchestration/task-state-machine.js';
import { EventService } from './event-service.js';
import { readNativeSearchCapability } from './llm-discovery-service.js';
import type { ResolvedRoleConfig } from './model-catalog-service.js';
import { OAuthService } from './oauth-service.js';
import { PlaybookTaskParallelismService } from './playbook-task-parallelism-service.js';
import { readAgentSupervisionTimingDefaults } from './platform-timing-defaults.js';
import { RemoteMcpOAuthService } from './remote-mcp-oauth-service.js';
import type { ExecutionContainerLeaseService } from './execution-container-lease-service.js';
import {
  readPositiveInteger,
  readRequiredPositiveIntegerRuntimeDefault,
} from './runtime-default-values.js';
import {
  buildExecutionEnvironmentAgentHint,
  type ExecutionContainerContract,
  type ExecutionEnvironmentSummary,
  normalizeStringArray,
} from './execution-environment-contract.js';
import { matchesWorkerToTaskRouting } from './task-routing-contract.js';
import { flattenInstructionLayers } from './task-context-service.js';
import {
  computeToolMatch,
  isGitBuiltInToolId,
  isSpecialistSelectableToolId,
  readAgentToolRequirements,
  resolveBuiltInToolOwner,
  resolveWorkspaceToolTags,
  type ToolOwner,
} from './tool-tag-service.js';
import {
  readSpecialistRoleCapabilities,
  type SpecialistRemoteMcpServerCapability,
  type SpecialistRoleCapabilities,
} from './specialist-capability-service.js';
import { resolveWorkspaceStorageBinding } from './workspace-storage.js';

const priorityCase = "CASE priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END";

type AgentExecutionMode = 'specialist' | 'orchestrator' | 'hybrid';
const claimRoleConfigSecretKeys = new Set([
  'llm_api_key',
  'llm_api_key_secret_ref',
  'llm_extra_headers',
  'llm_extra_headers_secret_ref',
  'api_key',
  'access_token',
  'token',
  'authorization',
]);
const CLAIM_CREDENTIAL_HANDLE_VERSION = 'v1';
const CLAIM_CREDENTIAL_HANDLE_ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const CLAIM_CREDENTIAL_HANDLE_IV_LENGTH_BYTES = 12;
const gitTokenCredentialKeys = ['token', 'git_token', 'access_token', 'token_ref', 'git_token_ref', 'access_token_ref', 'secret_ref'];
const gitSSHPrivateKeyCredentialKeys = [
  'git_ssh_private_key',
  'ssh_private_key',
  'private_key',
  'git_ssh_private_key_ref',
  'ssh_private_key_ref',
  'private_key_ref',
];
const gitSSHKnownHostsCredentialKeys = [
  'git_ssh_known_hosts',
  'ssh_known_hosts',
  'known_hosts',
  'git_ssh_known_hosts_ref',
  'ssh_known_hosts_ref',
  'known_hosts_ref',
];
const operatorRecordToolIds = ['record_operator_brief', 'record_operator_update'] as const;
type ClaimCredentialKind = 'llm_api_key' | 'llm_extra_headers' | 'mcp_parameter' | 'mcp_oauth';
interface ClaimCredentialPayload {
  task_id?: string;
  kind?: string;
  stored_secret?: string;
  provider_id?: string;
}

interface TaskClaimDependencies {
  pool: DatabasePool;
  eventService: EventService;
  logService?: LogService;
  toTaskResponse: (task: Record<string, unknown>) => Record<string, unknown>;
  getTaskContext: (tenantId: string, taskId: string, agentId?: string) => Promise<unknown>;
  resolveRoleConfig?: (tenantId: string, roleName: string) => Promise<ResolvedRoleConfig | null>;
  parallelismService?: PlaybookTaskParallelismService;
  executionContainerLeaseService?: Pick<ExecutionContainerLeaseService, 'reserveForTask'>;
  claimHandleSecret: string;
}

interface DirectModelLookupRow {
  provider_id: string;
  provider_name: string;
  provider_base_url: string | null;
  provider_api_key_secret_ref: string | null;
  provider_auth_mode: string | null;
  provider_metadata: Record<string, unknown> | null;
  model_id: string;
  model_context_window: number | null;
  model_max_output_tokens: number | null;
  model_endpoint_type: string | null;
  model_reasoning_config: Record<string, unknown> | null;
  model_input_cost_per_million_usd: string | null;
  model_output_cost_per_million_usd: string | null;
}

interface RetryReadyTaskRow {
  id: string;
  workflow_id: string | null;
  work_item_id: string | null;
  is_orchestrator_task: boolean;
  state: TaskState;
}

interface TaskLLMResolution {
  roleName: string;
  existingRoleConfig: Record<string, unknown>;
  resolved: ResolvedRoleConfig;
}

interface TaskLoopContract {
  loopMode: 'reactive' | 'tpaov';
  maxIterations: number;
  llmMaxRetries: number;
}

interface ResolvedTaskExecutionEnvironment {
  executionContainer: ExecutionContainerContract;
  executionEnvironment: ExecutionEnvironmentSummary;
  snapshot: ExecutionEnvironmentSummary;
}

interface ClaimPeerAgentRow {
  id: string;
  routing_tags: string[] | null;
  last_claim_at: string | Date | null;
  last_heartbeat_at: string | Date | null;
  heartbeat_interval_seconds: number | null;
  metadata: Record<string, unknown> | null;
}

interface ClaimableExecutionEnvironmentRow {
  id: string;
  name: string;
  source_kind: string;
  catalog_key: string | null;
  catalog_version: number | null;
  image: string;
  cpu: string;
  memory: string;
  pull_policy: string;
  compatibility_status: string;
  verification_contract_version: string | null;
  verified_metadata: unknown;
  tool_capabilities: unknown;
  bootstrap_commands: unknown;
  bootstrap_required_domains: unknown;
  support_status: string | null;
}

interface TaskModelOverrideSelection {
  providerName: string;
  modelId: string;
  requested: boolean;
}

function buildExecutionContractLogPayload(input: {
  llmResolution: TaskLLMResolution;
  loopContract: TaskLoopContract;
  executionContainer: ExecutionContainerContract | null;
  executionEnvironment: ExecutionEnvironmentSummary | null;
  agentId: string;
  workerId: string | null;
  task: Record<string, unknown>;
}): Record<string, unknown> {
  const gitContract = describeGitContract(input.task);
  return {
    agent_id: input.agentId,
    worker_id: input.workerId,
    loop_mode: input.loopContract.loopMode,
    max_iterations: input.loopContract.maxIterations,
    llm_max_retries: input.loopContract.llmMaxRetries,
    llm_provider: input.llmResolution.resolved.provider.providerType,
    llm_model: input.llmResolution.resolved.model.modelId,
    llm_context_window: input.llmResolution.resolved.model.contextWindow,
    llm_max_output_tokens: input.llmResolution.resolved.model.maxOutputTokens,
    llm_endpoint_type: input.llmResolution.resolved.model.endpointType,
    llm_reasoning_config: input.llmResolution.resolved.reasoningConfig,
    llm_native_search_mode: resolveNativeSearchMode(
      (input.task.role_config ?? {}) as Record<string, unknown>,
      input.llmResolution.resolved,
    ),
    execution_container_image: input.executionContainer?.image ?? null,
    execution_container_cpu: input.executionContainer?.cpu ?? null,
    execution_container_memory: input.executionContainer?.memory ?? null,
    execution_container_pull_policy: input.executionContainer?.pull_policy ?? null,
    execution_environment_id: input.executionEnvironment?.id ?? null,
    execution_environment_name: input.executionEnvironment?.name ?? null,
    execution_environment_source_kind: input.executionEnvironment?.source_kind ?? null,
    execution_environment_support_status: input.executionEnvironment?.support_status ?? null,
    execution_environment_compatibility_status:
      input.executionEnvironment?.compatibility_status ?? null,
    llm_input_cost_per_million_usd: input.llmResolution.resolved.model.inputCostPerMillionUsd,
    llm_output_cost_per_million_usd: input.llmResolution.resolved.model.outputCostPerMillionUsd,
    ...gitContract,
  };
}

function buildClaimCredentialResolutionError(providerId?: string): ValidationError {
  return new ValidationError(
    'OAuth session expired. An admin must reconnect on the LLM Providers page.',
    {
      category: 'provider_reauth_required',
      retryable: false,
      recoverable: false,
      recovery_hint: 'reconnect_oauth_provider',
      recovery: {
        status: 'operator_action_required',
        reason: 'provider_reauth_required',
        provider_id: providerId ?? null,
      },
    },
  );
}

function buildClaimLLMFields(
  roleConfig: Record<string, unknown>,
  resolved: ResolvedRoleConfig,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    llm_provider: resolved.provider.providerType,
    llm_model: resolved.model.modelId,
    llm_context_window: resolved.model.contextWindow,
    llm_max_output_tokens: resolved.model.maxOutputTokens,
    llm_reasoning_config: resolved.reasoningConfig,
  };

  const nativeSearchMode = resolveNativeSearchMode(roleConfig, resolved);
  if (nativeSearchMode) {
    fields.llm_native_search_mode = nativeSearchMode;
  }
  if (resolved.model.inputCostPerMillionUsd != null) {
    fields.llm_input_cost_per_million_usd = resolved.model.inputCostPerMillionUsd;
  }
  if (resolved.model.outputCostPerMillionUsd != null) {
    fields.llm_output_cost_per_million_usd = resolved.model.outputCostPerMillionUsd;
  }

  return fields;
}

function describeGitContract(task: Record<string, unknown>): Record<string, unknown> {
  const bindings = Array.isArray(task.resource_bindings) ? task.resource_bindings : [];
  const credentials = isRecord(task.credentials) ? task.credentials : {};
  return {
    git_repository_binding_count: countGitRepositoryBindings(bindings),
    binding_contains_git_credentials: bindingsContainGitCredentials(bindings),
    has_git_token: typeof credentials.git_token === 'string' && credentials.git_token.trim().length > 0,
    has_git_ssh_private_key:
      typeof credentials.git_ssh_private_key === 'string' &&
      credentials.git_ssh_private_key.trim().length > 0,
    has_git_ssh_known_hosts:
      typeof credentials.git_ssh_known_hosts === 'string' &&
      credentials.git_ssh_known_hosts.trim().length > 0,
  };
}

function countGitRepositoryBindings(bindings: unknown[]): number {
  return bindings.filter(
    (binding) => isRecord(binding) && String(binding.type ?? '').trim() === 'git_repository',
  ).length;
}

function bindingsContainGitCredentials(bindings: unknown[]): boolean {
  return bindings.some((binding) => {
    if (!isRecord(binding) || String(binding.type ?? '').trim() !== 'git_repository') {
      return false;
    }
    return recordContainsGitCredentials(binding) || recordContainsGitCredentials(binding.credentials);
  });
}

function recordContainsGitCredentials(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return [
    'token',
    'git_token',
    'access_token',
    'git_ssh_private_key',
    'ssh_private_key',
    'private_key',
    'git_ssh_known_hosts',
    'ssh_known_hosts',
    'known_hosts',
  ].some((key) => typeof value[key] === 'string' && value[key].trim().length > 0);
}

export class TaskClaimService {
  constructor(private readonly deps: TaskClaimDependencies) {}

  async claimTask(
    identity: ApiKeyIdentity,
    payload: {
      agent_id: string;
      worker_id?: string;
      routing_tags?: string[];
      workflow_id?: string;
      playbook_id?: string;
      include_context?: boolean;
    },
  ): Promise<Record<string, unknown> | null> {
    const client = await this.deps.pool.connect();
    try {
      await client.query('BEGIN');
      await this.promoteRetryReadyTasks(identity.tenantId, payload.workflow_id, client);

      const agentRes = await client.query('SELECT * FROM agents WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [
        identity.tenantId,
        payload.agent_id,
      ]);
      if (!agentRes.rowCount) throw new NotFoundError('Agent not found');

      const agent = agentRes.rows[0];
      const executionMode = readAgentExecutionMode(agent.metadata);
      if (identity.scope === 'worker') {
        if (!identity.ownerId) {
          throw new ForbiddenError('Agent identity is not bound to a Specialist Agent owner.');
        }

        if (agent.worker_id !== identity.ownerId) {
          throw new ForbiddenError('Specialist Agent cannot claim tasks with a Specialist Execution owned by a different Specialist Agent.');
        }

        if (payload.worker_id && payload.worker_id !== identity.ownerId) {
          throw new ForbiddenError('Specialist Agent cannot claim tasks on behalf of a different Specialist Agent.');
        }
      }

      if (payload.worker_id && agent.worker_id !== payload.worker_id) {
        throw new ForbiddenError('Specialist Agent cannot claim tasks with a Specialist Execution owned by a different Specialist Agent.');
      }

      if (agent.current_task_id) {
        throw new AgentBusyError(`Agent already holds task '${agent.current_task_id}'. Complete or fail it first.`, {
          current_task_id: agent.current_task_id,
        });
      }

      const taskRes = await client.query(
        `SELECT tasks.* FROM tasks
         LEFT JOIN workflows ON workflows.tenant_id = tasks.tenant_id AND workflows.id = tasks.workflow_id
         WHERE tasks.tenant_id = $1
           AND tasks.state = 'ready'
           AND ($2::uuid IS NULL OR tasks.workflow_id = $2::uuid)
           AND ($5::uuid IS NULL OR workflows.playbook_id = $5::uuid)
           AND ${buildExecutionModeCondition(executionMode)}
           AND (workflows.id IS NULL OR workflows.state <> 'paused')
           AND (
             NOT (tasks.metadata ? 'preferred_agent_id')
             OR NULLIF(tasks.metadata->>'preferred_agent_id', '') IS NULL
             OR tasks.metadata->>'preferred_agent_id' = $3
           )
           AND (
             NOT (tasks.metadata ? 'preferred_worker_id')
             OR NULLIF(tasks.metadata->>'preferred_worker_id', '') IS NULL
             OR tasks.metadata->>'preferred_worker_id' = COALESCE($4, tasks.metadata->>'preferred_worker_id')
           )
         ORDER BY
           CASE WHEN tasks.metadata->>'preferred_agent_id' = $3 THEN 1 ELSE 0 END DESC,
           CASE WHEN tasks.metadata->>'preferred_worker_id' = COALESCE($4, tasks.metadata->>'preferred_worker_id') THEN 1 ELSE 0 END DESC,
           ${priorityCase} DESC,
           tasks.created_at ASC
         LIMIT 25
         FOR UPDATE OF tasks SKIP LOCKED`,
        [identity.tenantId, payload.workflow_id ?? null, payload.agent_id, payload.worker_id ?? null, payload.playbook_id ?? null],
      );

      if (!taskRes.rowCount) {
        await client.query('COMMIT');
        return null;
      }

      const agentTools = readAgentToolRequirements(agent);
      let task: Record<string, unknown> | null = null;
      let toolMatch = { matched: [] as string[], unavailable_optional: [] as string[] };
      const routingTags = payload.routing_tags ?? [];
      for (const candidate of taskRes.rows as Record<string, unknown>[]) {
        if (!matchesWorkerToTaskRouting(candidate, routingTags)) {
          continue;
        }
        if (
          this.deps.parallelismService &&
          (await this.deps.parallelismService.shouldQueueForCapacity(
            identity.tenantId,
            {
              taskId: String(candidate.id),
              workflowId:
                typeof candidate.workflow_id === 'string' ? candidate.workflow_id : null,
              workItemId:
                typeof candidate.work_item_id === 'string' ? candidate.work_item_id : null,
              isOrchestratorTask: candidate.is_orchestrator_task === true,
              currentState: candidate.state as TaskState,
            },
            client,
          ))
        ) {
          continue;
        }
        const workspaceTools = await resolveWorkspaceToolTags(
          client,
          identity.tenantId,
          (candidate.workspace_id as string | null | undefined) ?? null,
        );
        const evaluation = computeToolMatch(workspaceTools, agentTools);
        if (evaluation.matches) {
          task = candidate;
          toolMatch = {
            matched: evaluation.matched,
            unavailable_optional: evaluation.unavailable_optional,
          };
          break;
        }
      }

      if (!task) {
        await client.query('COMMIT');
        return null;
      }
      if (
        task.is_orchestrator_task === true
        && await this.shouldYieldOrchestratorClaim({
          tenantId: identity.tenantId,
          task,
          agent,
          agentId: payload.agent_id,
          playbookId:
            typeof payload.playbook_id === 'string' && payload.playbook_id.trim().length > 0
              ? payload.playbook_id.trim()
              : null,
          client,
        })
      ) {
        await client.query('COMMIT');
        return null;
      }
      const llmResolution = await this.resolveTaskLLMConfig(identity.tenantId, task);
      const loopContract = await this.resolveTaskLoopContract(
        identity.tenantId,
        task,
        client,
      );
      const resolvedExecutionEnvironment = await this.resolveExecutionEnvironmentContract(
        identity.tenantId,
        task,
        client,
      );
      const executionContainer = resolvedExecutionEnvironment?.executionContainer ?? null;
      const executionEnvironment = resolvedExecutionEnvironment?.executionEnvironment ?? null;
      if (
        executionContainer
        && this.deps.executionContainerLeaseService
      ) {
        const lease = await this.deps.executionContainerLeaseService.reserveForTask(
          identity.tenantId,
          {
            taskId: String(task.id),
            workflowId:
              typeof task.workflow_id === 'string' && task.workflow_id.trim().length > 0
                ? task.workflow_id
                : null,
            workItemId:
              typeof task.work_item_id === 'string' && task.work_item_id.trim().length > 0
                ? task.work_item_id
                : null,
            role: typeof task.role === 'string' ? task.role : '',
            agentId: payload.agent_id,
            workerId: payload.worker_id ?? null,
          },
          client,
        );
        if (!lease.reserved) {
          await client.query('COMMIT');
          return null;
        }
      }
      assertValidTransition(task.id as string, task.state as Parameters<typeof assertValidTransition>[1], 'claimed');

      const updatedTaskRes = await client.query(
        `UPDATE tasks
         SET state = 'claimed', state_changed_at = now(),
             assigned_agent_id = $3,
             assigned_worker_id = $4,
             claimed_at = now(),
             execution_environment_id = $5,
             execution_environment_snapshot = $6::jsonb
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [
          identity.tenantId,
          task.id,
          payload.agent_id,
          payload.worker_id ?? null,
          executionEnvironment?.id ?? null,
          JSON.stringify(resolvedExecutionEnvironment?.snapshot ?? null),
        ],
      );

      await client.query(
        `UPDATE agents SET current_task_id = $2, status = 'busy', last_heartbeat_at = now()
            , last_claim_at = now()
         WHERE tenant_id = $1 AND id = $3`,
        [identity.tenantId, task.id, payload.agent_id],
      );

      await this.deps.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'task.state_changed',
          entityType: 'task',
          entityId: task.id as string,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: {
            from_state: 'ready',
            to_state: 'claimed',
            agent_id: payload.agent_id,
            worker_id: payload.worker_id ?? null,
          },
        },
        client,
      );

      await client.query('COMMIT');
      const claimedTask = mergeClaimRuntimeBindings(
        this.deps.toTaskResponse(updatedTaskRes.rows[0] as Record<string, unknown>),
        updatedTaskRes.rows[0] as Record<string, unknown>,
      );

      const namesRes = await client.query(
        `SELECT
           w.name AS workflow_name,
           p.name AS workspace_name,
           p.repository_url AS workspace_repository_url,
           p.settings AS workspace_settings
         FROM tasks t
         LEFT JOIN workflows w ON w.tenant_id = t.tenant_id AND w.id = t.workflow_id
         LEFT JOIN workspaces p ON p.tenant_id = t.tenant_id AND p.id = t.workspace_id
         WHERE t.tenant_id = $1 AND t.id = $2`,
        [identity.tenantId, task.id],
      );
      if (namesRes.rowCount) {
        (claimedTask as Record<string, unknown>).workflow_name = namesRes.rows[0].workflow_name;
        (claimedTask as Record<string, unknown>).workspace_name = namesRes.rows[0].workspace_name;
        (claimedTask as Record<string, unknown>).workspace_binding = resolveWorkspaceStorageBinding({
          repository_url: namesRes.rows[0].workspace_repository_url,
          settings: namesRes.rows[0].workspace_settings,
        });
      } else {
        (claimedTask as Record<string, unknown>).workspace_binding = resolveWorkspaceStorageBinding({});
      }

      const enrichedTask = await this.enrichWithLLMCredentials(
        identity.tenantId,
        claimedTask,
        llmResolution,
      );
      const runtimeReadyTask = hydrateClaimGitCredentials(enrichedTask);
      await logTaskGovernanceTransition(this.deps.logService, {
        tenantId: identity.tenantId,
        operation: 'task.execution_contract_resolved',
        executor: client,
        task: runtimeReadyTask,
        payload: buildExecutionContractLogPayload({
          llmResolution,
          loopContract,
          executionContainer,
          executionEnvironment,
          agentId: payload.agent_id,
          workerId: payload.worker_id ?? null,
          task: runtimeReadyTask,
        }),
      });
      const { context: _taskContext, ...claimedTaskBase } = runtimeReadyTask as Record<string, unknown>;
      const instructionContext = (await this.deps.getTaskContext(
        identity.tenantId,
        task.id as string,
        payload.agent_id,
      )) as Record<string, unknown>;
      const instructions =
        typeof instructionContext.instructions === 'string' ? instructionContext.instructions : '';
      const layers = (instructionContext.instruction_layers ?? {}) as Record<string, unknown>;
      const executionBrief = (instructionContext.execution_brief ?? null) as Record<string, unknown> | null;
      const runtimeCapabilities = buildRuntimeTaskCapabilities(runtimeReadyTask, instructionContext);
      const mergedBase = mergeSystemPrompt(claimedTaskBase, layers);
      const executionBackend = readTaskExecutionBackend(runtimeReadyTask);
      const toolOwners = buildToolOwnerContract(mergedBase);
      if ((payload.include_context ?? true) === false) {
        return {
          ...mergedBase,
          execution_backend: executionBackend,
          loop_mode: loopContract.loopMode,
          max_iterations: loopContract.maxIterations,
          llm_max_retries: loopContract.llmMaxRetries,
          execution_container: executionContainer,
          execution_environment: executionEnvironment,
          runtime_capabilities: runtimeCapabilities,
          tool_owners: toolOwners,
          tools: toolMatch,
          instructions,
          execution_brief: executionBrief,
        };
      }

      return {
        ...mergedBase,
        execution_backend: executionBackend,
        loop_mode: loopContract.loopMode,
        max_iterations: loopContract.maxIterations,
        llm_max_retries: loopContract.llmMaxRetries,
        execution_container: executionContainer,
        execution_environment: executionEnvironment,
        runtime_capabilities: runtimeCapabilities,
        tool_owners: toolOwners,
        tools: toolMatch,
        instructions,
        execution_brief: executionBrief,
        context: instructionContext,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async promoteRetryReadyTasks(
    tenantId: string,
    workflowId: string | undefined,
    client: DatabaseClient,
  ): Promise<void> {
    const candidates = await client.query<RetryReadyTaskRow>(
      `SELECT id, workflow_id, work_item_id, is_orchestrator_task, state
         FROM tasks
        WHERE tenant_id = $1
          AND state = 'pending'
          AND metadata ? 'retry_available_at'
          AND ($2::uuid IS NULL OR workflow_id = $2::uuid)
          AND (metadata->>'retry_available_at')::timestamptz <= now()
        ORDER BY ${priorityCase} DESC, created_at ASC
        FOR UPDATE SKIP LOCKED`,
      [tenantId, workflowId ?? null],
    );

    for (const candidate of candidates.rows) {
      const shouldQueue =
        this.deps.parallelismService &&
        (await this.deps.parallelismService.shouldQueueForCapacity(
          tenantId,
          {
            taskId: candidate.id,
            workflowId: candidate.workflow_id,
            workItemId: candidate.work_item_id,
            isOrchestratorTask: candidate.is_orchestrator_task,
            currentState: candidate.state,
          },
          client,
        ));
      if (shouldQueue) {
        continue;
      }

      const updated = await client.query(
        `UPDATE tasks
            SET state = 'ready',
                state_changed_at = now()
          WHERE tenant_id = $1
            AND id = $2
            AND state = 'pending'`,
        [tenantId, candidate.id],
      );
      if (!updated.rowCount) {
        continue;
      }

      await this.deps.eventService.emit(
        {
          tenantId,
          type: 'task.state_changed',
          entityType: 'task',
          entityId: candidate.id,
          actorType: 'system',
          actorId: 'retry_backoff',
          data: {
            from_state: 'pending',
            to_state: 'ready',
            reason: 'retry_backoff_elapsed',
          },
        },
        client,
      );
    }
  }

  private async shouldYieldOrchestratorClaim(input: {
    tenantId: string;
    task: Record<string, unknown>;
    agent: Record<string, unknown>;
    agentId: string;
    playbookId: string | null;
    client: DatabaseClient;
  }): Promise<boolean> {
    const scopePlaybookId = normalizeAgentPlaybookScope(input.playbookId, input.agent.metadata);
    const timingDefaults = await readAgentSupervisionTimingDefaults(input.client, input.tenantId);
    const peerAgents = await input.client.query<ClaimPeerAgentRow>(
      `SELECT id, routing_tags, last_claim_at, last_heartbeat_at, heartbeat_interval_seconds, metadata
         FROM agents
        WHERE tenant_id = $1
          AND id <> $2
          AND current_task_id IS NULL
          AND status IN ('active', 'idle')`,
      [input.tenantId, input.agentId],
    );
    const eligiblePeers = peerAgents.rows.filter((peer) => {
      if (!agentCanClaimOrchestratorTasks(peer.metadata)) {
        return false;
      }
      if (normalizeAgentPlaybookScope(null, peer.metadata) !== scopePlaybookId) {
        return false;
      }
      if (!isFreshClaimPeer(peer, timingDefaults.heartbeatThresholdMultiplier)) {
        return false;
      }
      return matchesWorkerToTaskRouting(
        input.task,
        Array.isArray(peer.routing_tags) ? peer.routing_tags : [],
      );
    });
    if (eligiblePeers.length === 0) {
      return false;
    }

    const currentLastClaimAt = toNullableDate(input.agent.last_claim_at);
    if (currentLastClaimAt == null) {
      return false;
    }
    if (eligiblePeers.some((peer) => toNullableDate(peer.last_claim_at) == null)) {
      return true;
    }

    const oldestPeerClaimAt = eligiblePeers
      .map((peer) => toNullableDate(peer.last_claim_at))
      .filter((value): value is Date => value instanceof Date)
      .sort((left, right) => left.getTime() - right.getTime())[0];
    if (!oldestPeerClaimAt) {
      return false;
    }
    return currentLastClaimAt.getTime() > oldestPeerClaimAt.getTime();
  }

  async resolveClaimCredentials(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      llm_api_key_claim_handle?: string;
      llm_extra_headers_claim_handle?: string;
      mcp_claim_handles?: string[];
    },
  ): Promise<Record<string, unknown>> {
    if (!identity.ownerId?.trim()) {
      throw new ForbiddenError('Calling identity is not bound to a Specialist Agent or Specialist Execution owner.');
    }

    await this.assertIdentityOwnsTask(identity, taskId);

    const credentials: Record<string, unknown> = {};
    if (payload.llm_api_key_claim_handle) {
      const claim = parseClaimCredentialHandlePayload(
        payload.llm_api_key_claim_handle,
        taskId,
        'llm_api_key',
        this.deps.claimHandleSecret,
      );
      try {
        credentials.llm_api_key = readOAuthToken(claim.stored_secret);
      } catch {
        await this.handleClaimCredentialResolutionFailure(claim.provider_id);
        throw buildClaimCredentialResolutionError(claim.provider_id);
      }
    }
    if (payload.llm_extra_headers_claim_handle) {
      const claim = parseClaimCredentialHandlePayload(
        payload.llm_extra_headers_claim_handle,
        taskId,
        'llm_extra_headers',
        this.deps.claimHandleSecret,
      );
      try {
        credentials.llm_extra_headers = parseExtraHeadersSecret(claim.stored_secret);
      } catch {
        await this.handleClaimCredentialResolutionFailure(claim.provider_id);
        throw buildClaimCredentialResolutionError(claim.provider_id);
      }
    }
    if (Array.isArray(payload.mcp_claim_handles) && payload.mcp_claim_handles.length > 0) {
      credentials.mcp_claim_values = Object.fromEntries(
        payload.mcp_claim_handles.map((handle) => [
          handle,
          readProviderSecret(
            parseMcpClaimCredentialHandle(
              handle,
              taskId,
              this.deps.claimHandleSecret,
            ),
          ),
        ]),
      );
    }
    return credentials;
  }

  private async handleClaimCredentialResolutionFailure(providerId?: string): Promise<void> {
    if (!providerId) {
      return;
    }
    await new OAuthService(this.deps.pool).markProviderNeedsReauth(providerId).catch(() => undefined);
  }

  private async enrichWithLLMCredentials(
    tenantId: string,
    task: Record<string, unknown>,
    llmResolution?: TaskLLMResolution,
  ): Promise<Record<string, unknown>> {
    const { roleName, existingRoleConfig, resolved } =
      llmResolution ?? (await this.resolveTaskLLMConfig(tenantId, task));
    const sanitizedTask = stripClaimSecretEchoes(task);

    const taskWithRoleDefinition = await this.enrichFromRoleDefinition(
      tenantId,
      roleName,
      sanitizedTask,
    );
    const taskWithAllowedTools = sanitizeClaimRoleTools(taskWithRoleDefinition);

    let credentials: Record<string, unknown>;
    if (resolved.provider.authMode === 'oauth' && resolved.provider.providerId) {
      credentials = await this.enrichWithOAuthCredentials(
        String(sanitizedTask.id ?? ''),
        taskWithAllowedTools,
        resolved,
      );
    } else {
      credentials = await this.resolveApiKeyCredentials(
        tenantId,
        String(sanitizedTask.id ?? ''),
        taskWithAllowedTools,
        resolved,
      );
    }

    return attachClaimCredentials(taskWithAllowedTools, {
      ...credentials,
    });
  }

  private async resolveTaskRoleConfigOverride(
    tenantId: string,
    selection: TaskModelOverrideSelection,
  ): Promise<ResolvedRoleConfig | null> {
    if (!selection.requested) {
      return null;
    }

    const result = await this.deps.pool.query<DirectModelLookupRow>(
      `SELECT
          p.id AS provider_id,
          p.name AS provider_name,
          p.base_url AS provider_base_url,
          p.api_key_secret_ref AS provider_api_key_secret_ref,
          p.auth_mode AS provider_auth_mode,
          p.metadata AS provider_metadata,
          m.model_id AS model_id,
          m.context_window AS model_context_window,
          m.max_output_tokens AS model_max_output_tokens,
          m.endpoint_type AS model_endpoint_type,
          m.reasoning_config AS model_reasoning_config,
          m.input_cost_per_million_usd AS model_input_cost_per_million_usd,
          m.output_cost_per_million_usd AS model_output_cost_per_million_usd
        FROM llm_models m
        JOIN llm_providers p
          ON p.id = m.provider_id
       WHERE p.tenant_id = $1
         AND p.name = $2
         AND m.model_id = $3
         AND p.is_enabled = true
         AND m.is_enabled = true
       LIMIT 1`,
      [tenantId, selection.providerName, selection.modelId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const providerMetadata = isRecord(row.provider_metadata) ? row.provider_metadata : {};
    const authMode = row.provider_auth_mode ?? 'api_key';
    return {
      provider: {
        name: row.provider_name,
        providerType: readProviderTypeForExecution(providerMetadata, row.provider_name),
        baseUrl: row.provider_base_url ?? '',
        apiKeySecretRef: row.provider_api_key_secret_ref,
        authMode,
        providerId: authMode === 'oauth' ? row.provider_id : null,
      },
      model: {
        modelId: row.model_id,
        contextWindow: row.model_context_window,
        maxOutputTokens: row.model_max_output_tokens,
        endpointType: row.model_endpoint_type,
        reasoningConfig: row.model_reasoning_config,
        inputCostPerMillionUsd: readNullableFloat(row.model_input_cost_per_million_usd),
        outputCostPerMillionUsd: readNullableFloat(row.model_output_cost_per_million_usd),
      },
      reasoningConfig: row.model_reasoning_config,
      nativeSearch: readNativeSearchCapability(row.model_id),
    };
  }

  private async resolveTaskLLMConfig(
    tenantId: string,
    task: Record<string, unknown>,
  ): Promise<TaskLLMResolution> {
    const sanitizedTask = stripClaimSecretEchoes(task);
    const roleName = (sanitizedTask.role as string) || '';
    const existingRoleConfig = (sanitizedTask.role_config ?? {}) as Record<string, unknown>;
    const directOverride = readTaskModelOverrideSelection(existingRoleConfig);
    let resolved: ResolvedRoleConfig | null = null;
    if (directOverride.requested) {
      if (!isCompleteTaskModelOverrideSelection(directOverride)) {
        throw buildInvalidTaskModelOverrideError(directOverride);
      }
      const directResolved = await this.resolveTaskRoleConfigOverride(tenantId, directOverride);
      if (!directResolved) {
        throw buildInvalidTaskModelOverrideError(directOverride);
      }
      const fallbackResolved = this.deps.resolveRoleConfig && roleName
        ? await this.deps.resolveRoleConfig(tenantId, roleName)
        : null;
      resolved = {
        ...directResolved,
        reasoningConfig:
          readExplicitTaskReasoningConfig(existingRoleConfig)
          ?? fallbackResolved?.reasoningConfig
          ?? null,
      };
    } else {
      resolved = this.deps.resolveRoleConfig && roleName
        ? await this.deps.resolveRoleConfig(tenantId, roleName)
        : null;
    }
    if (!resolved) {
      throw buildMissingTaskModelConfigError(roleName);
    }
    return {
      roleName,
      existingRoleConfig,
      resolved,
    };
  }

  private async enrichFromRoleDefinition(
    tenantId: string,
    roleName: string,
    task: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    try {
      const capabilities = await readSpecialistRoleCapabilities(
        this.deps.pool,
        tenantId,
        roleName,
      );
      const existingRoleConfig = (task.role_config ?? {}) as Record<string, unknown>;
      const updates: Record<string, unknown> = {};

      if (capabilities?.escalationTarget) {
        updates.escalation_target = capabilities.escalationTarget;
      } else if (task.is_orchestrator_task === true) {
        updates.escalation_target = 'human';
      }
      if (capabilities) {
        updates.tools = capabilities.allowedTools;
        if (typeof capabilities.description === 'string' && capabilities.description.trim().length > 0) {
          updates.description = capabilities.description.trim();
        }
        const remoteMcpServers = await buildRemoteMcpServerContracts(
          String(task.id ?? ''),
          tenantId,
          capabilities,
          this.deps.claimHandleSecret,
          this.deps.pool,
        );
        if (remoteMcpServers.length > 0) {
          updates.mcp_servers = remoteMcpServers;
        }
      }

      if (Object.keys(updates).length === 0) return task;

      return {
        ...task,
        role_config: { ...existingRoleConfig, ...updates },
      };
    } catch {
      return task;
    }
  }

  private async enrichWithOAuthCredentials(
    taskId: string,
    task: Record<string, unknown>,
    resolved: ResolvedRoleConfig,
  ): Promise<Record<string, unknown>> {
    const oauthService = new OAuthService(this.deps.pool);
    const oauthToken = await oauthService.resolveValidToken(resolved.provider.providerId!);

    const llmFields: Record<string, unknown> = buildClaimLLMFields(
      (task.role_config ?? {}) as Record<string, unknown>,
      resolved,
    );
    llmFields.llm_base_url = oauthToken.baseUrl;
    llmFields.llm_endpoint_type = oauthToken.endpointType;
    llmFields.llm_auth_mode = 'oauth';

    return {
      ...llmFields,
      ...toClaimStringCredential(
        taskId,
        'llm_api_key',
        'llm_api_key_claim_handle',
        'llm_api_key_secret_ref',
        oauthToken.accessTokenSecret,
        this.deps.claimHandleSecret,
        { providerId: resolved.provider.providerId! },
      ),
      ...toClaimObjectCredential(
        taskId,
        'llm_extra_headers',
        'llm_extra_headers_claim_handle',
        'llm_extra_headers_secret_ref',
        oauthToken.extraHeadersSecret,
        this.deps.claimHandleSecret,
        { providerId: resolved.provider.providerId! },
      ),
    };
  }

  private async resolveApiKeyCredentials(
    tenantId: string,
    taskId: string,
    task: Record<string, unknown>,
    resolved: ResolvedRoleConfig,
  ): Promise<Record<string, unknown>> {
    const llmFields: Record<string, unknown> = buildClaimLLMFields(
      (task.role_config ?? {}) as Record<string, unknown>,
      resolved,
    );
    if (resolved.provider.baseUrl) {
      llmFields.llm_base_url = resolved.provider.baseUrl;
    }
    if (resolved.model.endpointType) {
      llmFields.llm_endpoint_type = resolved.model.endpointType;
    }
    const storedSecret = await this.loadStoredProviderSecret(tenantId, resolved);
    return {
      ...llmFields,
      ...toClaimStringCredential(
        taskId,
        'llm_api_key',
        'llm_api_key_claim_handle',
        'llm_api_key_secret_ref',
        storedSecret,
        this.deps.claimHandleSecret,
      ),
    };
  }

  private async loadStoredProviderSecret(
    tenantId: string,
    resolved: ResolvedRoleConfig,
  ): Promise<string | null> {
    const providerId = resolved.provider.providerId?.trim();
    if (!providerId || isExternalSecretReference(resolved.provider.apiKeySecretRef ?? '')) {
      return resolved.provider.apiKeySecretRef;
    }
    const result = await this.deps.pool.query<{ api_key_secret_ref: string | null }>(
      `SELECT api_key_secret_ref
         FROM llm_providers
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1`,
      [tenantId, providerId],
    );
    return result.rows[0]?.api_key_secret_ref ?? resolved.provider.apiKeySecretRef;
  }

  private async resolveTaskLoopContract(
    tenantId: string,
    task: Record<string, unknown>,
    db: DatabaseClient,
  ): Promise<TaskLoopContract> {
    const maxIterations = await this.resolveLoopContractValue(
      tenantId,
      task.max_iterations,
      'agent.max_iterations',
      db,
    );
    const llmMaxRetries = await this.resolveLoopContractValue(
      tenantId,
      task.llm_max_retries,
      'agent.llm_max_retries',
      db,
    );
    return {
      loopMode: buildTaskLoopMode(task),
      maxIterations,
      llmMaxRetries,
    };
  }

  private async readRoleScopedExecutionEnvironmentId(
    tenantId: string,
    roleName: string,
    db: DatabaseClient,
  ): Promise<string | null> {
    const trimmedRoleName = roleName.trim();
    if (trimmedRoleName.length === 0) {
      return null;
    }
    const result = await db.query<{ execution_environment_id: string | null }>(
      `SELECT execution_environment_id
         FROM role_definitions
        WHERE tenant_id = $1
          AND name = $2
          AND is_active = true
        LIMIT 1`,
      [tenantId, trimmedRoleName],
    );
    return result.rows[0]?.execution_environment_id ?? null;
  }

  private async readClaimableExecutionEnvironmentRow(
    tenantId: string,
    requestedId: string | null,
    db: DatabaseClient,
  ): Promise<ClaimableExecutionEnvironmentRow | null> {
    const result = await db.query<ClaimableExecutionEnvironmentRow>(
      `SELECT
         ee.id,
         ee.name,
         ee.source_kind,
         ee.catalog_key,
         ee.catalog_version,
         ee.image,
         ee.cpu,
         ee.memory,
         ee.pull_policy,
         ee.compatibility_status,
         ee.verification_contract_version,
         ee.verified_metadata,
         ee.tool_capabilities,
         ee.bootstrap_commands,
         ee.bootstrap_required_domains,
         c.support_status
       FROM execution_environments ee
       LEFT JOIN execution_environment_catalog c
         ON c.catalog_key = ee.catalog_key
        AND c.catalog_version = ee.catalog_version
      WHERE ee.tenant_id = $1
        AND ee.is_archived = false
        AND ee.is_claimable = true
        AND COALESCE(c.support_status, 'active') <> 'blocked'
        AND (
          ($2::uuid IS NOT NULL AND ee.id = $2::uuid)
          OR ($2::uuid IS NULL AND ee.is_default = true)
        )
      LIMIT 1`,
      [tenantId, requestedId],
    );
    return result.rows[0] ?? null;
  }

  private async resolveExecutionEnvironmentContract(
    tenantId: string,
    task: Record<string, unknown>,
    db: DatabaseClient,
  ): Promise<ResolvedTaskExecutionEnvironment | null> {
    if (readTaskExecutionBackend(task) !== 'runtime_plus_task') {
      return null;
    }
    const environmentId = await this.readRoleScopedExecutionEnvironmentId(
      tenantId,
      typeof task.role === 'string' ? task.role : '',
      db,
    );
    const row = await this.readClaimableExecutionEnvironmentRow(tenantId, environmentId, db);
    if (!row) {
      throw new ValidationError(
        'No claimable Specialist Execution environment is configured for this role or tenant default',
      );
    }
    return buildResolvedTaskExecutionEnvironment(row);
  }

  private async resolveLoopContractValue(
    tenantId: string,
    explicitValue: unknown,
    runtimeDefaultKey: 'agent.max_iterations' | 'agent.llm_max_retries',
    db: DatabaseClient,
  ): Promise<number> {
    const directValue = readPositiveInteger(explicitValue);
    if (directValue !== null) {
      return directValue;
    }

    return readRequiredPositiveIntegerRuntimeDefault(db, tenantId, runtimeDefaultKey);
  }

  private async assertIdentityOwnsTask(identity: ApiKeyIdentity, taskId: string): Promise<void> {
    const result = await this.deps.pool.query<{ assigned_agent_id: string | null; assigned_worker_id: string | null }>(
      `SELECT assigned_agent_id, assigned_worker_id
         FROM tasks
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1`,
      [identity.tenantId, taskId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Task not found');
    }

    const task = result.rows[0];
    if (identity.scope === 'worker') {
      if ((task?.assigned_worker_id ?? '') !== identity.ownerId) {
        throw new ForbiddenError('Specialist Agent cannot resolve claim credentials for a different task.');
      }
      return;
    }

    if ((task?.assigned_agent_id ?? '') !== identity.ownerId) {
      throw new ForbiddenError('Agent cannot resolve claim credentials for a different task.');
    }
  }
}

function normalizeAgentPlaybookScope(explicitPlaybookId: string | null, metadata: unknown): string | null {
  if (explicitPlaybookId && explicitPlaybookId.trim().length > 0) {
    return explicitPlaybookId.trim();
  }
  if (!isRecord(metadata)) {
    return null;
  }
  const playbookId = metadata.playbook_id;
  return typeof playbookId === 'string' && playbookId.trim().length > 0 ? playbookId.trim() : null;
}

function agentCanClaimOrchestratorTasks(metadata: unknown): boolean {
  return readAgentExecutionMode(metadata) !== 'specialist';
}

function isFreshClaimPeer(peer: ClaimPeerAgentRow, freshnessMultiplier: number): boolean {
  const lastHeartbeatAt = toNullableDate(peer.last_heartbeat_at);
  if (!lastHeartbeatAt) {
    return false;
  }
  const heartbeatIntervalSeconds =
    typeof peer.heartbeat_interval_seconds === 'number' && peer.heartbeat_interval_seconds > 0
      ? peer.heartbeat_interval_seconds
      : 30;
  const freshnessWindowMs = heartbeatIntervalSeconds * Math.max(freshnessMultiplier, 1) * 1000;
  return Date.now() - lastHeartbeatAt.getTime() <= freshnessWindowMs;
}

function toNullableDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readExplicitTaskReasoningConfig(
  roleConfig: Record<string, unknown>,
): Record<string, unknown> | null {
  const value = roleConfig.llm_reasoning_config;
  return isRecord(value) ? value : null;
}

function readTaskModelOverrideSelection(
  roleConfig: Record<string, unknown>,
): TaskModelOverrideSelection {
  const providerName = typeof roleConfig.llm_provider === 'string'
    ? roleConfig.llm_provider.trim()
    : '';
  const modelId = typeof roleConfig.llm_model === 'string'
    ? roleConfig.llm_model.trim()
    : '';
  return {
    providerName,
    modelId,
    requested: providerName !== '' || modelId !== '',
  };
}

function isCompleteTaskModelOverrideSelection(
  selection: TaskModelOverrideSelection,
): boolean {
  return selection.providerName !== '' && selection.modelId !== '';
}

function mergeSystemPrompt(
  taskResponse: Record<string, unknown>,
  instructionLayers: Record<string, unknown>,
): Record<string, unknown> {
  const flattened = flattenInstructionLayers(instructionLayers);
  if (!flattened) return taskResponse;

  const existing = (taskResponse.role_config ?? {}) as Record<string, unknown>;
  return {
    ...taskResponse,
    role_config: { ...existing, system_prompt: flattened },
  };
}

function buildResolvedTaskExecutionEnvironment(
  row: ClaimableExecutionEnvironmentRow,
): ResolvedTaskExecutionEnvironment {
  const verifiedMetadata = isRecord(row.verified_metadata) ? row.verified_metadata : {};
  const toolCapabilities = isRecord(row.tool_capabilities) ? row.tool_capabilities : {};
  const executionEnvironment: ExecutionEnvironmentSummary = {
    id: row.id,
    name: row.name,
    source_kind: row.source_kind === 'catalog' ? 'catalog' : 'custom',
    catalog_key: row.catalog_key,
    catalog_version: row.catalog_version,
    image: row.image,
    cpu: row.cpu,
    memory: row.memory,
    pull_policy: row.pull_policy === 'always' || row.pull_policy === 'never' ? row.pull_policy : 'if-not-present',
    compatibility_status:
      row.compatibility_status === 'compatible' || row.compatibility_status === 'incompatible'
        ? row.compatibility_status
        : 'unknown',
    support_status:
      row.support_status === 'deprecated' || row.support_status === 'blocked'
        ? row.support_status
        : row.source_kind === 'catalog'
          ? 'active'
          : null,
    verification_contract_version: row.verification_contract_version,
    verified_metadata: verifiedMetadata,
    tool_capabilities: toolCapabilities,
    bootstrap_commands: normalizeStringArray(row.bootstrap_commands),
    bootstrap_required_domains: normalizeStringArray(row.bootstrap_required_domains),
    agent_hint: buildExecutionEnvironmentAgentHint({
      name: row.name,
      image: row.image,
      verifiedMetadata,
      toolCapabilities,
    }),
  };
  return {
    executionContainer: {
      image: executionEnvironment.image,
      cpu: executionEnvironment.cpu,
      memory: executionEnvironment.memory,
      pull_policy: executionEnvironment.pull_policy,
    },
    executionEnvironment,
    snapshot: executionEnvironment,
  };
}

function readAgentExecutionMode(value: unknown): AgentExecutionMode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'specialist';
  }
  const mode = (value as Record<string, unknown>).execution_mode;
  if (mode === 'orchestrator' || mode === 'hybrid') {
    return mode;
  }
  return 'specialist';
}

function buildMissingTaskModelConfigError(roleName: string): ValidationError {
  const trimmedRoleName = roleName.trim();
  const label = trimmedRoleName ? `role '${trimmedRoleName}'` : 'this task';
  return new ValidationError(
    `No LLM model is configured for ${label}. Assign a model to the role or set a default model on the LLM Providers page before claiming tasks.`,
    { role: trimmedRoleName || null },
  );
}

function buildInvalidTaskModelOverrideError(
  selection: TaskModelOverrideSelection,
): ValidationError {
  if (!selection.providerName || !selection.modelId) {
    return new ValidationError(
      'Explicit task model override is incomplete. Set both llm_provider and llm_model or remove the override so the role/default LLM routing can apply.',
      {
        llm_provider: selection.providerName || null,
        llm_model: selection.modelId || null,
      },
    );
  }
  return new ValidationError(
    `Explicit task model override could not be resolved for provider "${selection.providerName}" and model "${selection.modelId}". Configure that model on the LLM Providers page or remove the task-level override.`,
    {
      llm_provider: selection.providerName,
      llm_model: selection.modelId,
    },
  );
}

function readProviderTypeForExecution(
  providerMetadata: Record<string, unknown>,
  providerName: string,
): string {
  const providerType = providerMetadata.providerType;
  if (typeof providerType === 'string' && providerType.trim().length > 0) {
    return providerType.trim();
  }
  throw new ValidationError(
    `Provider "${providerName}" is missing providerType metadata. Re-save the provider on the LLM Providers page before using it for execution.`,
    {
      provider_name: providerName,
    },
  );
}

function resolveNativeSearchMode(
  roleConfig: Record<string, unknown>,
  resolved: ResolvedRoleConfig,
): string | null {
  if (!Array.isArray(roleConfig.tools)) {
    return null;
  }
  const hasNativeSearch = roleConfig.tools.some(
    (tool) => typeof tool === 'string' && tool.trim() === 'native_search',
  );
  if (!hasNativeSearch) {
    return null;
  }
  return resolved.nativeSearch?.mode ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildExecutionModeCondition(mode: AgentExecutionMode): string {
  const backendExpression = `COALESCE(
    tasks.execution_backend::text,
    CASE
      WHEN tasks.is_orchestrator_task = true THEN 'runtime_only'
      ELSE 'runtime_plus_task'
    END
  )`;
  if (mode === 'orchestrator') {
    return `${backendExpression} = 'runtime_only'`;
  }
  if (mode === 'hybrid') {
    return 'true';
  }
  return `${backendExpression} = 'runtime_plus_task'`;
}

function buildTaskLoopMode(task: Record<string, unknown>) {
  return task.is_orchestrator_task === true ? 'tpaov' : 'reactive';
}

function buildRuntimeTaskCapabilities(
  task: Record<string, unknown>,
  _instructionContext: Record<string, unknown>,
): Record<string, unknown> {
  const taskKind = readPresentString(isRecord(task.metadata) ? task.metadata.task_kind : null) ?? '';
  const allowsHandoffResolution = taskKind === 'assessment' || taskKind === 'approval';
  const requiresStructuredHandoff = allowsHandoffResolution || taskInputRequiresStructuredHandoff(task);
  return compactRecord({
    requires_structured_handoff: requiresStructuredHandoff,
    allows_handoff_resolution: allowsHandoffResolution,
    handoff_satisfies_completion: allowsHandoffResolution,
    forbidden_mutation_tools: allowsHandoffResolution ? ['file_write', 'file_edit', 'git_commit', 'git_push'] : undefined,
    isolate_shell_exec_workspace: allowsHandoffResolution || undefined,
  });
}

function taskInputRequiresStructuredHandoff(task: Record<string, unknown>): boolean {
  const input = isRecord(task.input) ? task.input : null;
  if (!input) {
    return false;
  }
  return Array.isArray(input.handoff_requirements) || Array.isArray(input.final_handoff_requirements);
}

function readNullableFloat(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stripClaimSecretEchoes(task: Record<string, unknown>): Record<string, unknown> {
  const roleConfig = (task.role_config ?? {}) as Record<string, unknown>;
  const credentials = (task.credentials ?? {}) as Record<string, unknown>;
  if (Object.keys(roleConfig).length === 0 && Object.keys(credentials).length === 0) {
    return task;
  }

  const sanitizedRoleConfig = Object.fromEntries(
    Object.entries(roleConfig).filter(([key]) => !claimRoleConfigSecretKeys.has(key)),
  );
  const sanitizedCredentials = Object.fromEntries(
    Object.entries(credentials).filter(([key]) => !claimRoleConfigSecretKeys.has(key)),
  );
  return {
    ...task,
    role_config: sanitizedRoleConfig,
    credentials: sanitizedCredentials,
  };
}

function sanitizeClaimRoleTools(task: Record<string, unknown>): Record<string, unknown> {
  if (task.is_orchestrator_task === true) {
    return task;
  }
  const roleConfig = isRecord(task.role_config) ? task.role_config : {};
  if (!Array.isArray(roleConfig.tools)) {
    return task;
  }
  const workspaceBinding = isRecord(task.workspace_binding) ? task.workspace_binding : {};
  const workspaceType = typeof workspaceBinding.type === 'string' ? workspaceBinding.type : null;
  const allowsGitTools = workspaceType === 'git_remote';
  const tools = roleConfig.tools.filter(
    (tool): tool is string =>
      typeof tool === 'string'
      && tool.trim().length > 0
      && isSpecialistSelectableToolId(tool)
      && (allowsGitTools || !isGitBuiltInToolId(tool)),
  );
  return {
    ...task,
    role_config: {
      ...roleConfig,
      tools: appendOperatorRecordTools(tools),
    },
  };
}

function appendOperatorRecordTools(tools: string[]): string[] {
  const merged = [...tools];
  for (const toolId of operatorRecordToolIds) {
    if (!merged.includes(toolId)) {
      merged.push(toolId);
    }
  }
  return merged;
}

function compactRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function readTaskExecutionBackend(task: Record<string, unknown>): 'runtime_only' | 'runtime_plus_task' {
  if (task.execution_backend === 'runtime_only' || task.execution_backend === 'runtime_plus_task') {
    return task.execution_backend;
  }
  return task.is_orchestrator_task === true ? 'runtime_only' : 'runtime_plus_task';
}

function buildToolOwnerContract(task: Record<string, unknown>): Record<string, ToolOwner> {
  const roleConfig = isRecord(task.role_config) ? task.role_config : {};
  const tools = Array.isArray(roleConfig.tools) ? roleConfig.tools : [];
  const entries = tools
    .filter((tool): tool is string => typeof tool === 'string' && tool.trim().length > 0)
    .map((tool) => [tool, resolveBuiltInToolOwner(tool)] as const)
    .filter((entry): entry is readonly [string, ToolOwner] => entry[1] !== null);
  return Object.fromEntries(entries);
}

function mergeClaimRuntimeBindings(
  claimedTask: Record<string, unknown>,
  persistedTask: Record<string, unknown>,
): Record<string, unknown> {
  const persistedBindings = Array.isArray(persistedTask.resource_bindings)
    ? (persistedTask.resource_bindings as unknown[])
    : null;
  if (!persistedBindings) {
    return claimedTask;
  }
  return {
    ...claimedTask,
    resource_bindings: persistedBindings,
  };
}

function hydrateClaimGitCredentials(task: Record<string, unknown>): Record<string, unknown> {
  const bindings = Array.isArray(task.resource_bindings)
    ? (task.resource_bindings as unknown[])
    : null;
  if (!bindings) {
    return task;
  }

  let gitToken: string | null = null;
  let gitSSHPrivateKey: string | null = null;
  let gitSSHKnownHosts: string | null = null;

  const sanitizedBindings = bindings.map((binding) => {
    if (!isRecord(binding) || String(binding.type ?? '').trim() !== 'git_repository') {
      return binding;
    }

    const credentials = isRecord(binding.credentials) ? binding.credentials : {};
    const nextBinding: Record<string, unknown> = { ...binding };
    const nextCredentials: Record<string, unknown> = { ...credentials };

    gitToken ??= readGitBindingCredential(binding, credentials, gitTokenCredentialKeys);
    gitSSHPrivateKey ??= readGitBindingCredential(
      binding,
      credentials,
      gitSSHPrivateKeyCredentialKeys,
    );
    gitSSHKnownHosts ??= readGitBindingCredential(
      binding,
      credentials,
      gitSSHKnownHostsCredentialKeys,
    );

    stripGitBindingCredential(nextBinding, nextCredentials, gitTokenCredentialKeys);
    stripGitBindingCredential(
      nextBinding,
      nextCredentials,
      gitSSHPrivateKeyCredentialKeys,
    );
    stripGitBindingCredential(
      nextBinding,
      nextCredentials,
      gitSSHKnownHostsCredentialKeys,
    );

    if (isRecord(binding.credentials)) {
      nextBinding.credentials = nextCredentials;
    }

    return nextBinding;
  });

  const claimCredentials: Record<string, unknown> = {};
  if (gitToken) {
    claimCredentials.git_token = gitToken;
  }
  if (gitSSHPrivateKey) {
    claimCredentials.git_ssh_private_key = gitSSHPrivateKey;
  }
  if (gitSSHKnownHosts) {
    claimCredentials.git_ssh_known_hosts = gitSSHKnownHosts;
  }

  const nextTask = {
    ...task,
    resource_bindings: sanitizedBindings,
  };

  return Object.keys(claimCredentials).length > 0
    ? attachClaimCredentials(nextTask, claimCredentials)
    : nextTask;
}

function readGitBindingCredential(
  binding: Record<string, unknown>,
  credentials: Record<string, unknown>,
  candidates: string[],
): string | null {
  const stored = firstPresentString(binding, credentials, candidates);
  if (!stored) {
    return null;
  }
  return isExternalSecretReference(stored) ? stored : readProviderSecret(stored);
}

function stripGitBindingCredential(
  binding: Record<string, unknown>,
  credentials: Record<string, unknown>,
  candidates: string[],
): void {
  for (const candidate of candidates) {
    delete binding[candidate];
    delete credentials[candidate];
  }
}

function firstPresentString(
  binding: Record<string, unknown>,
  credentials: Record<string, unknown>,
  candidates: string[],
): string | null {
  for (const candidate of candidates) {
    const direct = readPresentString(binding[candidate]);
    if (direct !== null) {
      return direct;
    }
  }
  for (const candidate of candidates) {
    const nested = readPresentString(credentials[candidate]);
    if (nested !== null) {
      return nested;
    }
  }
  return null;
}

function readPresentString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function attachClaimCredentials(
  task: Record<string, unknown>,
  credentials: Record<string, unknown>,
): Record<string, unknown> {
  const nextCredentials = {
    ...((task.credentials ?? {}) as Record<string, unknown>),
    ...credentials,
  };
  if (Object.keys(nextCredentials).length === 0) {
    return task;
  }
  return {
    ...task,
    credentials: nextCredentials,
  };
}

async function buildRemoteMcpServerContracts(
  taskId: string,
  tenantId: string,
  capabilities: SpecialistRoleCapabilities,
  claimHandleSecret: string,
  pool: DatabasePool,
): Promise<Record<string, unknown>[]> {
  const oauthService = new RemoteMcpOAuthService(
    pool,
    {
      getStoredServer: async () => {
        throw new ValidationError('Remote MCP OAuth server reload is not available in claim path');
      },
      createVerifiedServer: async () => {
        throw new ValidationError('Remote MCP OAuth server creation is not available in claim path');
      },
      updateVerifiedServer: async () => {
        throw new ValidationError('Remote MCP OAuth server update is not available in claim path');
      },
    },
    {
      verify: async () => {
        throw new ValidationError('Remote MCP verification is not available in claim path');
      },
    },
    {
    },
  );
  return Promise.all(
    capabilities.remoteMcpServers.map((server) =>
      buildRemoteMcpServerContract(taskId, tenantId, server, claimHandleSecret, oauthService),
    ),
  );
}

async function buildRemoteMcpServerContract(
  taskId: string,
  tenantId: string,
  server: SpecialistRemoteMcpServerCapability,
  claimHandleSecret: string,
  oauthService: RemoteMcpOAuthService,
): Promise<Record<string, unknown>> {
  const parameters = server.parameters
    .filter((parameter) => isRuntimeRemoteMcpParameterPlacement(parameter.placement))
    .map((parameter) =>
      buildRemoteMcpParameterContract(taskId, parameter, claimHandleSecret),
    );
  const oauthParameter = server.authMode === 'oauth'
    ? await buildRemoteMcpOauthParameterContract(taskId, tenantId, server, claimHandleSecret, oauthService)
    : null;
  return compactRecord({
    id: server.id,
    name: server.slug,
    display_name: server.name,
    description: server.description,
    transport: server.verifiedTransport ?? 'streamable_http',
    url: server.endpointUrl,
    timeout_seconds: server.callTimeoutSeconds,
    auth_mode: server.authMode,
    verification_contract_version: server.verificationContractVersion,
    verified_capability_summary: server.verifiedCapabilitySummary,
    discovered_tools_snapshot: server.discoveredToolsSnapshot,
    discovered_resources_snapshot: server.discoveredResourcesSnapshot,
    discovered_prompts_snapshot: server.discoveredPromptsSnapshot,
    parameters: oauthParameter ? [...parameters, oauthParameter] : parameters,
  });
}

async function buildRemoteMcpOauthParameterContract(
  taskId: string,
  _tenantId: string,
  server: SpecialistRemoteMcpServerCapability,
  claimHandleSecret: string,
  oauthService: RemoteMcpOAuthService,
): Promise<Record<string, unknown>> {
  const storedSecret = await oauthService.resolveStoredAuthorizationSecret({
    id: server.id,
    oauthConfig: server.oauthConfig,
    oauthCredentials: server.oauthCredentials,
  });
  return {
    placement: 'header',
    key: 'Authorization',
    value_kind: 'secret',
    claim_handle: createClaimCredentialHandle(
      taskId,
      'mcp_oauth',
      storedSecret,
      claimHandleSecret,
    ),
  };
}

function isRuntimeRemoteMcpParameterPlacement(placement: string): boolean {
  return placement === 'path'
    || placement === 'query'
    || placement === 'header'
    || placement === 'cookie'
    || placement === 'initialize_param';
}

function buildRemoteMcpParameterContract(
  taskId: string,
  parameter: SpecialistRemoteMcpServerCapability['parameters'][number],
  claimHandleSecret: string,
): Record<string, unknown> {
  if (parameter.valueKind === 'static') {
    return compactRecord({
      id: parameter.id,
      placement: parameter.placement,
      key: parameter.key,
      value_kind: 'static',
      value: parameter.staticValue,
    });
  }
  const storedSecret = parameter.encryptedSecretValue?.trim() ?? '';
  if (!storedSecret) {
    return compactRecord({
      id: parameter.id,
      placement: parameter.placement,
      key: parameter.key,
      value_kind: 'secret',
    });
  }
  if (isExternalSecretReference(storedSecret)) {
    throw new ValidationError(
      'Remote MCP parameters cannot use external secret references in the claim path.',
    );
  }
  return {
    id: parameter.id,
    placement: parameter.placement,
    key: parameter.key,
    value_kind: 'secret',
    claim_handle: createClaimCredentialHandle(
      taskId,
      'mcp_parameter',
      storedSecret,
      claimHandleSecret,
    ),
  };
}

function toClaimStringCredential(
  taskId: string,
  kind: ClaimCredentialKind,
  handleKey: string,
  secretRefKey: string,
  stored: string | null | undefined,
  claimHandleSecret: string,
  options?: { providerId?: string },
): Record<string, unknown> {
  const normalized = typeof stored === 'string' ? stored.trim() : '';
  if (!normalized) {
    return {};
  }
  if (isExternalSecretReference(normalized)) {
    return { [secretRefKey]: normalized };
  }
  return {
    [handleKey]: createClaimCredentialHandle(
      taskId,
      kind,
      normalized,
      claimHandleSecret,
      options,
    ),
  };
}

function toClaimObjectCredential(
  taskId: string,
  kind: ClaimCredentialKind,
  handleKey: string,
  secretRefKey: string,
  stored: string | null | undefined,
  claimHandleSecret: string,
  options?: { providerId?: string },
): Record<string, unknown> {
  const normalized = typeof stored === 'string' ? stored.trim() : '';
  if (!normalized) {
    return {};
  }
  if (isExternalSecretReference(normalized)) {
    return { [secretRefKey]: normalized };
  }
  return {
    [handleKey]: createClaimCredentialHandle(
      taskId,
      kind,
      normalized,
      claimHandleSecret,
      options,
    ),
  };
}

function parseExtraHeadersSecret(secret: string): Record<string, string> {
  const parsed = JSON.parse(readProviderSecret(secret)) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value] as const] : [],
    ),
  );
}

function createClaimCredentialHandle(
  taskId: string,
  kind: ClaimCredentialKind,
  storedSecret: string,
  claimHandleSecret: string,
  options?: { providerId?: string },
): string {
  const iv = randomBytes(CLAIM_CREDENTIAL_HANDLE_IV_LENGTH_BYTES);
  const cipher = createCipheriv(
    CLAIM_CREDENTIAL_HANDLE_ENCRYPTION_ALGORITHM,
    deriveClaimHandleKey(claimHandleSecret),
    iv,
  );
  const encrypted = Buffer.concat([
    cipher.update(
      JSON.stringify({
        task_id: taskId,
        kind,
        stored_secret: storedSecret,
        provider_id: options?.providerId ?? undefined,
      }),
      'utf8',
    ),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `claim:${CLAIM_CREDENTIAL_HANDLE_VERSION}:${iv.toString('base64url')}.${encrypted.toString('base64url')}.${authTag.toString('base64url')}`;
}

function parseClaimCredentialHandle(
  handle: string,
  expectedTaskId: string,
  expectedKind: ClaimCredentialKind,
  claimHandleSecret: string,
): string {
  return parseClaimCredentialHandlePayload(
    handle,
    expectedTaskId,
    expectedKind,
    claimHandleSecret,
  ).stored_secret;
}

function parseClaimCredentialHandlePayload(
  handle: string,
  expectedTaskId: string,
  expectedKind: ClaimCredentialKind,
  claimHandleSecret: string,
): ClaimCredentialPayload & { stored_secret: string } {
  const prefix = `claim:${CLAIM_CREDENTIAL_HANDLE_VERSION}:`;
  if (!handle.startsWith(prefix)) {
    throw new ValidationError('Invalid claim credential handle.');
  }
  const encoded = handle.slice(prefix.length);
  const decoded = readClaimCredentialPayload(encoded, claimHandleSecret);
  if (
    decoded.task_id !== expectedTaskId
    || decoded.kind !== expectedKind
    || typeof decoded.stored_secret !== 'string'
  ) {
    throw new ValidationError('Invalid claim credential handle.');
  }
  return decoded as ClaimCredentialPayload & { stored_secret: string };
}

function parseMcpClaimCredentialHandle(
  handle: string,
  expectedTaskId: string,
  claimHandleSecret: string,
): string {
  try {
    return parseClaimCredentialHandle(handle, expectedTaskId, 'mcp_parameter', claimHandleSecret);
  } catch {
    return parseClaimCredentialHandle(handle, expectedTaskId, 'mcp_oauth', claimHandleSecret);
  }
}

function deriveClaimHandleKey(claimHandleSecret: string): Buffer {
  return createHash('sha256').update(claimHandleSecret, 'utf8').digest();
}

function readClaimCredentialPayload(
  encoded: string,
  claimHandleSecret: string,
): ClaimCredentialPayload {
  const segments = encoded.split('.');
  if (segments.length === 2) {
    return readLegacyClaimCredentialPayload(encoded, claimHandleSecret);
  }
  if (segments.length === 3) {
    return readOpaqueClaimCredentialPayload(segments, claimHandleSecret);
  }
  throw new ValidationError('Invalid claim credential handle.');
}

function readLegacyClaimCredentialPayload(
  encoded: string,
  claimHandleSecret: string,
): ClaimCredentialPayload {
  const separator = encoded.lastIndexOf('.');
  if (separator <= 0 || separator === encoded.length - 1) {
    throw new ValidationError('Invalid claim credential handle.');
  }
  const payload = encoded.slice(0, separator);
  const signature = encoded.slice(separator + 1);
  const expectedSignature = createHmac('sha256', claimHandleSecret).update(payload).digest();
  const providedSignature = Buffer.from(signature, 'base64url');
  if (
    expectedSignature.length !== providedSignature.length
    || !timingSafeEqual(expectedSignature, providedSignature)
  ) {
    throw new ValidationError('Invalid claim credential handle.');
  }
  return parseClaimCredentialPayload(Buffer.from(payload, 'base64url').toString('utf8'));
}

function readOpaqueClaimCredentialPayload(
  segments: string[],
  claimHandleSecret: string,
): ClaimCredentialPayload {
  const [ivBase64, encryptedBase64, authTagBase64] = segments;
  if (!ivBase64 || !encryptedBase64 || !authTagBase64) {
    throw new ValidationError('Invalid claim credential handle.');
  }
  try {
    const decipher = createDecipheriv(
      CLAIM_CREDENTIAL_HANDLE_ENCRYPTION_ALGORITHM,
      deriveClaimHandleKey(claimHandleSecret),
      Buffer.from(ivBase64, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(authTagBase64, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedBase64, 'base64url')),
      decipher.final(),
    ]);
    return parseClaimCredentialPayload(decrypted.toString('utf8'));
  } catch {
    throw new ValidationError('Invalid claim credential handle.');
  }
}

function parseClaimCredentialPayload(payload: string): ClaimCredentialPayload {
  try {
    return JSON.parse(payload) as ClaimCredentialPayload;
  } catch {
    throw new ValidationError('Invalid claim credential handle.');
  }
}
