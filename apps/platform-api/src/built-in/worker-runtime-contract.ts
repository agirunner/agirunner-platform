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
  pipeline_id: z.string().min(1).optional(),
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

function extractGitToken(resourceBindings: Record<string, unknown>[]): string | undefined {
  for (const binding of resourceBindings) {
    const bindingToken = asNonEmptyString(binding['git_token']);
    if (bindingToken) {
      return bindingToken;
    }

    const credentials = asRecord(binding['credentials']);
    const nestedToken =
      asNonEmptyString(credentials['git_token']) ??
      asNonEmptyString(credentials['token']) ??
      asNonEmptyString(credentials['access_token']);
    if (nestedToken) {
      return nestedToken;
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
}

export function buildRuntimeTaskSubmission(
  task: Record<string, unknown>,
  options: RuntimeTaskSubmissionOptions = {},
): RuntimeTaskSubmission {
  const resourceBindings = asRecordArray(task.resource_bindings);

  const submission = {
    task_id: String(task.id ?? task.task_id ?? ''),
    pipeline_id: asNonEmptyString(task.pipeline_id),
    tenant_id: asNonEmptyString(task.tenant_id),
    role: asNonEmptyString(task.role) ?? 'developer',
    input: asRecord(task.input),
    context_stack: asRecord(task.context_stack ?? task.context),
    upstream_outputs: asRecord(task.upstream_outputs),
    resource_bindings: resourceBindings,
    credentials: {
      llm_api_key: asNonEmptyString(options.llmApiKey),
      llm_provider: asNonEmptyString(options.llmProvider),
      llm_model: asNonEmptyString(options.llmModel),
      git_token: asNonEmptyString(options.gitToken) ?? extractGitToken(resourceBindings),
    },
    role_config: asRecord(task.role_config),
    environment: asRecord(task.environment),
    constraints: asRecord(task.constraints),
  };

  return runtimeTaskSubmissionSchema.parse(submission);
}
