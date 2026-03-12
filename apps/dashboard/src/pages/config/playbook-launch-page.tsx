import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Plus, Rocket, Trash2 } from 'lucide-react';

import {
  dashboardApi,
  type DashboardEffectiveModelResolution,
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
  buildModelOverrides,
  buildParametersFromDrafts,
  buildStructuredObject,
  createRoleOverrideDraft,
  createStructuredEntryDraft,
  defaultParameterDraftValue,
  mergeStructuredObjects,
  readLaunchDefinition,
  syncRoleOverrideDrafts,
  type LaunchParameterSpec,
  type RoleOverrideDraft,
  type StructuredEntryDraft,
  type StructuredValueType,
} from './playbook-launch-support.js';

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
  const [error, setError] = useState<string | null>(null);

  const playbooksQuery = useQuery({
    queryKey: ['playbooks'],
    queryFn: () => dashboardApi.listPlaybooks(),
  });
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => dashboardApi.listProjects(),
  });

  const selectedPlaybook = useMemo(
    () => (playbooksQuery.data?.data ?? []).find((playbook) => playbook.id === selectedPlaybookId) ?? null,
    [playbooksQuery.data?.data, selectedPlaybookId],
  );
  const launchDefinition = useMemo(() => readLaunchDefinition(selectedPlaybook), [selectedPlaybook]);
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

  useEffect(() => {
    if (!workflowName.trim() && selectedPlaybook) {
      setWorkflowName(`${selectedPlaybook.name} Run`);
    }
  }, [selectedPlaybook, workflowName]);

  useEffect(() => {
    setParameterDrafts((current) => {
      const next: Record<string, string> = {};
      for (const spec of launchDefinition.parameterSpecs) {
        next[spec.key] = current[spec.key] ?? defaultParameterDraftValue(spec.defaultValue, spec.inputType);
      }
      return next;
    });
  }, [launchDefinition.parameterSpecs]);

  useEffect(() => {
    setModelOverrideDrafts((current) => syncRoleOverrideDrafts(launchDefinition.roles, current));
  }, [launchDefinition.roles]);

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
      });
    },
    onSuccess: (workflow) => {
      navigate(`/work/workflows/${workflow.id}`);
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to launch playbook');
    },
  });

  const playbooks = playbooksQuery.data?.data ?? [];
  const projects = projectsQuery.data?.data ?? [];
  const canLaunch = Boolean(selectedPlaybookId && workflowName.trim());

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Launch Playbook</h1>
        <p className="text-sm text-muted">
          Create a new workflow run from a playbook with structured run inputs, board-aware context,
          and role-based model overrides.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Run Configuration</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Playbook</span>
              <Select value={selectedPlaybookId} onValueChange={setSelectedPlaybookId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a playbook" />
                </SelectTrigger>
                <SelectContent>
                  {playbooks.map((playbook) => (
                    <SelectItem key={playbook.id} value={playbook.id}>
                      {playbook.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="grid gap-2 text-sm">
              <span className="font-medium">Workflow Name</span>
              <Input value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} />
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

            <StructuredSection
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
                onChange={(drafts) => {
                  setError(null);
                  setModelOverrideDrafts(drafts);
                }}
              />
            </StructuredSection>

            {workflowOverrides.error ? (
              <p className="text-sm text-red-600">{workflowOverrides.error}</p>
            ) : null}
            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            <div className="flex justify-end">
              <Button
                onClick={() => launchMutation.mutate()}
                disabled={!canLaunch || launchMutation.isPending}
              >
                {launchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                Launch Run
              </Button>
            </div>
          </CardContent>
        </Card>

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
  );
}

function StructuredSection(props: {
  title: string;
  description: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div>
        <div className="font-medium">{props.title}</div>
        <p className="text-sm text-muted">{props.description}</p>
      </div>
      {props.children}
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
    <div className="space-y-3 rounded-md border border-dashed border-border p-3">
      <div className="space-y-1">
        <div className="text-sm font-medium">{props.title}</div>
        {props.description ? <p className="text-xs text-muted">{props.description}</p> : null}
      </div>
      {props.drafts.length === 0 ? (
        <p className="text-sm text-muted">No entries added yet.</p>
      ) : (
        props.drafts.map((draft) => (
          <div key={draft.id} className="grid gap-3 rounded-md border border-border p-3">
            <div className="grid gap-3 md:grid-cols-[1.1fr,0.7fr,1.2fr,auto]">
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
                  size="icon"
                  onClick={() => props.onChange(props.drafts.filter((entry) => entry.id !== draft.id))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ))
      )}
      <Button type="button" variant="outline" onClick={() => props.onChange([...props.drafts, createStructuredEntryDraft()])}>
        <Plus className="h-4 w-4" />
        {props.addLabel}
      </Button>
    </div>
  );
}

function RoleOverrideEditor(props: {
  drafts: RoleOverrideDraft[];
  playbookRoles: string[];
  onChange(drafts: RoleOverrideDraft[]): void;
}): JSX.Element {
  return (
    <div className="space-y-3">
      {props.drafts.length === 0 ? (
        <p className="text-sm text-muted">No workflow-specific model overrides configured.</p>
      ) : (
        props.drafts.map((draft) => {
          const isPlaybookRole = props.playbookRoles.includes(draft.role.trim());
          return (
            <div key={draft.id} className="grid gap-3 rounded-md border border-border p-3">
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
                    size="icon"
                    onClick={() => props.onChange(props.drafts.filter((entry) => entry.id !== draft.id))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="grid gap-1 text-xs">
                  <span className="font-medium">Role</span>
                  <Input
                    value={draft.role}
                    disabled={isPlaybookRole}
                    onChange={(event) => props.onChange(updateRoleDraft(props.drafts, draft.id, { role: event.target.value }))}
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="font-medium">Provider</span>
                  <Input
                    value={draft.provider}
                    placeholder="openai"
                    onChange={(event) => props.onChange(updateRoleDraft(props.drafts, draft.id, { provider: event.target.value }))}
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="font-medium">Model</span>
                  <Input
                    value={draft.model}
                    placeholder="gpt-5"
                    onChange={(event) => props.onChange(updateRoleDraft(props.drafts, draft.id, { model: event.target.value }))}
                  />
                </label>
              </div>
              <label className="grid gap-1 text-xs">
                <span className="font-medium">Reasoning Config JSON</span>
                <Textarea
                  value={draft.reasoningConfig}
                  placeholder='{"effort":"medium"}'
                  className="min-h-[100px] font-mono text-xs"
                  onChange={(event) => props.onChange(updateRoleDraft(props.drafts, draft.id, { reasoningConfig: event.target.value }))}
                />
              </label>
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
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
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
            </div>
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
