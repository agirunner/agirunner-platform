import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../../lib/api.js';

interface Workflow {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

function normalizeData(response: { data: Workflow[] } | Workflow[]): Workflow[] {
  if (Array.isArray(response)) {
    return response;
  }
  return response?.data ?? [];
}

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  pending: 'bg-gray-100 text-gray-800',
  paused: 'bg-yellow-100 text-yellow-800',
};

function statusBadgeClass(status: string): string {
  return STATUS_COLORS[status.toLowerCase()] ?? 'bg-gray-100 text-gray-800';
}

export function WorkflowListPage(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['workflows'],
    queryFn: () => dashboardApi.listWorkflows(),
  });

  if (isLoading) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-destructive">Error loading data</div>;

  const workflows = normalizeData(data);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Workflows</h1>
        <button
          type="button"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Launch Workflow
        </button>
      </div>

      {workflows.length === 0 ? (
        <p className="text-muted-foreground">No workflows found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 pr-4 font-medium">Name</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((wf) => (
                <tr key={wf.id} className="border-b hover:bg-muted/50">
                  <td className="py-3 pr-4 font-medium">{wf.name}</td>
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(wf.status)}`}
                    >
                      {wf.status}
                    </span>
                  </td>
                  <td className="py-3 text-muted-foreground">
                    {new Date(wf.created_at).toLocaleString()}
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
