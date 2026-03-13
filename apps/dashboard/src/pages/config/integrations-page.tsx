import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plug, Trash2 } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Switch } from '../../components/ui/switch.js';
import { dashboardApi, type DashboardIntegrationRecord } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { IntegrationEditorDialog } from './integrations-editor-dialog.js';
import {
  filterIntegrations,
  KIND_LABELS,
  summarizeIntegrationLibrary,
  summarizeIntegrationConfig,
  type IntegrationScopeFilter,
  type IntegrationStatusFilter,
  type IntegrationKind,
} from './integrations-page.support.js';
import {
  IntegrationFilters,
  IntegrationSummaryCards,
} from './integrations-page.sections.js';

function kindVariant(kind: IntegrationKind) {
  const map: Record<IntegrationKind, 'default' | 'secondary' | 'outline' | 'warning'> = {
    webhook: 'default',
    slack: 'secondary',
    otlp_http: 'outline',
    github_issues: 'warning',
  };
  return map[kind];
}

export function IntegrationsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<IntegrationStatusFilter>('all');
  const [scopeFilter, setScopeFilter] = useState<IntegrationScopeFilter>('all');
  const [editorTarget, setEditorTarget] = useState<DashboardIntegrationRecord | 'create' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DashboardIntegrationRecord | null>(null);

  const integrationsQuery = useQuery({
    queryKey: ['integrations'],
    queryFn: () => dashboardApi.listIntegrations(),
  });
  const workflowsQuery = useQuery({
    queryKey: ['integration-workflow-options'],
    queryFn: () => dashboardApi.listWorkflows(),
  });

  const createMutation = useMutation({
    mutationFn: dashboardApi.createIntegration,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['integrations'] });
      setEditorTarget(null);
      toast.success('Integration created');
    },
    onError: (error) => {
      toast.error(`Failed to create integration: ${String(error)}`);
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ integrationId, payload }: { integrationId: string; payload: Parameters<typeof dashboardApi.updateIntegration>[1] }) =>
      dashboardApi.updateIntegration(integrationId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['integrations'] });
      setEditorTarget(null);
      toast.success('Integration updated');
    },
    onError: (error) => {
      toast.error(`Failed to update integration: ${String(error)}`);
    },
  });
  const toggleMutation = useMutation({
    mutationFn: ({ integrationId, isActive }: { integrationId: string; isActive: boolean }) =>
      dashboardApi.updateIntegration(integrationId, { is_active: isActive }),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['integrations'] });
      toast.success(variables.isActive ? 'Integration enabled' : 'Integration disabled');
    },
    onError: () => {
      toast.error('Failed to update integration');
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (integrationId: string) => dashboardApi.deleteIntegration(integrationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['integrations'] });
      setDeleteTarget(null);
      toast.success('Integration deleted');
    },
    onError: () => {
      toast.error('Failed to delete integration');
    },
  });

  const workflowNameById = useMemo(
    () =>
      new Map(
        (workflowsQuery.data?.data ?? []).map((workflow) => [workflow.id, workflow.name] as const),
      ),
    [workflowsQuery.data],
  );

  if (integrationsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (integrationsQuery.error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          Failed to load integrations: {String(integrationsQuery.error)}
        </div>
      </div>
    );
  }

  const integrations = integrationsQuery.data ?? [];
  const summaryCards = useMemo(
    () => summarizeIntegrationLibrary(integrations),
    [integrations],
  );
  const filteredIntegrations = useMemo(
    () =>
      filterIntegrations(
        integrations,
        search,
        statusFilter,
        scopeFilter,
        workflowNameById,
      ),
    [integrations, search, statusFilter, scopeFilter, workflowNameById],
  );

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <CardTitle className="text-2xl">Integrations</CardTitle>
            <CardDescription className="max-w-2xl leading-6">
              Configure outbound delivery for workflow events with first-class controls for scope, subscriptions, and provider-specific settings.
            </CardDescription>
          </div>
          <Button onClick={() => setEditorTarget('create')}>Add integration</Button>
        </CardHeader>
      </Card>

      <IntegrationSummaryCards cards={summaryCards} />
      <IntegrationFilters
        search={search}
        statusFilter={statusFilter}
        scopeFilter={scopeFilter}
        onSearchChange={setSearch}
        onStatusFilterChange={setStatusFilter}
        onScopeFilterChange={setScopeFilter}
      />

      {integrations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <Plug className="h-12 w-12 text-muted" />
            <div className="space-y-1">
              <p className="font-medium">No integrations configured</p>
              <p className="text-sm text-muted">Add an integration to connect workflows with your external systems.</p>
            </div>
            <Button onClick={() => setEditorTarget('create')}>Add integration</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredIntegrations.map((integration) => (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              workflowName={integration.workflow_id ? workflowNameById.get(integration.workflow_id) ?? integration.workflow_id : 'Global integration'}
              isMutating={toggleMutation.isPending || deleteMutation.isPending || updateMutation.isPending}
              onEdit={() => setEditorTarget(integration)}
              onDelete={() => setDeleteTarget(integration)}
              onToggle={(isActive) => toggleMutation.mutate({ integrationId: integration.id, isActive })}
            />
          ))}
          {filteredIntegrations.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted">
                No integrations match the current filters.
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      <IntegrationEditorDialog
        mode={editorTarget === 'create' ? 'create' : 'edit'}
        integration={typeof editorTarget === 'object' ? editorTarget : null}
        open={editorTarget !== null}
        workflows={workflowsQuery.data?.data ?? []}
        isPending={createMutation.isPending || updateMutation.isPending}
        errorMessage={
          createMutation.error
            ? String(createMutation.error)
            : updateMutation.error
              ? String(updateMutation.error)
              : null
        }
        onOpenChange={(open) => !open && setEditorTarget(null)}
        onSubmit={(payload) => {
          if (editorTarget === 'create') {
            createMutation.mutate(payload as Parameters<typeof dashboardApi.createIntegration>[0]);
            return;
          }
          if (editorTarget && typeof editorTarget === 'object') {
            updateMutation.mutate({
              integrationId: editorTarget.id,
              payload: payload as Parameters<typeof dashboardApi.updateIntegration>[1],
            });
          }
        }}
      />

      <DeleteIntegrationDialog
        integration={deleteTarget}
        isPending={deleteMutation.isPending}
        onClose={() => setDeleteTarget(null)}
        onDelete={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />
    </div>
  );
}

function IntegrationCard(props: {
  integration: DashboardIntegrationRecord;
  workflowName: string;
  isMutating: boolean;
  onEdit(): void;
  onDelete(): void;
  onToggle(isActive: boolean): void;
}) {
  const summary = summarizeIntegrationConfig(props.integration);

  return (
    <Card>
      <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={kindVariant(props.integration.kind)}>
              {KIND_LABELS[props.integration.kind]}
            </Badge>
            <Badge variant="outline">{props.workflowName}</Badge>
            <Badge variant={props.integration.is_active ? 'secondary' : 'outline'}>
              {props.integration.is_active ? 'Active' : 'Paused'}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {props.integration.subscriptions.length > 0 ? (
              props.integration.subscriptions.map((subscription) => (
                <Badge key={subscription} variant="outline" className="text-xs">
                  {subscription}
                </Badge>
              ))
            ) : (
              <Badge variant="outline">Default event coverage</Badge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border px-3 py-2">
            <span className="text-sm">Active</span>
            <Switch
              checked={props.integration.is_active}
              disabled={props.isMutating}
              onCheckedChange={props.onToggle}
            />
          </div>
          <Button variant="outline" onClick={props.onEdit} disabled={props.isMutating}>
            <Pencil className="h-4 w-4" />
            Edit integration
          </Button>
          <Button variant="outline" onClick={props.onDelete} disabled={props.isMutating}>
            <Trash2 className="h-4 w-4" />
            Delete integration
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {summary.map((field) => (
            <div key={field.label} className="rounded-md bg-border/10 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">{field.label}</p>
              <p className="mt-1 text-sm">{field.value}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function DeleteIntegrationDialog(props: {
  integration: DashboardIntegrationRecord | null;
  isPending: boolean;
  onClose(): void;
  onDelete(): void;
}) {
  return (
    <Dialog open={props.integration !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[70vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Delete integration</DialogTitle>
          <DialogDescription>
            {props.integration
              ? `Delete the ${KIND_LABELS[props.integration.kind]} integration and stop future outbound deliveries for this destination.`
              : 'Delete this integration.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={props.onClose} disabled={props.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={props.onDelete} disabled={props.isPending}>
            {props.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete integration
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
