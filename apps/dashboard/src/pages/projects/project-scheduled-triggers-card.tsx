import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarClock, Pencil, Trash2, Zap } from 'lucide-react';

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
  formatCadence,
  formatDateTime,
  hydrateScheduledTriggerForm,
  type ScheduledTriggerFormState,
} from './project-scheduled-trigger-support.js';

type RoleOption = { id: string; name: string; description: string | null; is_active: boolean };

export function ScheduledTriggersCard({ project }: { project: DashboardProjectRecord }): JSX.Element {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ScheduledTriggerFormState>(createScheduledTriggerFormState());
  const [editingTriggerId, setEditingTriggerId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DashboardScheduledWorkItemTriggerRecord | null>(null);

  const triggersQuery = useQuery({
    queryKey: ['scheduled-work-item-triggers', project.id],
    queryFn: () => dashboardApi.listScheduledWorkItemTriggers(),
  });
  const workflowsQuery = useQuery({
    queryKey: ['project-workflows', project.id],
    queryFn: () => dashboardApi.listWorkflows({ project_id: project.id, per_page: '100' }),
  });
  const roleDefinitionsQuery = useQuery({
    queryKey: ['role-definitions', 'active'],
    queryFn: () => dashboardApi.listRoleDefinitions(),
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
  const roles = (roleDefinitionsQuery.data ?? []) as RoleOption[];
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
  }

  function startEdit(trigger: DashboardScheduledWorkItemTriggerRecord): void {
    setEditingTriggerId(trigger.id);
    setForm(hydrateScheduledTriggerForm(trigger));
  }

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
          cadence, target a project run, and wake the orchestrator through the normal activation path.
        </div>

        <section className="space-y-4 rounded-xl border border-border/70 bg-background/70 p-4">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{triggerOverview.heading}</h3>
            <p className="text-sm leading-6 text-muted">{triggerOverview.summary}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-card/80 p-3 text-sm leading-6 text-muted">
            <span className="font-medium text-foreground">Best next step:</span>{' '}
            {triggerOverview.nextAction}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {triggerOverview.packets.map((packet) => (
              <div
                key={packet.label}
                className="rounded-xl border border-border/70 bg-card/80 p-3"
              >
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
                  {packet.label}
                </div>
                <div className="mt-1 text-sm font-semibold text-foreground">{packet.value}</div>
                <p className="mt-1 text-sm leading-6 text-muted">{packet.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">Current schedules</h3>
              <p className="text-sm text-muted">Inspect, edit, pause, or remove recurring project work.</p>
            </div>
            <Link to="/config/triggers" className="text-sm text-accent hover:underline">
              Open trigger overview
            </Link>
          </div>

          {triggersQuery.isLoading ? (
            <LoadingCard />
          ) : scheduledTriggers.length === 0 ? (
            <p className="text-sm text-muted">No scheduled work item triggers for this project.</p>
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

        <ProjectScheduledTriggerForm
          form={form}
          workflows={workflows}
          stages={selectedWorkflowQuery.data?.workflow_stages ?? []}
          columns={selectedBoardQuery.data?.columns ?? []}
          roles={roles}
          isEditing={editingTriggerId !== null}
          isPending={saveMutation.isPending}
          isLoadingWorkflowDetails={selectedWorkflowQuery.isLoading || selectedBoardQuery.isLoading}
          errorMessage={saveMutation.isError ? 'Failed to save scheduled trigger.' : null}
          onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
          onSubmit={() => saveMutation.mutate()}
          onCancel={resetEditor}
        />

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
            <Badge variant="outline">{props.trigger.source}</Badge>
          </div>
          <div className="flex flex-wrap gap-2 text-sm text-muted">
            <span>{props.workflowName}</span>
            <span>{formatCadence(props.trigger.cadence_minutes)}</span>
            <span>Next {formatDateTime(props.trigger.next_fire_at)}</span>
            <span>
              Last run {props.trigger.last_fired_at ? formatDateTime(props.trigger.last_fired_at) : 'Not fired yet'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted">
            {typeof defaults.stage_name === 'string' ? <Badge variant="secondary">{defaults.stage_name}</Badge> : null}
            {typeof defaults.column_id === 'string' ? <Badge variant="secondary">{defaults.column_id}</Badge> : null}
            {typeof defaults.owner_role === 'string' ? <Badge variant="secondary">{defaults.owner_role}</Badge> : null}
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
