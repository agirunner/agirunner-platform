import { z } from 'zod';

const recordSchema = z.record(z.unknown());

export const internalWorkerBackendSchema = z.enum(['go-runtime']);
export type InternalWorkerBackend = z.infer<typeof internalWorkerBackendSchema>;

export const legacyWorkerRuntimePayloadSchema = z.object({
  task_id: z.string().min(1),
  title: z.string().min(1),
  type: z.string().min(1),
  input: recordSchema.default({}),
  context: recordSchema.default({}),
});

export type LegacyWorkerRuntimePayload = z.infer<typeof legacyWorkerRuntimePayloadSchema>;

export const runtimeTaskSubmissionSchema = z.object({
  task_id: z.string().min(1),
  workflow_id: z.string().min(1).optional(),
  tenant_id: z.string().min(1).optional(),
  role: z.string().min(1),
  input: recordSchema.default({}),
  context_stack: recordSchema.default({}),
  upstream_outputs: recordSchema.default({}),
  resource_bindings: z.array(recordSchema).default([]),
  credentials: z
    .object({
      llm_api_key: z.string().min(1).optional(),
      llm_provider: z.string().min(1).optional(),
      llm_model: z.string().min(1).optional(),
      git_token: z.string().min(1).optional(),
      git_ssh_private_key: z.string().min(1).optional(),
      git_ssh_known_hosts: z.string().min(1).optional(),
    })
    .default({}),
  role_config: recordSchema.default({}),
  environment: recordSchema.default({}),
  constraints: recordSchema.default({}),
});

export type RuntimeTaskSubmission = z.infer<typeof runtimeTaskSubmissionSchema>;

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNonEmptyRawString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return value.trim().length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
    )
    .map((entry) => ({ ...entry }));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  const arrayValue = asStringArray(value);
  if (arrayValue.length > 0) {
    return arrayValue;
  }

  const singleValue = asNonEmptyString(value);
  if (singleValue) {
    return [singleValue];
  }

  return undefined;
}

function extractGitToken(resourceBindings: Record<string, unknown>[]): string | undefined {
  return extractGitCredential(resourceBindings, ['git_token', 'token', 'access_token']);
}

function extractGitCredential(
  resourceBindings: Record<string, unknown>[],
  candidates: string[],
): string | undefined {
  for (const binding of resourceBindings) {
    for (const candidate of candidates) {
      const bindingValue = asNonEmptyString(binding[candidate]);
      if (bindingValue) {
        return bindingValue;
      }
    }

    const credentials = asRecord(binding['credentials']);
    for (const candidate of candidates) {
      const nestedValue = asNonEmptyString(credentials[candidate]);
      if (nestedValue) {
        return nestedValue;
      }
    }
  }
  return undefined;
}

function extractRawGitCredential(
  resourceBindings: Record<string, unknown>[],
  candidates: string[],
): string | undefined {
  for (const binding of resourceBindings) {
    for (const candidate of candidates) {
      const bindingValue = asNonEmptyRawString(binding[candidate]);
      if (bindingValue) {
        return bindingValue;
      }
    }

    const credentials = asRecord(binding['credentials']);
    for (const candidate of candidates) {
      const nestedValue = asNonEmptyRawString(credentials[candidate]);
      if (nestedValue) {
        return nestedValue;
      }
    }
  }
  return undefined;
}

/**
 * @deprecated Stage S4: legacy-node built-in worker path is decommissioned.
 *             Built-in worker execution is Go runtime only.
 */
export function buildLegacyWorkerRuntimePayload(
  _task: Record<string, unknown>,
): LegacyWorkerRuntimePayload {
  throw new Error(
    'legacy-node built-in worker mode has been deprecated and disabled. Use INTERNAL_WORKER_BACKEND=go-runtime.',
  );
}

export interface RuntimeTaskSubmissionOptions {
  llmApiKey?: string;
  llmProvider?: string;
  llmModel?: string;
  gitToken?: string;
  defaultRoleConfigs?: Record<string, Record<string, unknown>>;
}

function resolveTaskDescription(task: Record<string, unknown>, input: Record<string, unknown>): string {
  return (
    asNonEmptyString(input.description) ??
    asNonEmptyString(input.objective) ??
    asNonEmptyString(input.goal) ??
    asNonEmptyString(task.description) ??
    asNonEmptyString(task.title) ??
    'Task execution request'
  );
}

function normalizeRuntimeInput(
  task: Record<string, unknown>,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const acceptanceCriteria =
    asOptionalStringArray(input.acceptance_criteria) ??
    asOptionalStringArray(task.acceptance_criteria) ??
    [];

  return {
    ...input,
    description: resolveTaskDescription(task, input),
    acceptance_criteria: acceptanceCriteria,
  };
}

function mergeRoleConfig(
  role: string,
  taskRoleConfig: Record<string, unknown>,
  defaultRoleConfigs: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const defaults = asRecord(defaultRoleConfigs[role]);
  const merged = {
    ...defaults,
    ...taskRoleConfig,
  };

  const tools =
    asStringArray((merged as Record<string, unknown>).tools).length > 0
      ? asStringArray((merged as Record<string, unknown>).tools)
      : asStringArray(defaults.allowedTools).length > 0
        ? asStringArray(defaults.allowedTools)
        : asStringArray((taskRoleConfig as Record<string, unknown>).allowedTools);

  return {
    ...merged,
    system_prompt:
      asNonEmptyString((merged as Record<string, unknown>).system_prompt) ??
      asNonEmptyString((merged as Record<string, unknown>).systemPrompt) ??
      '',
    tools,
  };
}

export function buildRuntimeTaskSubmission(
  task: Record<string, unknown>,
  options: RuntimeTaskSubmissionOptions = {},
): RuntimeTaskSubmission {
  const resourceBindings = asRecordArray(task.resource_bindings);
  const role = asNonEmptyString(task.role) ?? 'developer';
  const input = asRecord(task.input);
  const inputCredentials = asRecord(input.credentials);
  const mergedRoleConfig = mergeRoleConfig(role, asRecord(task.role_config), options.defaultRoleConfigs ?? {});

  const submission = {
    task_id: String(task.id ?? task.task_id ?? ''),
    workflow_id: asNonEmptyString(task.workflow_id),
    tenant_id: asNonEmptyString(task.tenant_id),
    role,
    input: normalizeRuntimeInput(task, input),
    context_stack: asRecord(task.context_stack ?? task.context),
    upstream_outputs: asRecord(task.upstream_outputs),
    resource_bindings: resourceBindings,
    credentials: {
      llm_api_key: asNonEmptyString(options.llmApiKey),
      llm_provider: asNonEmptyString(options.llmProvider),
      llm_model: asNonEmptyString(options.llmModel),
      git_token:
        asNonEmptyString(options.gitToken) ??
        asNonEmptyString(inputCredentials.git_token) ??
        extractGitToken(resourceBindings),
      git_ssh_private_key:
        asNonEmptyRawString(inputCredentials.git_ssh_private_key) ??
        asNonEmptyRawString(inputCredentials.ssh_private_key) ??
        extractRawGitCredential(resourceBindings, ['git_ssh_private_key', 'ssh_private_key', 'private_key']),
      git_ssh_known_hosts:
        asNonEmptyRawString(inputCredentials.git_ssh_known_hosts) ??
        asNonEmptyRawString(inputCredentials.ssh_known_hosts) ??
        extractRawGitCredential(resourceBindings, ['git_ssh_known_hosts', 'ssh_known_hosts', 'known_hosts']),
    },
    role_config: mergedRoleConfig,
    environment: asRecord(task.environment),
    constraints: asRecord(task.constraints),
  };

  return runtimeTaskSubmissionSchema.parse(submission);
}
