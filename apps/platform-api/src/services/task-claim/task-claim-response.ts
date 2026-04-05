import { isExternalSecretReference } from '../../lib/oauth-crypto.js';
import { logTaskGovernanceTransition } from '../../logging/workflow-events/task-governance-log.js';
import { normalizeTaskState } from '../../orchestration/task-state-machine.js';
import { flattenInstructionLayersForSystemPrompt } from '../task-context-service/task-context-service.js';
import { resolveWorkspaceStorageBinding } from '../workspace/workspace-storage.js';
import { readSpecialistRoleCapabilities } from '../specialist/specialist-capability-service.js';
import { OAuthService } from '../oauth/oauth-service.js';
import { attachClaimCredentials, buildRuntimeTaskCapabilities, buildToolOwnerContract, hydrateClaimGitCredentials, mergeClaimRuntimeBindings, readNullableFloat, readTaskExecutionBackend, sanitizeClaimRoleTools, stripClaimSecretEchoes } from './task-claim-task-payload.js';
import { buildClaimLLMFields, buildExecutionContractLogPayload, buildRemoteMcpServerContracts } from './task-claim-llm-contracts.js';
import { buildMissingTaskModelConfigError, logAssembledPromptWarningIfNeeded, mergeSystemPrompt, readAssembledPromptWarningThreshold } from './task-claim-common.js';
import { toClaimObjectCredential, toClaimStringCredential } from './task-claim-credential-handles.js';
import type {
  ClaimResponseBuildInput,
  TaskClaimDependencies,
  TaskLLMResolution,
} from './task-claim-types.js';

export async function buildClaimResponse(
  deps: TaskClaimDependencies,
  input: ClaimResponseBuildInput,
): Promise<Record<string, unknown>> {
  const executionContainer = input.resolvedExecutionEnvironment?.executionContainer ?? null;
  const executionEnvironment = input.resolvedExecutionEnvironment?.executionEnvironment ?? null;
  const claimedTask = mergeClaimRuntimeBindings(
    buildClaimTaskBase(input.task),
    input.task,
  );

  const namesRes = await input.client.query(
    `SELECT
         w.name AS workflow_name,
         p.name AS workspace_name,
         p.repository_url AS workspace_repository_url,
         p.settings AS workspace_settings
       FROM tasks t
       LEFT JOIN workflows w ON w.tenant_id = t.tenant_id AND w.id = t.workflow_id
       LEFT JOIN workspaces p ON p.tenant_id = t.tenant_id AND p.id = t.workspace_id
       WHERE t.tenant_id = $1 AND t.id = $2`,
    [input.identity.tenantId, input.task.id],
  );
  if (namesRes.rowCount) {
    claimedTask.workflow_name = namesRes.rows[0].workflow_name;
    claimedTask.workspace_name = namesRes.rows[0].workspace_name;
    claimedTask.workspace_binding = resolveWorkspaceStorageBinding({
      repository_url: namesRes.rows[0].workspace_repository_url,
      settings: namesRes.rows[0].workspace_settings,
    });
  } else {
    claimedTask.workspace_binding = resolveWorkspaceStorageBinding({});
  }

  const enrichedTask = await enrichWithLLMCredentials(
    deps,
    input.identity.tenantId,
    claimedTask,
    input.llmResolution,
  );
  const runtimeReadyTask = hydrateClaimGitCredentials(enrichedTask);
  await logTaskGovernanceTransition(deps.logService, {
    tenantId: input.identity.tenantId,
    operation: 'task.execution_contract_resolved',
    executor: input.client,
    task: runtimeReadyTask,
    payload: buildExecutionContractLogPayload({
      llmResolution: input.llmResolution,
      loopContract: input.loopContract,
      executionContainer,
      executionEnvironment,
      agentId: input.payload.agent_id,
      workerId: input.payload.worker_id ?? null,
      task: runtimeReadyTask,
    }),
  });
  const { context: _taskContext, ...claimedTaskBase } = runtimeReadyTask as Record<string, unknown>;
  const instructionContext = (await deps.getTaskContext(
    input.identity.tenantId,
    input.task.id as string,
    input.payload.agent_id,
  )) as Record<string, unknown>;
  const instructions =
    typeof instructionContext.instructions === 'string' ? instructionContext.instructions : '';
  const layers = (instructionContext.instruction_layers ?? {}) as Record<string, unknown>;
  const executionBrief = (instructionContext.execution_brief ?? null) as Record<string, unknown> | null;
  const runtimeCapabilities = buildRuntimeTaskCapabilities(runtimeReadyTask, instructionContext);
  const assembledSystemPrompt = flattenInstructionLayersForSystemPrompt(layers);
  const mergedBase = mergeSystemPrompt(claimedTaskBase, assembledSystemPrompt);
  await logAssembledPromptWarningIfNeeded(deps.logService, {
    tenantId: input.identity.tenantId,
    executor: input.client,
    task: runtimeReadyTask,
    prompt: assembledSystemPrompt,
    warningThresholdChars: readAssembledPromptWarningThreshold(instructionContext),
  });
  const executionBackend = readTaskExecutionBackend(runtimeReadyTask);
  const toolOwners = buildToolOwnerContract(mergedBase);
  if ((input.payload.include_context ?? true) === false) {
    return {
      ...mergedBase,
      execution_backend: executionBackend,
      loop_mode: input.loopContract.loopMode,
      max_iterations: input.loopContract.maxIterations,
      llm_max_retries: input.loopContract.llmMaxRetries,
      execution_container: executionContainer,
      execution_environment: executionEnvironment,
      runtime_capabilities: runtimeCapabilities,
      tool_owners: toolOwners,
      tools: input.toolMatch,
      instructions,
      execution_brief: executionBrief,
    };
  }

  return {
    ...mergedBase,
    execution_backend: executionBackend,
    loop_mode: input.loopContract.loopMode,
    max_iterations: input.loopContract.maxIterations,
    llm_max_retries: input.loopContract.llmMaxRetries,
    execution_container: executionContainer,
    execution_environment: executionEnvironment,
    runtime_capabilities: runtimeCapabilities,
    tool_owners: toolOwners,
    tools: input.toolMatch,
    instructions,
    execution_brief: executionBrief,
    context: instructionContext,
  };
}

function buildClaimTaskBase(task: Record<string, unknown>): Record<string, unknown> {
  const { resource_bindings: _resourceBindings, ...rest } = task;
  const metadata = isRecord(rest.metadata) ? rest.metadata : {};
  return {
    ...rest,
    state: normalizeClaimState(rest.state),
    description: metadata.description ?? null,
    parent_id: metadata.parent_id ?? null,
    verification: metadata.verification ?? null,
    cost_cap_usd: readNullableFloat(rest.cost_cap_usd),
    execution_environment: isRecord(rest.execution_environment_snapshot)
      ? rest.execution_environment_snapshot
      : null,
    used_task_sandbox: rest.used_task_sandbox ?? false,
  };
}

function normalizeClaimState(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const normalized = normalizeTaskState(value);
  if (normalized) {
    return normalized;
  }
  throw new Error(`Persisted task state must be canonical. Found '${value}'.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function resolveTaskLLMConfig(
  deps: TaskClaimDependencies,
  tenantId: string,
  task: Record<string, unknown>,
): Promise<TaskLLMResolution> {
  const sanitizedTask = stripClaimSecretEchoes(task);
  const roleName = (sanitizedTask.role as string) || '';
  const existingRoleConfig = (sanitizedTask.role_config ?? {}) as Record<string, unknown>;
  const resolved = deps.resolveRoleConfig && roleName
    ? await deps.resolveRoleConfig(tenantId, roleName)
    : null;
  if (!resolved) {
    throw buildMissingTaskModelConfigError(roleName);
  }
  return {
    roleName,
    existingRoleConfig,
    resolved,
  };
}

async function enrichWithLLMCredentials(
  deps: TaskClaimDependencies,
  tenantId: string,
  task: Record<string, unknown>,
  llmResolution?: TaskLLMResolution,
): Promise<Record<string, unknown>> {
  const { roleName, resolved } =
    llmResolution ?? (await resolveTaskLLMConfig(deps, tenantId, task));
  const sanitizedTask = stripClaimSecretEchoes(task);

  const taskWithRoleDefinition = await enrichFromRoleDefinition(
    deps,
    tenantId,
    roleName,
    sanitizedTask,
  );
  const taskWithAllowedTools = sanitizeClaimRoleTools(taskWithRoleDefinition);

  let credentials: Record<string, unknown>;
  if (resolved.provider.authMode === 'oauth' && resolved.provider.providerId) {
    credentials = await enrichWithOAuthCredentials(
      deps,
      String(sanitizedTask.id ?? ''),
      taskWithAllowedTools,
      resolved,
    );
  } else {
    credentials = await resolveApiKeyCredentials(
      deps,
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

async function enrichFromRoleDefinition(
  deps: TaskClaimDependencies,
  tenantId: string,
  roleName: string,
  task: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const capabilities = await readSpecialistRoleCapabilities(
      deps.pool,
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
        deps.claimHandleSecret,
        deps.pool,
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

async function enrichWithOAuthCredentials(
  deps: TaskClaimDependencies,
  taskId: string,
  task: Record<string, unknown>,
  resolved: TaskLLMResolution['resolved'],
): Promise<Record<string, unknown>> {
  const oauthService = new OAuthService(deps.pool);
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
      deps.claimHandleSecret,
      { providerId: resolved.provider.providerId! },
    ),
    ...toClaimObjectCredential(
      taskId,
      'llm_extra_headers',
      'llm_extra_headers_claim_handle',
      'llm_extra_headers_secret_ref',
      oauthToken.extraHeadersSecret,
      deps.claimHandleSecret,
      { providerId: resolved.provider.providerId! },
    ),
  };
}

async function resolveApiKeyCredentials(
  deps: TaskClaimDependencies,
  tenantId: string,
  taskId: string,
  task: Record<string, unknown>,
  resolved: TaskLLMResolution['resolved'],
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
  const storedSecret = await loadStoredProviderSecret(deps, tenantId, resolved);
  return {
    ...llmFields,
    ...toClaimStringCredential(
      taskId,
      'llm_api_key',
      'llm_api_key_claim_handle',
      'llm_api_key_secret_ref',
      storedSecret,
      deps.claimHandleSecret,
    ),
  };
}

async function loadStoredProviderSecret(
  deps: TaskClaimDependencies,
  tenantId: string,
  resolved: TaskLLMResolution['resolved'],
): Promise<string | null> {
  const providerId = resolved.provider.providerId?.trim();
  if (!providerId || isExternalSecretReference(resolved.provider.apiKeySecretRef ?? '')) {
    return resolved.provider.apiKeySecretRef;
  }
  const result = await deps.pool.query<{ api_key_secret_ref: string | null }>(
    `SELECT api_key_secret_ref
         FROM llm_providers
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1`,
    [tenantId, providerId],
  );
  return result.rows[0]?.api_key_secret_ref ?? resolved.provider.apiKeySecretRef;
}
