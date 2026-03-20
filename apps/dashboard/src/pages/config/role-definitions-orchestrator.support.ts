import type {
  DashboardLlmModelRecord,
  FleetStatusResponse,
  FleetWorkerRecord,
} from '../../lib/api.js';
import {
  ORCHESTRATOR_DEFAULT_CPU_LIMIT,
  ORCHESTRATOR_DEFAULT_MEMORY_LIMIT,
  ORCHESTRATOR_DEFAULT_RUNTIME_IMAGE,
} from './role-definitions-orchestrator.defaults.js';

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
  resourceLabel: string;
  modelLabel: string;
}

export interface OrchestratorControlIssue {
  id: 'prompt' | 'model' | 'pool';
  title: string;
  detail: string;
}

export interface OrchestratorControlReadiness {
  headline: string;
  detail: string;
  issues: OrchestratorControlIssue[];
  isReady: boolean;
}

export interface OrchestratorControlSurface {
  id: 'prompt' | 'model' | 'pool' | 'specialists';
  title: string;
  summary: string;
  detail: string;
  href: string;
  label: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}

const EMPTY_MODEL_SUMMARY: OrchestratorModelSummary = {
  modelLabel: 'Use system default',
  reasoningLabel: 'No explicit reasoning profile',
  sourceLabel: 'System default',
};

export function summarizeOrchestratorPrompt(
  config: { prompt: string; updatedAt: string } | undefined,
): OrchestratorPromptSummary {
  const content = config?.prompt?.trim() ?? '';
  if (!content) {
    return {
      statusLabel: 'No active prompt',
      versionLabel: 'Not configured',
      excerpt: 'Define how the orchestrator should manage workflows before activating new runs.',
    };
  }

  return {
    statusLabel: 'Prompt configured',
    versionLabel: `${content.length} chars`,
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
  const cpuLimits = uniqueCompact(orchestratorWorkers.map((worker) => worker.cpu_limit));
  const memoryLimits = uniqueCompact(orchestratorWorkers.map((worker) => worker.memory_limit));

  return {
    desiredWorkers: pool?.desired_workers ?? orchestratorWorkers.length,
    desiredReplicas: pool?.desired_replicas ?? orchestratorWorkers.reduce((sum, worker) => sum + worker.replicas, 0),
    enabledWorkers:
      pool?.enabled_workers ?? orchestratorWorkers.filter((worker) => worker.enabled).length,
    runningContainers:
      pool?.running_containers ??
      orchestratorWorkers.reduce((sum, worker) => sum + worker.actual.length, 0),
    runtimeLabel:
      runtimeImages.length > 0 ? runtimeImages.join(', ') : ORCHESTRATOR_DEFAULT_RUNTIME_IMAGE,
    resourceLabel: summarizeResourceLabel(cpuLimits, memoryLimits),
    modelLabel: modelPins.length > 0 ? modelPins.join(', ') : 'Inherited from LLM assignments',
  };
}

function summarizeResourceLabel(cpuLimits: string[], memoryLimits: string[]): string {
  const cpuLabel =
    cpuLimits.length === 0
      ? ORCHESTRATOR_DEFAULT_CPU_LIMIT
      : cpuLimits.length === 1
        ? cpuLimits[0]
        : 'Mixed';
  const memoryLabel =
    memoryLimits.length === 0
      ? ORCHESTRATOR_DEFAULT_MEMORY_LIMIT
      : memoryLimits.length === 1
        ? memoryLimits[0]
        : 'Mixed';
  return `${cpuLabel} CPU · ${memoryLabel} memory`;
}

export function summarizeOrchestratorReadiness(
  prompt: OrchestratorPromptSummary,
  model: OrchestratorModelSummary,
  pool: OrchestratorPoolSummary,
): OrchestratorControlReadiness {
  const issues: OrchestratorControlIssue[] = [];

  if (prompt.statusLabel === 'No active prompt') {
    issues.push({
      id: 'prompt',
      title: 'Add the orchestrator baseline prompt.',
      detail: 'Operators should activate a platform-instructions version before new workflows depend on orchestration decisions.',
    });
  }

  if (model.modelLabel === EMPTY_MODEL_SUMMARY.modelLabel) {
    issues.push({
      id: 'model',
      title: 'Assign an orchestrator model.',
      detail: 'Choose a system default or orchestrator override so the control plane does not rely on an unset model route.',
    });
  }

  if (pool.enabledWorkers === 0 || pool.desiredWorkers === 0 || pool.desiredReplicas === 0) {
    issues.push({
      id: 'pool',
      title: 'Enable the orchestrator worker pool.',
      detail: 'Set at least one enabled worker with desired replicas so orchestrator tasks have capacity to run.',
    });
  } else if (pool.runningContainers === 0) {
    issues.push({
      id: 'pool',
      title: 'Review orchestrator pool capacity.',
      detail: 'Workers are configured but no orchestrator containers are running yet. Confirm the pool can actually start work.',
    });
  }

  if (issues.length === 0) {
    return {
      headline: 'Ready',
      detail: 'Prompt, model, and pool are configured.',
      issues,
      isReady: true,
    };
  }

  return {
    headline: 'Needs attention',
    detail: 'Resolve these orchestrator setup blockers before relying on this control plane for live workflows.',
    issues,
    isReady: false,
  };
}

export function summarizeOrchestratorControlSurfaces(
  prompt: OrchestratorPromptSummary,
  model: OrchestratorModelSummary,
  pool: OrchestratorPoolSummary,
): OrchestratorControlSurface[] {
  return [
    {
      id: 'prompt',
      title: 'Prompt baseline',
      summary: prompt.versionLabel,
      detail:
        prompt.statusLabel === 'No active prompt'
          ? 'Platform instructions define orchestrator tone, review posture, and stall recovery before any run starts.'
          : 'Platform instructions own the orchestrator baseline for delegation, recovery, and review language.',
      href: '/config/instructions',
      label: 'Open prompt settings',
    },
    {
      id: 'model',
      title: 'Model routing',
      summary: model.modelLabel,
      detail: `${model.sourceLabel} · ${model.reasoningLabel}`,
      href: '/config/llm',
      label: 'Open model routing',
    },
    {
      id: 'pool',
      title: 'Pool and runtime',
      summary: `${pool.enabledWorkers} enabled / ${pool.desiredReplicas} desired replicas`,
      detail: `Orchestrator posture owns the primary worker runtime image and capacity. Runtime defaults control the shared specialist execution envelope and safeguards.`,
      href: '/config/orchestrator',
      label: 'Open orchestrator',
      secondaryHref: '/config/runtimes',
      secondaryLabel: 'Open runtime defaults',
    },
    {
      id: 'specialists',
      title: 'Specialist prompts and escalation',
      summary: 'Managed in the role catalog below',
      detail:
        'Role prompts, tool grants, verification strategy, fallback routing, and escalation targets are edited on this page in the specialist role editor.',
      href: '#specialist-role-catalog',
      label: 'Jump to role catalog',
    },
  ];
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
    return `Reasoning: ${String(value)}`;
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
