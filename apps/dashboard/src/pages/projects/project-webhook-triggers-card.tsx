import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Pencil, Plus, Trash2, Webhook } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Switch } from '../../components/ui/switch.js';
import { dashboardApi } from '../../lib/api.js';
import type {
  DashboardProjectRecord,
  DashboardWebhookWorkItemTriggerRecord,
  DashboardWorkflowRecord,
} from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import {
  WebhookTriggerDeleteDialog,
  WebhookTriggerEditorDialog,
  WebhookTriggerInspectDialog,
} from '../config/work-item-triggers-page.sections.js';
import {
  buildWebhookTriggerCreatePayload,
  buildWebhookTriggerUpdatePayload,
  describeWebhookTriggerActivity,
  describeWebhookTriggerPacket,
} from '../config/work-item-triggers-page.support.js';
import { ProjectGitWebhookSignaturesCard } from './project-git-webhook-signatures-card.js';
import { buildWebhookTriggerOverview } from './project-webhook-triggers-support.js';

type EditorTarget = 'create' | DashboardWebhookWorkItemTriggerRecord;

export function WebhookTriggersCard({ project }: { project: DashboardProjectRecord }): JSX.Element {
  const queryClient = useQueryClient();
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DashboardWebhookWorkItemTriggerRecord | null>(null);
  const [inspectTarget, setInspectTarget] = useState<DashboardWebhookWorkItemTriggerRecord | null>(null);

  const triggersQuery = useQuery({
    queryKey: ['webhook-work-item-triggers', project.id],
    queryFn: () => dashboardApi.listWebhookWorkItemTriggers(),
  });
  const workflowsQuery = useQuery({
    queryKey: ['project-workflows', project.id],
    queryFn: () => dashboardApi.listWorkflows({ project_id: project.id, per_page: '100' }),
  });

  const invalidateTriggers = () =>
    queryClient.invalidateQueries({ queryKey: ['webhook-work-item-triggers', project.id] });

  const createMutation = useMutation({
    mutationFn: dashboardApi.createWebhookWorkItemTrigger,
    onSuccess: async () => {
      await invalidateTriggers();
      setEditorTarget(null);
      toast.success('Webhook trigger created');
    },
    onError: (error: unknown) => {
      toast.error(
        `Failed to create trigger: ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ triggerId, payload }: { triggerId: string; payload: Parameters<typeof dashboardApi.updateWebhookWorkItemTrigger>[1] }) =>
      dashboardApi.updateWebhookWorkItemTrigger(triggerId, payload),
    onSuccess: async () => {
      await invalidateTriggers();
      setEditorTarget(null);
      toast.success('Webhook trigger updated');
    },
    onError: (error: unknown) => {
      toast.error(
        `Failed to update trigger: ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ triggerId, isActive }: { triggerId: string; isActive: boolean }) =>
      dashboardApi.updateWebhookWorkItemTrigger(triggerId, { is_active: isActive }),
    onSuccess: async (_data, variables) => {
      await invalidateTriggers();
      toast.success(`Trigger ${variables.isActive ? 'enabled' : 'disabled'}`);
    },
    onError: () => {
      toast.error('Failed to toggle trigger');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (triggerId: string) => dashboardApi.deleteWebhookWorkItemTrigger(triggerId),
    onSuccess: async () => {
      await invalidateTriggers();
      setDeleteTarget(null);
      toast.success('Webhook trigger deleted');
    },
    onError: () => {
      toast.error('Failed to delete trigger');
    },
  });

  const workflows = (workflowsQuery.data?.data ?? []) as DashboardWorkflowRecord[];
  const projectTriggers = useMemo(
    () =>
      ((triggersQuery.data?.data ?? []) as DashboardWebhookWorkItemTriggerRecord[])
        .filter((trigger) => trigger.project_id === project.id)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [project.id, triggersQuery.data],
  );
  const triggerOverview = useMemo(
    () => buildWebhookTriggerOverview(projectTriggers),
    [projectTriggers],
  );

  const isMutating =
    createMutation.isPending ||
    updateMutation.isPending ||
    toggleMutation.isPending ||
    deleteMutation.isPending;

  const editorMode = editorTarget === 'create' ? ('create' as const) : ('edit' as const);
  const editorTrigger = editorTarget !== 'create' ? editorTarget : null;
  const editorMutationError = editorMode === 'create' ? createMutation.error : updateMutation.error;

  function handleEditorSubmit(payload: Record<string, unknown>) {
    if (editorMode === 'create') {
      createMutation.mutate(payload as Parameters<typeof dashboardApi.createWebhookWorkItemTrigger>[0]);
    } else if (editorTrigger) {
      updateMutation.mutate({ triggerId: editorTrigger.id, payload });
    }
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-4 w-4" />
            Inbound hooks
          </CardTitle>
          <Button size="sm" onClick={() => setEditorTarget('create')}>
            <Plus className="h-4 w-4" />
            Add trigger
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-4 rounded-xl border border-border/70 bg-background/70 p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{triggerOverview.heading}</h3>
              <p className="text-sm leading-6 text-muted">{triggerOverview.summary}</p>
            </div>
            <div className="flex flex-wrap gap-2 xl:max-w-sm xl:justify-end">
              {triggerOverview.packets.map((packet) => (
                <OverviewPill key={packet.label} label={packet.label} value={packet.value} />
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-border/70 bg-card/80 p-3 text-sm leading-6 text-muted">
            <span className="font-medium text-foreground">Best next step:</span>{' '}
            {triggerOverview.nextAction}
          </div>
        </section>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">Current triggers</h3>
              <p className="text-sm text-muted">
                Inspect, toggle, or revise project-scoped webhook rules.
              </p>
            </div>
          </div>

          {triggersQuery.isLoading ? (
            <LoadingPlaceholder />
          ) : projectTriggers.length === 0 ? (
            <EmptyState onCreateClick={() => setEditorTarget('create')} />
          ) : (
            <div className="grid gap-3">
              {projectTriggers.map((trigger) => (
                <WebhookTriggerCard
                  key={trigger.id}
                  trigger={trigger}
                  workflowName={workflows.find((item) => item.id === trigger.workflow_id)?.name ?? trigger.workflow_id}
                  isMutating={isMutating}
                  onInspect={() => setInspectTarget(trigger)}
                  onEdit={() => setEditorTarget(trigger)}
                  onDelete={() => setDeleteTarget(trigger)}
                  onToggle={(checked) =>
                    toggleMutation.mutate({ triggerId: trigger.id, isActive: checked })}
                />
              ))}
            </div>
          )}
        </div>

        <WebhookTriggerEditorDialog
          mode={editorMode}
          trigger={editorTrigger}
          open={editorTarget !== null}
          defaultProjectId={project.id}
          projectScoped
          projects={[project]}
          workflows={workflows}
          isPending={createMutation.isPending || updateMutation.isPending}
          errorMessage={editorMutationError ? String(editorMutationError) : null}
          onOpenChange={(open) => { if (!open) setEditorTarget(null); }}
          onSubmit={handleEditorSubmit}
        />

        <WebhookTriggerDeleteDialog
          trigger={deleteTarget}
          open={deleteTarget !== null}
          isPending={deleteMutation.isPending}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
          onConfirm={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id); }}
        />

        <WebhookTriggerInspectDialog
          trigger={inspectTarget}
          open={inspectTarget !== null}
          projects={[project]}
          workflows={workflows}
          onOpenChange={(open) => { if (!open) setInspectTarget(null); }}
        />

        <ProjectGitWebhookSignaturesCard project={project} compact />
      </CardContent>
    </Card>
  );
}

function OverviewPill(props: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/80 px-3 py-1.5 text-xs">
      <span className="font-medium uppercase tracking-[0.16em] text-muted">{props.label}</span>
      <span className="font-semibold text-foreground">{props.value}</span>
    </div>
  );
}

function LoadingPlaceholder(): JSX.Element {
  return (
    <div className="rounded-md border p-6 text-sm text-muted">Loading…</div>
  );
}

function EmptyState({ onCreateClick }: { onCreateClick(): void }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-md border py-12 text-center">
      <div className="space-y-1">
        <p className="font-medium">No webhook triggers for this project</p>
        <p className="text-sm text-muted">
          Add the first inbound hook when this project should turn external events into workflow work.
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onCreateClick}>
        <Plus className="h-4 w-4" /> Create first trigger
      </Button>
    </div>
  );
}

function WebhookTriggerCard(props: {
  trigger: DashboardWebhookWorkItemTriggerRecord;
  workflowName: string;
  isMutating: boolean;
  onInspect(): void;
  onEdit(): void;
  onDelete(): void;
  onToggle(checked: boolean): void;
}): JSX.Element {
  const activity = describeWebhookTriggerActivity(props.trigger);
  const packet = describeWebhookTriggerPacket(props.trigger);

  return (
    <div className="rounded-md border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{props.trigger.name}</span>
            <Badge variant={activity.variant}>{activity.label}</Badge>
            <Badge variant="outline">{props.trigger.source}</Badge>
          </div>
          <div className="flex flex-wrap gap-2 text-sm text-muted">
            <span>{props.workflowName}</span>
            <span>{packet.mode}</span>
          </div>
          {props.trigger.event_types && props.trigger.event_types.length > 0 ? (
            <div className="flex flex-wrap gap-1 text-xs text-muted">
              {props.trigger.event_types.map((eventType) => (
                <Badge key={eventType} variant="secondary">{eventType}</Badge>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border px-3 py-2">
            <Webhook className="h-4 w-4 text-muted" />
            <span className="text-sm">Active</span>
            <Switch
              checked={props.trigger.is_active}
              disabled={props.isMutating}
              onCheckedChange={props.onToggle}
            />
          </div>
          <Button variant="outline" size="sm" onClick={props.onInspect} disabled={props.isMutating}>
            <Eye className="h-4 w-4" />
            Inspect
          </Button>
          <Button variant="outline" size="sm" onClick={props.onEdit} disabled={props.isMutating}>
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={props.onDelete} disabled={props.isMutating}>
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
