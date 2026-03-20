import type {
  DashboardLlmModelRecord,
  DashboardLlmProviderRecord,
  FleetWorkerRecord,
} from '../../lib/api.js';
import {
  validateContainerCpu,
  validateContainerImage,
  validateContainerMemory,
} from '../../lib/container-resources.validation.js';

export type PoolKind = 'orchestrator' | 'specialist';
export type NetworkPolicy = 'restricted' | 'open';

export interface WorkerEnvironmentEntry {
  id: string;
  key: string;
  value: string;
}

export interface WorkerDesiredStateFormValues {
  workerName: string;
  role: string;
  poolKind: PoolKind;
  runtimeImage: string;
  cpuLimit: string;
  memoryLimit: string;
  networkPolicy: NetworkPolicy;
  environmentEntries: WorkerEnvironmentEntry[];
  llmProvider: string;
  llmModel: string;
  llmApiKeySecretRef: string;
  replicas: string;
  enabled: boolean;
}

export interface WorkerDesiredStateValidationErrors {
  workerName?: string;
  role?: string;
  runtimeImage?: string;
  cpuLimit?: string;
  memoryLimit?: string;
  replicas?: string;
}

export const POOL_KIND_OPTIONS: Array<{ value: PoolKind; label: string }> = [
  { value: 'orchestrator', label: 'Orchestrator pool' },
  { value: 'specialist', label: 'Specialist pool' },
];

export const NETWORK_POLICY_OPTIONS: Array<{
  value: NetworkPolicy;
  label: string;
  description: string;
}> = [
  {
    value: 'restricted',
    label: 'Restricted',
    description: 'Only allowed egress is permitted. Use this for normal production workers.',
  },
  {
    value: 'open',
    label: 'Open',
    description: 'Unrestricted outbound access. Use only when the role genuinely requires it.',
  },
];

function blankEnvironmentEntry(id: string): WorkerEnvironmentEntry {
  return { id, key: '', value: '' };
}

function nextEntryId(index: number): string {
  return `env-${index + 1}`;
}

export function inferPoolKindFromRole(role: string): PoolKind {
  return role.toLowerCase().includes('orchestrator') ? 'orchestrator' : 'specialist';
}

export function formatEnvironmentValue(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function buildEnvironmentEntries(
  environment: Record<string, unknown>,
): WorkerEnvironmentEntry[] {
  const entries = Object.entries(environment).map(([key, value], index) => ({
    id: nextEntryId(index),
    key,
    value: formatEnvironmentValue(value),
  }));
  return entries.length > 0 ? entries : [blankEnvironmentEntry(nextEntryId(0))];
}

export function buildEnvironmentRecord(entries: WorkerEnvironmentEntry[]): Record<string, string> {
  return entries.reduce<Record<string, string>>((result, entry) => {
    const key = entry.key.trim();
    if (!key) {
      return result;
    }
    result[key] = entry.value;
    return result;
  }, {});
}

export function createBlankWorkerFormValues(): WorkerDesiredStateFormValues {
  return {
    workerName: '',
    role: '',
    poolKind: 'specialist',
    runtimeImage: '',
    cpuLimit: '2',
    memoryLimit: '2g',
    networkPolicy: 'restricted',
    environmentEntries: [blankEnvironmentEntry(nextEntryId(0))],
    llmProvider: '',
    llmModel: '',
    llmApiKeySecretRef: '',
    replicas: '1',
    enabled: true,
  };
}

export function buildWorkerFormValues(
  worker?: FleetWorkerRecord | null,
): WorkerDesiredStateFormValues {
  if (!worker) {
    return createBlankWorkerFormValues();
  }
  return {
    workerName: worker.worker_name,
    role: worker.role,
    poolKind: worker.pool_kind,
    runtimeImage: worker.runtime_image,
    cpuLimit: worker.cpu_limit,
    memoryLimit: worker.memory_limit,
    networkPolicy: normalizeNetworkPolicy(worker.network_policy),
    environmentEntries: buildEnvironmentEntries(worker.environment),
    llmProvider: worker.llm_provider ?? '',
    llmModel: worker.llm_model ?? '',
    llmApiKeySecretRef: '',
    replicas: String(worker.replicas),
    enabled: worker.enabled,
  };
}

export function normalizeNetworkPolicy(value: string | null | undefined): NetworkPolicy {
  return value === 'open' ? 'open' : 'restricted';
}

export function listModelsForProvider(
  models: DashboardLlmModelRecord[],
  provider: DashboardLlmProviderRecord | null,
): DashboardLlmModelRecord[] {
  if (!provider) {
    return [];
  }
  return models.filter(
    (model) =>
      model.is_enabled !== false &&
      (model.provider_id === provider.id || model.provider_name === provider.name),
  );
}

export function listSuggestedWorkerRoles(workers: FleetWorkerRecord[]): string[] {
  return [...new Set(workers.map((worker) => worker.role.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function addEnvironmentEntry(entries: WorkerEnvironmentEntry[]): WorkerEnvironmentEntry[] {
  return [...entries, blankEnvironmentEntry(nextEntryId(entries.length))];
}

export function removeEnvironmentEntry(
  entries: WorkerEnvironmentEntry[],
  entryId: string,
): WorkerEnvironmentEntry[] {
  const next = entries.filter((entry) => entry.id !== entryId);
  return next.length > 0 ? next : [blankEnvironmentEntry(nextEntryId(0))];
}

export function updateEnvironmentEntry(
  entries: WorkerEnvironmentEntry[],
  entryId: string,
  patch: Partial<Pick<WorkerEnvironmentEntry, 'key' | 'value'>>,
): WorkerEnvironmentEntry[] {
  return entries.map((entry) => (entry.id === entryId ? { ...entry, ...patch } : entry));
}

export function buildCreateWorkerPayload(values: WorkerDesiredStateFormValues): {
  workerName: string;
  role: string;
  poolKind: PoolKind;
  runtimeImage: string;
  cpuLimit: string;
  memoryLimit: string;
  networkPolicy: NetworkPolicy;
  environment: Record<string, string>;
  llmProvider?: string;
  llmModel?: string;
  llmApiKeySecretRef?: string;
  replicas: number;
  enabled: boolean;
} {
  return {
    workerName: values.workerName.trim(),
    role: values.role.trim(),
    poolKind: values.poolKind,
    runtimeImage: values.runtimeImage.trim(),
    cpuLimit: values.cpuLimit.trim(),
    memoryLimit: values.memoryLimit.trim(),
    networkPolicy: values.networkPolicy,
    environment: buildEnvironmentRecord(values.environmentEntries),
    llmProvider: values.llmProvider.trim() || undefined,
    llmModel: values.llmModel.trim() || undefined,
    llmApiKeySecretRef: values.llmApiKeySecretRef.trim() || undefined,
    replicas: Math.max(1, Number.parseInt(values.replicas, 10) || 1),
    enabled: values.enabled,
  };
}

export function buildUpdateWorkerPayload(values: WorkerDesiredStateFormValues): {
  role: string;
  poolKind: PoolKind;
  runtimeImage: string;
  cpuLimit: string;
  memoryLimit: string;
  networkPolicy: NetworkPolicy;
  environment: Record<string, string>;
  llmProvider?: string;
  llmModel?: string;
  llmApiKeySecretRef?: string;
  replicas: number;
  enabled: boolean;
} {
  return {
    role: values.role.trim(),
    poolKind: values.poolKind,
    runtimeImage: values.runtimeImage.trim(),
    cpuLimit: values.cpuLimit.trim(),
    memoryLimit: values.memoryLimit.trim(),
    networkPolicy: values.networkPolicy,
    environment: buildEnvironmentRecord(values.environmentEntries),
    llmProvider: values.llmProvider.trim() || undefined,
    llmModel: values.llmModel.trim() || undefined,
    llmApiKeySecretRef: values.llmApiKeySecretRef.trim() || undefined,
    replicas: Math.max(1, Number.parseInt(values.replicas, 10) || 1),
    enabled: values.enabled,
  };
}

export function validateWorkerDesiredState(
  values: WorkerDesiredStateFormValues,
): WorkerDesiredStateValidationErrors {
  const errors: WorkerDesiredStateValidationErrors = {};

  if (!values.workerName.trim()) {
    errors.workerName = 'Enter a worker name so operators can target this desired state.';
  }
  if (!values.role.trim()) {
    errors.role = 'Enter the worker role that this desired state should service.';
  }
  if (!values.runtimeImage.trim()) {
    errors.runtimeImage = 'Provide the runtime image that should be deployed for this worker.';
  }
  const imageError = validateContainerImage(values.runtimeImage, 'Runtime image');
  if (imageError) {
    errors.runtimeImage = imageError;
  }
  const cpuError = validateContainerCpu(values.cpuLimit, 'CPU limit');
  if (cpuError) {
    errors.cpuLimit = cpuError;
  }
  const memoryError = validateContainerMemory(values.memoryLimit, 'Memory limit');
  if (memoryError) {
    errors.memoryLimit = memoryError;
  }

  const replicas = Number.parseInt(values.replicas, 10);
  if (!Number.isFinite(replicas) || replicas < 1) {
    errors.replicas = 'Desired replicas must be at least 1.';
  }

  return errors;
}

export function formatCapacityDelta(desired: number, actual: number): string {
  if (desired === actual) {
    return 'Capacity aligned';
  }
  if (actual < desired) {
    return `${desired - actual} replica${desired - actual === 1 ? '' : 's'} below target`;
  }
  return `${actual - desired} extra replica${actual - desired === 1 ? '' : 's'} still running`;
}
