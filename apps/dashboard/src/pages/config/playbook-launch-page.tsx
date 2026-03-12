import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Rocket } from 'lucide-react';

import {
  dashboardApi,
  type DashboardEffectiveModelResolution,
  type DashboardPlaybookRecord,
  type DashboardProjectRecord,
  type DashboardProjectResolvedModelsResponse,
  type DashboardRoleModelOverride,
} from '../../lib/api.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Textarea } from '../../components/ui/textarea.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { StructuredRecordView } from '../../components/structured-data.js';

export function PlaybookLaunchPage(): JSX.Element {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const [selectedPlaybookId, setSelectedPlaybookId] = useState(params.id ?? '');
  const [workflowName, setWorkflowName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [parametersText, setParametersText] = useState('{\n  \n}');
  const [metadataText, setMetadataText] = useState('{\n  \n}');
  const [modelOverridesText, setModelOverridesText] = useState('{\n  \n}');
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
  const parsedWorkflowOverrides = useMemo(
    () => parseModelOverrides(modelOverridesText, false),
    [modelOverridesText],
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
      JSON.stringify(parsedWorkflowOverrides.value ?? {}),
      JSON.stringify(projectResolvedModelsQuery.data?.project_model_overrides ?? {}),
    ],
    queryFn: () =>
      dashboardApi.previewEffectiveModels({
        project_model_overrides: projectResolvedModelsQuery.data?.project_model_overrides ?? {},
        workflow_model_overrides: parsedWorkflowOverrides.value ?? {},
      }),
    enabled:
      selectedPlaybookId.length > 0 &&
      !parsedWorkflowOverrides.error &&
      (Object.keys(parsedWorkflowOverrides.value ?? {}).length > 0 || projectId.length > 0),
  });

  useEffect(() => {
    if (!workflowName.trim() && selectedPlaybook) {
      setWorkflowName(`${selectedPlaybook.name} Run`);
    }
  }, [selectedPlaybook, workflowName]);

  const launchMutation = useMutation({
    mutationFn: async () => {
      const parameters = parseJsonObject(parametersText, 'Parameters');
      const metadata = parseJsonObject(metadataText, 'Metadata');
      const parsedModelOverrides = parseModelOverrides(modelOverridesText);
      const modelOverrides = parsedModelOverrides.value ?? {};
      return dashboardApi.createWorkflow({
        playbook_id: selectedPlaybookId,
        name: workflowName.trim(),
        project_id: projectId || undefined,
        parameters,
        metadata,
        model_overrides: Object.keys(modelOverrides).length > 0 ? modelOverrides : undefined,
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
          Create a new workflow run from a playbook instead of the legacy template launcher.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Run Configuration</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
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

            <label className="grid gap-2 text-sm">
              <span className="font-medium">Parameters JSON</span>
              <Textarea
                value={parametersText}
                onChange={(event) => {
                  setError(null);
                  setParametersText(event.target.value);
                }}
                className="min-h-[180px] font-mono text-xs"
              />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="font-medium">Metadata JSON</span>
              <Textarea
                value={metadataText}
                onChange={(event) => {
                  setError(null);
                  setMetadataText(event.target.value);
                }}
                className="min-h-[160px] font-mono text-xs"
              />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="font-medium">Workflow Model Overrides JSON</span>
              <Textarea
                value={modelOverridesText}
                onChange={(event) => {
                  setError(null);
                  setModelOverridesText(event.target.value);
                }}
                className="min-h-[160px] font-mono text-xs"
                placeholder={'{\n  "architect": {\n    "provider": "openai",\n    "model": "gpt-5"\n  }\n}'}
              />
            </label>

            {parsedWorkflowOverrides.error ? (
              <p className="text-sm text-red-600">{parsedWorkflowOverrides.error}</p>
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
          workflowOverrides={parsedWorkflowOverrides.value ?? {}}
          isLoading={playbooksQuery.isLoading || projectsQuery.isLoading}
        />
      </div>
    </div>
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
  isLoading: boolean;
}) {
  const selectedProject = props.projects.find((project) => project.id === props.selectedProjectId) ?? null;
  const boardColumns = Array.isArray((props.playbook?.definition as { board?: { columns?: unknown[] } } | undefined)?.board?.columns)
    ? (((props.playbook?.definition as { board?: { columns?: unknown[] } } | undefined)?.board?.columns?.length) ?? 0)
    : 0;
  const stages = Array.isArray((props.playbook?.definition as { stages?: unknown[] } | undefined)?.stages)
    ? (((props.playbook?.definition as { stages?: unknown[] } | undefined)?.stages?.length) ?? 0)
    : 0;

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
              <Badge variant="outline">{boardColumns} columns</Badge>
              <Badge variant="outline">{stages} stages</Badge>
            </div>
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

function parseJsonObject(value: string, label: string): Record<string, unknown> | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '{' || trimmed === '{\n  \n}') {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error instanceof Error ? error.message : 'parse error'}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function parseModelOverrides(
  value: string,
  throwOnError = true,
): { value?: Record<string, DashboardRoleModelOverride>; error?: string } {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '{' || trimmed === '{\n  \n}') {
    return { value: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const message = `Workflow model overrides must be valid JSON: ${error instanceof Error ? error.message : 'parse error'}`;
    if (throwOnError) {
      throw new Error(message);
    }
    return { error: message };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const message = 'Workflow model overrides must be a JSON object.';
    if (throwOnError) {
      throw new Error(message);
    }
    return { error: message };
  }

  return { value: parsed as Record<string, DashboardRoleModelOverride> };
}
