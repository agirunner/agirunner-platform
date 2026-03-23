import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { dashboardApi, type DashboardApiKeyRecord } from '../../lib/api.js';
import { CreateApiKeyDialog, RevokeConfirmDialog } from './api-key-page.dialogs.js';
import {
  ApiKeyEmptyState,
  ApiKeyHeader,
  ApiKeyLifecycleSection,
  ApiKeyOverview,
} from './api-key-page.sections.js';

export function ApiKeyPage(): JSX.Element {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<DashboardApiKeyRecord | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => dashboardApi.listApiKeys(),
  });

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Loading API keys...</div>;
  }

  if (error) {
    return <div className="p-6 text-red-600">Failed to load API keys.</div>;
  }

  const apiKeys: DashboardApiKeyRecord[] = Array.isArray(data) ? data : [];

  return (
    <div className="space-y-6 p-6">
      <ApiKeyHeader onCreate={() => setIsCreateOpen(true)} />
      <ApiKeyOverview apiKeys={apiKeys} />
      {apiKeys.length === 0 ? (
        <ApiKeyEmptyState onCreate={() => setIsCreateOpen(true)} />
      ) : (
        <ApiKeyLifecycleSection apiKeys={apiKeys} onRevoke={(record) => setRevokeTarget(record)} />
      )}
      <CreateApiKeyDialog isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      {revokeTarget ? (
        <RevokeConfirmDialog
          isOpen
          onClose={() => setRevokeTarget(null)}
          record={revokeTarget}
        />
      ) : null}
    </div>
  );
}
