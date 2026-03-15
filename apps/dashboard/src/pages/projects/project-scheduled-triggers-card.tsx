import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Pencil, Plus, Trash2, Zap } from 'lucide-react';

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
import { Switch } from '../../components/ui/switch.js';
import { dashboardApi } from '../../lib/api.js';
import type {
  DashboardProjectRecord,
  DashboardScheduledWorkItemTriggerRecord,
  DashboardWorkflowRecord,
} from '../../lib/api.js';
import { ProjectScheduledTriggerForm } from './project-scheduled-trigger-form.js';
import {
  buildScheduledTriggerOverview,
  buildScheduledTriggerPayload,
  createScheduledTriggerFormState,
  describeTriggerHealth,
  formatDateTime,
  formatSchedule,
  hydrateScheduledTriggerForm,
  type ScheduledTriggerFormState,
} from './project-scheduled-trigger-support.js';

export function ScheduledTriggersCard({ project }: { project: DashboardProjectRecord }): JSX.Element {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ScheduledTriggerFormState>(createScheduledTriggerFormState());
  const [editingTriggerId, setEditingTriggerId] = useState<string | null>(null);
  const [showComposer, setShowComposer] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DashboardScheduledWorkItemTriggerRecord | null>(null);

  const triggersQuery = useQuery({
    queryKey: ['scheduled-work-item-triggers', project.id],
    queryFn: () => dashboardApi.listScheduledWorkItemTriggers(),
  });
  const workflowsQuery = useQuery({
    queryKey: ['project-workflows', project.id],
    queryFn: () => dashboardApi.listWorkflows({ project_id: project.id, per_page: '100' }),
  });
  const selectedWorkflowQuery = useQuery({
    queryKey: ['workflow', form.workflowId, 'stages'],
    queryFn: () => dashboardApi.getWorkflow(form.workflowId),
    enabled: form.workflowId.length > 0,
  });
  const selectedBoardQuery = useQuery({
    queryKey: ['workflow', form.workflowId, 'board-columns'],
    queryFn: () => dashboardApi.getWorkflowBoard(form.workflowId),
    enabled: form.workflowId.length > 0,
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = buildScheduledTriggerPayload(project.id, form);
      return editingTriggerId
        ? dashboardApi.updateScheduledWorkItemTrigger(editingTriggerId, payload)
        : dashboardApi.createScheduledWorkItemTrigger(payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['scheduled-work-item-triggers', project.id] });
      resetEditor();
    },
  });
  const toggleMutation = useMutation({
    mutationFn: ({ triggerId, isActive }: { triggerId: string; isActive: boolean }) =>
      dashboardApi.updateScheduledWorkItemTrigger(triggerId, { is_active: isActive }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['scheduled-work-item-triggers', project.id] });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (triggerId: string) => dashboardApi.deleteScheduledWorkItemTrigger(triggerId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['scheduled-work-item-triggers', project.id] });
      setDeleteTarget(null);
    },
  });

  const workflows = (workflowsQuery.data?.data ?? []) as DashboardWorkflowRecord[];
  const scheduledTriggers = useMemo(
    () =>
      ((triggersQuery.data?.data ?? []) as DashboardScheduledWorkItemTriggerRecord[])
        .filter((trigger) => trigger.project_id === project.id)
        .sort((left, right) => left.next_fire_at.localeCompare(right.next_fire_at)),
    [project.id, triggersQuery.data],
  );
  const triggerOverview = useMemo(
    () => buildScheduledTriggerOverview(scheduledTriggers),
    [scheduledTriggers],
  );

  function resetEditor(): void {
    setEditingTriggerId(null);
    setForm(createScheduledTriggerFormState());
    setShowComposer(false);
  }

  function startEdit(trigger: DashboardScheduledWorkItemTriggerRecord): void {
    setEditingTriggerId(trigger.id);
    setForm(hydrateScheduledTriggerForm(trigger));
    setShowComposer(true);
  }

  function startCreate(): void {
    setEditingTriggerId(null);
    setForm(createScheduledTriggerFormState());
    setShowComposer(true);
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Schedules
          </CardTitle>
          <Button size="sm" onClick={startCreate}>
            <Plus className="h-4 w-4" />
            Add schedule
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
              <h3 className="text-sm font-medium">Current schedules</h3>
              <p className="text-sm text-muted">
                Inspect, pause, or revise the schedules already feeding this project.
              </p>
            </div>
          </div>

          {triggersQuery.isLoading ? (
            <LoadingCard />
          ) : scheduledTriggers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 bg-background/70 p-4 text-sm text-muted">
              No scheduled work item triggers for this project yet.
            </div>
          ) : (
            <div className="grid gap-3">
              {scheduledTriggers.map((trigger) => (
                <ScheduledTriggerCard
                  key={trigger.id}
                  trigger={trigger}
                  workflowName={workflows.find((item) => item.id === trigger.workflow_id)?.name ?? trigger.workflow_id}
                  onEdit={() => startEdit(trigger)}
                  onDelete={() => setDeleteTarget(trigger)}
                  onToggle={(checked) =>
                    toggleMutation.mutate({ triggerId: trigger.id, isActive: checked })}
                  isMutating={toggleMutation.isPending || deleteMutation.isPending}
                />
              ))}
            </div>
          )}
        </div>

        {showComposer ? (
          <ProjectScheduledTriggerForm
            form={form}
            workflows={workflows}
            stages={selectedWorkflowQuery.data?.workflow_stages ?? []}
            columns={selectedBoardQuery.data?.columns ?? []}
            isEditing={editingTriggerId !== null}
            isPending={saveMutation.isPending}
            isLoadingWorkflowDetails={selectedWorkflowQuery.isLoading || selectedBoardQuery.isLoading}
            errorMessage={
              saveMutation.isError
                ? saveMutation.error instanceof Error && saveMutation.error.message.includes('422')
                  ? 'Review the schedule settings and work-item template, then try saving again.'
                  : 'Failed to save scheduled trigger.'
                : null
            }
            onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
            onSubmit={() => saveMutation.mutate()}
            onCancel={resetEditor}
          />
        ) : (
          <section className="rounded-xl border border-border/70 bg-background/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">Create or revise schedules</h3>
                <p className="text-sm leading-6 text-muted">
                  Open the composer only when cadence, routing, or generated work-item copy needs to
                  change.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={startCreate}>
                <Plus className="h-4 w-4" />
                Add schedule
              </Button>
            </div>
          </section>
        )}

        <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Delete scheduled trigger</DialogTitle>
              <DialogDescription>
                {deleteTarget
                  ? `Delete "${deleteTarget.name}" and stop future scheduled work-item creation for this project.`
                  : 'Delete this scheduled trigger.'}
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteMutation.isPending}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
                disabled={deleteMutation.isPending}
              >
                Delete schedule
              </Button>
            </div>
          </DialogContent>
        </Dialog>
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

function LoadingCard(): JSX.Element {
  return (
    <div className="rounded-md border p-6 text-sm text-muted">Loading…</div>
  );
}

function ScheduledTriggerCard(props: {
  trigger: DashboardScheduledWorkItemTriggerRecord;
  workflowName: string;
  isMutating: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (checked: boolean) => void;
}) {
  const health = describeTriggerHealth(props.trigger);
  const defaults = (props.trigger.defaults ?? {}) as Record<string, unknown>;

  return (
    <div className="rounded-md border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{props.trigger.name}</span>
            <Badge variant={health.variant}>{health.label}</Badge>
          </div>
          <div className="flex flex-wrap gap-2 text-sm text-muted">
            <span>{props.workflowName}</span>
            <span>{formatSchedule(props.trigger)}</span>
            <span>Next {formatDateTime(props.trigger.next_fire_at)}</span>
            <span>
              Last run {props.trigger.last_fired_at ? formatDateTime(props.trigger.last_fired_at) : 'Not fired yet'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted">
            {typeof defaults.stage_name === 'string' ? <Badge variant="secondary">{defaults.stage_name}</Badge> : null}
            {typeof defaults.column_id === 'string' ? <Badge variant="secondary">{defaults.column_id}</Badge> : null}
            {typeof defaults.priority === 'string' ? <Badge variant="secondary">{defaults.priority}</Badge> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border px-3 py-2">
            <CalendarClock className="h-4 w-4 text-muted" />
            <span className="text-sm">Active</span>
            <Switch
              checked={props.trigger.is_active}
              disabled={props.isMutating}
              onCheckedChange={props.onToggle}
            />
          </div>
          <Button variant="outline" onClick={props.onEdit} disabled={props.isMutating}>
            <Pencil className="h-4 w-4" />
            Edit schedule
          </Button>
          <Button variant="outline" onClick={props.onDelete} disabled={props.isMutating}>
            <Trash2 className="h-4 w-4" />
            Delete schedule
          </Button>
        </div>
      </div>
    </div>
  );
}
