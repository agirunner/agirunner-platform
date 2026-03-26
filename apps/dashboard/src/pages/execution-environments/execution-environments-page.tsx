import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Loader2, Plus, ServerCog } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { toast } from '../../lib/toast.js';
import type {
  DashboardExecutionEnvironmentCatalogRecord,
  DashboardExecutionEnvironmentRecord,
} from '../../lib/api.js';
import { MetricCard } from '../role-definitions/role-definitions-list.js';
import {
  archiveExecutionEnvironment,
  createExecutionEnvironment,
  createExecutionEnvironmentFromCatalog,
  fetchExecutionEnvironmentCatalog,
  fetchExecutionEnvironments,
  restoreExecutionEnvironment,
  setDefaultExecutionEnvironment,
  updateExecutionEnvironment,
  verifyExecutionEnvironment,
} from './execution-environments-page.api.js';
import { ExecutionEnvironmentCatalogSection } from './execution-environments-catalog.js';
import { ExecutionEnvironmentDialog } from './execution-environments-dialog.js';
import {
  buildExecutionEnvironmentPayload,
  buildExecutionEnvironmentStats,
  buildExecutionEnvironmentUpdatePayload,
  createExecutionEnvironmentForm,
  sortExecutionEnvironments,
  type ExecutionEnvironmentFormState,
} from './execution-environments-page.support.js';
import { ExecutionEnvironmentTable } from './execution-environments-table.js';

interface DialogState {
  mode: 'create' | 'edit';
  environmentId: string | null;
}

export function ExecutionEnvironmentsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [dialogState, setDialogState] = useState<DialogState | null>(null);
  const [dialogForm, setDialogForm] = useState<ExecutionEnvironmentFormState>(
    createExecutionEnvironmentForm(),
  );
  const [busyEnvironmentId, setBusyEnvironmentId] = useState<string | null>(null);

  const catalogQuery = useQuery({
    queryKey: ['execution-environment-catalog'],
    queryFn: fetchExecutionEnvironmentCatalog,
  });
  const environmentsQuery = useQuery({
    queryKey: ['execution-environments'],
    queryFn: fetchExecutionEnvironments,
  });

  const createOrUpdateMutation = useMutation({
    mutationFn: async () => {
      if (dialogState?.mode === 'edit' && dialogState.environmentId) {
        return updateExecutionEnvironment(
          dialogState.environmentId,
          buildExecutionEnvironmentUpdatePayload(dialogForm),
        );
      }
      return createExecutionEnvironment(buildExecutionEnvironmentPayload(dialogForm));
    },
    onSuccess: async (environment) => {
      await refreshEnvironmentQueries(queryClient);
      setDialogState(null);
      setDialogForm(createExecutionEnvironmentForm());
      toast.success(
        dialogState?.mode === 'edit'
          ? `Updated environment ${environment.name}.`
          : `Created environment ${environment.name}.`,
      );
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save environment.');
    },
  });

  const createFromCatalogMutation = useMutation({
    mutationFn: async (entry: DashboardExecutionEnvironmentCatalogRecord) => {
      setBusyEnvironmentId(entry.catalog_key);
      return createExecutionEnvironmentFromCatalog({
        catalogKey: entry.catalog_key,
        catalogVersion: entry.catalog_version,
      });
    },
    onSuccess: async (environment) => {
      setBusyEnvironmentId(null);
      await refreshEnvironmentQueries(queryClient);
      toast.success(`Added starter environment ${environment.name}.`);
    },
    onError: (error) => {
      setBusyEnvironmentId(null);
      toast.error(error instanceof Error ? error.message : 'Failed to add starter environment.');
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async (environment: DashboardExecutionEnvironmentRecord) => {
      setBusyEnvironmentId(environment.id);
      return verifyExecutionEnvironment(environment.id);
    },
    onSuccess: async (environment) => {
      setBusyEnvironmentId(null);
      await refreshEnvironmentQueries(queryClient);
      toast.success(`Verified environment ${environment.name}.`);
    },
    onError: (error) => {
      setBusyEnvironmentId(null);
      toast.error(error instanceof Error ? error.message : 'Failed to verify environment.');
    },
  });

  const defaultMutation = useMutation({
    mutationFn: async (environment: DashboardExecutionEnvironmentRecord) => {
      setBusyEnvironmentId(environment.id);
      return setDefaultExecutionEnvironment(environment.id);
    },
    onSuccess: async (environment) => {
      setBusyEnvironmentId(null);
      await refreshEnvironmentQueries(queryClient);
      toast.success(`Set ${environment.name} as the tenant default environment.`);
    },
    onError: (error) => {
      setBusyEnvironmentId(null);
      toast.error(error instanceof Error ? error.message : 'Failed to set default environment.');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (environment: DashboardExecutionEnvironmentRecord) => {
      setBusyEnvironmentId(environment.id);
      return archiveExecutionEnvironment(environment.id);
    },
    onSuccess: async (environment) => {
      setBusyEnvironmentId(null);
      await refreshEnvironmentQueries(queryClient);
      toast.success(`Archived environment ${environment.name}.`);
    },
    onError: (error) => {
      setBusyEnvironmentId(null);
      toast.error(error instanceof Error ? error.message : 'Failed to archive environment.');
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (environment: DashboardExecutionEnvironmentRecord) => {
      setBusyEnvironmentId(environment.id);
      return restoreExecutionEnvironment(environment.id);
    },
    onSuccess: async (environment) => {
      setBusyEnvironmentId(null);
      await refreshEnvironmentQueries(queryClient);
      toast.success(`Restored environment ${environment.name}.`);
    },
    onError: (error) => {
      setBusyEnvironmentId(null);
      toast.error(error instanceof Error ? error.message : 'Failed to restore environment.');
    },
  });

  const environments = useMemo(
    () => sortExecutionEnvironments(environmentsQuery.data ?? []),
    [environmentsQuery.data],
  );
  const stats = buildExecutionEnvironmentStats(environments);
  const defaultEnvironment = environments.find((environment) => environment.is_default) ?? null;
  const imageSuggestions = [...new Set((catalogQuery.data ?? []).map((entry) => entry.image))];

  if (catalogQuery.isLoading || environmentsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (catalogQuery.error || environmentsQuery.error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          Failed to load execution environments: {String(catalogQuery.error ?? environmentsQuery.error)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <ServerCog className="h-5 w-5 text-accent" />
            <h1 className="text-2xl font-semibold">Environments</h1>
          </div>
          <p className="max-w-3xl text-sm text-muted">
            Configure tenant-owned Specialist execution environments. These records define the image, CPU, memory, and pull policy used for execution containers.
          </p>
        </div>
        <Button
          onClick={() => {
            setDialogState({ mode: 'create', environmentId: null });
            setDialogForm(createExecutionEnvironmentForm());
          }}
        >
          <Plus className="h-4 w-4" />
          Create Custom Environment
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total environments" value={stats.total} />
        <MetricCard
          label="Claimable"
          value={stats.claimable}
          tone={stats.claimable > 0 ? 'success' : 'warning'}
        />
        <MetricCard label="Catalog starters" value={stats.catalog} />
        <MetricCard label="Custom images" value={stats.custom} />
      </div>

      <div className="rounded-xl border border-border/70 bg-muted/10 px-4 py-4 text-sm">
        <p className="font-medium text-foreground">
          {defaultEnvironment
            ? `Tenant default: ${defaultEnvironment.name}`
            : 'No tenant default environment is configured.'}
        </p>
        <p className="mt-1 text-muted">
          {defaultEnvironment
            ? `${defaultEnvironment.image} | CPU ${defaultEnvironment.cpu} | Memory ${defaultEnvironment.memory} | Pull ${defaultEnvironment.pull_policy}`
            : 'Set one of the compatible tenant environments as default before assigning roles to inherit the default environment.'}
        </p>
      </div>

      <ExecutionEnvironmentCatalogSection
        catalog={catalogQuery.data ?? []}
        environments={environments}
        addingCatalogKey={createFromCatalogMutation.isPending ? busyEnvironmentId : null}
        onAddStarter={(entry) => createFromCatalogMutation.mutate(entry)}
      />

      <ExecutionEnvironmentTable
        environments={environments}
        busyEnvironmentId={busyEnvironmentId}
        onEdit={(environment) => {
          setDialogState({ mode: 'edit', environmentId: environment.id });
          setDialogForm(createExecutionEnvironmentForm(environment));
        }}
        onVerify={(environment) => verifyMutation.mutate(environment)}
        onSetDefault={(environment) => defaultMutation.mutate(environment)}
        onArchive={(environment) => archiveMutation.mutate(environment)}
        onRestore={(environment) => restoreMutation.mutate(environment)}
      />

      {dialogState ? (
        <ExecutionEnvironmentDialog
          open
          title={dialogState.mode === 'edit' ? 'Edit Environment' : 'Create Custom Environment'}
          description={
            dialogState.mode === 'edit'
              ? 'Update the tenant-owned execution environment. Saving resets verification so it must be verified again before roles can claim it.'
              : 'Create a tenant-owned execution environment from any public base image.'
          }
          submitLabel={dialogState.mode === 'edit' ? 'Save Environment' : 'Create Environment'}
          form={dialogForm}
          imageSuggestions={imageSuggestions}
          isPending={createOrUpdateMutation.isPending}
          mutationError={
            createOrUpdateMutation.error instanceof Error
              ? createOrUpdateMutation.error.message
              : null
          }
          onFormChange={setDialogForm}
          onClose={() => {
            if (!createOrUpdateMutation.isPending) {
              setDialogState(null);
            }
          }}
          onSubmit={() => createOrUpdateMutation.mutate()}
        />
      ) : null}
    </div>
  );
}

async function refreshEnvironmentQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['execution-environments'] }),
    queryClient.invalidateQueries({ queryKey: ['execution-environment-catalog'] }),
    queryClient.invalidateQueries({ queryKey: ['roles'] }),
  ]);
}
