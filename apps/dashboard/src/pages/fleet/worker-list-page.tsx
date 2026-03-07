import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../../lib/api.js';

interface Worker {
  id: string;
  name: string;
  status: string;
  capabilities: string[];
  created_at: string;
}

function normalizeData(response: { data: Worker[] } | Worker[]): Worker[] {
  if (Array.isArray(response)) {
    return response;
  }
  return response?.data ?? [];
}

const STATUS_COLORS: Record<string, string> = {
  online: 'bg-green-100 text-green-800',
  offline: 'bg-gray-100 text-gray-800',
  busy: 'bg-blue-100 text-blue-800',
  error: 'bg-red-100 text-red-800',
};

function statusBadgeClass(status: string): string {
  return STATUS_COLORS[status.toLowerCase()] ?? 'bg-gray-100 text-gray-800';
}

export function WorkerListPage(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['workers'],
    queryFn: () => dashboardApi.listWorkers(),
  });

  if (isLoading) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-destructive">Error loading data</div>;

  const workers = normalizeData(data);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Workers</h1>

      {workers.length === 0 ? (
        <p className="text-muted-foreground">No workers registered.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 pr-4 font-medium">Name</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 pr-4 font-medium">Capabilities</th>
                <th className="pb-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((worker) => (
                <tr key={worker.id} className="border-b hover:bg-muted/50">
                  <td className="py-3 pr-4 font-medium">{worker.name}</td>
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(worker.status)}`}
                    >
                      {worker.status}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex flex-wrap gap-1">
                      {(worker.capabilities ?? []).map((cap) => (
                        <span
                          key={cap}
                          className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs"
                        >
                          {cap}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 text-muted-foreground">
                    {new Date(worker.created_at).toLocaleString()}
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
