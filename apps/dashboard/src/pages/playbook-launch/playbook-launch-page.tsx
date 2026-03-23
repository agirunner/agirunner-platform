import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../../lib/api.js';
import {
  buildWorkflowBudgetInput,
  createWorkflowBudgetDraft,
  readLaunchDefinition,
  validateLaunchDraft,
  type RoleOverrideDraft,
  type StructuredEntryDraft,
  type WorkflowBudgetDraft,
} from './playbook-launch-support.js';
import {
  validateRoleOverrideDrafts,
  validateStructuredEntries,
} from './playbook-launch-entry-validation.js';
import { usePlaybookLaunchPageEffects } from './playbook-launch-page.effects.js';
import { usePlaybookLaunchMutation } from './playbook-launch-page.mutation.js';
import { PlaybookLaunchForm } from './playbook-launch-form.js';
import {
  countConfiguredWorkflowOverrides,
  readWorkflowOverrides,
} from './playbook-launch-overrides.js';
import {
  countConfiguredWorkflowConfigOverrides,
  haveSameInstructionLayers,
  readWorkflowPolicyDefinition,
  summarizeInstructionLayerSelection,
  validateWorkflowConfigEntryDrafts,
  validateWorkflowConfigOverrideDrafts,
  type InstructionLayerName,
} from './playbook-launch-workflow-policy.support.js';
export function PlaybookLaunchPage(): JSX.Element {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const [selectedPlaybookId, setSelectedPlaybookId] = useState(params.id ?? '');
  const [workflowName, setWorkflowName] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [parameterDrafts, setParameterDrafts] = useState<Record<string, string>>({});
  const [extraParameterDrafts, setExtraParameterDrafts] = useState<StructuredEntryDraft[]>([]);
  const [metadataDrafts, setMetadataDrafts] = useState<StructuredEntryDraft[]>([]);
  const [workflowConfigDrafts, setWorkflowConfigDrafts] = useState<Record<string, string>>({});
  const [extraWorkflowConfigDrafts, setExtraWorkflowConfigDrafts] = useState<
    StructuredEntryDraft[]
  >([]);
  const [suppressedInstructionLayers, setSuppressedInstructionLayers] = useState<
    InstructionLayerName[]
  >([]);
  const [modelOverrideDrafts, setModelOverrideDrafts] = useState<RoleOverrideDraft[]>([]);
  const [workflowBudgetDraft, setWorkflowBudgetDraft] = useState<WorkflowBudgetDraft>(() =>
    createWorkflowBudgetDraft(),
  );
  const [error, setError] = useState<string | null>(null);
  const autoFilledParameterDraftsRef = useRef<Record<string, string>>({});
  const playbooksQuery = useQuery({
    queryKey: ['playbooks'],
    queryFn: () => dashboardApi.listPlaybooks(),
  });
  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => dashboardApi.listWorkspaces(),
  });
  const llmProvidersQuery = useQuery({
    queryKey: ['llm-providers'],
    queryFn: () => dashboardApi.listLlmProviders(),
  });
  const llmModelsQuery = useQuery({
    queryKey: ['llm-models'],
    queryFn: () => dashboardApi.listLlmModels(),
  });
  const playbooks = playbooksQuery.data?.data ?? [];
  const launchablePlaybooks = useMemo(
    () => playbooks.filter((playbook) => playbook.is_active !== false),
    [playbooks],
  );
  const selectedPlaybook = useMemo(
    () => playbooks.find((playbook) => playbook.id === selectedPlaybookId) ?? null,
    [playbooks, selectedPlaybookId],
  );
  const isSelectedPlaybookArchived = selectedPlaybook?.is_active === false;
  const launchDefinition = useMemo(
    () => readLaunchDefinition(selectedPlaybook),
    [selectedPlaybook],
  );
  const workflowPolicyDefinition = useMemo(
    () => readWorkflowPolicyDefinition(selectedPlaybook),
    [selectedPlaybook],
  );
  const configuredWorkflowOverrideCount = useMemo(
    () => countConfiguredWorkflowOverrides(modelOverrideDrafts),
    [modelOverrideDrafts],
  );
  const workflowConfigValidation = useMemo(
    () =>
      validateWorkflowConfigOverrideDrafts(
        workflowPolicyDefinition.configOverrideSpecs,
        workflowConfigDrafts,
      ),
    [workflowConfigDrafts, workflowPolicyDefinition.configOverrideSpecs],
  );
  const extraWorkflowConfigValidation = useMemo(
    () =>
      validateWorkflowConfigEntryDrafts(
        extraWorkflowConfigDrafts,
        workflowPolicyDefinition.configOverrideSpecs,
      ),
    [extraWorkflowConfigDrafts, workflowPolicyDefinition.configOverrideSpecs],
  );
  const configuredWorkflowConfigOverrideCount = useMemo(
    () =>
      countConfiguredWorkflowConfigOverrides({
        specs: workflowPolicyDefinition.configOverrideSpecs,
        draftValues: workflowConfigDrafts,
        extraDrafts: extraWorkflowConfigDrafts,
      }),
    [extraWorkflowConfigDrafts, workflowConfigDrafts, workflowPolicyDefinition.configOverrideSpecs],
  );
  const hasInstructionConfigOverride = useMemo(
    () =>
      !haveSameInstructionLayers(
        suppressedInstructionLayers,
        workflowPolicyDefinition.defaultSuppressedLayers,
      ),
    [suppressedInstructionLayers, workflowPolicyDefinition.defaultSuppressedLayers],
  );
  const instructionConfigSummary = useMemo(
    () =>
      summarizeInstructionLayerSelection({
        suppressedLayers: suppressedInstructionLayers,
        defaultSuppressedLayers: workflowPolicyDefinition.defaultSuppressedLayers,
      }),
    [suppressedInstructionLayers, workflowPolicyDefinition.defaultSuppressedLayers],
  );
  const extraParametersValidation = useMemo(
    () => validateStructuredEntries(extraParameterDrafts),
    [extraParameterDrafts],
  );
  const metadataValidation = useMemo(
    () => validateStructuredEntries(metadataDrafts),
    [metadataDrafts],
  );
  const roleOverrideValidation = useMemo(
    () => validateRoleOverrideDrafts(modelOverrideDrafts),
    [modelOverrideDrafts],
  );
  const workflowOverrides = useMemo(
    () => readWorkflowOverrides(modelOverrideDrafts),
    [modelOverrideDrafts],
  );
  const workflowOverrideBlockingError =
    roleOverrideValidation.blockingIssues[0] ?? workflowOverrides.error;
  const workflowConfigBlockingError =
    workflowConfigValidation.blockingIssues[0] ?? extraWorkflowConfigValidation.blockingIssues[0];
  const workspaceResolvedModelsQuery = useQuery({
    queryKey: ['workspace-models', workspaceId],
    queryFn: () => dashboardApi.getResolvedWorkspaceModels(workspaceId),
    enabled: workspaceId.length > 0,
  });
  const previewQuery = useQuery({
    queryKey: [
      'workflow-model-preview',
      workspaceId,
      JSON.stringify(workflowOverrides.value ?? {}),
      JSON.stringify(workspaceResolvedModelsQuery.data?.workspace_model_overrides ?? {}),
    ],
    queryFn: () =>
      dashboardApi.previewEffectiveModels({
        roles: launchDefinition.roles,
        workspace_model_overrides: workspaceResolvedModelsQuery.data?.workspace_model_overrides ?? {},
        workflow_model_overrides: workflowOverrides.value ?? {},
      }),
    enabled:
      selectedPlaybookId.length > 0 &&
      !workflowOverrideBlockingError &&
      (Object.keys(workflowOverrides.value ?? {}).length > 0 || workspaceId.length > 0),
  });
  const workspaces = workspacesQuery.data?.data ?? [];
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
  const launchValidation = useMemo(
    () =>
      validateLaunchDraft({
        selectedPlaybook,
        workflowName,
        workflowBudgetDraft,
        additionalParametersError: extraParametersValidation.blockingIssues[0],
        metadataError: metadataValidation.blockingIssues[0],
        workflowConfigOverridesError: workflowConfigBlockingError,
        workflowOverrideError: workflowOverrideBlockingError,
      }),
    [
      selectedPlaybook,
      workflowName,
      workflowBudgetDraft,
      extraParametersValidation.blockingIssues,
      metadataValidation.blockingIssues,
      workflowConfigBlockingError,
      workflowOverrideBlockingError,
    ],
  );
  const workflowBudget = useMemo(() => {
    if (
      launchValidation.fieldErrors.tokenBudget ||
      launchValidation.fieldErrors.costCapUsd ||
      launchValidation.fieldErrors.maxDurationMinutes
    ) {
      return undefined;
    }
    return buildWorkflowBudgetInput(workflowBudgetDraft);
  }, [launchValidation.fieldErrors, workflowBudgetDraft]);
  useEffect(() => {
    setSuppressedInstructionLayers(workflowPolicyDefinition.defaultSuppressedLayers);
  }, [selectedPlaybookId, workflowPolicyDefinition.defaultSuppressedLayers.join(',')]);
  usePlaybookLaunchPageEffects({
    paramsId: params.id,
    selectedPlaybookId,
    selectedPlaybook,
    selectedWorkspace,
    launchDefinition,
    workflowName,
    workspaceId,
    extraParameterDrafts,
    metadataDrafts,
    workflowConfigDrafts,
    extraWorkflowConfigDrafts,
    suppressedInstructionLayers,
    modelOverrideDrafts,
    workflowBudgetDraft,
    autoFilledParameterDraftsRef,
    setSelectedPlaybookId,
    setWorkflowName,
    setParameterDrafts,
    setModelOverrideDrafts,
    setError,
  });
  const launchMutation = usePlaybookLaunchMutation({
    navigate,
    selectedPlaybookId,
    workflowName,
    workspaceId,
    launchDefinition,
    parameterDrafts,
    extraParameterDrafts,
    metadataDrafts,
    workflowPolicyDefinition,
    workflowConfigDrafts,
    extraWorkflowConfigDrafts,
    suppressedInstructionLayers,
    modelOverrideDrafts,
    workflowBudget,
    setError,
  });
  const canLaunch = launchValidation.isValid && !launchMutation.isPending;
  const hasAdditionalParameters = extraParameterDrafts.length > 0;
  const hasMetadataEntries = metadataDrafts.length > 0;
  const hasWorkflowOverrides = configuredWorkflowOverrideCount > 0;

  return (
    <div data-testid="playbook-launch-surface" className="mx-auto max-w-[88rem] space-y-6 px-4 py-6 sm:px-6">
      <PlaybookLaunchForm
        selectedPlaybookId={selectedPlaybookId}
        isSelectedPlaybookArchived={isSelectedPlaybookArchived}
        launchablePlaybooks={launchablePlaybooks}
        workflowName={workflowName}
        workspaceId={workspaceId}
        workspaces={workspaces}
        selectedPlaybook={selectedPlaybook}
        selectedWorkspace={selectedWorkspace}
        launchValidation={launchValidation}
        launchDefinition={launchDefinition}
        parameterDrafts={parameterDrafts}
        extraParameterDrafts={extraParameterDrafts}
        extraParametersValidation={extraParametersValidation}
        metadataDrafts={metadataDrafts}
        metadataValidation={metadataValidation}
        workflowPolicyDefinition={workflowPolicyDefinition}
        workflowConfigDrafts={workflowConfigDrafts}
        workflowConfigValidation={workflowConfigValidation}
        extraWorkflowConfigDrafts={extraWorkflowConfigDrafts}
        extraWorkflowConfigValidation={extraWorkflowConfigValidation}
        suppressedInstructionLayers={suppressedInstructionLayers}
        hasInstructionConfigOverride={hasInstructionConfigOverride}
        configuredWorkflowConfigOverrideCount={configuredWorkflowConfigOverrideCount}
        instructionConfigSummary={instructionConfigSummary}
        workflowBudgetDraft={workflowBudgetDraft}
        modelOverrideDrafts={modelOverrideDrafts}
        roleOverrideValidation={roleOverrideValidation}
        configuredWorkflowOverrideCount={configuredWorkflowOverrideCount}
        llmProviders={llmProvidersQuery.data ?? []}
        llmModels={llmModelsQuery.data ?? []}
        hasLlmLoadError={Boolean(llmProvidersQuery.error || llmModelsQuery.error)}
        workflowOverrides={workflowOverrides.value ?? {}}
        workflowConfigBlockingError={workflowConfigBlockingError}
        workflowOverrideBlockingError={workflowOverrideBlockingError}
        workspaceResolvedModels={workspaceResolvedModelsQuery.data}
        previewData={previewQuery.data}
        previewError={previewQuery.error}
        previewLoading={previewQuery.isLoading}
        isLoadingSummary={playbooksQuery.isLoading || workspacesQuery.isLoading}
        error={error}
        canLaunch={canLaunch}
        isLaunching={launchMutation.isPending}
        onPlaybookChange={(id) => {
          setSelectedPlaybookId(id);
          setError(null);
        }}
        onWorkflowNameChange={(name) => {
          setWorkflowName(name);
          setError(null);
        }}
        onWorkspaceChange={setWorkspaceId}
        onParameterChange={(key, value) => {
          setError(null);
          setParameterDrafts((current) => ({ ...current, [key]: value }));
        }}
        onExtraParameterDraftsChange={(drafts) => {
          setError(null);
          setExtraParameterDrafts(drafts);
        }}
        onMetadataDraftsChange={(drafts) => {
          setError(null);
          setMetadataDrafts(drafts);
        }}
        onWorkflowConfigChange={(path, value) => {
          setError(null);
          setWorkflowConfigDrafts((current) => ({ ...current, [path]: value }));
        }}
        onExtraWorkflowConfigDraftsChange={(drafts) => {
          setError(null);
          setExtraWorkflowConfigDrafts(drafts);
        }}
        onSuppressedInstructionLayersChange={(layers) => {
          setError(null);
          setSuppressedInstructionLayers(layers);
        }}
        onWorkflowBudgetChange={(draft) => {
          setError(null);
          setWorkflowBudgetDraft(draft);
        }}
        onModelOverrideDraftsChange={(drafts) => {
          setError(null);
          setModelOverrideDrafts(drafts);
        }}
        onLaunch={() => launchMutation.mutate()}
      />
    </div>
  );
}
