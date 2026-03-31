import type * as Contracts from '../contracts.js';
import type { DashboardApiMethodContext } from './method-context.js';

export function createDashboardApiMethodsGroup6(
  context: DashboardApiMethodContext,
): Partial<Contracts.DashboardApi> {
  const { requestData, withRefresh } = context;

  return {
    listCommunityCatalogPlaybooks: () =>
      withRefresh(() =>
        requestData<Contracts.DashboardCommunityCatalogPlaybookRecord[]>(
          '/api/v1/community-catalog/playbooks',
          { method: 'GET' },
        ),
      ),
    getCommunityCatalogPlaybookDetail: (playbookId) =>
      withRefresh(() =>
        requestData<Contracts.DashboardCommunityCatalogPlaybookDetail>(
          `/api/v1/community-catalog/playbooks/${playbookId}`,
          { method: 'GET' },
        ),
      ),
    previewCommunityCatalogImport: (payload) =>
      withRefresh(() =>
        requestData<Contracts.DashboardCommunityCatalogImportPreview>(
          '/api/v1/community-catalog/import-preview',
          {
            method: 'POST',
            body: payload as Record<string, unknown>,
          },
        ),
      ),
    importCommunityCatalogPlaybooks: (payload) =>
      withRefresh(() =>
        requestData<Contracts.DashboardCommunityCatalogImportResult>(
          '/api/v1/community-catalog/import',
          {
            method: 'POST',
            body: payload as Record<string, unknown>,
          },
        ),
      ),
    getCommunityCatalogPlaybookOrigin: (playbookId) =>
      withRefresh(() =>
        requestData<Contracts.DashboardCommunityCatalogPlaybookOrigin>(
          `/api/v1/community-catalog/imported-playbooks/${playbookId}/origin`,
          { method: 'GET' },
        ),
      ),
  };
}
