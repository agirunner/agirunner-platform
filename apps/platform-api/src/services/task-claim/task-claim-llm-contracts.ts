import type { DatabasePool } from '../../db/database.js';
import { ValidationError } from '../../errors/domain-errors.js';
import { isExternalSecretReference } from '../../lib/oauth-crypto.js';
import { RemoteMcpOAuthService } from '../remote-mcp/oauth/remote-mcp-oauth-service.js';
import type { ResolvedRoleConfig } from '../model-catalog/model-catalog-service.js';
import {
  type SpecialistRemoteMcpServerCapability,
  type SpecialistRoleCapabilities,
} from '../specialist-capability-service.js';
import { createClaimCredentialHandle } from './task-claim-credential-handles.js';
import { compactRecord } from './task-claim-task-payload.js';
import { isRecord, resolveNativeSearchMode } from './task-claim-common.js';
import type {
  TaskLLMResolution,
  TaskLoopContract,
} from './task-claim-types.js';

export function buildClaimLLMFields(
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

export function buildExecutionContractLogPayload(input: {
  llmResolution: TaskLLMResolution;
  loopContract: TaskLoopContract;
  executionContainer: {
    image: string;
    cpu: string;
    memory: string;
    pull_policy: 'always' | 'if-not-present' | 'never';
  } | null;
  executionEnvironment: {
    id: string;
    name: string;
    source_kind: 'catalog' | 'custom';
    support_status: 'active' | 'deprecated' | 'blocked' | null;
    compatibility_status: 'compatible' | 'incompatible' | 'unknown';
  } | null;
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

export async function buildRemoteMcpServerContracts(
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
