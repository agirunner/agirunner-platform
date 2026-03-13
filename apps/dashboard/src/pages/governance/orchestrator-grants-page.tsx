import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import { dashboardApi } from '../../lib/api.js';
import {
  GrantsEmptyState,
  GrantsErrorState,
  GrantsFilterBar,
  GrantsFilteredEmptyState,
  GrantsHeader,
  GrantsLoadingState,
  GrantsOverview,
} from './orchestrator-grants-page.sections.js';
import {
  buildAgentItems,
  buildWorkflowItems,
  fetchGrants,
  findAgent,
  findWorkflow,
  hasGrantFilters,
  readGrantFilters,
  revokeGrant,
  sortGrants,
  sortAgents,
  sortWorkflows,
  summarizeGrants,
  writeGrantFilters,
} from './orchestrator-grants-page.support.js';
import { GrantsTableSection } from './orchestrator-grants-page.table.js';
import { CreateGrantDialog, RevokeGrantDialog } from './orchestrator-grants-page.dialog.js';
import { toast } from '../../lib/toast.js';

export function OrchestratorGrantsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [revokeTargetId, setRevokeTargetId] = useState<string | null>(null);
  const filters = readGrantFilters(searchParams);
  const grantsQuery = useQuery({
    queryKey: ['orchestrator-grants', filters.workflowId, filters.agentId],
    queryFn: () => fetchGrants(filters),
    retry: false,
  });
  const agentsQuery = useQuery({
    queryKey: ['orchestrator-grant-agent-filters'],
    queryFn: () => dashboardApi.listAgents(),
    staleTime: 30_000,
  });
  const workflowsQuery = useQuery({
    queryKey: ['orchestrator-grant-workflow-filters'],
    queryFn: () => dashboardApi.listWorkflows(),
    staleTime: 30_000,
  });
  const revokeMutation = useMutation({
    mutationFn: revokeGrant,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orchestrator-grants'] });
      setRevokeTargetId(null);
      toast.success('Grant revoked');
    },
    onError: () => {
      toast.error('Failed to revoke grant');
    },
  });

  if (grantsQuery.isLoading) {
    return <GrantsLoadingState />;
  }

  if (grantsQuery.error) {
    return <GrantsErrorState error={grantsQuery.error} />;
  }

  const grants = sortGrants(grantsQuery.data ?? []);
  const hasFiltersApplied = hasGrantFilters(filters);
  const agents = sortAgents(agentsQuery.data ?? []);
  const workflows = sortWorkflows(workflowsQuery.data?.data ?? []);
  const revokeTarget = grants.find((grant) => grant.id === revokeTargetId) ?? null;

  function updateFilters(nextFilters: Partial<typeof filters>): void {
    setSearchParams(
      (current) => writeGrantFilters(current, { ...filters, ...nextFilters }),
      { replace: true },
    );
  }

  function clearFilters(): void {
    setSearchParams((current) => writeGrantFilters(current, {}), { replace: true });
  }

  return (
    <div className="space-y-6 p-6">
      <GrantsHeader onCreate={() => setIsCreateOpen(true)} />
      <GrantsOverview summary={summarizeGrants(grants)} />
      <GrantsFilterBar
        filters={filters}
        workflowItems={buildWorkflowItems(workflows)}
        agentItems={buildAgentItems(agents)}
        workflowsLoading={workflowsQuery.isLoading}
        agentsLoading={agentsQuery.isLoading}
        workflowsError={Boolean(workflowsQuery.error)}
        agentsError={Boolean(agentsQuery.error)}
        onWorkflowChange={(workflowId) => updateFilters({ workflowId })}
        onAgentChange={(agentId) => updateFilters({ agentId })}
        onReset={clearFilters}
      />
      {grants.length === 0 ? (
        hasFiltersApplied ? (
          <GrantsFilteredEmptyState
            onClearFilters={clearFilters}
            onCreate={() => setIsCreateOpen(true)}
          />
        ) : (
          <GrantsEmptyState onCreate={() => setIsCreateOpen(true)} />
        )
      ) : (
        <GrantsTableSection
          grants={grants}
          agents={agents}
          workflows={workflows}
          isRevoking={revokeMutation.isPending}
          onRevoke={(grantId) => setRevokeTargetId(grantId)}
        />
      )}
      <CreateGrantDialog isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      {revokeTarget ? (
        <RevokeGrantDialog
          isOpen
          onClose={() => setRevokeTargetId(null)}
          grant={revokeTarget}
          agent={findAgent(agents, revokeTarget.agent_id)}
          workflow={findWorkflow(workflows, revokeTarget.workflow_id)}
          isRevoking={revokeMutation.isPending}
          onConfirm={(grantId) => revokeMutation.mutateAsync(grantId)}
        />
      ) : null}
    </div>
  );
}
