import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '../../components/ui/card.js';
import { dashboardApi } from '../../lib/api.js';
import type {
  DashboardProjectRecord,
  DashboardScheduledWorkItemTriggerRecord,
  DashboardWebhookWorkItemTriggerRecord,
  DashboardWorkflowRecord,
} from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { buildTriggerOperatorFocus, summarizeTriggerOverview } from './work-item-triggers-page.support.js';
import {
  ScheduledTriggerSection,
  TriggerSummarySection,
  WebhookTriggerDeleteDialog,
  WebhookTriggerEditorDialog,
  WebhookTriggerInspectDialog,
  WebhookTriggerSection,
} from './work-item-triggers-page.sections.js';

type EditorTarget = 'create' | DashboardWebhookWorkItemTriggerRecord;

export function WorkItemTriggersPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DashboardWebhookWorkItemTriggerRecord | null>(null);
  const [inspectTarget, setInspectTarget] = useState<DashboardWebhookWorkItemTriggerRecord | null>(null);

  const projectsQuery = useQuery({
    queryKey: ['projects', 'trigger-overview'],
    queryFn: () => dashboardApi.listProjects(),
  });
  const workflowsQuery = useQuery({
    queryKey: ['workflows', 'trigger-overview'],
    queryFn: () => dashboardApi.listWorkflows({ per_page: '100' }),
  });
  const scheduledQuery = useQuery({
    queryKey: ['scheduled-work-item-triggers', 'overview'],
    queryFn: () => dashboardApi.listScheduledWorkItemTriggers(),
  });
  const webhookQuery = useQuery({
    queryKey: ['webhook-work-item-triggers', 'overview'],
    queryFn: () => dashboardApi.listWebhookWorkItemTriggers(),
  });

  const createMutation = useMutation({
    mutationFn: dashboardApi.createWebhookWorkItemTrigger,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['webhook-work-item-triggers'] });
      setEditorTarget(null);
      toast.success('Webhook trigger created');
    },
    onError: (error: unknown) => {
      toast.error(`Failed to create trigger: ${String(error)}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ triggerId, payload }: { triggerId: string; payload: Parameters<typeof dashboardApi.updateWebhookWorkItemTrigger>[1] }) =>
      dashboardApi.updateWebhookWorkItemTrigger(triggerId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['webhook-work-item-triggers'] });
      setEditorTarget(null);
      toast.success('Webhook trigger updated');
    },
    onError: (error: unknown) => {
      toast.error(`Failed to update trigger: ${String(error)}`);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ triggerId, isActive }: { triggerId: string; isActive: boolean }) =>
      dashboardApi.updateWebhookWorkItemTrigger(triggerId, { is_active: isActive }),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['webhook-work-item-triggers'] });
      toast.success(`Trigger ${variables.isActive ? 'enabled' : 'disabled'}`);
    },
    onError: () => {
      toast.error('Failed to toggle trigger');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (triggerId: string) => dashboardApi.deleteWebhookWorkItemTrigger(triggerId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['webhook-work-item-triggers'] });
      setDeleteTarget(null);
      toast.success('Webhook trigger deleted');
    },
    onError: () => {
      toast.error('Failed to delete trigger');
    },
  });

  if (projectsQuery.isLoading || workflowsQuery.isLoading || scheduledQuery.isLoading || webhookQuery.isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (projectsQuery.error || workflowsQuery.error || scheduledQuery.error || webhookQuery.error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          Failed to load trigger overview.
        </div>
      </div>
    );
  }

  const projects = (projectsQuery.data?.data ?? []) as DashboardProjectRecord[];
  const workflows = (workflowsQuery.data?.data ?? []) as DashboardWorkflowRecord[];
  const scheduled = (scheduledQuery.data?.data ?? []) as DashboardScheduledWorkItemTriggerRecord[];
  const webhooks = (webhookQuery.data?.data ?? []) as DashboardWebhookWorkItemTriggerRecord[];
  const summaryCards = summarizeTriggerOverview(scheduled, webhooks);
  const operatorFocus = buildTriggerOperatorFocus(scheduled, webhooks);
  const isMutating = createMutation.isPending || updateMutation.isPending || toggleMutation.isPending || deleteMutation.isPending;

  const editorMode = editorTarget === 'create' ? 'create' as const : 'edit' as const;
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
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <CardTitle className="text-2xl">Trigger Overview</CardTitle>
            <p className="max-w-3xl text-sm text-muted">
              Manage webhook work-item triggers and review scheduled automation posture across projects.
            </p>
          </div>
        </CardHeader>
      </Card>

      <TriggerSummarySection focus={operatorFocus} summaries={summaryCards} />
      <ScheduledTriggerSection
        projects={projects}
        workflows={workflows}
        triggers={scheduled.slice().sort((left, right) => left.next_fire_at.localeCompare(right.next_fire_at))}
      />
      <WebhookTriggerSection
        projects={projects}
        workflows={workflows}
        triggers={webhooks.slice().sort((left, right) => left.name.localeCompare(right.name))}
        isMutating={isMutating}
        onCreateClick={() => setEditorTarget('create')}
        onEditClick={(trigger) => setEditorTarget(trigger)}
        onInspectClick={(trigger) => setInspectTarget(trigger)}
        onToggle={(trigger, isActive) => toggleMutation.mutate({ triggerId: trigger.id, isActive })}
        onDeleteClick={(trigger) => setDeleteTarget(trigger)}
      />

      <WebhookTriggerEditorDialog
        mode={editorMode}
        trigger={editorTrigger}
        open={editorTarget !== null}
        projects={projects}
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
        projects={projects}
        workflows={workflows}
        onOpenChange={(open) => { if (!open) setInspectTarget(null); }}
      />
    </div>
  );
}
