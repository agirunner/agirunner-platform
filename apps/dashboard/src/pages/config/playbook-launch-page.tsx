import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Rocket } from 'lucide-react';
import { dashboardApi } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  buildLaunchSectionLinks,
  buildWorkflowBudgetInput,
  summarizeLaunchOverviewCards,
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
import { LaunchOverviewCards } from './playbook-launch-page.sections.js';
import { usePlaybookLaunchPageEffects } from './playbook-launch-page.effects.js';
import { usePlaybookLaunchMutation } from './playbook-launch-page.mutation.js';
import { PlaybookLaunchForm } from './playbook-launch-form.js';
import { countConfiguredWorkflowOverrides, readWorkflowOverrides } from './playbook-launch-overrides.js';
export function PlaybookLaunchPage(): JSX.Element {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const [selectedPlaybookId, setSelectedPlaybookId] = useState(params.id ?? '');
  const [workflowName, setWorkflowName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [parameterDrafts, setParameterDrafts] = useState<Record<string, string>>({});
  const [extraParameterDrafts, setExtraParameterDrafts] = useState<StructuredEntryDraft[]>([]);
  const [metadataDrafts, setMetadataDrafts] = useState<StructuredEntryDraft[]>([]);
  const [modelOverrideDrafts, setModelOverrideDrafts] = useState<RoleOverrideDraft[]>([]);
  const [workflowBudgetDraft, setWorkflowBudgetDraft] = useState<WorkflowBudgetDraft>(
    () => createWorkflowBudgetDraft(),
  );
  const [error, setError] = useState<string | null>(null);
  const autoFilledParameterDraftsRef = useRef<Record<string, string>>({});
  const playbooksQuery = useQuery({
    queryKey: ['playbooks'],
    queryFn: () => dashboardApi.listPlaybooks(),
  });
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => dashboardApi.listProjects(),
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
  const configuredWorkflowOverrideCount = useMemo(
    () => countConfiguredWorkflowOverrides(modelOverrideDrafts),
    [modelOverrideDrafts],
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
  const projectResolvedModelsQuery = useQuery({
    queryKey: ['project-models', projectId],
    queryFn: () => dashboardApi.getResolvedProjectModels(projectId),
    enabled: projectId.length > 0,
  });
  const previewQuery = useQuery({
    queryKey: [
      'workflow-model-preview',
      projectId,
      JSON.stringify(workflowOverrides.value ?? {}),
      JSON.stringify(projectResolvedModelsQuery.data?.project_model_overrides ?? {}),
    ],
    queryFn: () =>
      dashboardApi.previewEffectiveModels({
        roles: launchDefinition.roles,
        project_model_overrides: projectResolvedModelsQuery.data?.project_model_overrides ?? {},
        workflow_model_overrides: workflowOverrides.value ?? {},
      }),
    enabled:
      selectedPlaybookId.length > 0 &&
      !workflowOverrideBlockingError &&
      (Object.keys(workflowOverrides.value ?? {}).length > 0 || projectId.length > 0),
  });
  const projects = projectsQuery.data?.data ?? [];
  const selectedProject = projects.find((project) => project.id === projectId) ?? null;
  const launchValidation = useMemo(
    () =>
      validateLaunchDraft({
        selectedPlaybook,
        workflowName,
        workflowBudgetDraft,
        additionalParametersError: extraParametersValidation.blockingIssues[0],
        metadataError: metadataValidation.blockingIssues[0],
        workflowOverrideError: workflowOverrideBlockingError,
      }),
    [
      selectedPlaybook,
      workflowName,
      workflowBudgetDraft,
      extraParametersValidation.blockingIssues,
      metadataValidation.blockingIssues,
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
  const overviewCards = useMemo(
    () =>
      summarizeLaunchOverviewCards({
        selectedPlaybook,
        selectedProject,
        launchDefinition,
        extraParameterCount: extraParameterDrafts.length,
        metadataCount: metadataDrafts.length,
        overrideCount: configuredWorkflowOverrideCount,
        workflowBudgetDraft,
      }),
    [
      selectedPlaybook,
      selectedProject,
      launchDefinition,
      extraParameterDrafts.length,
      metadataDrafts.length,
      configuredWorkflowOverrideCount,
      workflowBudgetDraft,
    ],
  );
  const sectionLinks = useMemo(
    () =>
      buildLaunchSectionLinks({
        launchDefinition,
        extraParameterCount: extraParameterDrafts.length,
        metadataCount: metadataDrafts.length,
        overrideCount: configuredWorkflowOverrideCount,
      }),
    [
      launchDefinition,
      extraParameterDrafts.length,
      metadataDrafts.length,
      configuredWorkflowOverrideCount,
    ],
  );
  usePlaybookLaunchPageEffects({
    paramsId: params.id,
    selectedPlaybookId,
    selectedPlaybook,
    selectedProject,
    launchDefinition,
    workflowName,
    projectId,
    extraParameterDrafts,
    metadataDrafts,
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
    projectId,
    launchDefinition,
    parameterDrafts,
    extraParameterDrafts,
    metadataDrafts,
    modelOverrideDrafts,
    workflowBudget,
    setError,
  });
  const canLaunch = launchValidation.isValid && !launchMutation.isPending;
  const hasAdditionalParameters = extraParameterDrafts.length > 0;
  const hasMetadataEntries = metadataDrafts.length > 0;
  const hasWorkflowOverrides = configuredWorkflowOverrideCount > 0;

  return (
    <div
      data-testid="playbook-launch-surface"
      className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8"
    >
      <LaunchOverviewCards cards={overviewCards} />
      <PlaybookLaunchForm
        selectedPlaybookId={selectedPlaybookId}
        isSelectedPlaybookArchived={isSelectedPlaybookArchived}
        launchablePlaybooks={launchablePlaybooks}
        workflowName={workflowName}
        projectId={projectId}
        projects={projects}
        selectedPlaybook={selectedPlaybook}
        selectedProject={selectedProject}
        launchValidation={launchValidation}
        launchDefinition={launchDefinition}
        parameterDrafts={parameterDrafts}
        extraParameterDrafts={extraParameterDrafts}
        extraParametersValidation={extraParametersValidation}
        metadataDrafts={metadataDrafts}
        metadataValidation={metadataValidation}
        workflowBudgetDraft={workflowBudgetDraft}
        modelOverrideDrafts={modelOverrideDrafts}
        roleOverrideValidation={roleOverrideValidation}
        configuredWorkflowOverrideCount={configuredWorkflowOverrideCount}
        llmProviders={llmProvidersQuery.data ?? []}
        llmModels={llmModelsQuery.data ?? []}
        hasLlmLoadError={Boolean(llmProvidersQuery.error || llmModelsQuery.error)}
        workflowOverrides={workflowOverrides.value ?? {}}
        workflowOverrideBlockingError={workflowOverrideBlockingError}
        sectionLinks={sectionLinks}
        projectResolvedModels={projectResolvedModelsQuery.data}
        previewData={previewQuery.data}
        previewError={previewQuery.error}
        previewLoading={previewQuery.isLoading}
        isLoadingSummary={playbooksQuery.isLoading || projectsQuery.isLoading}
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
        onProjectChange={setProjectId}
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
