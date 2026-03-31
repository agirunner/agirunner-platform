import { ConflictError, ValidationError } from '../../errors/domain-errors.js';
import { areJsonValuesEquivalent } from '../json-equivalence.js';
import { resolveWorkspaceStorageBinding, buildGitRemoteResourceBindings } from '../workspace-storage.js';
import {
  PLATFORM_CONTROL_PLANE_IDEMPOTENT_MUTATION_REPLAY_ID,
  mustGetSafetynetEntry,
} from '../safetynet/registry.js';
import { logSafetynetTriggered } from '../safetynet/logging.js';
import type { CreateTaskInput } from '../task-service.types.js';

export const DEFAULT_REPOSITORY_TASK_TEMPLATE = 'execution-workspace';
const secretLikeKeyPattern = /(secret|token|password|api[_-]?key|credential|authorization|private[_-]?key|known_hosts)/i;
const IDEMPOTENT_MUTATION_REPLAY_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_CONTROL_PLANE_IDEMPOTENT_MUTATION_REPLAY_ID,
);

export function resolveTaskExecutionBackend(input: CreateTaskInput): 'runtime_only' | 'runtime_plus_task' {
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

export function mergeWorkspaceStorageBindings(
  bindings: Record<string, unknown>[],
  storage: ReturnType<typeof resolveWorkspaceStorageBinding>,
): Record<string, unknown>[] {
  const nonGitBindings = bindings.filter((binding) => !isGitRepositoryBinding(binding));
  return [
    ...nonGitBindings,
    ...buildGitRemoteResourceBindings(storage),
  ];
}

export function normalizeResourceBindings(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
}

export function isGitRepositoryBinding(binding: Record<string, unknown>): boolean {
  return asNullableString(binding.type) === 'git_repository';
}

export function stripWorkspaceStorageOverrides(
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

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeTaskContractInput(input: CreateTaskInput): CreateTaskInput {
  const taskKind = resolveTaskKind(input);
  const persistedTaskKind = shouldPersistTaskKind(input, taskKind) ? taskKind : undefined;
  assertTaskKindIsValidForInput(taskKind, input);
  const normalizedRoleConfig = normalizeTaskRoleConfig(input);
  return {
    ...input,
    task_kind: persistedTaskKind,
    role_config: normalizedRoleConfig,
    input: mergeSubjectLinkageIntoInput(input),
  };
}

export function normalizeTaskRoleConfig(
  input: CreateTaskInput,
): Record<string, unknown> | undefined {
  const roleConfig = asRecord(input.role_config);
  if (Object.keys(roleConfig).length === 0) {
    return undefined;
  }
  const {
    llm_provider: _llmProvider,
    llm_model: _llmModel,
    llm_reasoning_config: _llmReasoningConfig,
    ...rest
  } = roleConfig;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

export function resolveTaskKind(input: CreateTaskInput): NonNullable<CreateTaskInput['task_kind']> {
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

export function shouldPersistTaskKind(
  input: CreateTaskInput,
  taskKind: NonNullable<CreateTaskInput['task_kind']>,
) {
  return input.task_kind !== undefined || taskKind === 'orchestrator' || taskKind === 'assessment' || taskKind === 'approval';
}

export function assertTaskKindIsValidForInput(
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

export function mergeSubjectLinkageIntoInput(input: CreateTaskInput): Record<string, unknown> {
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

export function selectPersistedSubjectLinkage(input: CreateTaskInput): Record<string, unknown> {
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

export function readOptionalSubjectString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function readOptionalPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

export function isClosedPlannedStage(workItem: LinkedWorkItemRow) {
  if (workItem.workflow_lifecycle !== 'planned') {
    return false;
  }
  return workItem.stage_status === 'completed' || workItem.stage_gate_status === 'approved';
}

export function findNextStageForRole(
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

export function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function asNullableNumber(value: unknown): number | null {
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

export function buildExpectedCreateTaskReplay(
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

export function buildExpectedCreateTaskIntent(
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

export function assertMatchingCreateTaskReplay(
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

export function matchesCreateTaskIntent(
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

export function hasMatchingCreateMetadata(
  existing: Record<string, unknown>,
  expected: Record<string, unknown>,
) {
  return Object.entries(expected).every(([key, value]) => areJsonValuesEquivalent(existing[key], value));
}

export function selectReplayStableMetadata(metadata: Record<string, unknown>) {
  const stable: Record<string, unknown> = {};
  for (const key of ['branch_id', 'lifecycle_policy', 'task_type', 'task_kind', 'credential_refs', 'assessment_prompt']) {
    if (key in metadata) {
      stable[key] = metadata[key];
    }
  }
  return stable;
}

export function selectIntentStableMetadata(metadata: Record<string, unknown>) {
  const stable = selectReplayStableMetadata(metadata);
  for (const key of ['description', 'parent_id']) {
    if (key in metadata) {
      stable[key] = metadata[key];
    }
  }
  return stable;
}

export function assertNoPlaintextSecrets(scope: string, sections: Record<string, unknown>) {
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

export function collectPlaintextSecretPaths(
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

export function isAllowedSecretReference(value: string): boolean {
  const normalized = value.trim();
  return normalized.startsWith('secret:') || normalized.startsWith('redacted://');
}

export function isSecretLikeKey(key: string): boolean {
  return secretLikeKeyPattern.test(key);
}

export function stripRedactedTaskSecretPlaceholders<T>(value: T): T {
  const sanitized = stripRedactedSecretPlaceholders(value, false);
  return (sanitized ?? value) as T;
}

export function stripRedactedSecretPlaceholders(value: unknown, inheritedSecret: boolean): unknown {
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

export function isRedactedSecretPlaceholder(value: string): boolean {
  return value.trim().startsWith('redacted://');
}
