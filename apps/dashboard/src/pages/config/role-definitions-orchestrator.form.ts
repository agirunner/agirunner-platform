import type {
  DashboardPlatformInstructionRecord,
  FleetWorkerRecord,
} from '../../lib/api.js';
import type { LlmModelRecord, ReasoningConfigSchema } from './role-definitions-page.support.js';
import type { RoleAssignmentRecord } from './role-definitions-orchestrator.support.js';

export const ORCHESTRATOR_INHERIT_MODEL = '__inherit__';
export const ORCHESTRATOR_ASSIGNMENT_MODEL = '__assignment__';

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
  replicas: string;
  enabled: boolean;
  modelId: string;
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
  models: LlmModelRecord[] = [],
): OrchestratorPoolDraft {
  const worker = choosePrimaryOrchestratorWorker(workers);
  if (!worker) {
    return {
      workerId: null,
      workerName: 'orchestrator-primary',
      runtimeImage: 'agirunner-runtime:local',
      replicas: '1',
      enabled: true,
      modelId: ORCHESTRATOR_ASSIGNMENT_MODEL,
    };
  }

  return {
    workerId: worker.id,
    workerName: worker.worker_name,
    runtimeImage: worker.runtime_image,
    replicas: String(worker.replicas),
    enabled: worker.enabled,
    modelId: resolveWorkerModelDraftValue(worker, models),
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

const DEFAULT_RUNTIME_IMAGE = 'agirunner-runtime:local';

export function listSuggestedRuntimeImages(workers: FleetWorkerRecord[]): string[] {
  const images = new Set(
    workers
      .filter((worker) => worker.pool_kind === 'orchestrator')
      .map((worker) => worker.runtime_image.trim())
      .filter(Boolean),
  );
  images.add(DEFAULT_RUNTIME_IMAGE);
  return [...images];
}

export function resolveWorkerModelSelection(
  models: LlmModelRecord[],
  modelId: string,
): { llmProvider?: string; llmModel?: string } {
  if (modelId === ORCHESTRATOR_ASSIGNMENT_MODEL) {
    return {};
  }
  const model = models.find((candidate) => candidate.id === modelId) ?? null;
  if (!model) {
    return {};
  }
  return {
    llmProvider: model.provider_name ?? undefined,
    llmModel: model.model_id,
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

function resolveWorkerModelDraftValue(
  worker: FleetWorkerRecord,
  models: LlmModelRecord[],
): string {
  if (!worker.llm_model?.trim()) {
    return ORCHESTRATOR_ASSIGNMENT_MODEL;
  }
  const matchedModel =
    models.find(
      (model) =>
        model.model_id === worker.llm_model &&
        (worker.llm_provider ? model.provider_name === worker.llm_provider : true),
    ) ?? null;
  return matchedModel?.id ?? ORCHESTRATOR_ASSIGNMENT_MODEL;
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
