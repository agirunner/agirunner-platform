import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../../lib/api.js';

interface Agent {
  id: string;
  name: string;
  status: string;
  role?: string;
  created_at: string;
}

function normalizeData(response: { data: Agent[] } | Agent[]): Agent[] {
  if (Array.isArray(response)) {
    return response;
  }
  return response?.data ?? [];
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  inactive: 'bg-gray-100 text-gray-800',
  busy: 'bg-blue-100 text-blue-800',
  error: 'bg-red-100 text-red-800',
};

function statusBadgeClass(status: string): string {
  return STATUS_COLORS[status.toLowerCase()] ?? 'bg-gray-100 text-gray-800';
}

export function AgentListPage(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['agents'],
    queryFn: () => dashboardApi.listAgents(),
  });

  if (isLoading) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-destructive">Error loading data</div>;

  const agents = normalizeData(data);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Agents</h1>

      {agents.length === 0 ? (
        <p className="text-muted-foreground">No agents registered.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 pr-4 font-medium">Name</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 pr-4 font-medium">Role</th>
                <th className="pb-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id} className="border-b hover:bg-muted/50">
                  <td className="py-3 pr-4 font-medium">{agent.name}</td>
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(agent.status)}`}
                    >
                      {agent.status}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {agent.role ?? '-'}
                  </td>
                  <td className="py-3 text-muted-foreground">
                    {new Date(agent.created_at).toLocaleString()}
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
