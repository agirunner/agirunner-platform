import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Loader2, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Switch } from '../../components/ui/switch.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import { Textarea } from '../../components/ui/textarea.js';
import type {
  DashboardProjectRecord,
  DashboardScheduledWorkItemTriggerRecord,
  DashboardWebhookWorkItemTriggerRecord,
  DashboardWorkflowRecord,
} from '../../lib/api.js';
import type {
  TriggerOperatorFocusPacket,
  TriggerOverviewSummaryCard,
  WebhookTriggerFormState,
} from './work-item-triggers-page.support.js';
import {
  buildWebhookTriggerCreatePayload,
  buildWebhookTriggerUpdatePayload,
  createWebhookTriggerFormState,
  describeScheduledTriggerHealth,
  describeScheduledTriggerPacket,
  describeWebhookTriggerActivity,
  describeWebhookTriggerPacket,
  hydrateWebhookTriggerForm,
  validateWebhookTriggerForm,
} from './work-item-triggers-page.support.js';

export function TriggerSummarySection(props: {
  focus: TriggerOperatorFocusPacket;
  summaries: TriggerOverviewSummaryCard[];
}): JSX.Element {
  return (
    <div className="space-y-4">
      <Card className="border-border/70 shadow-sm">
        <CardHeader className="gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
            Operator focus
          </p>
          <CardTitle className="text-lg">{props.focus.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-2xl font-semibold text-foreground">{props.focus.value}</p>
            <p className="max-w-3xl text-sm leading-6 text-muted">{props.focus.detail}</p>
          </div>
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link to="/projects">Open project settings</Link>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {props.summaries.map((summary) => (
          <Card key={summary.label} className="border-border/70 shadow-sm">
            <CardHeader className="space-y-1">
              <p className="text-sm font-medium text-muted">{summary.label}</p>
              <CardTitle className="text-2xl">{summary.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-muted">{summary.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function ScheduledTriggerSection(props: {
  projects: DashboardProjectRecord[];
  workflows: DashboardWorkflowRecord[];
  triggers: DashboardScheduledWorkItemTriggerRecord[];
}): JSX.Element {
  const projectsById = new Map(props.projects.map((project) => [project.id, project.name] as const));
  const workflowsById = new Map(
    props.workflows.map((workflow) => [workflow.id, workflow.name || workflow.id] as const),
  );

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-2">
        <CardTitle>Scheduled Triggers</CardTitle>
        <p className="max-w-3xl text-sm leading-6 text-muted">
          Review cadence, next-run posture, and the owning project before changing recurring
          work-item automation.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-4 lg:hidden">
          {props.triggers.map((trigger) => {
            const packet = describeScheduledTriggerPacket(trigger);
            const health = describeScheduledTriggerHealth(trigger);
            return (
              <Card key={trigger.id} className="border-border/70 bg-muted/10 shadow-none">
                <CardHeader className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">{trigger.name}</CardTitle>
                    <Badge variant={health.variant}>{health.label}</Badge>
                  </div>
                  <p className="text-sm text-muted">
                    {describeProjectLabel(projectsById, trigger.project_id)}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <TriggerInfo label="Cadence" value={packet.cadence} />
                  <TriggerInfo label="Next run" value={packet.nextRun} />
                  <TriggerInfo label="Source" value={packet.source} />
                  <TriggerInfo
                    label="Open board"
                    value={workflowsById.get(trigger.workflow_id) ?? trigger.workflow_id}
                  />
                  <TriggerInfo label="Next action" value={packet.nextAction} />
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/projects/${trigger.project_id}`}>Open project</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/work/workflows/${trigger.workflow_id}`}>Open board</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="hidden overflow-x-auto lg:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rule</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Cadence</TableHead>
                <TableHead>Next run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Next action</TableHead>
                <TableHead className="text-right">Links</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.triggers.map((trigger) => {
                const packet = describeScheduledTriggerPacket(trigger);
                const health = describeScheduledTriggerHealth(trigger);
                return (
                  <TableRow key={trigger.id}>
                    <TableCell className="font-medium">{trigger.name}</TableCell>
                    <TableCell>{describeProjectLabel(projectsById, trigger.project_id)}</TableCell>
                    <TableCell>{packet.cadence}</TableCell>
                    <TableCell>{packet.nextRun}</TableCell>
                    <TableCell>
                      <Badge variant={health.variant}>{health.label}</Badge>
                    </TableCell>
                    <TableCell className="max-w-sm text-sm text-muted">{packet.nextAction}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/projects/${trigger.project_id}`}>Open project</Link>
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/work/workflows/${trigger.workflow_id}`}>Open board</Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export function WebhookTriggerSection(props: {
  projects: DashboardProjectRecord[];
  workflows: DashboardWorkflowRecord[];
  triggers: DashboardWebhookWorkItemTriggerRecord[];
  isMutating: boolean;
  onCreateClick(): void;
  onEditClick(trigger: DashboardWebhookWorkItemTriggerRecord): void;
  onInspectClick(trigger: DashboardWebhookWorkItemTriggerRecord): void;
  onToggle(trigger: DashboardWebhookWorkItemTriggerRecord, isActive: boolean): void;
  onDeleteClick(trigger: DashboardWebhookWorkItemTriggerRecord): void;
}): JSX.Element {
  const projectsById = new Map(props.projects.map((project) => [project.id, project.name] as const));
  const workflowsById = new Map(
    props.workflows.map((workflow) => [workflow.id, workflow.name || workflow.id] as const),
  );

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-2">
        <div className="space-y-2">
          <CardTitle>Webhook Triggers</CardTitle>
          <p className="max-w-3xl text-sm leading-6 text-muted">
            Manage inbound webhook trigger rules that create work items from external events.
          </p>
        </div>
        <Button size="sm" onClick={props.onCreateClick}>
          <Plus className="h-4 w-4" /> Add trigger
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {props.triggers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="space-y-1">
              <p className="font-medium">No webhook triggers configured</p>
              <p className="text-sm text-muted">Create a webhook trigger to start receiving external events as work items.</p>
            </div>
            <Button size="sm" variant="outline" onClick={props.onCreateClick}>
              <Plus className="h-4 w-4" /> Create first trigger
            </Button>
          </div>
        ) : null}

        {props.triggers.length > 0 ? (
          <div className="space-y-4 lg:hidden">
            {props.triggers.map((trigger) => {
              const packet = describeWebhookTriggerPacket(trigger);
              const activity = describeWebhookTriggerActivity(trigger);
              return (
                <Card key={trigger.id} className="border-border/70 bg-muted/10 shadow-none">
                  <CardHeader className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="text-base">{trigger.name}</CardTitle>
                      <Badge variant={activity.variant}>{activity.label}</Badge>
                    </div>
                    <p className="text-sm text-muted">
                      {describeProjectLabel(projectsById, trigger.project_id)}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <TriggerInfo label="Source" value={packet.source} />
                    <TriggerInfo label="Signature mode" value={packet.mode} />
                    <TriggerInfo label="Activity" value={packet.activity} />
                    <TriggerInfo
                      label="Workflow"
                      value={workflowsById.get(trigger.workflow_id) ?? trigger.workflow_id}
                    />
                    <div className="flex items-center gap-2 pt-1">
                      <Switch
                        checked={trigger.is_active}
                        disabled={props.isMutating}
                        onCheckedChange={(checked) => props.onToggle(trigger, checked)}
                      />
                      <span className="text-xs text-muted">{trigger.is_active ? 'Enabled' : 'Disabled'}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button size="sm" variant="outline" onClick={() => props.onInspectClick(trigger)}>
                        <Eye className="h-3.5 w-3.5" /> Inspect
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => props.onEditClick(trigger)}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" onClick={() => props.onDeleteClick(trigger)}>
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : null}

        {props.triggers.length > 0 ? (
          <div className="hidden overflow-x-auto lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Signature mode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {props.triggers.map((trigger) => {
                  const packet = describeWebhookTriggerPacket(trigger);
                  const activity = describeWebhookTriggerActivity(trigger);
                  return (
                    <TableRow key={trigger.id}>
                      <TableCell className="font-medium">{trigger.name}</TableCell>
                      <TableCell>{describeProjectLabel(projectsById, trigger.project_id)}</TableCell>
                      <TableCell>{packet.source}</TableCell>
                      <TableCell>{packet.mode}</TableCell>
                      <TableCell>
                        <Badge variant={activity.variant}>{activity.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={trigger.is_active}
                          disabled={props.isMutating}
                          onCheckedChange={(checked) => props.onToggle(trigger, checked)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" title="Inspect" onClick={() => props.onInspectClick(trigger)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" title="Edit" onClick={() => props.onEditClick(trigger)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" title="Delete" className="text-red-600 hover:text-red-700" onClick={() => props.onDeleteClick(trigger)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function WebhookTriggerEditorDialog(props: {
  mode: 'create' | 'edit';
  trigger?: DashboardWebhookWorkItemTriggerRecord | null;
  open: boolean;
  projects: DashboardProjectRecord[];
  workflows: DashboardWorkflowRecord[];
  isPending: boolean;
  errorMessage?: string | null;
  onOpenChange(open: boolean): void;
  onSubmit(payload: ReturnType<typeof buildWebhookTriggerCreatePayload> | ReturnType<typeof buildWebhookTriggerUpdatePayload>): void;
}): JSX.Element {
  const [form, setForm] = useState<WebhookTriggerFormState>(createWebhookTriggerFormState());

  useEffect(() => {
    if (!props.open) return;
    setForm(props.trigger ? hydrateWebhookTriggerForm(props.trigger) : createWebhookTriggerFormState());
  }, [props.trigger, props.open]);

  const isCreate = props.mode === 'create';
  const validation = validateWebhookTriggerForm(form, props.mode);

  function update<K extends keyof WebhookTriggerFormState>(key: K, value: WebhookTriggerFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit() {
    props.onSubmit(isCreate ? buildWebhookTriggerCreatePayload(form) : buildWebhookTriggerUpdatePayload(form));
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isCreate ? 'Create webhook trigger' : 'Edit webhook trigger'}</DialogTitle>
          <DialogDescription>
            Configure an inbound webhook rule that creates work items from external events.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <section
            className={
              validation.isValid
                ? 'rounded-xl border border-emerald-300 bg-emerald-50/70 p-4'
                : 'rounded-xl border border-amber-300 bg-amber-50/80 p-4'
            }
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">Save readiness</h3>
                <p className="text-sm text-muted">
                  {validation.isValid
                    ? 'This trigger is ready to save.'
                    : 'Resolve the items below before saving.'}
                </p>
              </div>
              <span className="rounded-full border border-current/10 bg-background/70 px-3 py-1 text-xs font-medium">
                {validation.isValid ? 'Ready to save' : `${validation.issues.length} item${validation.issues.length === 1 ? '' : 's'} to fix`}
              </span>
            </div>
            {!validation.isValid ? (
              <ul className="mt-3 space-y-1 text-sm text-amber-950">
                {validation.issues.map((issue) => (
                  <li key={issue}>• {issue}</li>
                ))}
              </ul>
            ) : null}
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <EditorField label="Name" error={validation.fieldErrors['name']}>
              <Input value={form.name} placeholder="e.g. GitHub PR opened" onChange={(event) => update('name', event.target.value)} />
            </EditorField>
            <EditorField label="Source" error={validation.fieldErrors['source']}>
              <Input value={form.source} placeholder="e.g. github.webhook" onChange={(event) => update('source', event.target.value)} />
            </EditorField>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <EditorField label="Project scope">
              <Select value={form.projectId || '__none__'} onValueChange={(value) => update('projectId', value === '__none__' ? '' : value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unscoped</SelectItem>
                  {props.projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </EditorField>
            <EditorField label="Target workflow" error={validation.fieldErrors['workflowId']}>
              <Select value={form.workflowId || '__none__'} onValueChange={(value) => update('workflowId', value === '__none__' ? '' : value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" disabled>Select workflow</SelectItem>
                  {props.workflows.map((workflow) => (
                    <SelectItem key={workflow.id} value={workflow.id}>{workflow.name || workflow.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </EditorField>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <EditorField label="Signature header" error={validation.fieldErrors['signatureHeader']}>
              <Input value={form.signatureHeader} placeholder="x-hub-signature-256" onChange={(event) => update('signatureHeader', event.target.value)} />
            </EditorField>
            <EditorField label="Signature mode">
              <Select value={form.signatureMode} onValueChange={(value) => update('signatureMode', value as WebhookTriggerFormState['signatureMode'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hmac_sha256">HMAC SHA-256</SelectItem>
                  <SelectItem value="shared_secret">Shared secret</SelectItem>
                </SelectContent>
              </Select>
            </EditorField>
          </div>

          <EditorField label={isCreate ? 'Secret' : 'Secret (leave blank to keep current)'} error={validation.fieldErrors['secret']}>
            <Input type="password" value={form.secret} placeholder={isCreate ? 'Webhook secret' : 'Leave blank to keep stored value'} onChange={(event) => update('secret', event.target.value)} />
          </EditorField>

          <div className="grid gap-4 md:grid-cols-2">
            <EditorField label="Event header">
              <Input value={form.eventHeader} placeholder="e.g. x-github-event" onChange={(event) => update('eventHeader', event.target.value)} />
            </EditorField>
            <EditorField label="Event types (comma-separated)">
              <Input value={form.eventTypes} placeholder="e.g. push, pull_request.opened" onChange={(event) => update('eventTypes', event.target.value)} />
            </EditorField>
          </div>

          <EditorField label="Field mappings (JSON)" error={validation.fieldErrors['fieldMappings']}>
            <Textarea rows={4} className="font-mono text-xs" value={form.fieldMappings} onChange={(event) => update('fieldMappings', event.target.value)} />
          </EditorField>

          <EditorField label="Defaults (JSON)" error={validation.fieldErrors['defaults']}>
            <Textarea rows={4} className="font-mono text-xs" value={form.defaults} onChange={(event) => update('defaults', event.target.value)} />
          </EditorField>

          <div className="flex items-center gap-2">
            <Switch checked={form.isActive} onCheckedChange={(checked) => update('isActive', checked)} />
            <span className="text-sm">{form.isActive ? 'Enabled' : 'Disabled'}</span>
          </div>

          {props.errorMessage ? <p className="text-sm text-red-600">{props.errorMessage}</p> : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>Cancel</Button>
            <Button type="button" disabled={props.isPending || !validation.isValid} onClick={submit}>
              {props.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : isCreate ? <Plus className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {isCreate ? 'Create trigger' : 'Save trigger'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WebhookTriggerDeleteDialog(props: {
  trigger: DashboardWebhookWorkItemTriggerRecord | null;
  open: boolean;
  isPending: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
}): JSX.Element | null {
  if (!props.trigger) return null;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete webhook trigger</DialogTitle>
          <DialogDescription>
            This action permanently removes the trigger and its invocation history.
          </DialogDescription>
        </DialogHeader>
        <Card className="border-border/70 bg-muted/10 shadow-none">
          <CardContent className="space-y-2 p-4 text-sm">
            <TriggerInfo label="Name" value={props.trigger.name} />
            <TriggerInfo label="Source" value={props.trigger.source} />
            <TriggerInfo label="Status" value={props.trigger.is_active ? 'Active' : 'Disabled'} />
          </CardContent>
        </Card>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={props.isPending} onClick={props.onConfirm}>
            {props.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete trigger
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WebhookTriggerInspectDialog(props: {
  trigger: DashboardWebhookWorkItemTriggerRecord | null;
  open: boolean;
  projects: DashboardProjectRecord[];
  workflows: DashboardWorkflowRecord[];
  onOpenChange(open: boolean): void;
}): JSX.Element | null {
  if (!props.trigger) return null;
  const projectsById = new Map(props.projects.map((project) => [project.id, project.name] as const));
  const workflowsById = new Map(props.workflows.map((workflow) => [workflow.id, workflow.name || workflow.id] as const));
  const trigger = props.trigger;
  const packet = describeWebhookTriggerPacket(trigger);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Inspect: {trigger.name}</DialogTitle>
          <DialogDescription>
            Full configuration details for this webhook trigger.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="grid gap-3 md:grid-cols-2">
            <TriggerInfo label="Source" value={packet.source} />
            <TriggerInfo label="Signature mode" value={packet.mode} />
            <TriggerInfo label="Project" value={describeProjectLabel(projectsById, trigger.project_id)} />
            <TriggerInfo label="Workflow" value={workflowsById.get(trigger.workflow_id) ?? trigger.workflow_id} />
            <TriggerInfo label="Status" value={trigger.is_active ? 'Active' : 'Disabled'} />
            <TriggerInfo label="Secret configured" value={trigger.secret_configured ? 'Yes' : 'No'} />
          </div>
          {trigger.event_header ? <TriggerInfo label="Event header" value={trigger.event_header} /> : null}
          {trigger.event_types && trigger.event_types.length > 0 ? (
            <TriggerInfo label="Event types" value={trigger.event_types.join(', ')} />
          ) : null}
          {trigger.field_mappings && Object.keys(trigger.field_mappings).length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Field mappings</p>
              <pre className="max-h-48 overflow-auto rounded-md border bg-muted/20 p-3 font-mono text-xs">
                {JSON.stringify(trigger.field_mappings, null, 2)}
              </pre>
            </div>
          ) : null}
          {trigger.defaults && Object.keys(trigger.defaults).length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Defaults</p>
              <pre className="max-h-48 overflow-auto rounded-md border bg-muted/20 p-3 font-mono text-xs">
                {JSON.stringify(trigger.defaults, null, 2)}
              </pre>
            </div>
          ) : null}
          {trigger.created_at ? <TriggerInfo label="Created" value={new Date(trigger.created_at).toLocaleString()} /> : null}
          {trigger.updated_at ? <TriggerInfo label="Updated" value={new Date(trigger.updated_at).toLocaleString()} /> : null}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditorField(props: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium">{props.label}</span>
      {props.children}
      {props.error ? <p className="text-xs text-red-600">{props.error}</p> : null}
    </label>
  );
}

function TriggerInfo(props: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{props.label}</p>
      <p className="text-sm text-foreground">{props.value}</p>
    </div>
  );
}

function describeProjectLabel(
  projectsById: Map<string, string>,
  projectId: string | null | undefined,
): string {
  if (!projectId) {
    return 'Unscoped project';
  }
  return projectsById.get(projectId) ?? projectId;
}
