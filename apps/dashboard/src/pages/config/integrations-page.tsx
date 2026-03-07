import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../../lib/api.js';

interface Integration {
  id: string;
  name: string;
  type: string;
  status: string;
  created_at: string;
}

function normalizeData(response: { data: Integration[] } | Integration[]): Integration[] {
  if (Array.isArray(response)) {
    return response;
  }
  return response?.data ?? [];
}

export function IntegrationsPage(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['integrations'],
    queryFn: () => dashboardApi.listIntegrations(),
  });

  if (isLoading) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-destructive">Error loading data</div>;

  const integrations = normalizeData(data);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Integrations</h1>

      {integrations.length === 0 ? (
        <p className="text-muted-foreground">No integrations configured.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 pr-4 font-medium">Name</th>
                <th className="pb-2 pr-4 font-medium">Type</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {integrations.map((integration) => (
                <tr key={integration.id} className="border-b hover:bg-muted/50">
                  <td className="py-3 pr-4 font-medium">{integration.name}</td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {integration.type}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        integration.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {integration.status}
                    </span>
                  </td>
                  <td className="py-3 text-muted-foreground">
                    {new Date(integration.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
