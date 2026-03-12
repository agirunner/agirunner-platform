import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  Loader2,
  Plus,
  Trash2,
  Save,
  Code2,
  FileText,
  Calendar,
  Webhook,
  Zap,
} from 'lucide-react';
import { dashboardApi } from '../../lib/api.js';
import type {
  DashboardEffectiveModelResolution,
  DashboardProjectRecord,
  DashboardProjectSpecRecord,
  DashboardProjectResourceRecord,
  DashboardRoleModelOverride,
  DashboardScheduledWorkItemTriggerRecord,
  DashboardProjectToolCatalog,
  DashboardProjectTimelineEntry,
  DashboardWorkflowRecord,
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

/* ------------------------------------------------------------------ */
/*  Spec Tab                                                           */
/* ------------------------------------------------------------------ */

function SpecTab({ projectId }: { projectId: string }): JSX.Element {
  const [isRawJson, setIsRawJson] = useState(false);
  const [editedJson, setEditedJson] = useState('');
  const [hasEdits, setHasEdits] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['project-spec', projectId],
    queryFn: () => dashboardApi.getProjectSpec(projectId),
  });

  if (isLoading) {
    return <LoadingCard />;
  }

  if (error) {
    return <ErrorCard message="Failed to load project spec." />;
  }

  const spec = data as DashboardProjectSpecRecord;
  const jsonString = JSON.stringify(spec, null, 2);

  function handleJsonEdit(value: string) {
    setEditedJson(value);
    setHasEdits(true);
  }

  if (isRawJson) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setIsRawJson(false)}>
            <FileText className="h-4 w-4" />
            Form View
          </Button>
          {hasEdits && (
            <Button size="sm" disabled>
              <Save className="h-4 w-4" />
              Save (read-only)
            </Button>
          )}
        </div>
        <Card>
          <CardContent className="p-0">
            <Textarea
              className="min-h-[400px] font-mono text-xs border-0 rounded-lg"
              value={hasEdits ? editedJson : jsonString}
              onChange={(e) => handleJsonEdit(e.target.value)}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button variant="outline" size="sm" onClick={() => { setIsRawJson(true); setEditedJson(jsonString); }}>
          <Code2 className="h-4 w-4" />
          Raw JSON
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

      {spec.config && Object.keys(spec.config).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Config</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md border bg-border/10 p-3 text-xs">
              {JSON.stringify(spec.config, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {spec.instructions && Object.keys(spec.instructions).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Instructions</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md border bg-border/10 p-3 text-xs">
              {JSON.stringify(spec.instructions, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
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

/* ------------------------------------------------------------------ */
/*  Memory Tab                                                         */
/* ------------------------------------------------------------------ */

function MemoryTab({ projectId }: { projectId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => dashboardApi.getProject(projectId),
  });

  const patchMutation = useMutation({
    mutationFn: (payload: { key: string; value: unknown }) =>
      dashboardApi.patchProjectMemory(projectId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  if (isLoading) return <LoadingCard />;

  const memory = (data?.memory ?? {}) as Record<string, unknown>;

  function handleAdd() {
    if (!newKey.trim()) return;
    let parsedValue: unknown = newValue;
    try {
      parsedValue = JSON.parse(newValue);
    } catch {
      /* use raw string */
    }
    patchMutation.mutate({ key: newKey.trim(), value: parsedValue });
    setNewKey('');
    setNewValue('');
  }

  function handleDelete(key: string) {
    patchMutation.mutate({ key, value: null });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Memory Entries</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(memory).length === 0 ? (
            <p className="text-sm text-muted">No memory entries.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(memory).map(([key, value]) => (
                  <TableRow key={key}>
                    <TableCell className="font-mono text-sm">{key}</TableCell>
                    <TableCell>
                      <pre className="max-w-md truncate text-xs">
                        {typeof value === 'string' ? value : JSON.stringify(value)}
                      </pre>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(key)}
                        disabled={patchMutation.isPending}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Add Entry</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium">Key</label>
              <Input
                placeholder="my_key"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
              />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium">Value (string or JSON)</label>
              <Input
                placeholder='"value" or {"key": "val"}'
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
              />
            </div>
            <Button size="sm" onClick={handleAdd} disabled={patchMutation.isPending || !newKey.trim()}>
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Git Webhook Tab                                                    */
/* ------------------------------------------------------------------ */

const GIT_PROVIDERS = ['github', 'gitea', 'gitlab'] as const;
const DEFAULT_SCHEDULED_TRIGGER_SOURCE = 'project.schedule';

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

interface ScheduledTriggerFormState {
  name: string;
  source: string;
  workflowId: string;
  cadenceMinutes: string;
  title: string;
  stageName: string;
  ownerRole: string;
  goal: string;
  notes: string;
  nextFireAt: string;
}

const INITIAL_SCHEDULED_TRIGGER_FORM: ScheduledTriggerFormState = {
  name: '',
  source: DEFAULT_SCHEDULED_TRIGGER_SOURCE,
  workflowId: '',
  cadenceMinutes: '60',
  title: '',
  stageName: '',
  ownerRole: '',
  goal: '',
  notes: '',
  nextFireAt: '',
};

function AutomationTab({ project }: { project: DashboardProjectRecord }): JSX.Element {
  return (
    <div className="space-y-4">
      <ScheduledTriggersTab project={project} />
      <GitWebhookTab project={project} />
    </div>
  );
}

function ScheduledTriggersTab({ project }: { project: DashboardProjectRecord }): JSX.Element {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ScheduledTriggerFormState>(INITIAL_SCHEDULED_TRIGGER_FORM);

  const triggersQuery = useQuery({
    queryKey: ['scheduled-work-item-triggers', project.id],
    queryFn: () => dashboardApi.listScheduledWorkItemTriggers(),
  });
  const workflowsQuery = useQuery({
    queryKey: ['project-workflows', project.id],
    queryFn: () => dashboardApi.listWorkflows({ project_id: project.id, per_page: '100' }),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      dashboardApi.createScheduledWorkItemTrigger(buildScheduledTriggerPayload(project.id, form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-work-item-triggers', project.id] });
      setForm(INITIAL_SCHEDULED_TRIGGER_FORM);
    },
  });
  const toggleMutation = useMutation({
    mutationFn: ({ triggerId, isActive }: { triggerId: string; isActive: boolean }) =>
      dashboardApi.updateScheduledWorkItemTrigger(triggerId, { is_active: isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-work-item-triggers', project.id] });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (triggerId: string) => dashboardApi.deleteScheduledWorkItemTrigger(triggerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-work-item-triggers', project.id] });
    },
  });

  const workflows = (workflowsQuery.data?.data ?? []) as DashboardWorkflowRecord[];
  const scheduledTriggers = ((triggersQuery.data?.data ?? []) as DashboardScheduledWorkItemTriggerRecord[])
    .filter((trigger) => trigger.project_id === project.id)
    .sort((left, right) => left.next_fire_at.localeCompare(right.next_fire_at));

  const workflowOptions = workflows.filter((workflow) => workflow.id.length > 0);
  const canCreate = form.name.trim() && form.workflowId && form.title.trim();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-4 w-4" />
          Scheduled Work Item Triggers
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-md border bg-border/10 p-3 text-sm text-muted">
          Scheduled triggers belong to the project they automate. They create work items on a
          cadence, target a project run, and wake the orchestrator through the normal
          activation path.
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Current schedules</h3>
            <Link to="/config/triggers" className="text-sm text-accent hover:underline">
              Open trigger overview
            </Link>
          </div>
          {triggersQuery.isLoading ? (
            <LoadingCard />
          ) : scheduledTriggers.length === 0 ? (
            <p className="text-sm text-muted">No scheduled work item triggers for this project.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Target Run</TableHead>
                  <TableHead>Cadence</TableHead>
                  <TableHead>Next Run</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="w-[60px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scheduledTriggers.map((trigger) => {
                  const workflow = workflows.find((item) => item.id === trigger.workflow_id);
                  const health = describeTriggerHealth(trigger);
                  return (
                    <TableRow key={trigger.id}>
                      <TableCell className="font-medium">
                        <div className="space-y-1">
                          <div>{trigger.name}</div>
                          <div className="text-xs text-muted">{trigger.source}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div>{workflow?.name ?? trigger.workflow_id}</div>
                          {trigger.last_fired_at ? (
                            <div className="text-xs text-muted">
                              Last run {formatDateTime(trigger.last_fired_at)}
                            </div>
                          ) : (
                            <div className="text-xs text-muted">Not fired yet</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{formatCadence(trigger.cadence_minutes)}</TableCell>
                      <TableCell>{formatDateTime(trigger.next_fire_at)}</TableCell>
                      <TableCell>
                        <Badge variant={health.variant}>{health.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={trigger.is_active}
                          disabled={toggleMutation.isPending}
                          onCheckedChange={(checked) =>
                            toggleMutation.mutate({ triggerId: trigger.id, isActive: checked })}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(trigger.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        <div className="space-y-4 rounded-md border p-4">
          <h3 className="text-sm font-medium">Add schedule</h3>
          {workflowOptions.length === 0 ? (
            <p className="text-sm text-muted">
              Create a project run before adding a scheduled trigger.
            </p>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <InputField
                  label="Name"
                  value={form.name}
                  onChange={(value) => setForm((current) => ({ ...current, name: value }))}
                  placeholder="Daily triage"
                />
                <InputField
                  label="Source"
                  value={form.source}
                  onChange={(value) => setForm((current) => ({ ...current, source: value }))}
                  placeholder={DEFAULT_SCHEDULED_TRIGGER_SOURCE}
                />
                <div className="space-y-1">
                  <label className="text-xs font-medium">Target Run</label>
                  <select
                    className="w-full rounded-md border bg-surface px-3 py-2 text-sm"
                    value={form.workflowId}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, workflowId: event.target.value }))}
                  >
                    <option value="">Select run</option>
                    {workflowOptions.map((workflow) => (
                      <option key={workflow.id} value={workflow.id}>
                        {workflow.name}
                      </option>
                    ))}
                  </select>
                </div>
                <InputField
                  label="Cadence (minutes)"
                  value={form.cadenceMinutes}
                  onChange={(value) => setForm((current) => ({ ...current, cadenceMinutes: value }))}
                  placeholder="60"
                />
                <InputField
                  label="Work item title"
                  value={form.title}
                  onChange={(value) => setForm((current) => ({ ...current, title: value }))}
                  placeholder="Run daily inbox triage"
                />
                <InputField
                  label="Stage name"
                  value={form.stageName}
                  onChange={(value) => setForm((current) => ({ ...current, stageName: value }))}
                  placeholder="triage"
                />
                <InputField
                  label="Owner role"
                  value={form.ownerRole}
                  onChange={(value) => setForm((current) => ({ ...current, ownerRole: value }))}
                  placeholder="triager"
                />
                <InputField
                  label="First run (optional)"
                  type="datetime-local"
                  value={form.nextFireAt}
                  onChange={(value) => setForm((current) => ({ ...current, nextFireAt: value }))}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <TextAreaField
                  label="Goal"
                  value={form.goal}
                  onChange={(value) => setForm((current) => ({ ...current, goal: value }))}
                  placeholder="Check open work, route urgent items, and summarize the queue."
                />
                <TextAreaField
                  label="Notes"
                  value={form.notes}
                  onChange={(value) => setForm((current) => ({ ...current, notes: value }))}
                  placeholder="Optional operator notes for the generated work item."
                />
              </div>
              {createMutation.isError ? (
                <p className="text-sm text-red-600">Failed to create scheduled trigger.</p>
              ) : null}
              <div className="flex justify-end">
                <Button
                  disabled={createMutation.isPending || !canCreate}
                  onClick={() => createMutation.mutate()}
                >
                  <Plus className="h-4 w-4" />
                  Add schedule
                </Button>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ModelOverridesTab({ project }: { project: DashboardProjectRecord }): JSX.Element {
  const queryClient = useQueryClient();
  const [overrideText, setOverrideText] = useState('{\n  \n}');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const overridesQuery = useQuery({
    queryKey: ['project-model-overrides', project.id],
    queryFn: () => dashboardApi.getProjectModelOverrides(project.id),
  });
  const resolvedQuery = useQuery({
    queryKey: ['project-resolved-models', project.id],
    queryFn: () => dashboardApi.getResolvedProjectModels(project.id),
  });

  useEffect(() => {
    if (!overridesQuery.data) {
      return;
    }
    setOverrideText(JSON.stringify(overridesQuery.data.model_overrides ?? {}, null, 2));
  }, [overridesQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsed = parseRoleModelOverridesJson(overrideText, 'Project model overrides');
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
            Define role-scoped model overrides for workflows in this project. Each key is a role
            name and each value must include `provider` and `model`.
          </p>
          <Textarea
            value={overrideText}
            onChange={(event) => {
              setSaveMessage(null);
              setOverrideText(event.target.value);
            }}
            className="min-h-[220px] font-mono text-xs"
            placeholder={'{\n  "architect": {\n    "provider": "openai",\n    "model": "gpt-5"\n  }\n}'}
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

function formatCadence(minutes: number): string {
  if (minutes < 60) return `Every ${minutes} min`;
  if (minutes % 60 === 0) return `Every ${minutes / 60} hr`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return `Every ${hours} hr ${remaining} min`;
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toLocaleString();
}

function describeTriggerHealth(trigger: DashboardScheduledWorkItemTriggerRecord) {
  if (!trigger.is_active) {
    return { label: 'Disabled', variant: 'secondary' as const };
  }
  if (Date.parse(trigger.next_fire_at) <= Date.now()) {
    return { label: 'Due', variant: 'warning' as const };
  }
  return { label: 'Scheduled', variant: 'success' as const };
}

function buildScheduledTriggerPayload(projectId: string, form: ScheduledTriggerFormState) {
  const cadenceMinutes = Number(form.cadenceMinutes);
  const defaults: Record<string, unknown> = {
    title: form.title.trim(),
  };
  if (form.stageName.trim()) defaults.stage_name = form.stageName.trim();
  if (form.ownerRole.trim()) defaults.owner_role = form.ownerRole.trim();
  if (form.goal.trim()) defaults.goal = form.goal.trim();
  if (form.notes.trim()) defaults.notes = form.notes.trim();

  const payload: Parameters<typeof dashboardApi.createScheduledWorkItemTrigger>[0] = {
    name: form.name.trim(),
    source: form.source.trim() || DEFAULT_SCHEDULED_TRIGGER_SOURCE,
    project_id: projectId,
    workflow_id: form.workflowId,
    cadence_minutes: Number.isFinite(cadenceMinutes) && cadenceMinutes > 0 ? cadenceMinutes : 60,
    defaults,
  };
  if (form.nextFireAt) {
    payload.next_fire_at = new Date(form.nextFireAt).toISOString();
  }
  return payload;
}

function parseRoleModelOverridesJson(
  value: string,
  label: string,
): Record<string, DashboardRoleModelOverride> {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '{' || trimmed === '{\n  \n}') {
    return {};
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

  return parsed as Record<string, DashboardRoleModelOverride>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          {project.description && (
            <p className="mt-1 text-sm text-muted">{project.description}</p>
          )}
        </div>
        <Badge variant={project.is_active ? 'success' : 'secondary'}>
          {project.is_active ? 'Active' : 'Inactive'}
        </Badge>
      </div>

      <Tabs defaultValue="spec">
        <TabsList>
          <TabsTrigger value="spec">Spec</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="timeline">Delivery</TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
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
          <MemoryTab projectId={project.id} />
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
