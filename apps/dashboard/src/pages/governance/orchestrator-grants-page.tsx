import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  GrantsEmptyState,
  GrantsErrorState,
  GrantsHeader,
  GrantsLoadingState,
  GrantsOverview,
} from './orchestrator-grants-page.sections.js';
import { fetchGrants, revokeGrant, summarizeGrants } from './orchestrator-grants-page.support.js';
import { GrantsTableSection } from './orchestrator-grants-page.table.js';
import { CreateGrantDialog } from './orchestrator-grants-page.dialog.js';

export function OrchestratorGrantsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const grantsQuery = useQuery({
    queryKey: ['orchestrator-grants'],
    queryFn: fetchGrants,
    retry: false,
  });
  const revokeMutation = useMutation({
    mutationFn: revokeGrant,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orchestrator-grants'] });
    },
  });

  if (grantsQuery.isLoading) {
    return <GrantsLoadingState />;
  }

  if (grantsQuery.error) {
    return <GrantsErrorState error={grantsQuery.error} />;
  }

  const grants = grantsQuery.data ?? [];

  return (
    <div className="space-y-6 p-6">
      <GrantsHeader onCreate={() => setIsCreateOpen(true)} />
      <GrantsOverview summary={summarizeGrants(grants)} />
      {grants.length === 0 ? (
        <GrantsEmptyState onCreate={() => setIsCreateOpen(true)} />
      ) : (
        <GrantsTableSection
          grants={grants}
          isRevoking={revokeMutation.isPending}
          onRevoke={(grantId) => revokeMutation.mutate(grantId)}
        />
      )}
      <CreateGrantDialog isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
    </div>
  );
}
