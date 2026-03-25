import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dashboardApi } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { ORCHESTRATOR_INHERIT_MODEL } from './role-definitions-orchestrator.form.js';
import {
  ORCHESTRATOR_DEFAULT_CPU_LIMIT,
  ORCHESTRATOR_DEFAULT_MEMORY_LIMIT,
  ORCHESTRATOR_DEFAULT_RUNTIME_IMAGE,
} from './role-definitions-orchestrator.defaults.js';
import {
  summarizeOrchestratorModel,
  summarizeOrchestratorPool,
  summarizeOrchestratorPrompt,
  summarizeOrchestratorReadiness,
} from './role-definitions-orchestrator.support.js';
import {
  fetchAssignments,
  fetchModels,
  fetchProviders,
  fetchSystemDefault,
  updateAssignment,
} from './role-definitions-page.api.js';

export function useRolePageOrchestratorState() {
  const queryClient = useQueryClient();
  const providersQuery = useQuery({ queryKey: ['llm-providers'], queryFn: fetchProviders });
  const modelsQuery = useQuery({ queryKey: ['llm-models'], queryFn: fetchModels });
  const orchestratorConfigQuery = useQuery({
    queryKey: ['orchestrator-config'],
    queryFn: () => dashboardApi.getOrchestratorConfig(),
  });
  const systemDefaultQuery = useQuery({
    queryKey: ['llm-system-default', 'roles-page'],
    queryFn: fetchSystemDefault,
  });
  const assignmentsQuery = useQuery({
    queryKey: ['llm-assignments', 'roles-page'],
    queryFn: fetchAssignments,
  });
  const fleetStatusQuery = useQuery({
    queryKey: ['fleet-status', 'roles-page'],
    queryFn: () => dashboardApi.fetchFleetStatus(),
  });
  const fleetWorkersQuery = useQuery({
    queryKey: ['fleet-workers', 'roles-page'],
    queryFn: () => dashboardApi.fetchFleetWorkers(),
  });

  const promptMutation = useMutation({
    mutationFn: async (content: string) =>
      dashboardApi.updateOrchestratorConfig({ prompt: content }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['orchestrator-config'], updated);
      toast.success('Saved orchestrator prompt.');
    },
    onError: (error) => {
      const message =
        error instanceof Error ? error.message : 'Failed to save orchestrator prompt.';
      toast.error(message);
    },
  });
  const modelMutation = useMutation({
    mutationFn: async (input: {
      modelId: string;
      reasoningConfig: Record<string, unknown> | null;
    }) =>
      updateAssignment('orchestrator', {
        primaryModelId: input.modelId === ORCHESTRATOR_INHERIT_MODEL ? undefined : input.modelId,
        reasoningConfig:
          input.modelId === ORCHESTRATOR_INHERIT_MODEL ? null : input.reasoningConfig,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['llm-assignments'] });
      toast.success('Saved orchestrator model routing.');
    },
    onError: (error) => {
      const message =
        error instanceof Error ? error.message : 'Failed to save orchestrator model routing.';
      toast.error(message);
    },
  });
  const poolMutation = useMutation({
    mutationFn: async (input: {
      workerId: string | null;
      workerName: string;
      runtimeImage: string;
      cpuLimit: string;
      memoryLimit: string;
      replicas: number;
      enabled: boolean;
    }) => {
      const workerName = input.workerName.trim();
      const runtimeImage = input.runtimeImage.trim() || ORCHESTRATOR_DEFAULT_RUNTIME_IMAGE;
      const cpuLimit = input.cpuLimit.trim() || ORCHESTRATOR_DEFAULT_CPU_LIMIT;
      const memoryLimit = input.memoryLimit.trim() || ORCHESTRATOR_DEFAULT_MEMORY_LIMIT;
      if (!workerName) {
        throw new Error('Enter an agent name for the orchestrator pool entry.');
      }
      const payload = {
        role: 'orchestrator',
        poolKind: 'orchestrator' as const,
        runtimeImage,
        cpuLimit,
        memoryLimit,
        replicas: input.replicas,
        enabled: input.enabled,
      };
      if (input.workerId) {
        return dashboardApi.updateFleetWorker(input.workerId, payload);
      }
      return dashboardApi.createFleetWorker({
        workerName,
        ...payload,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fleet-workers'] });
      await queryClient.invalidateQueries({ queryKey: ['fleet-status'] });
      toast.success('Saved orchestrator pool posture.');
    },
    onError: (error) => {
      const message =
        error instanceof Error ? error.message : 'Failed to save orchestrator pool posture.';
      toast.error(message);
    },
  });

  const models = modelsQuery.data ?? [];
  const workers = fleetWorkersQuery.data ?? [];
  const modelCatalogError =
    modelsQuery.error || providersQuery.error
      ? String(modelsQuery.error ?? providersQuery.error)
      : null;
  const promptSummary = summarizeOrchestratorPrompt(orchestratorConfigQuery.data);
  const modelSummary = summarizeOrchestratorModel(
    assignmentsQuery.data,
    systemDefaultQuery.data,
    models,
  );
  const poolSummary = summarizeOrchestratorPool(fleetStatusQuery.data, workers);

  return {
    roleDialogCatalog: {
      providers: providersQuery.data ?? [],
      models,
      systemDefault: systemDefaultQuery.data,
      assignments: assignmentsQuery.data ?? [],
      isModelCatalogLoading: providersQuery.isLoading || modelsQuery.isLoading,
      modelCatalogError,
    },
    controlPlaneProps: {
      promptSummary,
      modelSummary,
      poolSummary,
      readiness: summarizeOrchestratorReadiness(promptSummary, modelSummary, poolSummary),
      orchestratorConfig: orchestratorConfigQuery.data,
      assignments: assignmentsQuery.data,
      systemDefault: systemDefaultQuery.data,
      models,
      workers,
      isLoading: [
        orchestratorConfigQuery,
        systemDefaultQuery,
        assignmentsQuery,
        fleetStatusQuery,
        fleetWorkersQuery,
      ].some((query) => query.isLoading),
      hasError: [
        orchestratorConfigQuery,
        systemDefaultQuery,
        assignmentsQuery,
        fleetStatusQuery,
        fleetWorkersQuery,
      ].some((query) => query.isError),
      isPromptSaving: promptMutation.isPending,
      isModelSaving: modelMutation.isPending,
      isPoolSaving: poolMutation.isPending,
      onSavePrompt: (content: string) => promptMutation.mutateAsync(content),
      onSaveModel: (input: {
        modelId: string;
        reasoningConfig: Record<string, unknown> | null;
      }) => modelMutation.mutateAsync(input),
      onSavePool: (input: {
        workerId: string | null;
        workerName: string;
        runtimeImage: string;
        cpuLimit: string;
        memoryLimit: string;
        replicas: number;
        enabled: boolean;
      }) => poolMutation.mutateAsync(input),
    },
  };
}
