import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Plus, Rocket, Trash2 } from 'lucide-react';

import {
  dashboardApi,
  type DashboardEffectiveModelResolution,
  type DashboardLlmModelRecord,
  type DashboardLlmProviderRecord,
  type DashboardPlaybookRecord,
  type DashboardProjectRecord,
  type DashboardProjectResolvedModelsResponse,
  type DashboardRoleModelOverride,
} from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import {
  buildLaunchSectionLinks,
  buildModelOverrides,
  buildParametersFromDrafts,
  buildStructuredObject,
  buildWorkflowBudgetInput,
  summarizeLaunchOverviewCards,
  createWorkflowBudgetDraft,
  createRoleOverrideDraft,
  createStructuredEntryDraft,
  defaultParameterDraftValue,
  mergeStructuredObjects,
  readLaunchDefinition,
  readMappedProjectParameterDraft,
  summarizeWorkflowBudgetDraft,
  syncRoleOverrideDrafts,
  validateLaunchDraft,
  type LaunchParameterSpec,
  type LaunchValidationResult,
  type RoleOverrideDraft,
  type StructuredEntryDraft,
  type StructuredValueType,
  type WorkflowBudgetDraft,
} from './playbook-launch-support.js';
import {
  SelectWithCustomControl,
  type StructuredChoiceOption,
} from './playbook-authoring-structured-controls.js';
import {
  LaunchOutlineCard,
  LaunchOverviewCards,
} from './playbook-launch-page.sections.js';

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
  const launchDefinition = useMemo(() => readLaunchDefinition(selectedPlaybook), [selectedPlaybook]);
  const hasAdditionalParameters = extraParameterDrafts.length > 0;
  const hasMetadataEntries = metadataDrafts.length > 0;
  const configuredWorkflowOverrideCount = useMemo(
    () => countConfiguredWorkflowOverrides(modelOverrideDrafts),
    [modelOverrideDrafts],
  );
  const hasWorkflowOverrides = configuredWorkflowOverrideCount > 0;
  const workflowOverrides = useMemo(
    () => readWorkflowOverrides(modelOverrideDrafts),
    [modelOverrideDrafts],
  );
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
      !workflowOverrides.error &&
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
        workflowOverrideError: workflowOverrides.error,
      }),
    [selectedPlaybook, workflowName, workflowBudgetDraft, workflowOverrides.error],
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

  useEffect(() => {
    if (!workflowName.trim() && selectedPlaybook) {
      setWorkflowName(`${selectedPlaybook.name} Run`);
    }
  }, [selectedPlaybook, workflowName]);

  useEffect(() => {
    setSelectedPlaybookId(params.id ?? '');
  }, [params.id]);

  useEffect(() => {
    setParameterDrafts((current) => {
      const next = { ...current };
      const nextAutoFilled: Record<string, string> = {};
      for (const spec of launchDefinition.parameterSpecs) {
        const defaultValue = defaultParameterDraftValue(spec.defaultValue, spec.inputType);
        const mappedValue = readMappedProjectParameterDraft(spec, selectedProject);
        const currentValue = current[spec.key];
        const priorAutoFilled = autoFilledParameterDraftsRef.current[spec.key];
        if (mappedValue !== undefined) {
          nextAutoFilled[spec.key] = mappedValue;
        }
        const shouldAutofill =
          mappedValue !== undefined &&
          (currentValue === undefined
            || currentValue === ''
            || currentValue === defaultValue
            || currentValue === priorAutoFilled);
        if (shouldAutofill) {
          next[spec.key] = mappedValue;
          continue;
        }
        if (currentValue === undefined || currentValue === priorAutoFilled) {
          next[spec.key] = defaultValue;
        }
      }
      autoFilledParameterDraftsRef.current = nextAutoFilled;
      return next;
    });
  }, [launchDefinition.parameterSpecs, selectedProject]);

  useEffect(() => {
    setModelOverrideDrafts((current) => syncRoleOverrideDrafts(launchDefinition.roles, current));
  }, [launchDefinition.roles]);

  useEffect(() => {
    setError(null);
  }, [
    selectedPlaybookId,
    workflowName,
    projectId,
    extraParameterDrafts,
    metadataDrafts,
    modelOverrideDrafts,
    workflowBudgetDraft,
  ]);

  const launchMutation = useMutation({
    mutationFn: async () => {
      const parameters = mergeStructuredObjects(
        buildParametersFromDrafts(launchDefinition.parameterSpecs, parameterDrafts),
        buildStructuredObject(extraParameterDrafts, 'Additional parameters'),
        'Parameters',
      );
      const metadata = buildStructuredObject(metadataDrafts, 'Metadata');
      const modelOverrides = buildModelOverrides(modelOverrideDrafts);
      return dashboardApi.createWorkflow({
        playbook_id: selectedPlaybookId,
        name: workflowName.trim(),
        project_id: projectId || undefined,
        parameters,
        metadata,
        model_overrides: modelOverrides,
        budget: workflowBudget,
      });
    },
    onSuccess: (workflow) => {
      navigate(`/work/workflows/${workflow.id}`);
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to launch playbook');
    },
  });

  const canLaunch = launchValidation.isValid && !launchMutation.isPending;

  return (
    <div
      data-testid="playbook-launch-surface"
      className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8"
    >
      <div className="space-y-3 rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          <Link to="/config/playbooks" className="underline-offset-4 hover:underline">
            Back to Playbooks
          </Link>
          {selectedPlaybookId ? (
            <Link
              to={`/config/playbooks/${selectedPlaybookId}`}
              className="underline-offset-4 hover:underline"
            >
              Open Playbook Detail
            </Link>
          ) : null}
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Launch Playbook</h1>
          <p className="text-sm text-muted">
            Create a new workflow run from a playbook with structured run inputs, board-aware context,
            and role-based model overrides.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">Structured launch flow</Badge>
          <Badge variant="outline">Board-aware context</Badge>
          <Badge variant="outline">Role-based model policy</Badge>
        </div>
      </div>

      <LaunchOverviewCards cards={overviewCards} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr),minmax(0,22rem)]">
        <Card>
          <CardHeader>
            <CardTitle>Run Configuration</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div className="grid gap-4 rounded-xl border border-border/70 bg-muted/10 p-4">
              <div className="grid gap-1">
                <div className="text-sm font-medium text-foreground">Run Identity</div>
                <p className="text-sm text-muted">
                  Choose the playbook, name the run, and decide whether it belongs to a project before launch.
                </p>
              </div>

              <label className="grid gap-2 text-sm">
                <span className="font-medium">Playbook</span>
                <Select
                  value={isSelectedPlaybookArchived ? '__archived__' : selectedPlaybookId}
                  onValueChange={(value) => {
                    setSelectedPlaybookId(value);
                    setError(null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a playbook" />
                  </SelectTrigger>
                  <SelectContent>
                    {isSelectedPlaybookArchived ? (
                      <SelectItem value="__archived__" disabled>
                        Archived revision selected - restore first
                      </SelectItem>
                    ) : null}
                    {launchablePlaybooks.map((playbook) => (
                      <SelectItem key={playbook.id} value={playbook.id}>
                        {playbook.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {launchValidation.fieldErrors.playbook && !isSelectedPlaybookArchived ? (
                  <p className="text-xs text-red-600">{launchValidation.fieldErrors.playbook}</p>
                ) : null}
              </label>
              {isSelectedPlaybookArchived ? (
                <div className="rounded-md border border-amber-300 bg-amber-50/80 p-3 text-sm text-amber-950">
                  This playbook revision is archived. Restore it from the playbook detail page
                  before launching a new workflow.
                </div>
              ) : null}

              <label className="grid gap-2 text-sm">
                <span className="font-medium">Workflow Name</span>
                <Input
                  value={workflowName}
                  onChange={(event) => {
                    setWorkflowName(event.target.value);
                    setError(null);
                  }}
                  placeholder="e.g. Customer onboarding board run"
                />
                {launchValidation.fieldErrors.workflowName ? (
                  <p className="text-xs text-red-600">
                    {launchValidation.fieldErrors.workflowName}
                  </p>
                ) : (
                  <p className="text-xs text-muted">
                    Use the run name operators will search for in the workflow board and audit trail.
                  </p>
                )}
              </label>

              <label className="grid gap-2 text-sm">
                <span className="font-medium">Project</span>
                <Select value={projectId || '__none__'} onValueChange={(value) => setProjectId(value === '__none__' ? '' : value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Standalone workflow" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Standalone workflow</SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>

            <StructuredSection
              id="launch-readiness"
              title="Launch Readiness"
              description="Review the launch essentials before starting the run."
            >
              <LaunchReadinessPanel
                selectedPlaybook={selectedPlaybook}
                selectedProject={selectedProject}
                workflowName={workflowName}
                hasStructuredParameters={launchDefinition.parameterSpecs.length > 0 || hasAdditionalParameters}
                hasMetadataEntries={hasMetadataEntries}
                hasWorkflowOverrides={hasWorkflowOverrides}
                budgetDraft={workflowBudgetDraft}
                validation={launchValidation}
              />
            </StructuredSection>

            <StructuredSection
              id="playbook-snapshot"
              title="Playbook Snapshot"
              description="Preview the board shape, stages, and declared roles that will frame this run."
            >
              <LaunchDefinitionSnapshot launchDefinition={launchDefinition} />
            </StructuredSection>

            <StructuredSection
              id="playbook-parameters"
              title="Playbook Parameters"
              description={
                launchDefinition.parameterSpecs.length > 0
                  ? 'Launch-time parameters are driven from the selected playbook definition.'
                  : 'This playbook does not define parameter specs yet. Add structured parameter keys as needed.'
              }
            >
              {launchDefinition.parameterSpecs.length > 0 ? (
                <div className="grid gap-4">
                  {launchDefinition.parameterSpecs.map((spec) => (
                    <ParameterField
                      key={spec.key}
                      spec={spec}
                      value={parameterDrafts[spec.key] ?? ''}
                      onChange={(value) => {
                        setError(null);
                        setParameterDrafts((current) => ({ ...current, [spec.key]: value }));
                      }}
                    />
                  ))}
                </div>
              ) : null}

              <StructuredEntryEditor
                title={launchDefinition.parameterSpecs.length > 0 ? 'Additional Parameters' : 'Parameters'}
                description="Add extra launch parameters without typing a full JSON object."
                drafts={extraParameterDrafts}
                onChange={(drafts) => {
                  setError(null);
                  setExtraParameterDrafts(drafts);
                }}
                addLabel="Add parameter"
              />
            </StructuredSection>

            <StructuredSection
              id="launch-metadata"
              title="Metadata"
              description="Attach structured workflow metadata as key/value entries instead of a raw JSON blob."
            >
              <StructuredEntryEditor
                title="Metadata Entries"
                drafts={metadataDrafts}
                onChange={(drafts) => {
                  setError(null);
                  setMetadataDrafts(drafts);
                }}
                addLabel="Add metadata field"
              />
            </StructuredSection>

            <StructuredSection
              id="workflow-budget-policy"
              title="Workflow Budget Policy"
              description="Set optional workflow-level guardrails for token spend, cost, and elapsed runtime."
            >
              <WorkflowBudgetEditor
                draft={workflowBudgetDraft}
                fieldErrors={launchValidation.fieldErrors}
                onChange={(draft) => {
                  setError(null);
                  setWorkflowBudgetDraft(draft);
                }}
              />
            </StructuredSection>

            <StructuredSection
              id="workflow-model-overrides"
              title="Workflow Model Overrides"
              description="Configure workflow-scoped overrides per playbook role and preview the effective model stack before launch."
            >
              {launchDefinition.roles.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {launchDefinition.roles.map((role) => (
                    <Badge key={role} variant="outline">
                      {role}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">
                  This playbook definition does not declare roles, so custom override rows are available.
                </p>
              )}
              <RoleOverrideEditor
                drafts={modelOverrideDrafts}
                playbookRoles={launchDefinition.roles}
                providers={llmProvidersQuery.data ?? []}
                models={llmModelsQuery.data ?? []}
                onChange={(drafts) => {
                  setError(null);
                  setModelOverrideDrafts(drafts);
                }}
              />
              {llmProvidersQuery.error || llmModelsQuery.error ? (
                <p className="text-sm text-red-600">
                  Failed to load provider or model options for workflow overrides.
                </p>
              ) : null}
            </StructuredSection>

            {workflowOverrides.error ? (
              <p className="text-sm text-red-600">{workflowOverrides.error}</p>
            ) : null}
            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/10 p-4">
              <div className="space-y-1">
                <div className="text-sm font-medium text-foreground">Ready to launch</div>
                <p className="text-sm text-muted">
                  Start the run from the pinned launch bar after reviewing the structured inputs
                  above.
                </p>
              </div>
              <Badge variant={canLaunch ? 'secondary' : 'destructive'}>
                {canLaunch ? 'Ready to launch' : 'Action needed'}
              </Badge>
            </section>
          </CardContent>
        </Card>

        <div className="space-y-4 xl:sticky xl:top-6">
          <LaunchOutlineCard sections={sectionLinks} />
          <PlaybookSummaryCard
            playbook={selectedPlaybook}
            projects={projects}
            selectedProjectId={projectId}
            projectResolvedModels={projectResolvedModelsQuery.data}
            previewData={previewQuery.data}
            previewError={previewQuery.error}
            previewLoading={previewQuery.isLoading}
            workflowOverrides={workflowOverrides.value ?? {}}
            launchDefinition={launchDefinition}
            isLoading={playbooksQuery.isLoading || projectsQuery.isLoading}
          />
        </div>
      </div>

      <div className="sticky bottom-4 z-10">
        <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-surface/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-medium">Launch stays within reach while you scroll</div>
            <p className="text-sm text-muted">
              The launch bar remains pinned so long parameter, metadata, and override sections stay
              usable on desktop and phone-sized layouts.
            </p>
          </div>
          <Button onClick={() => launchMutation.mutate()} disabled={!canLaunch}>
            {launchMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Rocket className="h-4 w-4" />
            )}
            Launch Run
          </Button>
        </div>
      </div>
    </div>
  );
}

function StructuredSection(props: {
  id?: string;
  title: string;
  description: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section
      id={props.id}
      className="scroll-mt-24 space-y-4 rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5"
    >
      <header>
        <div className="font-medium text-foreground">{props.title}</div>
        <p className="mt-1 text-sm text-muted">{props.description}</p>
      </header>
      {props.children}
    </section>
  );
}

function LaunchReadinessPanel(props: {
  selectedPlaybook: DashboardPlaybookRecord | null;
  selectedProject: DashboardProjectRecord | null;
  workflowName: string;
  hasStructuredParameters: boolean;
  hasMetadataEntries: boolean;
  hasWorkflowOverrides: boolean;
  budgetDraft: WorkflowBudgetDraft;
  validation: LaunchValidationResult;
}): JSX.Element {
  const budgetSummary = summarizeWorkflowBudgetDraft(props.budgetDraft);
  const checks = [
    {
      label: 'Playbook selected',
      detail:
        props.selectedPlaybook?.is_active === false
          ? `${props.selectedPlaybook.name} is archived and must be restored before launch.`
          : props.selectedPlaybook?.name ?? 'Choose the playbook to launch.',
      isReady: Boolean(props.selectedPlaybook) && props.selectedPlaybook?.is_active !== false,
    },
    {
      label: 'Workflow named',
      detail: props.workflowName.trim() || 'Enter a descriptive run name.',
      isReady: !props.validation.fieldErrors.workflowName,
    },
    {
      label: 'Project context',
      detail: props.selectedProject?.name ?? 'Standalone workflow',
      isReady: true,
    },
    {
      label: 'Structured launch inputs',
      detail: props.hasStructuredParameters
        ? 'Parameters are configured through structured controls.'
        : 'This run will start with playbook defaults only.',
      isReady: true,
    },
    {
      label: 'Metadata and model policy',
      detail: props.hasMetadataEntries || props.hasWorkflowOverrides
        ? 'Metadata or workflow model policy is configured.'
        : 'Using existing defaults and no workflow-specific overrides.',
      isReady: true,
    },
    {
      label: 'Workflow budget policy',
      detail:
        props.validation.fieldErrors.tokenBudget ||
        props.validation.fieldErrors.costCapUsd ||
        props.validation.fieldErrors.maxDurationMinutes ||
        budgetSummary,
      isReady:
        !props.validation.fieldErrors.tokenBudget &&
        !props.validation.fieldErrors.costCapUsd &&
        !props.validation.fieldErrors.maxDurationMinutes,
    },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {checks.map((check) => (
        <div key={check.label} className="rounded-md border border-border bg-muted/20 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="font-medium">{check.label}</div>
            <Badge variant={check.isReady ? 'secondary' : 'destructive'}>
              {check.isReady ? 'Ready' : 'Action needed'}
            </Badge>
          </div>
          <p className="mt-2 text-muted">{check.detail}</p>
        </div>
      ))}
      <div className="md:col-span-2 rounded-md border border-border bg-surface p-3 text-sm">
        <div className="font-medium">Launch status</div>
        {props.validation.blockingIssues.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
            {props.validation.blockingIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-muted">All required launch inputs are present.</p>
        )}
      </div>
    </div>
  );
}

function WorkflowBudgetEditor(props: {
  draft: WorkflowBudgetDraft;
  fieldErrors: LaunchValidationResult['fieldErrors'];
  onChange(draft: WorkflowBudgetDraft): void;
}): JSX.Element {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <label className="grid gap-2 text-sm">
        <span className="font-medium">Token Budget</span>
        <Input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={props.draft.tokenBudget}
          onChange={(event) =>
            props.onChange({ ...props.draft, tokenBudget: event.target.value })
          }
          placeholder="Optional cap"
        />
        <span className="text-xs text-muted">
          Integer cap for total tokens across the workflow.
        </span>
        {props.fieldErrors.tokenBudget ? (
          <span className="text-xs text-red-600">{props.fieldErrors.tokenBudget}</span>
        ) : null}
      </label>
      <label className="grid gap-2 text-sm">
        <span className="font-medium">Cost Cap (USD)</span>
        <Input
          type="number"
          min={0.0001}
          step={0.01}
          inputMode="decimal"
          value={props.draft.costCapUsd}
          onChange={(event) =>
            props.onChange({ ...props.draft, costCapUsd: event.target.value })
          }
          placeholder="Optional cap"
        />
        <span className="text-xs text-muted">
          Stop treating spend as open-ended when the workflow has a dollar ceiling.
        </span>
        {props.fieldErrors.costCapUsd ? (
          <span className="text-xs text-red-600">{props.fieldErrors.costCapUsd}</span>
        ) : null}
      </label>
      <label className="grid gap-2 text-sm">
        <span className="font-medium">Max Duration (Minutes)</span>
        <Input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={props.draft.maxDurationMinutes}
          onChange={(event) =>
            props.onChange({ ...props.draft, maxDurationMinutes: event.target.value })
          }
          placeholder="Optional cap"
        />
        <span className="text-xs text-muted">
          Guard against workflows running longer than the intended operator window.
        </span>
        {props.fieldErrors.maxDurationMinutes ? (
          <span className="text-xs text-red-600">{props.fieldErrors.maxDurationMinutes}</span>
        ) : null}
      </label>
    </div>
  );
}

function LaunchDefinitionSnapshot(props: {
  launchDefinition: ReturnType<typeof readLaunchDefinition>;
}): JSX.Element {
  return (
    <div className="grid gap-3">
      <SummaryList
        title="Board Columns"
        values={props.launchDefinition.boardColumns.map((column) => column.label)}
        emptyMessage="No board columns defined."
      />
      <SummaryList
        title="Live Stages"
        values={props.launchDefinition.stageNames}
        emptyMessage="No stages defined."
      />
      <SummaryList
        title="Playbook Roles"
        values={props.launchDefinition.roles}
        emptyMessage="No explicit roles declared."
      />
    </div>
  );
}

function ParameterField(props: {
  spec: LaunchParameterSpec;
  value: string;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <div className="grid gap-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{props.spec.label}</span>
        <div className="flex gap-2">
          {props.spec.options.length > 0 ? <Badge variant="outline">{props.spec.options.length} options</Badge> : null}
          <Badge variant="secondary">{props.spec.key}</Badge>
        </div>
      </div>
      {props.spec.description ? <p className="text-xs text-muted">{props.spec.description}</p> : null}
      <ValueInput
        valueType={props.spec.inputType === 'select' ? 'string' : props.spec.inputType}
        value={props.value}
        options={props.spec.options}
        onChange={props.onChange}
      />
    </div>
  );
}

function StructuredEntryEditor(props: {
  title: string;
  description?: string;
  drafts: StructuredEntryDraft[];
  onChange(drafts: StructuredEntryDraft[]): void;
  addLabel: string;
}): JSX.Element {
  return (
    <section className="space-y-3 rounded-md border border-dashed border-border p-3">
      <header className="space-y-1">
        <div className="text-sm font-medium">{props.title}</div>
        {props.description ? <p className="text-xs text-muted">{props.description}</p> : null}
      </header>
      {props.drafts.length === 0 ? (
        <p className="text-sm text-muted">No entries added yet.</p>
      ) : (
        props.drafts.map((draft) => (
          <article key={draft.id} className="grid gap-3 rounded-md border border-border p-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr),minmax(0,0.7fr),minmax(0,1.2fr),auto]">
              <label className="grid gap-1 text-xs">
                <span className="font-medium">Key</span>
                <Input
                  value={draft.key}
                  onChange={(event) => props.onChange(updateStructuredDraft(props.drafts, draft.id, { key: event.target.value }))}
                />
              </label>
              <label className="grid gap-1 text-xs">
                <span className="font-medium">Type</span>
                <Select
                  value={draft.valueType}
                  onValueChange={(value) =>
                    props.onChange(updateStructuredDraft(props.drafts, draft.id, { valueType: value as StructuredValueType }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="string">String</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                    <SelectItem value="boolean">Boolean</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <div className="grid gap-1 text-xs">
                <span className="font-medium">Value</span>
                <ValueInput
                  valueType={draft.valueType}
                  value={draft.value}
                  onChange={(value) => props.onChange(updateStructuredDraft(props.drafts, draft.id, { value }))}
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => props.onChange(props.drafts.filter((entry) => entry.id !== draft.id))}
                >
                  <Trash2 className="h-4 w-4" />
                  Remove Entry
                </Button>
              </div>
            </div>
          </article>
        ))
      )}
      <Button type="button" variant="outline" onClick={() => props.onChange([...props.drafts, createStructuredEntryDraft()])}>
        <Plus className="h-4 w-4" />
        {props.addLabel}
      </Button>
    </section>
  );
}

function countConfiguredWorkflowOverrides(drafts: RoleOverrideDraft[]): number {
  return drafts.filter(
    (draft) =>
      draft.provider.trim().length > 0 ||
      draft.model.trim().length > 0 ||
      draft.reasoningEntries.some(
        (entry) => entry.key.trim().length > 0 || entry.value.trim().length > 0,
      ),
  ).length;
}

function RoleOverrideEditor(props: {
  drafts: RoleOverrideDraft[];
  playbookRoles: string[];
  providers: DashboardLlmProviderRecord[];
  models: DashboardLlmModelRecord[];
  onChange(drafts: RoleOverrideDraft[]): void;
}): JSX.Element {
  const enabledModels = useMemo(
    () => props.models.filter((model) => model.is_enabled !== false),
    [props.models],
  );
  const roleOptions = useMemo<StructuredChoiceOption[]>(
    () =>
      props.playbookRoles.map((role) => ({
        value: role,
        label: role,
        description: 'Declared in the selected playbook.',
      })),
    [props.playbookRoles],
  );

  return (
    <div className="space-y-3">
      {props.drafts.length === 0 ? (
        <p className="text-sm text-muted">No workflow-specific model overrides configured.</p>
      ) : (
        props.drafts.map((draft) => {
          const isPlaybookRole = props.playbookRoles.includes(draft.role.trim());
          const selectedProvider = findProviderByDraft(props.providers, draft.provider);
          const availableModels = listModelsForProvider(enabledModels, selectedProvider);
          return (
            <div key={draft.id} className="grid gap-3 rounded-xl border border-border/70 bg-muted/10 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant={isPlaybookRole ? 'secondary' : 'outline'}>
                    {isPlaybookRole ? 'playbook role' : 'custom role'}
                  </Badge>
                  <span className="text-sm font-medium">{draft.role.trim() || 'New role override'}</span>
                </div>
                {!isPlaybookRole ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => props.onChange(props.drafts.filter((entry) => entry.id !== draft.id))}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove Override
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                <label className="grid gap-1 text-xs">
                  <span className="font-medium">Role</span>
                  {isPlaybookRole ? (
                    <div className="rounded-md border border-border/70 bg-background/80 px-3 py-2 text-sm text-foreground">
                      {draft.role}
                    </div>
                  ) : (
                    <SelectWithCustomControl
                      value={draft.role}
                      options={availableRoleOverrideOptions(roleOptions, props.drafts, draft)}
                      placeholder="Select a role"
                      unsetLabel="Unset role"
                      customPlaceholder="Custom role"
                      onChange={(value) =>
                        props.onChange(updateRoleDraft(props.drafts, draft.id, { role: value }))
                      }
                    />
                  )}
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="font-medium">Provider</span>
                  <Select
                    value={selectedProvider?.id ?? '__unset__'}
                    onValueChange={(value) =>
                      props.onChange(
                        updateProviderForRoleDraft(
                          props.drafts,
                          draft.id,
                          value,
                          props.providers,
                          enabledModels,
                        ),
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unset__">Unset</SelectItem>
                      {props.providers.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="font-medium">Model</span>
                  <Select
                    value={draft.model || '__unset__'}
                    onValueChange={(value) =>
                      props.onChange(
                        updateRoleDraft(props.drafts, draft.id, {
                          model: value === '__unset__' ? '' : value,
                        }),
                      )
                    }
                    disabled={availableModels.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={selectedProvider ? 'Select model' : 'Select a provider first'}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unset__">Unset</SelectItem>
                      {availableModels.map((model) => (
                        <SelectItem key={model.id} value={model.model_id}>
                          {model.model_id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <p className="text-xs text-muted">
                Choose from discovered models for the selected provider. Manage providers and model
                discovery on the LLM Providers page.
              </p>
              <StructuredEntryEditor
                title="Reasoning Config Entries"
                description="Add only the reasoning settings this role needs as structured key/value entries."
                drafts={draft.reasoningEntries}
                addLabel="Add reasoning setting"
                onChange={(reasoningEntries) =>
                  props.onChange(updateRoleDraft(props.drafts, draft.id, { reasoningEntries }))
                }
              />
            </div>
          );
        })
      )}
      <Button type="button" variant="outline" onClick={() => props.onChange([...props.drafts, createRoleOverrideDraft()])}>
        <Plus className="h-4 w-4" />
        Add custom role override
      </Button>
    </div>
  );
}

function ValueInput(props: {
  valueType: StructuredValueType;
  value: string;
  options?: string[];
  onChange(value: string): void;
}): JSX.Element {
  if (props.options && props.options.length > 0) {
    return (
      <Select value={props.value || '__empty__'} onValueChange={(value) => props.onChange(value === '__empty__' ? '' : value)}>
        <SelectTrigger>
          <SelectValue placeholder="Select a value" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__empty__">Unset</SelectItem>
          {props.options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (props.valueType === 'boolean') {
    return (
      <Select value={props.value || '__empty__'} onValueChange={(value) => props.onChange(value === '__empty__' ? '' : value)}>
        <SelectTrigger>
          <SelectValue placeholder="Unset" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__empty__">Unset</SelectItem>
          <SelectItem value="true">True</SelectItem>
          <SelectItem value="false">False</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (props.valueType === 'json') {
    return (
      <Textarea
        value={props.value}
        className="min-h-[100px] font-mono text-xs"
        onChange={(event) => props.onChange(event.target.value)}
      />
    );
  }

  return (
    <Input
      type={props.valueType === 'number' ? 'number' : 'text'}
      inputMode={props.valueType === 'number' ? 'decimal' : undefined}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

function findProviderByDraft(
  providers: DashboardLlmProviderRecord[],
  providerName: string,
): DashboardLlmProviderRecord | null {
  const normalized = providerName.trim();
  if (!normalized) {
    return null;
  }
  return providers.find((provider) => provider.name === normalized) ?? null;
}

function listModelsForProvider(
  models: DashboardLlmModelRecord[],
  provider: DashboardLlmProviderRecord | null,
): DashboardLlmModelRecord[] {
  if (!provider) {
    return [];
  }
  return models.filter(
    (model) => model.provider_id === provider.id || model.provider_name === provider.name,
  );
}

function updateProviderForRoleDraft(
  drafts: RoleOverrideDraft[],
  draftId: string,
  providerId: string,
  providers: DashboardLlmProviderRecord[],
  models: DashboardLlmModelRecord[],
): RoleOverrideDraft[] {
  if (providerId === '__unset__') {
    return updateRoleDraft(drafts, draftId, { provider: '', model: '' });
  }
  const provider = providers.find((entry) => entry.id === providerId);
  if (!provider) {
    return drafts;
  }
  const allowedModels = listModelsForProvider(models, provider).map((model) => model.model_id);
  const currentDraft = drafts.find((entry) => entry.id === draftId);
  const nextModel =
    currentDraft && allowedModels.includes(currentDraft.model) ? currentDraft.model : '';
  return updateRoleDraft(drafts, draftId, { provider: provider.name, model: nextModel });
}

function availableRoleOverrideOptions(
  options: StructuredChoiceOption[],
  drafts: RoleOverrideDraft[],
  currentDraft: RoleOverrideDraft,
): StructuredChoiceOption[] {
  const claimedRoles = new Set(
    drafts
      .filter((draft) => draft.id !== currentDraft.id)
      .map((draft) => draft.role.trim())
      .filter(Boolean),
  );
  return options.filter(
    (option) => option.value === currentDraft.role.trim() || !claimedRoles.has(option.value),
  );
}

function PlaybookSummaryCard(props: {
  playbook: DashboardPlaybookRecord | null;
  projects: DashboardProjectRecord[];
  selectedProjectId: string;
  projectResolvedModels?: DashboardProjectResolvedModelsResponse;
  previewData?: {
    roles: string[];
    project_model_overrides: Record<string, DashboardRoleModelOverride>;
    workflow_model_overrides: Record<string, DashboardRoleModelOverride>;
    effective_models: Record<string, DashboardEffectiveModelResolution>;
  };
  previewError: unknown;
  previewLoading: boolean;
  workflowOverrides: Record<string, DashboardRoleModelOverride>;
  launchDefinition: ReturnType<typeof readLaunchDefinition>;
  isLoading: boolean;
}) {
  const selectedProject = props.projects.find((project) => project.id === props.selectedProjectId) ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Launch Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {props.isLoading ? <p className="text-sm text-muted">Loading playbook details...</p> : null}
        {!props.isLoading && !props.playbook ? (
          <p className="text-sm text-muted">Select a playbook to review its lifecycle and board shape.</p>
        ) : null}
        {props.playbook ? (
          <>
            <div className="space-y-1">
              <div className="text-lg font-medium">{props.playbook.name}</div>
              <p className="text-sm text-muted">{props.playbook.description ?? 'No description provided.'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{props.playbook.lifecycle}</Badge>
              <Badge variant="outline">{props.launchDefinition.boardColumns.length} columns</Badge>
              <Badge variant="outline">{props.launchDefinition.stageNames.length} stages</Badge>
              <Badge variant="outline">{props.launchDefinition.roles.length} roles</Badge>
              {props.playbook.is_active === false ? (
                <Badge variant="destructive">Archived</Badge>
              ) : null}
            </div>
            {props.playbook.is_active === false ? (
              <div className="rounded-md border border-amber-300 bg-amber-50/80 p-3 text-sm text-amber-950">
                Launch is disabled for archived revisions. Restore this playbook from its detail
                page before starting a new workflow.
              </div>
            ) : null}
            {props.launchDefinition.stageNames.length > 0 ? (
              <SummaryList
                title="Live Stages"
                values={props.launchDefinition.stageNames}
                emptyMessage="No stages defined."
              />
            ) : null}
            {props.launchDefinition.boardColumns.length > 0 ? (
              <SummaryList
                title="Board Columns"
                values={props.launchDefinition.boardColumns.map((column) => column.label)}
                emptyMessage="No board columns defined."
              />
            ) : null}
            <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
              <div className="font-medium">Outcome</div>
              <div className="text-muted">{props.playbook.outcome}</div>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
              <div className="font-medium">Project</div>
              <div className="text-muted">{selectedProject?.name ?? 'Standalone workflow'}</div>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
              <div className="font-medium">Workflow override roles</div>
              <div className="text-muted">
                {Object.keys(props.workflowOverrides).length > 0
                  ? Object.keys(props.workflowOverrides).join(', ')
                  : 'No workflow-specific overrides configured.'}
              </div>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
              <div className="font-medium">Resolved Effective Models</div>
              {props.previewLoading ? (
                <p className="text-muted">Resolving effective models...</p>
              ) : props.previewError ? (
                <p className="text-red-600">Failed to resolve effective models.</p>
              ) : props.previewData && Object.keys(props.previewData.effective_models).length > 0 ? (
                <ResolvedModelList effectiveModels={props.previewData.effective_models} />
              ) : props.projectResolvedModels && Object.keys(props.projectResolvedModels.effective_models).length > 0 ? (
                <ResolvedModelList effectiveModels={props.projectResolvedModels.effective_models} />
              ) : (
                <p className="text-muted">
                  Add project or workflow overrides to preview the effective model stack.
                </p>
              )}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SummaryList(props: {
  title: string;
  values: string[];
  emptyMessage: string;
}): JSX.Element {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
      <div className="font-medium">{props.title}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {props.values.length > 0 ? (
          props.values.map((value) => (
            <Badge key={value} variant="outline">
              {value}
            </Badge>
          ))
        ) : (
          <span className="text-muted">{props.emptyMessage}</span>
        )}
      </div>
    </div>
  );
}

function ResolvedModelList(props: {
  effectiveModels: Record<string, DashboardEffectiveModelResolution>;
}) {
  return (
    <div className="space-y-3">
      {Object.entries(props.effectiveModels).map(([role, resolution]) => (
        <div key={role} className="rounded-md border border-border bg-surface p-3">
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="outline">{role}</Badge>
            <Badge variant={resolution.fallback ? 'destructive' : 'secondary'}>
              {resolution.source}
            </Badge>
          </div>
          {resolution.resolved ? (
            <div className="space-y-1 text-sm">
              <div>
                {resolution.resolved.provider.name} / {resolution.resolved.model.modelId}
              </div>
              {resolution.resolved.model.endpointType ? (
                <div className="text-muted">Endpoint: {resolution.resolved.model.endpointType}</div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted">No resolved model available.</p>
          )}
          {resolution.fallback_reason ? (
            <p className="mt-2 text-xs text-red-600">{resolution.fallback_reason}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function updateStructuredDraft(
  drafts: StructuredEntryDraft[],
  draftId: string,
  patch: Partial<StructuredEntryDraft>,
): StructuredEntryDraft[] {
  return drafts.map((draft) => (draft.id === draftId ? { ...draft, ...patch } : draft));
}

function updateRoleDraft(
  drafts: RoleOverrideDraft[],
  draftId: string,
  patch: Partial<RoleOverrideDraft>,
): RoleOverrideDraft[] {
  return drafts.map((draft) => (draft.id === draftId ? { ...draft, ...patch } : draft));
}

function readWorkflowOverrides(
  drafts: RoleOverrideDraft[],
): { value?: Record<string, DashboardRoleModelOverride>; error?: string } {
  try {
    return { value: buildModelOverrides(drafts) ?? {} };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Workflow model overrides are invalid.',
    };
  }
}
