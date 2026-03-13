import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import {
  Bot,
  BrainCircuit,
  Boxes,
  FolderKanban,
  Loader2,
  PackageSearch,
  Plus,
  Trash2,
  Save,
  Webhook,
  Wrench,
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
} from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { StructuredRecordView } from '../../components/structured-data.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs.js';
import {
  buildProjectModelOverview,
  buildProjectWorkspaceOverview,
  buildRoleModelOverrides,
  buildStructuredObject,
  createRoleOverrideDraft,
  createStructuredEntryDraft,
  hydrateRoleOverrideDrafts,
  normalizeProjectDetailTab,
  objectToStructuredDrafts,
  PROJECT_DETAIL_TAB_OPTIONS,
  type ProjectDetailTabValue,
  type RoleOverrideDraft,
  type StructuredEntryDraft,
  type StructuredValueType,
} from './project-detail-support.js';
import { ProjectArtifactExplorerPanel } from './project-artifact-explorer-panel.js';
import { ProjectDeliveryHistory } from './project-delivery-history.js';
import { ProjectDetailMemoryTab } from './project-detail-memory-tab.js';
import { ScheduledTriggersCard } from './project-scheduled-triggers-card.js';
import { WebhookTriggersCard } from './project-webhook-triggers-card.js';

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
          <FieldRow
            label="Version"
            value={spec.version !== undefined ? String(spec.version) : '-'}
          />
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
          {saveMutation.error instanceof Error
            ? saveMutation.error.message
            : 'Failed to save project spec.'}
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
    <div className="space-y-4">
      <Card className="border-border/70 shadow-none">
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">Resource posture</CardTitle>
          <CardDescription>
            Review project-scoped resources and metadata without forcing phone-sized operators into
            a dense desktop table.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <WorkspaceMetricCard
            label="Resources"
            value={`${resources.length}`}
            detail="Configured project resource records."
          />
          <WorkspaceMetricCard
            label="Typed resources"
            value={`${resources.filter((resource) => Boolean(resource.type)).length}`}
            detail="Resources with an explicit type label."
          />
          <WorkspaceMetricCard
            label="Described"
            value={`${resources.filter((resource) => Boolean(resource.description)).length}`}
            detail="Resources that already explain operator intent."
          />
          <WorkspaceMetricCard
            label="Metadata"
            value={`${resources.filter((resource) => countRecordEntries(resource.metadata) > 0).length}`}
            detail="Resources carrying structured metadata for downstream automation."
          />
        </CardContent>
      </Card>

      <div className="grid gap-3 md:hidden">
        {resources.map((resource, index) => (
          <Card key={resource.id ?? index} className="border-border/70 shadow-none">
            <CardContent className="grid gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-foreground">
                  {resource.name ?? resource.id ?? '-'}
                </div>
                <Badge variant="secondary">{resource.type ?? 'Unlabeled'}</Badge>
              </div>
              <p className="text-sm leading-6 text-muted">
                {resource.description ?? 'No resource description is saved yet.'}
              </p>
              <div className="space-y-2 rounded-xl border border-border/70 bg-background/70 p-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
                  Metadata
                </div>
                {resource.metadata && Object.keys(resource.metadata).length > 0 ? (
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs text-muted">
                    {JSON.stringify(resource.metadata, null, 2)}
                  </pre>
                ) : (
                  <p className="text-sm text-muted">No metadata.</p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="hidden border-border/70 shadow-none md:block">
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
              {resources.map((resource, index) => (
                <TableRow key={resource.id ?? index}>
                  <TableCell className="font-medium">
                    {resource.name ?? resource.id ?? '-'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{resource.type ?? '-'}</Badge>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-sm">
                    {resource.description ?? '-'}
                  </TableCell>
                  <TableCell>
                    {resource.metadata && Object.keys(resource.metadata).length > 0 ? (
                      <pre className="max-w-xs truncate text-xs">
                        {JSON.stringify(resource.metadata)}
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
    </div>
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
      name:
        typeof t === 'object' && t !== null && 'name' in t
          ? String((t as { name: string }).name)
          : String(t),
      isBlocked: false,
      data: t,
    })),
    ...blockedTools.map((t) => ({
      name:
        typeof t === 'object' && t !== null && 'name' in t
          ? String((t as { name: string }).name)
          : String(t),
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
    <div className="space-y-4">
      <Card className="border-border/70 shadow-none">
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">Tool posture</CardTitle>
          <CardDescription>
            Check what the project can use right now and which tools remain blocked before an
            operator launches or edits work.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <WorkspaceMetricCard
            label="Available"
            value={`${tools.filter((tool) => !tool.isBlocked).length}`}
            detail="Project tools currently enabled for use."
          />
          <WorkspaceMetricCard
            label="Blocked"
            value={`${tools.filter((tool) => tool.isBlocked).length}`}
            detail="Tools explicitly blocked by project policy."
          />
          <WorkspaceMetricCard
            label="Catalog size"
            value={`${tools.length}`}
            detail="Combined available and blocked tool records."
          />
        </CardContent>
      </Card>

      <div className="grid gap-3 md:hidden">
        {tools.map((tool) => (
          <Card key={tool.name} className="border-border/70 shadow-none">
            <CardContent className="flex items-start justify-between gap-4 p-4">
              <div className="space-y-2">
                <div className="text-sm font-semibold text-foreground">{tool.name}</div>
                <p className="text-sm text-muted">
                  {tool.isBlocked
                    ? 'Blocked at the project layer.'
                    : 'Available to project-scoped automation and operator work.'}
                </p>
                <Badge variant={tool.isBlocked ? 'destructive' : 'success'}>
                  {tool.isBlocked ? 'Blocked' : 'Available'}
                </Badge>
              </div>
              <Switch checked={!tool.isBlocked} disabled />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="hidden border-border/70 shadow-none md:block">
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Timeline Tab                                                       */
/* ------------------------------------------------------------------ */

function TimelineTab({ projectId }: { projectId: string }): JSX.Element {
  return <ProjectDeliveryHistory projectId={projectId} />;
}

function ArtifactsTab({ projectId }: { projectId: string }): JSX.Element {
  return <ProjectArtifactExplorerPanel projectId={projectId} />;
}

/* ------------------------------------------------------------------ */
/*  Git Webhook Tab                                                    */
/* ------------------------------------------------------------------ */

const GIT_PROVIDERS = ['github', 'gitea', 'gitlab'] as const;
const EMPTY_SELECT_VALUE = '__empty__';

function GitWebhookTab({ project }: { project: DashboardProjectRecord }): JSX.Element {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState(project.git_webhook_provider ?? 'github');
  const [secret, setSecret] = useState('');
  const trimmedSecret = secret.trim();
  const secretError =
    trimmedSecret.length > 0 && trimmedSecret.length < 8
      ? 'Enter at least 8 characters so signature verification is usable.'
      : null;

  const mutation = useMutation({
    mutationFn: (payload: { provider: string; secret: string }) =>
      dashboardApi.configureGitWebhook(project.id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      setSecret('');
    },
  });

  function handleSave() {
    if (!trimmedSecret || secretError) return;
    mutation.mutate({ provider, secret: trimmedSecret });
  }

  return (
    <div className="space-y-4">
      <Card className="border-border/70 shadow-none">
        <CardHeader className="space-y-2">
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-4 w-4" />
            Git Webhook Configuration
          </CardTitle>
          <CardDescription>
            Keep repository signature verification discoverable from the same project automation
            workspace that owns inbound schedules and webhook rules.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <WorkspaceMetricCard
              label="Provider"
              value={
                project.git_webhook_provider
                  ? formatProviderName(project.git_webhook_provider)
                  : 'Not set'
              }
              detail="The repository provider expected to sign inbound events."
            />
            <WorkspaceMetricCard
              label="Secret posture"
              value={project.git_webhook_secret_configured ? 'Configured' : 'Missing'}
              detail="Project-scoped signature verification should stay visible here, not hidden behind a backend-only setting."
            />
            <WorkspaceMetricCard
              label="Repository"
              value={project.repository_url ? 'Linked' : 'Not linked'}
              detail={
                project.repository_url
                  ? 'A repository URL is already attached to this project.'
                  : 'Add a repository URL if operators expect inbound repository-driven automation.'
              }
            />
          </div>

          <section
            className={cn(
              'rounded-xl border p-4',
              project.git_webhook_secret_configured
                ? 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/20'
                : 'border-amber-300 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/20',
            )}
          >
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-foreground">Save readiness</h4>
              <p className="text-sm leading-6 text-muted">
                {project.git_webhook_secret_configured
                  ? 'Repository signature verification is already configured. Update the secret here if the repository integration has rotated credentials.'
                  : 'No git webhook secret is configured yet. Add one here before relying on signed repository events.'}
              </p>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
            <label className="space-y-1">
              <span className="text-xs font-medium">Provider</span>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GIT_PROVIDERS.map((providerOption) => (
                    <SelectItem key={providerOption} value={providerOption}>
                      {formatProviderName(providerOption)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted">
                Match the repository provider so operators do not have to infer which signature
                header is expected.
              </p>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium">Webhook Secret</span>
              <Input
                type="password"
                placeholder="Enter webhook secret (min 8 characters)"
                value={secret}
                className={secretError ? 'border-red-300 focus-visible:ring-red-500' : undefined}
                aria-invalid={secretError ? true : undefined}
                onChange={(event) => setSecret(event.target.value)}
              />
              {secretError ? <p className="text-xs text-red-600">{secretError}</p> : null}
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/70 p-3">
            <p className="text-sm text-muted">
              This secret is stored through the backend. The workspace only exposes enough posture
              to confirm that signature verification is configured and reachable.
            </p>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={mutation.isPending || !trimmedSecret || Boolean(secretError)}
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
        <Card className="border-border/70 shadow-none">
          <CardHeader className="space-y-2">
            <CardTitle className="text-sm">Repository</CardTitle>
            <CardDescription>
              Operators should be able to confirm the attached repository without leaving the
              project workspace.
            </CardDescription>
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
      <Card className="border-border/70 shadow-none">
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">Automation workspace</CardTitle>
          <CardDescription>
            Keep recurring work, inbound webhook rules, and repository signature posture together so
            operators can verify the full project automation path in one pass.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <WorkspaceMetricCard
              label="Schedules"
              value="Recurring work"
              detail="Use the schedule section to route regular project work into a target run."
            />
            <WorkspaceMetricCard
              label="Inbound hooks"
              value="External events"
              detail="Project webhook triggers turn external events into work items without leaving this workspace."
            />
            <WorkspaceMetricCard
              label="Repo signatures"
              value={project.git_webhook_provider ? 'Configured' : 'Needs setup'}
              detail={
                project.git_webhook_provider
                  ? 'Repository signature verification is already configured.'
                  : 'Configure a git webhook secret if repository events should be trusted.'
              }
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <a href="#project-automation-schedules">Jump to schedules</a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href="#project-automation-webhooks">Jump to webhook rules</a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href="#project-automation-repository">Jump to repository signatures</a>
            </Button>
          </div>
        </CardContent>
      </Card>

      <section id="project-automation-schedules" className="scroll-mt-24">
        <ScheduledTriggersCard project={project} />
      </section>
      <section id="project-automation-webhooks" className="scroll-mt-24">
        <WebhookTriggersCard project={project} />
      </section>
      <section id="project-automation-repository" className="scroll-mt-24">
        <GitWebhookTab project={project} />
      </section>
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
    setOverrideDrafts(
      hydrateRoleOverrideDrafts(roleNames, overridesQuery.data.model_overrides ?? {}),
    );
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

  const modelOverview = buildProjectModelOverview(
    overridesQuery.data?.model_overrides,
    resolvedQuery.data?.effective_models,
  );

  return (
    <div className="space-y-4">
      <Card className="border-border/70 shadow-none">
        <CardHeader className="space-y-2">
          <CardTitle>Project Model Overrides</CardTitle>
          <CardDescription>
            Adjust project-only role posture here, then verify the resolved outcome before operators
            launch or resume work.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {modelOverview.packets.map((packet) => (
              <WorkspaceMetricCard
                key={packet.label}
                label={packet.label}
                value={packet.value}
                detail={packet.detail}
              />
            ))}
          </div>
          <div className="rounded-xl border border-border/70 bg-background/70 p-4 text-sm leading-6 text-muted">
            {modelOverview.summary}
          </div>
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
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/70 p-3">
            <p className="text-sm text-muted">
              Save after changing provider, model, or reasoning config so the resolved posture card
              below stays truthful.
            </p>
            <Button disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              <Save className="h-4 w-4" />
              Save Overrides
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-none">
        <CardHeader className="space-y-2">
          <CardTitle>Resolved Effective Models</CardTitle>
          <CardDescription>
            Confirm the effective provider, model, and any fallback condition without switching to
            an inspector.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {resolvedQuery.isLoading ? (
            <p className="text-sm text-muted">Resolving effective models...</p>
          ) : null}
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
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4">
      <span className="w-28 text-sm text-muted">{label}</span>
      <span className="break-all text-sm font-medium">{value}</span>
    </div>
  );
}

function WorkspaceMetricCard(props: { label: string; value: string; detail: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-background/70 p-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
        {props.label}
      </div>
      <div className="mt-1 text-sm font-semibold text-foreground">{props.value}</div>
      <p className="mt-1 text-sm leading-6 text-muted">{props.detail}</p>
    </div>
  );
}

function countRecordEntries(value: Record<string, unknown> | null | undefined): number {
  return Object.keys(value ?? {}).length;
}

function formatProviderName(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
                  onChange={(event) =>
                    props.onChange(
                      updateStructuredDraft(props.drafts, draft.id, { key: event.target.value }),
                    )
                  }
                />
              </label>
              <label className="grid gap-1 text-xs">
                <span className="font-medium">Type</span>
                <Select
                  value={draft.valueType}
                  onValueChange={(value) =>
                    props.onChange(
                      updateStructuredDraft(props.drafts, draft.id, {
                        valueType: value as StructuredValueType,
                      }),
                    )
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
                  onChange={(value) =>
                    props.onChange(updateStructuredDraft(props.drafts, draft.id, { value }))
                  }
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    props.onChange(props.drafts.filter((entry) => entry.id !== draft.id))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                  Remove entry
                </Button>
              </div>
            </div>
          </div>
        ))
      )}
      <Button
        type="button"
        variant="outline"
        onClick={() => props.onChange([...props.drafts, createStructuredEntryDraft()])}
      >
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
                  !draft.provider || !model.provider_name || model.provider_name === draft.provider,
              )
              .map((model) => model.model_id),
            draft.model,
          );
          return (
            <div
              key={draft.id}
              className="space-y-3 rounded-xl border border-border/70 bg-background/70 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge variant={isResolvedRole ? 'secondary' : 'outline'}>
                    {isResolvedRole ? 'resolved role' : 'custom role'}
                  </Badge>
                  <span className="text-sm font-medium">
                    {draft.role.trim() || 'New role override'}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    props.onChange(props.drafts.filter((entry) => entry.id !== draft.id))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                  Remove role
                </Button>
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                <label className="grid gap-1 text-xs">
                  <span className="font-medium">Role</span>
                  <Input
                    value={draft.role}
                    placeholder="architect"
                    onChange={(event) =>
                      props.onChange(
                        updateRoleDraft(props.drafts, draft.id, { role: event.target.value }),
                      )
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="font-medium">Provider</span>
                  <Select
                    value={draft.provider || EMPTY_SELECT_VALUE}
                    onValueChange={(value) =>
                      props.onChange(
                        updateRoleDraft(props.drafts, draft.id, {
                          provider: value === EMPTY_SELECT_VALUE ? '' : value,
                          model: '',
                        }),
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={EMPTY_SELECT_VALUE}>Select provider</SelectItem>
                      {providerOptions.map((provider) => (
                        <SelectItem key={provider} value={provider}>
                          {provider}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="font-medium">Model</span>
                  <Select
                    value={draft.model || EMPTY_SELECT_VALUE}
                    onValueChange={(value) =>
                      props.onChange(
                        updateRoleDraft(props.drafts, draft.id, {
                          model: value === EMPTY_SELECT_VALUE ? '' : value,
                        }),
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select model" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={EMPTY_SELECT_VALUE}>Select model</SelectItem>
                      {modelOptions.map((model) => (
                        <SelectItem key={model} value={model}>
                          {model}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted">
                    {draft.provider
                      ? 'Only models for the selected provider are shown here.'
                      : 'Choose a provider first to narrow the available models.'}
                  </p>
                </label>
              </div>
              <label className="grid gap-1 text-xs">
                <span className="font-medium">Reasoning Config JSON</span>
                <Textarea
                  value={draft.reasoningConfig}
                  className="min-h-[100px] font-mono text-xs"
                  placeholder='{"effort":"medium"}'
                  onChange={(event) =>
                    props.onChange(
                      updateRoleDraft(props.drafts, draft.id, {
                        reasoningConfig: event.target.value,
                      }),
                    )
                  }
                />
                <p className="text-xs text-muted">
                  Leave this blank unless the provider/model pair needs explicit reasoning posture
                  overrides.
                </p>
              </label>
            </div>
          );
        })
      )}
      <Button
        type="button"
        variant="outline"
        onClick={() => props.onChange([...props.drafts, createRoleOverrideDraft()])}
      >
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

function ProjectWorkspaceTabIcon(props: {
  tab: ProjectDetailTabValue;
  className?: string;
}): JSX.Element {
  const iconClassName = props.className;
  if (props.tab === 'resources') {
    return <Boxes className={iconClassName} />;
  }
  if (props.tab === 'tools') {
    return <Wrench className={iconClassName} />;
  }
  if (props.tab === 'timeline') {
    return <FolderKanban className={iconClassName} />;
  }
  if (props.tab === 'memory') {
    return <BrainCircuit className={iconClassName} />;
  }
  if (props.tab === 'artifacts') {
    return <PackageSearch className={iconClassName} />;
  }
  if (props.tab === 'models') {
    return <Bot className={iconClassName} />;
  }
  if (props.tab === 'automation') {
    return <Webhook className={iconClassName} />;
  }
  return <Zap className={iconClassName} />;
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export function ProjectDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ['project', id],
    queryFn: () => dashboardApi.getProject(id!),
    enabled: Boolean(id),
  });
  const projectSpecQuery = useQuery({
    queryKey: ['project-spec', id],
    queryFn: () => dashboardApi.getProjectSpec(id!),
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
    return <div className="p-6 text-red-600">Failed to load project. Please try again later.</div>;
  }

  const project = data as DashboardProjectRecord;
  const activeTab = normalizeProjectDetailTab(searchParams.get('tab'));
  const activeTabOption =
    PROJECT_DETAIL_TAB_OPTIONS.find((option) => option.value === activeTab) ??
    PROJECT_DETAIL_TAB_OPTIONS[0];
  const projectOverview = buildProjectWorkspaceOverview(project, projectSpecQuery.data);

  function handleTabChange(nextTab: ProjectDetailTabValue): void {
    const nextSearchParams = new URLSearchParams(searchParams);
    if (nextTab === 'spec') {
      nextSearchParams.delete('tab');
    } else {
      nextSearchParams.set('tab', nextTab);
    }
    setSearchParams(nextSearchParams, { replace: true });
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <Card className="border-border/70 shadow-none">
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={project.is_active ? 'success' : 'secondary'}>
                  {project.is_active ? 'Active' : 'Inactive'}
                </Badge>
                <Badge variant="outline">{project.slug}</Badge>
                {project.repository_url ? <Badge variant="outline">Repository linked</Badge> : null}
              </div>
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
                <p className="text-sm leading-6 text-muted">
                  {project.description ??
                    'Project detail keeps the shipped workspace tabs, configuration, delivery history, and project-scoped controls in one place.'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to={`/projects/${project.id}/memory`}>Memory Explorer</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to={`/projects/${project.id}/artifacts`}>Artifact Explorer</Link>
              </Button>
            </div>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/70 p-4 text-sm leading-6 text-muted">
            {projectOverview.summary}
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {projectOverview.packets.map((packet) => (
            <WorkspaceMetricCard
              key={packet.label}
              label={packet.label}
              value={packet.value}
              detail={packet.detail}
            />
          ))}
        </CardContent>
      </Card>

      <Tabs
        value={activeTab}
        onValueChange={(value) => handleTabChange(value as ProjectDetailTabValue)}
      >
        <div className="sticky top-0 z-10 space-y-3 rounded-2xl bg-background/95 pb-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <Card className="border-border/70 shadow-none">
            <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <ProjectWorkspaceTabIcon tab={activeTab} className="h-4 w-4 text-muted" />
                  {activeTabOption.label}
                </div>
                <p className="text-sm leading-6 text-muted">{activeTabOption.description}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link to={`/projects/${project.id}/memory`}>Open memory workspace</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to={`/projects/${project.id}/artifacts`}>Open artifact workspace</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="sm:hidden">
            <Select
              value={activeTab}
              onValueChange={(value) => handleTabChange(value as ProjectDetailTabValue)}
            >
              <SelectTrigger aria-label="Select project workspace tab">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_DETAIL_TAB_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <TabsList className="hidden h-auto w-full flex-wrap gap-1 rounded-xl bg-border/30 p-1 sm:inline-flex">
            {PROJECT_DETAIL_TAB_OPTIONS.map((option) => (
              <TabsTrigger key={option.value} value={option.value} className="flex-1">
                {option.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

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
