import type {
  DashboardLlmModelRecord,
  DashboardPlatformInstructionRecord,
  FleetStatusResponse,
  FleetWorkerRecord,
} from '../../lib/api.js';

export interface SystemDefaultRecord {
  modelId: string | null;
  reasoningConfig: Record<string, unknown> | null;
}

export interface RoleAssignmentRecord {
  role_name: string;
  primary_model_id?: string | null;
  reasoning_config?: Record<string, unknown> | null;
}

export interface OrchestratorPromptSummary {
  statusLabel: string;
  versionLabel: string;
  excerpt: string;
}

export interface OrchestratorModelSummary {
  modelLabel: string;
  reasoningLabel: string;
  sourceLabel: string;
}

export interface OrchestratorPoolSummary {
  desiredWorkers: number;
  desiredReplicas: number;
  enabledWorkers: number;
  runningContainers: number;
  runtimeLabel: string;
  modelLabel: string;
}

const EMPTY_MODEL_SUMMARY: OrchestratorModelSummary = {
  modelLabel: 'Use system default',
  reasoningLabel: 'No explicit reasoning profile',
  sourceLabel: 'System default',
};

export function summarizeOrchestratorPrompt(
  instructions: DashboardPlatformInstructionRecord | undefined,
): OrchestratorPromptSummary {
  const content = instructions?.content?.trim() ?? '';
  if (!content) {
    return {
      statusLabel: 'No active prompt',
      versionLabel: 'Draft needed',
      excerpt: 'Write the baseline orchestration instructions here before activating new workflows.',
    };
  }

  return {
    statusLabel: 'Prompt configured',
    versionLabel: `v${instructions?.version ?? 0}`,
    excerpt:
      content.length > 160
        ? `${content.slice(0, 157).trimEnd()}...`
        : content,
  };
}

export function summarizeOrchestratorModel(
  assignments: RoleAssignmentRecord[] | undefined,
  systemDefault: SystemDefaultRecord | undefined,
  models: DashboardLlmModelRecord[],
): OrchestratorModelSummary {
  const orchestratorAssignment = assignments?.find(
    (assignment) => assignment.role_name.trim().toLowerCase() === 'orchestrator',
  );
  const selectedModelId =
    orchestratorAssignment?.primary_model_id?.trim() || systemDefault?.modelId?.trim() || '';
  const matchedModel = findModel(models, selectedModelId);
  const reasoningConfig =
    orchestratorAssignment?.reasoning_config ?? systemDefault?.reasoningConfig ?? null;

  if (!selectedModelId) {
    return EMPTY_MODEL_SUMMARY;
  }

  return {
    modelLabel: matchedModel
      ? `${matchedModel.model_id}${matchedModel.provider_name ? ` (${matchedModel.provider_name})` : ''}`
      : selectedModelId,
    reasoningLabel: summarizeReasoningConfig(reasoningConfig),
    sourceLabel:
      orchestratorAssignment?.primary_model_id || orchestratorAssignment?.reasoning_config
        ? 'Orchestrator override'
        : 'System default',
  };
}

export function summarizeOrchestratorPool(
  status: FleetStatusResponse | undefined,
  workers: FleetWorkerRecord[] | undefined,
): OrchestratorPoolSummary {
  const pool = status?.worker_pools.find((entry) => entry.pool_kind === 'orchestrator');
  const orchestratorWorkers = (workers ?? []).filter((worker) => worker.pool_kind === 'orchestrator');
  const runtimeImages = uniqueCompact(orchestratorWorkers.map((worker) => worker.runtime_image));
  const modelPins = uniqueCompact(orchestratorWorkers.map((worker) => worker.llm_model));

  return {
    desiredWorkers: pool?.desired_workers ?? orchestratorWorkers.length,
    desiredReplicas: pool?.desired_replicas ?? orchestratorWorkers.reduce((sum, worker) => sum + worker.replicas, 0),
    enabledWorkers:
      pool?.enabled_workers ?? orchestratorWorkers.filter((worker) => worker.enabled).length,
    runningContainers:
      pool?.running_containers ??
      orchestratorWorkers.reduce((sum, worker) => sum + worker.actual.length, 0),
    runtimeLabel: runtimeImages.length > 0 ? runtimeImages.join(', ') : 'Use worker desired state',
    modelLabel: modelPins.length > 0 ? modelPins.join(', ') : 'Inherited from LLM assignments',
  };
}

export function summarizeReasoningConfig(
  config: Record<string, unknown> | null | undefined,
): string {
  if (!config || Object.keys(config).length === 0) {
    return 'No explicit reasoning profile';
  }

  const [firstKey] = Object.keys(config);
  const value = config[firstKey];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return `${firstKey}: ${String(value)}`;
  }
  return `${firstKey} configured`;
}

function findModel(
  models: DashboardLlmModelRecord[],
  selectedModelId: string,
): DashboardLlmModelRecord | null {
  if (!selectedModelId) {
    return null;
  }

  return (
    models.find((model) => model.id === selectedModelId) ??
    models.find((model) => model.model_id === selectedModelId) ??
    null
  );
}

function uniqueCompact(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
}
