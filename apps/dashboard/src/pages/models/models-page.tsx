import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { BrainCog, Loader2 } from 'lucide-react';

import { DashboardPageHeader } from '../../components/layout/dashboard-page-header.js';
import { DashboardSectionCard } from '../../components/layout/dashboard-section-card.js';
import { dashboardApi } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { buildAssignmentSummaryCards } from './assignments/assignment-summary.js';
import { RoleAssignmentsSection } from './assignments/assignments-section.js';
import {
  AssignmentSummaryCards,
  DIALOG_ALERT_CLASS_NAME,
  ERROR_PANEL_STYLE,
} from './models-page.chrome.js';
import { ModelCatalog } from './model-catalog.js';
import {
  buildAssignmentRoleRows,
  formatContextWindow,
  getModelEnablementState,
  getProviderTypeDefaults,
  reasoningBadgeVariant,
  reasoningLabel,
} from './models-page.defaults.js';
import { AddProviderDialog, ConnectOAuthDialog } from './providers/provider-dialogs.js';
import {
  DeleteProviderDialog,
  OAuthProviderCard,
  ProviderCard,
} from './providers/provider-cards.js';
import type { AssignmentSurfaceSummaryCard } from './models-page.support.js';
import type { ProviderDeleteTarget } from './models-page.types.js';

export {
  buildAssignmentRoleRows,
  formatContextWindow,
  getModelEnablementState,
  getProviderTypeDefaults,
  reasoningBadgeVariant,
  reasoningLabel,
};

export function ModelsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [discoveringId, setDiscoveringId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProviderDeleteTarget | null>(null);

  useEffect(() => {
    const oauthSuccess = searchParams.get('oauth_success');
    const oauthError = searchParams.get('oauth_error');
    const oauthEmail = searchParams.get('oauth_email');

    if (oauthSuccess) {
      const msg = oauthEmail
        ? `OAuth connected successfully (${oauthEmail}).`
        : 'OAuth connected successfully.';
      toast.success(msg);
      queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
      queryClient.invalidateQueries({ queryKey: ['llm-models'] });
      setSearchParams({}, { replace: true });
    } else if (oauthError) {
      toast.error(`OAuth failed: ${oauthError}`);
      setSearchParams({}, { replace: true });
    }
  }, [queryClient, searchParams, setSearchParams]);

  const providersQuery = useQuery({
    queryKey: ['llm-providers'],
    queryFn: () => dashboardApi.listLlmProviders(),
  });
  const modelsQuery = useQuery({
    queryKey: ['llm-models'],
    queryFn: () => dashboardApi.listLlmModels(),
  });
  const assignmentsQuery = useQuery({
    queryKey: ['llm-assignments'],
    queryFn: () => dashboardApi.listLlmAssignments(),
  });
  const roleDefinitionsQuery = useQuery({
    queryKey: ['role-definitions', 'llm-assignments'],
    queryFn: () => dashboardApi.listRoleDefinitions(),
  });
  const systemDefaultQuery = useQuery({
    queryKey: ['llm-system-default'],
    queryFn: () => dashboardApi.getLlmSystemDefault(),
  });

  const providers = Array.isArray(providersQuery.data) ? providersQuery.data : [];
  const models = Array.isArray(modelsQuery.data) ? modelsQuery.data : [];
  const assignments = Array.isArray(assignmentsQuery.data) ? assignmentsQuery.data : [];
  const roleDefinitions = Array.isArray(roleDefinitionsQuery.data) ? roleDefinitionsQuery.data : [];
  const enabledModels = models.filter((model) => model.is_enabled !== false);
  const systemDefault = systemDefaultQuery.data ?? { modelId: null, reasoningConfig: null };
  const initialAssignmentSummaryCards = useMemo(
    () =>
      buildAssignmentSummaryCards({
        enabledModels,
        assignments,
        roleDefinitions,
        systemDefault,
      }),
    [assignments, enabledModels, roleDefinitions, systemDefault],
  );
  const [assignmentSurfaceCards, setAssignmentSurfaceCards] = useState<
    AssignmentSurfaceSummaryCard[]
  >(initialAssignmentSummaryCards);

  useEffect(() => {
    setAssignmentSurfaceCards(initialAssignmentSummaryCards);
  }, [initialAssignmentSummaryCards]);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) {
        throw new Error('Choose a provider to delete.');
      }
      return dashboardApi.deleteLlmProvider(deleteTarget.provider.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
      queryClient.invalidateQueries({ queryKey: ['llm-models'] });
      toast.success(`Provider "${deleteTarget?.provider.name ?? 'provider'}" deleted.`);
      setDeleteTarget(null);
    },
    onError: (error) => {
      toast.error(`Failed to delete provider: ${String(error)}`);
    },
  });

  const discoverMutation = useMutation({
    mutationFn: (providerId: string) => dashboardApi.discoverLlmModels(providerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
      queryClient.invalidateQueries({ queryKey: ['llm-models'] });
      setDiscoveringId(null);
      toast.success('Model discovery complete.');
    },
    onError: (error) => {
      setDiscoveringId(null);
      toast.error(`Discovery failed: ${String(error)}`);
    },
  });

  const toggleModelEnabled = useMutation({
    mutationFn: ({ modelId, isEnabled }: { modelId: string; isEnabled: boolean }) =>
      dashboardApi.updateLlmModel(modelId, { isEnabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llm-models'] });
    },
    onError: (error) => {
      toast.error(`Failed to update model: ${String(error)}`);
    },
  });

  function handleDiscover(providerId: string) {
    setDiscoveringId(providerId);
    discoverMutation.mutate(providerId);
  }

  const isLoading =
    providersQuery.isLoading ||
    modelsQuery.isLoading ||
    assignmentsQuery.isLoading ||
    roleDefinitionsQuery.isLoading;
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  const hasError =
    providersQuery.error ||
    modelsQuery.error ||
    assignmentsQuery.error ||
    roleDefinitionsQuery.error;
  if (hasError) {
    return (
      <div className="p-6">
        <div className={DIALOG_ALERT_CLASS_NAME} style={ERROR_PANEL_STYLE}>
          Failed to load LLM configuration:{' '}
          {String(
            providersQuery.error ??
              modelsQuery.error ??
              assignmentsQuery.error ??
              roleDefinitionsQuery.error,
          )}
        </div>
      </div>
    );
  }

  function requestProviderDelete(providerId: string) {
    const provider = providers.find((entry) => entry.id === providerId);
    if (!provider) {
      toast.error('Provider not found.');
      return;
    }
    setDeleteTarget({
      provider,
      modelCount: models.filter((model) => model.provider_id === providerId).length,
    });
  }

  return (
    <div className="space-y-8 p-6">
      <DashboardPageHeader
        navHref="/platform/models"
        description="Manage model providers, the model catalog, and specialist model assignments."
        actions={
          <>
            <ConnectOAuthDialog />
            <AddProviderDialog existingNames={providers.map((provider) => provider.name)} />
          </>
        }
      />
      <DashboardSectionCard
        id="llm-providers-library"
        title="Providers"
        description="Manage provider connectivity and refresh the discovered model catalog from each source."
      >
        {providers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted">
            <BrainCog className="mb-4 h-12 w-12" />
            <p className="font-medium">No providers configured</p>
            <p className="mt-1 text-sm">Add an LLM provider to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {providers.map((provider) =>
              provider.auth_mode === 'oauth' ? (
                <OAuthProviderCard
                  key={provider.id}
                  provider={provider}
                  modelCount={models.filter((model) => model.provider_id === provider.id).length}
                  onDelete={requestProviderDelete}
                  onDiscover={handleDiscover}
                  isDiscovering={discoveringId === provider.id}
                />
              ) : (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  modelCount={models.filter((model) => model.provider_id === provider.id).length}
                  onDelete={requestProviderDelete}
                  onDiscover={handleDiscover}
                  isDiscovering={discoveringId === provider.id}
                />
              ),
            )}
          </div>
        )}
      </DashboardSectionCard>
      <ModelCatalog
        models={models}
        providers={providers}
        onToggleEnabled={(modelId, isEnabled) => toggleModelEnabled.mutate({ modelId, isEnabled })}
      />
      <AssignmentSummaryCards cards={assignmentSurfaceCards} />
      <RoleAssignmentsSection
        enabledModels={enabledModels}
        assignments={assignments}
        roleDefinitions={roleDefinitions}
        systemDefault={systemDefault}
        onSummaryCardsChange={setAssignmentSurfaceCards}
      />
      <DeleteProviderDialog
        target={deleteTarget}
        isDeleting={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) {
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
