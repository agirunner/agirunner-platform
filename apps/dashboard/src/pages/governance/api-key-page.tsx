import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../../lib/api.js';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  expires_at?: string;
  is_active: boolean;
}

function normalizeData(response: { data: ApiKey[] } | ApiKey[]): ApiKey[] {
  if (Array.isArray(response)) {
    return response;
  }
  return response?.data ?? [];
}

export function ApiKeyPage(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => dashboardApi.listApiKeys(),
  });

  if (isLoading) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-destructive">Error loading data</div>;

  const apiKeys = normalizeData(data);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">API Keys</h1>
        <button
          type="button"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Create API Key
        </button>
      </div>

      {apiKeys.length === 0 ? (
        <p className="text-muted-foreground">No API keys found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 pr-4 font-medium">Name</th>
                <th className="pb-2 pr-4 font-medium">Prefix</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 pr-4 font-medium">Created</th>
                <th className="pb-2 pr-4 font-medium">Expires</th>
                <th className="pb-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {apiKeys.map((key) => (
                <tr key={key.id} className="border-b hover:bg-muted/50">
                  <td className="py-3 pr-4 font-medium">{key.name}</td>
                  <td className="py-3 pr-4 font-mono text-muted-foreground">
                    {key.prefix}...
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        key.is_active
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {key.is_active ? 'Active' : 'Revoked'}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {new Date(key.created_at).toLocaleString()}
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {key.expires_at
                      ? new Date(key.expires_at).toLocaleDateString()
                      : 'Never'}
                  </td>
                  <td className="py-3">
                    {key.is_active && (
                      <button
                        type="button"
                        className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                      >
                        Revoke
                      </button>
                    )}
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
