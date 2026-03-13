import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  Loader2,
  Plus,
  Trash2,
  Save,
  Calendar,
  Webhook,
  Zap,
} from 'lucide-react';
import { dashboardApi } from '../../lib/api.js';
import type {
  DashboardEffectiveModelResolution,
  DashboardLlmModelRecord,
  DashboardProjectRecord,
  DashboardProjectSpecRecord,
  DashboardProjectResourceRecord,
  DashboardProjectToolCatalog,
  DashboardProjectTimelineEntry,
} from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { StructuredRecordView } from '../../components/structured-data.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { Textarea } from '../../components/ui/textarea.js';
import { Switch } from '../../components/ui/switch.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/table.js';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '../../components/ui/tabs.js';
import {
  buildRoleModelOverrides,
  buildStructuredObject,
  createRoleOverrideDraft,
  createStructuredEntryDraft,
  hydrateRoleOverrideDrafts,
  objectToStructuredDrafts,
  type RoleOverrideDraft,
  type StructuredEntryDraft,
  type StructuredValueType,
} from './project-detail-support.js';
import { ProjectArtifactExplorerPanel } from './project-artifact-explorer-panel.js';
import { ProjectDetailMemoryTab } from './project-detail-memory-tab.js';
import { ScheduledTriggersCard } from './project-scheduled-triggers-card.js';

/* ------------------------------------------------------------------ */
/*  Spec Tab                                                           */
/* ------------------------------------------------------------------ */

function SpecTab({ projectId }: { projectId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const [configDrafts, setConfigDrafts] = useState<StructuredEntryDraft[]>([]);
  const [instructionDrafts, setInstructionDrafts] = useState<StructuredEntryDraft[]>([]);
  const [resourceDrafts, setResourceDrafts] = useState<StructuredEntryDraft[]>([]);
  const [documentDrafts, setDocumentDrafts] = useState<StructuredEntryDraft[]>([]);
  const [toolDrafts, setToolDrafts] = useState<StructuredEntryDraft[]>([]);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['project-spec', projectId],
    queryFn: () => dashboardApi.getProjectSpec(projectId),
  });

  useEffect(() => {
    if (!data) {
      return;
    }
    setConfigDrafts(objectToStructuredDrafts(data.config));
    setInstructionDrafts(objectToStructuredDrafts(data.instructions));
    setResourceDrafts(objectToStructuredDrafts(data.resources));
    setDocumentDrafts(objectToStructuredDrafts(data.documents));
    setToolDrafts(objectToStructuredDrafts(data.tools));
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const resources = buildStructuredObject(resourceDrafts, 'Project resources');
      const documents = buildStructuredObject(documentDrafts, 'Project documents');
      const tools = buildStructuredObject(toolDrafts, 'Project tools');
      const nextSpec = {
        ...(resources ? { resources } : {}),
        ...(documents ? { documents } : {}),
        ...(tools ? { tools } : {}),
        config: buildStructuredObject(configDrafts, 'Project config') ?? {},
        instructions: buildStructuredObject(instructionDrafts, 'Project instructions') ?? {},
      };
      return dashboardApi.updateProjectSpec(projectId, nextSpec);
    },
    onSuccess: async () => {
      setSaveMessage('Project spec saved.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-spec', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
      ]);
    },
  });

  if (isLoading) {
    return <LoadingCard />;
  }

  if (error) {
    return <ErrorCard message="Failed to load project spec." />;
  }

  const spec = data as DashboardProjectSpecRecord;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-3">
        {saveMessage ? <p className="text-sm text-green-600">{saveMessage}</p> : null}
        <Button size="sm" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
          <Save className="h-4 w-4" />
          Save Spec
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <FieldRow label="Project ID" value={spec.project_id} />
          <FieldRow label="Version" value={spec.version !== undefined ? String(spec.version) : '-'} />
          <FieldRow
            label="Updated"
            value={spec.updated_at ? new Date(spec.updated_at).toLocaleString() : '-'}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Config</CardTitle>
        </CardHeader>
        <CardContent>
          <StructuredEntryEditor
            title="Config Entries"
            description="Edit project configuration as structured key/value entries instead of a raw JSON document."
            drafts={configDrafts}
            onChange={(drafts) => {
              setSaveMessage(null);
              setConfigDrafts(drafts);
            }}
            addLabel="Add config field"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Instructions</CardTitle>
        </CardHeader>
        <CardContent>
          <StructuredEntryEditor
            title="Instruction Entries"
            description="Edit structured project instructions and document references without switching to raw JSON."
            drafts={instructionDrafts}
            onChange={(drafts) => {
              setSaveMessage(null);
              setInstructionDrafts(drafts);
            }}
            addLabel="Add instruction field"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resources</CardTitle>
        </CardHeader>
        <CardContent>
          <StructuredEntryEditor
            title="Resource Entries"
            description="Edit project-scoped resource bindings and descriptors with structured entries."
            drafts={resourceDrafts}
            onChange={(drafts) => {
              setSaveMessage(null);
              setResourceDrafts(drafts);
            }}
            addLabel="Add resource entry"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <StructuredEntryEditor
            title="Document Entries"
            description="Edit project document references and metadata without switching to a raw JSON blob."
            drafts={documentDrafts}
            onChange={(drafts) => {
              setSaveMessage(null);
              setDocumentDrafts(drafts);
            }}
            addLabel="Add document entry"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tools</CardTitle>
        </CardHeader>
        <CardContent>
          <StructuredEntryEditor
            title="Tool Entries"
            description="Edit project tool policy entries as structured values rather than a read-only spec view."
            drafts={toolDrafts}
            onChange={(drafts) => {
              setSaveMessage(null);
              setToolDrafts(drafts);
            }}
            addLabel="Add tool entry"
          />
        </CardContent>
      </Card>

      {saveMutation.error ? (
        <p className="text-sm text-red-600">
          {saveMutation.error instanceof Error ? saveMutation.error.message : 'Failed to save project spec.'}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Resources Tab                                                      */
/* ------------------------------------------------------------------ */

function ResourcesTab({ projectId }: { projectId: string }): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['project-resources', projectId],
    queryFn: () => dashboardApi.listProjectResources(projectId),
  });

  if (isLoading) return <LoadingCard />;
  if (error) return <ErrorCard message="Failed to load resources." />;

  const resources = (data?.data ?? []) as DashboardProjectResourceRecord[];

  if (resources.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted">
          No resources defined for this project.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Metadata</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {resources.map((r, idx) => (
              <TableRow key={r.id ?? idx}>
                <TableCell className="font-medium">{r.name ?? r.id ?? '-'}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{r.type ?? '-'}</Badge>
                </TableCell>
                <TableCell className="max-w-xs truncate text-sm">{r.description ?? '-'}</TableCell>
                <TableCell>
                  {r.metadata && Object.keys(r.metadata).length > 0 ? (
                    <pre className="max-w-xs truncate text-xs">
                      {JSON.stringify(r.metadata)}
                    </pre>
                  ) : (
                    '-'
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Tools Tab                                                          */
/* ------------------------------------------------------------------ */

interface ToolEntry {
  name: string;
  isBlocked: boolean;
  data: unknown;
}

function ToolsTab({ projectId }: { projectId: string }): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['project-tools', projectId],
    queryFn: () => dashboardApi.listProjectTools(projectId),
  });

  if (isLoading) return <LoadingCard />;
  if (error) return <ErrorCard message="Failed to load tools." />;

  const catalog = (data?.data ?? {}) as DashboardProjectToolCatalog;
  const availableTools = Array.isArray(catalog.available) ? catalog.available : [];
  const blockedTools = Array.isArray(catalog.blocked) ? catalog.blocked : [];

  const tools: ToolEntry[] = [
    ...availableTools.map((t) => ({
      name: typeof t === 'object' && t !== null && 'name' in t ? String((t as { name: string }).name) : String(t),
      isBlocked: false,
      data: t,
    })),
    ...blockedTools.map((t) => ({
      name: typeof t === 'object' && t !== null && 'name' in t ? String((t as { name: string }).name) : String(t),
      isBlocked: true,
      data: t,
    })),
  ];

  if (tools.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted">
          No tools configured for this project.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Toggle</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tools.map((tool) => (
              <TableRow key={tool.name}>
                <TableCell className="font-medium">{tool.name}</TableCell>
                <TableCell>
                  <Badge variant={tool.isBlocked ? 'destructive' : 'success'}>
                    {tool.isBlocked ? 'Blocked' : 'Available'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Switch checked={!tool.isBlocked} disabled />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Timeline Tab                                                       */
/* ------------------------------------------------------------------ */

function TimelineTab({ projectId }: { projectId: string }): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['project-timeline', projectId],
    queryFn: () => dashboardApi.getProjectTimeline(projectId),
  });

  if (isLoading) return <LoadingCard />;
  if (error) return <ErrorCard message="Failed to load delivery history." />;

  const entries = (data ?? []) as DashboardProjectTimelineEntry[];

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted">
          No delivery history for this project yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="relative space-y-0">
          {entries.map((entry, idx) => {
            const stateVariant = statusBadgeVariant(entry.state);
            return (
              <div key={entry.workflow_id} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="h-3 w-3 rounded-full border-2 border-accent bg-surface" />
                  {idx < entries.length - 1 && <div className="w-0.5 flex-1 bg-border" />}
                </div>
                <div className="pb-6 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/work/workflows/${entry.workflow_id}`}
                      className="text-sm font-medium text-accent hover:underline"
                    >
                      {entry.name}
                    </Link>
                    <Badge variant={stateVariant} className="capitalize text-[10px]">
                      {entry.state}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted">
                    <Calendar className="mr-1 inline h-3 w-3" />
                    {new Date(entry.created_at).toLocaleString()}
                    {entry.duration_seconds !== undefined && entry.duration_seconds !== null && (
                      <span className="ml-2">
                        Duration: {formatDuration(entry.duration_seconds)}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-muted">{describeDeliveryEntry(entry)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ArtifactsTab({ projectId }: { projectId: string }): JSX.Element {
  return <ProjectArtifactExplorerPanel projectId={projectId} />;
}

/* ------------------------------------------------------------------ */
/*  Git Webhook Tab                                                    */
/* ------------------------------------------------------------------ */

const GIT_PROVIDERS = ['github', 'gitea', 'gitlab'] as const;

function GitWebhookTab({ project }: { project: DashboardProjectRecord }): JSX.Element {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState(project.git_webhook_provider ?? 'github');
  const [secret, setSecret] = useState('');

  const mutation = useMutation({
    mutationFn: (payload: { provider: string; secret: string }) =>
      dashboardApi.configureGitWebhook(project.id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      setSecret('');
    },
  });

  function handleSave() {
    if (!secret.trim() || secret.trim().length < 8) return;
    mutation.mutate({ provider, secret: secret.trim() });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-4 w-4" />
            Git Webhook Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {project.git_webhook_provider && (
            <div className="rounded-md border bg-border/10 p-3 text-sm">
              <FieldRow label="Provider" value={project.git_webhook_provider} />
              <FieldRow
                label="Secret"
                value={project.git_webhook_secret_configured ? 'Configured' : 'Not set'}
              />
            </div>
          )}
          {!project.git_webhook_provider && (
            <p className="text-sm text-muted">
              No git webhook secret configured. Set one to enable per-project signature verification.
            </p>
          )}

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Provider</label>
              <select
                className="w-full rounded-md border bg-surface px-3 py-2 text-sm"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                {GIT_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Webhook Secret</label>
              <Input
                type="password"
                placeholder="Enter webhook secret (min 8 characters)"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={mutation.isPending || !secret.trim() || secret.trim().length < 8}
            >
              <Save className="h-4 w-4" />
              {project.git_webhook_provider ? 'Update' : 'Configure'} Webhook Secret
            </Button>
          </div>

          {mutation.isError && (
            <p className="text-sm text-red-600">Failed to save webhook configuration.</p>
          )}
          {mutation.isSuccess && (
            <p className="text-sm text-green-600">Webhook configuration saved.</p>
          )}
        </CardContent>
      </Card>

      {project.repository_url && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Repository</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldRow label="URL" value={project.repository_url} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AutomationTab({ project }: { project: DashboardProjectRecord }): JSX.Element {
  return (
    <div className="space-y-4">
      <ScheduledTriggersCard project={project} />
      <GitWebhookTab project={project} />
    </div>
  );
}

function ModelOverridesTab({ project }: { project: DashboardProjectRecord }): JSX.Element {
  const queryClient = useQueryClient();
  const [overrideDrafts, setOverrideDrafts] = useState<RoleOverrideDraft[]>([]);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const overridesQuery = useQuery({
    queryKey: ['project-model-overrides', project.id],
    queryFn: () => dashboardApi.getProjectModelOverrides(project.id),
  });
  const resolvedQuery = useQuery({
    queryKey: ['project-resolved-models', project.id],
    queryFn: () => dashboardApi.getResolvedProjectModels(project.id),
  });
  const providersQuery = useQuery({
    queryKey: ['llm-providers'],
    queryFn: () => dashboardApi.listLlmProviders(),
  });
  const modelsQuery = useQuery({
    queryKey: ['llm-models'],
    queryFn: () => dashboardApi.listLlmModels(),
  });

  useEffect(() => {
    if (!overridesQuery.data) {
      return;
    }
    const resolvedRoles = Object.keys(resolvedQuery.data?.effective_models ?? {});
    const overrideRoles = Object.keys(overridesQuery.data.model_overrides ?? {});
    const roleNames = [...new Set([...resolvedRoles, ...overrideRoles])];
    setOverrideDrafts(hydrateRoleOverrideDrafts(roleNames, overridesQuery.data.model_overrides ?? {}));
  }, [overridesQuery.data, resolvedQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsed = buildRoleModelOverrides(overrideDrafts) ?? {};
      return dashboardApi.patchProject(project.id, {
        settings: {
          ...asRecord(project.settings),
          model_overrides: parsed,
        },
      });
    },
    onSuccess: async () => {
      setSaveMessage('Project model overrides saved.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project', project.id] }),
        queryClient.invalidateQueries({ queryKey: ['project-model-overrides', project.id] }),
        queryClient.invalidateQueries({ queryKey: ['project-resolved-models', project.id] }),
      ]);
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
        <CardTitle>Project Model Overrides</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted">
            Define role-scoped model overrides for workflows in this project with structured fields
            instead of a raw JSON editor.
          </p>
          <RoleOverrideEditor
            drafts={overrideDrafts}
            resolvedRoles={Object.keys(resolvedQuery.data?.effective_models ?? {})}
            providerOptions={(providersQuery.data ?? []).map((provider) => provider.name)}
            modelOptions={modelsQuery.data ?? []}
            onChange={(drafts) => {
              setSaveMessage(null);
              setOverrideDrafts(drafts);
            }}
          />
          {saveMutation.error ? (
            <p className="text-sm text-red-600">
              {saveMutation.error instanceof Error
                ? saveMutation.error.message
                : 'Failed to save project model overrides.'}
            </p>
          ) : null}
          {saveMessage ? <p className="text-sm text-green-600">{saveMessage}</p> : null}
          <div className="flex justify-end">
            <Button disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              <Save className="h-4 w-4" />
              Save Overrides
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resolved Effective Models</CardTitle>
        </CardHeader>
        <CardContent>
          {resolvedQuery.isLoading ? <p className="text-sm text-muted">Resolving effective models...</p> : null}
          {resolvedQuery.error ? (
            <p className="text-sm text-red-600">Failed to load resolved effective models.</p>
          ) : null}
          {resolvedQuery.data ? (
            <ResolvedModelCards effectiveModels={resolvedQuery.data.effective_models} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

function LoadingCard(): JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </CardContent>
    </Card>
  );
}

function ErrorCard({ message }: { message: string }): JSX.Element {
  return (
    <Card>
      <CardContent className="py-4 text-sm text-red-600">{message}</CardContent>
    </Card>
  );
}

function FieldRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center gap-4">
      <span className="w-28 text-sm text-muted">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function InputField(props: {
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  type?: string;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium">{props.label}</label>
      <Input
        type={props.type ?? 'text'}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </div>
  );
}

function TextAreaField(props: {
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium">{props.label}</label>
      <Textarea
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
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
                  <SelectTrigger className="w-full">
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
                  Remove entry
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

function ValueInput(props: {
  valueType: StructuredValueType;
  value: string;
  onChange(value: string): void;
}): JSX.Element {
  if (props.valueType === 'boolean') {
    return (
      <Select value={props.value} onValueChange={props.onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select boolean value" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">Unset</SelectItem>
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

function RoleOverrideEditor(props: {
  drafts: RoleOverrideDraft[];
  resolvedRoles: string[];
  providerOptions: string[];
  modelOptions: DashboardLlmModelRecord[];
  onChange(drafts: RoleOverrideDraft[]): void;
}): JSX.Element {
  return (
    <div className="space-y-3">
      {props.drafts.length === 0 ? (
        <p className="text-sm text-muted">No project-specific model overrides configured.</p>
      ) : (
        props.drafts.map((draft) => {
          const isResolvedRole = props.resolvedRoles.includes(draft.role.trim());
          const providerOptions = ensureCurrentStringOption(props.providerOptions, draft.provider);
          const modelOptions = ensureCurrentStringOption(
            props.modelOptions
              .filter(
                (model) =>
                  !draft.provider ||
                  !model.provider_name ||
                  model.provider_name === draft.provider,
              )
              .map((model) => model.model_id),
            draft.model,
          );
          return (
            <div key={draft.id} className="space-y-3 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant={isResolvedRole ? 'secondary' : 'outline'}>
                    {isResolvedRole ? 'resolved role' : 'custom role'}
                  </Badge>
                  <span className="text-sm font-medium">{draft.role.trim() || 'New role override'}</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => props.onChange(props.drafts.filter((entry) => entry.id !== draft.id))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="grid gap-1 text-xs">
                  <span className="font-medium">Role</span>
                  <Input
                    value={draft.role}
                    onChange={(event) => props.onChange(updateRoleDraft(props.drafts, draft.id, { role: event.target.value }))}
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="font-medium">Provider</span>
                  <select
                    className="w-full rounded-md border bg-surface px-3 py-2 text-sm"
                    value={draft.provider}
                    onChange={(event) =>
                      props.onChange(
                        updateRoleDraft(props.drafts, draft.id, {
                          provider: event.target.value,
                          model: '',
                        }),
                      )
                    }
                  >
                    <option value="">Select provider</option>
                    {providerOptions.map((provider) => (
                      <option key={provider} value={provider}>
                        {provider}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="font-medium">Model</span>
                  <select
                    className="w-full rounded-md border bg-surface px-3 py-2 text-sm"
                    value={draft.model}
                    onChange={(event) =>
                      props.onChange(
                        updateRoleDraft(props.drafts, draft.id, { model: event.target.value }),
                      )
                    }
                  >
                    <option value="">Select model</option>
                    {modelOptions.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="grid gap-1 text-xs">
                <span className="font-medium">Reasoning Config JSON</span>
                <Textarea
                  value={draft.reasoningConfig}
                  className="min-h-[100px] font-mono text-xs"
                  placeholder='{"effort":"medium"}'
                  onChange={(event) => props.onChange(updateRoleDraft(props.drafts, draft.id, { reasoningConfig: event.target.value }))}
                />
              </label>
            </div>
          );
        })
      )}
      <Button type="button" variant="outline" onClick={() => props.onChange([...props.drafts, createRoleOverrideDraft()])}>
        <Plus className="h-4 w-4" />
        Add role override
      </Button>
    </div>
  );
}

function ensureCurrentStringOption(options: string[], currentValue: string): string[] {
  const normalized = options.filter((value, index) => value && options.indexOf(value) === index);
  if (currentValue && !normalized.includes(currentValue)) {
    return [currentValue, ...normalized];
  }
  return normalized;
}

function ResolvedModelCards(props: {
  effectiveModels: Record<string, DashboardEffectiveModelResolution>;
}): JSX.Element {
  const entries = Object.entries(props.effectiveModels);
  if (entries.length === 0) {
    return <p className="text-sm text-muted">No model overrides or resolved roles available.</p>;
  }

  return (
    <div className="space-y-3">
      {entries.map(([role, resolution]) => (
        <div key={role} className="rounded-md border bg-border/10 p-3 text-sm">
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="outline">{role}</Badge>
            <Badge variant={resolution.fallback ? 'destructive' : 'secondary'}>
              {resolution.source}
            </Badge>
          </div>
          {resolution.resolved ? (
            <>
              <div>
                {resolution.resolved.provider.name} / {resolution.resolved.model.modelId}
              </div>
              {resolution.resolved.reasoningConfig ? (
                <StructuredRecordView
                  data={resolution.resolved.reasoningConfig}
                  emptyMessage="No reasoning config."
                />
              ) : null}
            </>
          ) : (
            <p className="text-muted">No resolved model available.</p>
          )}
          {resolution.fallback_reason ? (
            <p className="mt-2 text-xs text-red-600">{resolution.fallback_reason}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function formatDuration(seconds?: number | null): string {
  if (seconds === undefined || seconds === null) return '-';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}m ${remaining}s`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function statusBadgeVariant(status: string) {
  const map: Record<string, 'success' | 'default' | 'destructive' | 'warning' | 'secondary'> = {
    completed: 'success',
    running: 'default',
    in_progress: 'default',
    failed: 'destructive',
    paused: 'warning',
    pending: 'secondary',
  };
  return map[status] ?? 'secondary';
}

function describeDeliveryEntry(entry: DashboardProjectTimelineEntry): string {
  const parts = [
    summarizeStageProgress(entry.stage_progression),
    summarizeWorkItemProgress(entry.stage_metrics),
    summarizeGateAttention(entry.stage_metrics),
    summarizeOrchestratorAnalytics(entry.orchestrator_analytics),
    summarizeArtifactCount(entry.produced_artifacts),
  ].filter(Boolean);

  return parts.length > 0
    ? parts.join(' • ')
    : 'Run summary available. Open the run for stage and gate detail.';
}

function summarizeStageProgress(
  progression: DashboardProjectTimelineEntry['stage_progression'],
): string | null {
  if (!Array.isArray(progression) || progression.length === 0) {
    return null;
  }
  const completed = progression.filter(
    (stage) =>
      stage &&
      typeof stage === 'object' &&
      'status' in stage &&
      (stage as Record<string, unknown>).status === 'completed',
  ).length;
  return `Stages ${completed}/${progression.length}`;
}

function summarizeWorkItemProgress(
  metrics: DashboardProjectTimelineEntry['stage_metrics'],
): string | null {
  if (!Array.isArray(metrics) || metrics.length === 0) {
    return null;
  }

  let total = 0;
  let open = 0;
  for (const metric of metrics) {
    const counts =
      metric &&
      typeof metric === 'object' &&
      'work_item_counts' in metric &&
      typeof (metric as { work_item_counts?: unknown }).work_item_counts === 'object' &&
      (metric as { work_item_counts?: Record<string, unknown> }).work_item_counts !== null
        ? (metric as { work_item_counts: Record<string, unknown> }).work_item_counts
        : null;
    total += Number(counts?.total ?? 0);
    open += Number(counts?.open ?? 0);
  }

  if (total === 0) {
    return null;
  }
  return `Work items ${total - open}/${total}`;
}

function summarizeGateAttention(
  metrics: DashboardProjectTimelineEntry['stage_metrics'],
): string | null {
  if (!Array.isArray(metrics) || metrics.length === 0) {
    return null;
  }
  const waiting = metrics.filter(
    (metric) =>
      metric &&
      typeof metric === 'object' &&
      'gate_status' in metric &&
      (metric as Record<string, unknown>).gate_status === 'awaiting_approval',
  ).length;
  return waiting > 0 ? `Gates waiting ${waiting}` : null;
}

function summarizeArtifactCount(
  artifacts: DashboardProjectTimelineEntry['produced_artifacts'],
): string | null {
  const count = Array.isArray(artifacts) ? artifacts.length : 0;
  return count > 0 ? `Artifacts ${count}` : null;
}

function summarizeOrchestratorAnalytics(
  analytics: DashboardProjectTimelineEntry['orchestrator_analytics'],
): string | null {
  const record = analytics && typeof analytics === 'object' ? (analytics as Record<string, unknown>) : null;
  if (!record) {
    return null;
  }

  const parts: string[] = [];
  const activationCount = Number(record.activation_count ?? 0);
  const reworkedTaskCount = Number(record.reworked_task_count ?? 0);
  const staleDetections = Number(record.stale_detection_count ?? 0);
  const totalCostUsd = Number(record.total_cost_usd ?? 0);

  if (activationCount > 0) {
    parts.push(`Activations ${activationCount}`);
  }
  if (reworkedTaskCount > 0) {
    parts.push(`Reworked tasks ${reworkedTaskCount}`);
  }
  if (staleDetections > 0) {
    parts.push(`Stale recoveries ${staleDetections}`);
  }
  if (totalCostUsd > 0) {
    parts.push(`Cost $${totalCostUsd.toFixed(2)}`);
  }
  return parts.length > 0 ? parts.join(' • ') : null;
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export function ProjectDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['project', id],
    queryFn: () => dashboardApi.getProject(id!),
    enabled: Boolean(id),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-red-600">Failed to load project. Please try again later.</div>
    );
  }

  const project = data as DashboardProjectRecord;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          {project.description && (
            <p className="mt-1 text-sm text-muted">{project.description}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/projects/${project.id}/memory`}>Memory Explorer</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={`/projects/${project.id}/artifacts`}>Artifact Explorer</Link>
          </Button>
          <Badge variant={project.is_active ? 'success' : 'secondary'}>
            {project.is_active ? 'Active' : 'Inactive'}
          </Badge>
        </div>
      </div>

      <Tabs defaultValue="spec">
        <TabsList>
          <TabsTrigger value="spec">Spec</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="timeline">Delivery</TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="automation">Automation</TabsTrigger>
        </TabsList>

        <TabsContent value="spec">
          <SpecTab projectId={project.id} />
        </TabsContent>

        <TabsContent value="resources">
          <ResourcesTab projectId={project.id} />
        </TabsContent>

        <TabsContent value="tools">
          <ToolsTab projectId={project.id} />
        </TabsContent>

        <TabsContent value="timeline">
          <TimelineTab projectId={project.id} />
        </TabsContent>

        <TabsContent value="memory">
          <ProjectDetailMemoryTab projectId={project.id} />
        </TabsContent>

        <TabsContent value="artifacts">
          <ArtifactsTab projectId={project.id} />
        </TabsContent>

        <TabsContent value="models">
          <ModelOverridesTab project={project} />
        </TabsContent>

        <TabsContent value="automation">
          <AutomationTab project={project} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
