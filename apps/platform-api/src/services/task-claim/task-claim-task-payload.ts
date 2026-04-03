import {
  isExternalSecretReference,
  readProviderSecret,
} from '../../lib/oauth-crypto.js';
import {
  buildExecutionEnvironmentAgentHint,
  normalizeStringArray,
  type ExecutionEnvironmentSummary,
} from '../execution-environment/contract.js';
import {
  taskAllowsHandoffResolution,
  taskHandoffSatisfiesCompletion,
  taskRequiresStructuredHandoff,
} from '../workflow-task-policy/workflow-task-handoff-policy.js';
import {
  isGitBuiltInToolId,
  isSpecialistSelectableToolId,
  resolveBuiltInToolOwner,
  type ToolOwner,
} from '../tool-tag-service.js';
import {
  claimRoleConfigSecretKeys,
  gitSSHKnownHostsCredentialKeys,
  gitSSHPrivateKeyCredentialKeys,
  gitTokenCredentialKeys,
  specialistOperatorRecordToolIds,
} from './task-claim-constants.js';
import { isRecord } from './task-claim-common.js';
import type {
  ClaimableExecutionEnvironmentRow,
  ResolvedTaskExecutionEnvironment,
  ToolOwnerMap,
} from './task-claim-types.js';

export function buildRuntimeTaskCapabilities(
  task: Record<string, unknown>,
  _instructionContext: Record<string, unknown>,
): Record<string, unknown> {
  const allowsHandoffResolution = taskAllowsHandoffResolution(task);
  const requiresStructuredHandoff = taskRequiresStructuredHandoff(task) || taskInputRequiresStructuredHandoff(task);
  return compactRecord({
    requires_structured_handoff: requiresStructuredHandoff,
    allows_handoff_resolution: allowsHandoffResolution,
    handoff_satisfies_completion: taskHandoffSatisfiesCompletion(task),
    forbidden_mutation_tools: allowsHandoffResolution ? ['file_write', 'file_edit', 'git_commit', 'git_push'] : undefined,
    isolate_shell_exec_workspace: allowsHandoffResolution || undefined,
  });
}

export function readTaskExecutionBackend(task: Record<string, unknown>): 'runtime_only' | 'runtime_plus_task' {
  if (task.execution_backend === 'runtime_only' || task.execution_backend === 'runtime_plus_task') {
    return task.execution_backend;
  }
  return task.is_orchestrator_task === true ? 'runtime_only' : 'runtime_plus_task';
}

export function readNullableFloat(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function compactRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

export function stripClaimSecretEchoes(task: Record<string, unknown>): Record<string, unknown> {
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

export function sanitizeClaimRoleTools(task: Record<string, unknown>): Record<string, unknown> {
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
      tools: appendSpecialistOperatorRecordTools(tools),
    },
  };
}

export function buildToolOwnerContract(task: Record<string, unknown>): ToolOwnerMap {
  const roleConfig = isRecord(task.role_config) ? task.role_config : {};
  const tools = Array.isArray(roleConfig.tools) ? roleConfig.tools : [];
  const entries = tools
    .filter((tool): tool is string => typeof tool === 'string' && tool.trim().length > 0)
    .map((tool) => [tool, resolveBuiltInToolOwner(tool)] as const)
    .filter((entry): entry is readonly [string, ToolOwner] => entry[1] !== null);
  return Object.fromEntries(entries);
}

export function mergeClaimRuntimeBindings(
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

export function buildResolvedTaskExecutionEnvironment(
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

export function attachClaimCredentials(
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

export function hydrateClaimGitCredentials(task: Record<string, unknown>): Record<string, unknown> {
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

function taskInputRequiresStructuredHandoff(task: Record<string, unknown>): boolean {
  const input = isRecord(task.input) ? task.input : null;
  if (!input) {
    return false;
  }
  return Array.isArray(input.handoff_requirements) || Array.isArray(input.final_handoff_requirements);
}

function appendSpecialistOperatorRecordTools(tools: string[]): string[] {
  const merged = [...tools];
  for (const toolId of specialistOperatorRecordToolIds) {
    if (!merged.includes(toolId)) {
      merged.push(toolId);
    }
  }
  return merged;
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
