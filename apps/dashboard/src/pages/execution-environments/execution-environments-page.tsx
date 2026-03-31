import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';

import {
  DEFAULT_LIST_PAGE_SIZE,
  ListPagination,
  paginateListItems,
} from '../../components/list-pagination/list-pagination.js';
import { DashboardPageHeader } from '../../components/layout/dashboard-page-header.js';
import { DashboardSectionCard } from '../../components/layout/dashboard-section-card.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { toast } from '../../lib/toast.js';
import type { DashboardExecutionEnvironmentRecord } from '../../lib/api.js';
import { MetricCard } from '../role-definitions/role-definitions-list.js';
import {
  archiveExecutionEnvironment,
  ExecutionEnvironmentAutoVerifyError,
  fetchExecutionEnvironments,
  restoreExecutionEnvironment,
  saveExecutionEnvironmentAndVerify,
  setDefaultExecutionEnvironment,
  verifyExecutionEnvironment,
} from './execution-environments-page.api.js';
import { ExecutionEnvironmentDialog } from './execution-environments-dialog.js';
import {
  buildExecutionEnvironmentPayload,
  buildExecutionEnvironmentStats,
  buildExecutionEnvironmentUpdatePayload,
  createCopiedExecutionEnvironmentForm,
  createExecutionEnvironmentForm,
  sortExecutionEnvironments,
  type ExecutionEnvironmentFormState,
} from './execution-environments-page.support.js';
import { ExecutionEnvironmentTable } from './execution-environments-table.js';

interface DialogState {
  mode: 'copy' | 'create' | 'edit';
  environmentId: string | null;
}

export function ExecutionEnvironmentsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [dialogState, setDialogState] = useState<DialogState | null>(null);
  const [dialogForm, setDialogForm] = useState<ExecutionEnvironmentFormState>(
    createExecutionEnvironmentForm(),
  );
  const [busyEnvironmentId, setBusyEnvironmentId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_LIST_PAGE_SIZE);

  const environmentsQuery = useQuery({
    queryKey: ['execution-environments'],
    queryFn: fetchExecutionEnvironments,
  });

  const createOrUpdateMutation = useMutation({
    mutationFn: async () => {
      return saveExecutionEnvironmentAndVerify({
        mode: dialogState?.mode === 'edit' ? 'edit' : 'create',
        environmentId: dialogState?.environmentId ?? undefined,
        payload:
          dialogState?.mode === 'edit'
            ? buildExecutionEnvironmentUpdatePayload(dialogForm)
            : buildExecutionEnvironmentPayload(dialogForm),
      });
    },
    onSuccess: async (environment) => {
      await refreshEnvironmentQueries(queryClient);
      setDialogState(null);
      setDialogForm(createExecutionEnvironmentForm());
      if (environment.compatibility_status === 'compatible') {
        toast.success(
          dialogState?.mode === 'edit'
            ? `Updated and verified environment ${environment.name}.`
            : `Created and verified environment ${environment.name}.`,
        );
        return;
      }
      toast.error(
        dialogState?.mode === 'edit'
          ? `Updated environment ${environment.name}, but verification reported incompatibilities.`
          : `Created environment ${environment.name}, but verification reported incompatibilities.`,
      );
    },
    onError: async (error) => {
      if (error instanceof ExecutionEnvironmentAutoVerifyError) {
        await refreshEnvironmentQueries(queryClient);
        setDialogState(null);
        setDialogForm(createExecutionEnvironmentForm());
        toast.error(error.message);
        return;
      }
      toast.error(error instanceof Error ? error.message : 'Failed to save environment.');
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
      toast.success(`Set ${environment.name} as the default environment.`);
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
  const pagination = paginateListItems(environments, page, pageSize);
  const stats = buildExecutionEnvironmentStats(environments);
  const defaultEnvironment = environments.find((environment) => environment.is_default) ?? null;

  if (environmentsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (environmentsQuery.error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          Failed to load execution environments: {String(environmentsQuery.error)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <DashboardPageHeader
        navHref="/platform/environments"
        description="Configure specialist execution environments. These records define the image, CPU, memory, and pull policy used for execution containers."
        actions={
          <Button
            onClick={() => {
              setDialogState({ mode: 'create', environmentId: null });
              setDialogForm(createExecutionEnvironmentForm());
            }}
          >
            <Plus className="h-4 w-4" />
            Create Custom Environment
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Total environments" value={stats.total} />
        <MetricCard label="Catalog" value={stats.catalog} />
        <MetricCard label="Custom images" value={stats.custom} />
      </div>

      <Card>
        <CardContent className="px-4 py-4 text-sm">
          <p className="font-medium text-foreground">
            {defaultEnvironment
              ? `Default environment: ${defaultEnvironment.name}`
              : 'No default environment is configured.'}
          </p>
          <p className="mt-1 text-muted">
            {defaultEnvironment
              ? `${defaultEnvironment.image} | CPU ${defaultEnvironment.cpu} | Memory ${defaultEnvironment.memory} | Pull ${defaultEnvironment.pull_policy}`
              : 'Set one of the verified environments as default before assigning roles to inherit the default environment.'}
          </p>
        </CardContent>
      </Card>

      <DashboardSectionCard
        title="Configured environments"
        description="Manage the execution environments available to Specialist roles."
        bodyClassName="space-y-0 p-0"
      >
        <div className="overflow-x-auto px-6 pb-0">
          <ExecutionEnvironmentTable
            environments={pagination.items}
            busyEnvironmentId={busyEnvironmentId}
            onCopy={(environment) => {
              setDialogState({ mode: 'copy', environmentId: null });
              setDialogForm(createCopiedExecutionEnvironmentForm(environment));
            }}
            onEdit={(environment) => {
              setDialogState({ mode: 'edit', environmentId: environment.id });
              setDialogForm(createExecutionEnvironmentForm(environment));
            }}
            onVerify={(environment) => verifyMutation.mutate(environment)}
            onSetDefault={(environment) => defaultMutation.mutate(environment)}
            onArchive={(environment) => archiveMutation.mutate(environment)}
            onRestore={(environment) => restoreMutation.mutate(environment)}
          />
        </div>
        <ListPagination
          page={pagination.page}
          pageSize={pageSize}
          totalItems={pagination.totalItems}
          totalPages={pagination.totalPages}
          start={pagination.start}
          end={pagination.end}
          itemLabel="environments"
          onPageChange={setPage}
          onPageSizeChange={(value) => {
            setPageSize(value);
            setPage(1);
          }}
        />
      </DashboardSectionCard>

      {dialogState ? (
        <ExecutionEnvironmentDialog
          open
          title={
            dialogState.mode === 'edit'
              ? 'Edit Environment'
              : dialogState.mode === 'copy'
                ? 'Copy Environment'
                : 'Create Custom Environment'
          }
          description={
            dialogState.mode === 'edit'
              ? 'Update the execution environment. Saving automatically re-verifies it before roles can use it.'
              : dialogState.mode === 'copy'
                ? 'Create a custom execution environment by copying the selected configuration.'
                : 'Create a custom execution environment from any public base image.'
          }
          submitLabel={dialogState.mode === 'edit' ? 'Save Environment' : 'Create Environment'}
          form={dialogForm}
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
    queryClient.invalidateQueries({ queryKey: ['roles'] }),
  ]);
}
