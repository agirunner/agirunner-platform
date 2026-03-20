import type {
  DashboardPlatformInstructionRecord,
  FleetWorkerRecord,
} from '../../lib/api.js';
import {
  validateContainerCpu,
  validateContainerImage,
  validateContainerMemory,
} from '../../lib/container-resources.validation.js';
import type { ReasoningConfigSchema } from './role-definitions-page.support.js';
import type { RoleAssignmentRecord } from './role-definitions-orchestrator.support.js';
import {
  ORCHESTRATOR_DEFAULT_CPU_LIMIT,
  ORCHESTRATOR_DEFAULT_MEMORY_LIMIT,
  ORCHESTRATOR_DEFAULT_RUNTIME_IMAGE,
} from './role-definitions-orchestrator.defaults.js';

export const ORCHESTRATOR_INHERIT_MODEL = '__inherit__';

export interface OrchestratorPromptDraft {
  content: string;
}

export interface OrchestratorModelDraft {
  modelId: string;
  reasoningConfig: Record<string, unknown> | null;
}

export interface OrchestratorPoolDraft {
  workerId: string | null;
  workerName: string;
  runtimeImage: string;
  cpuLimit: string;
  memoryLimit: string;
  replicas: string;
  enabled: boolean;
}

export function buildOrchestratorPromptDraft(
  instructions: DashboardPlatformInstructionRecord | undefined,
): OrchestratorPromptDraft {
  return { content: instructions?.content ?? '' };
}

export function buildOrchestratorModelDraft(
  assignments: RoleAssignmentRecord[] | undefined,
): OrchestratorModelDraft {
  const assignment = findOrchestratorAssignment(assignments);
  return {
    modelId: assignment?.primary_model_id?.trim() || ORCHESTRATOR_INHERIT_MODEL,
    reasoningConfig: assignment?.reasoning_config ?? null,
  };
}

export function buildOrchestratorPoolDraft(
  workers: FleetWorkerRecord[],
): OrchestratorPoolDraft {
  const worker = choosePrimaryOrchestratorWorker(workers);
  if (!worker) {
    return {
      workerId: null,
      workerName: 'orchestrator-primary',
      runtimeImage: ORCHESTRATOR_DEFAULT_RUNTIME_IMAGE,
      cpuLimit: ORCHESTRATOR_DEFAULT_CPU_LIMIT,
      memoryLimit: ORCHESTRATOR_DEFAULT_MEMORY_LIMIT,
      replicas: '1',
      enabled: true,
    };
  }

  return {
    workerId: worker.id,
    workerName: worker.worker_name,
    runtimeImage: worker.runtime_image,
    cpuLimit: worker.cpu_limit,
    memoryLimit: worker.memory_limit,
    replicas: String(worker.replicas),
    enabled: worker.enabled,
  };
}

export function choosePrimaryOrchestratorWorker(
  workers: FleetWorkerRecord[],
): FleetWorkerRecord | null {
  const orchestratorWorkers = workers.filter((worker) => worker.pool_kind === 'orchestrator');
  if (orchestratorWorkers.length === 0) {
    return null;
  }

  return [...orchestratorWorkers].sort(compareWorkers)[0] ?? null;
}

export function listOrchestratorWorkerOptions(workers: FleetWorkerRecord[]) {
  return workers
    .filter((worker) => worker.pool_kind === 'orchestrator')
    .sort(compareWorkers)
    .map((worker) => ({
      id: worker.id,
      name: worker.worker_name,
      detail: `${worker.enabled ? 'Enabled' : 'Disabled'} · ${worker.replicas} desired replica${worker.replicas === 1 ? '' : 's'}`,
    }));
}

export function listSuggestedRuntimeImages(workers: FleetWorkerRecord[]): string[] {
  const images = new Set(
    workers
      .filter((worker) => worker.pool_kind === 'orchestrator')
      .map((worker) => worker.runtime_image.trim())
      .filter(Boolean),
  );
  images.add(ORCHESTRATOR_DEFAULT_RUNTIME_IMAGE);
  return [...images];
}

export function validateOrchestratorPoolDraft(draft: OrchestratorPoolDraft): {
  runtimeImage?: string;
  cpuLimit?: string;
  memoryLimit?: string;
} {
  const runtimeImageError = validateContainerImage(draft.runtimeImage, 'Runtime image');
  const cpuLimitError = validateContainerCpu(draft.cpuLimit, 'CPU limit');
  const memoryLimitError = validateContainerMemory(draft.memoryLimit, 'Memory limit');

  return {
    ...(runtimeImageError ? { runtimeImage: runtimeImageError } : {}),
    ...(cpuLimitError ? { cpuLimit: cpuLimitError } : {}),
    ...(memoryLimitError ? { memoryLimit: memoryLimitError } : {}),
  };
}

export function extractReasoningValue(
  schema: ReasoningConfigSchema | null | undefined,
  config: Record<string, unknown> | null | undefined,
): string | number | null {
  if (!schema || !config) {
    return null;
  }
  const value = config[schema.type];
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

export function buildReasoningConfig(
  schema: ReasoningConfigSchema,
  value: string | number,
): Record<string, unknown> {
  return { [schema.type]: value };
}

function findOrchestratorAssignment(
  assignments: RoleAssignmentRecord[] | undefined,
): RoleAssignmentRecord | null {
  return (
    assignments?.find((assignment) => assignment.role_name.trim().toLowerCase() === 'orchestrator') ??
    null
  );
}

function compareWorkers(left: FleetWorkerRecord, right: FleetWorkerRecord): number {
  if (left.enabled !== right.enabled) {
    return left.enabled ? -1 : 1;
  }
  if (left.replicas !== right.replicas) {
    return right.replicas - left.replicas;
  }
  return left.worker_name.localeCompare(right.worker_name);
}
