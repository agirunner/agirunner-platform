import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../../lib/api.js';

interface Task {
  id: string;
  title: string;
  status: string;
  assigned_worker: string | null;
  created_at: string;
}

function normalizeData(response: { data: Task[] } | Task[]): Task[] {
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
  awaiting_approval: 'bg-yellow-100 text-yellow-800',
};

function statusBadgeClass(status: string): string {
  return STATUS_COLORS[status.toLowerCase()] ?? 'bg-gray-100 text-gray-800';
}

export function TaskListPage(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => dashboardApi.listTasks(),
  });

  if (isLoading) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-destructive">Error loading data</div>;

  const tasks = normalizeData(data);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Tasks</h1>

      {tasks.length === 0 ? (
        <p className="text-muted-foreground">No tasks found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 pr-4 font-medium">Title</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 pr-4 font-medium">Assigned Worker</th>
                <th className="pb-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id} className="border-b hover:bg-muted/50">
                  <td className="py-3 pr-4 font-medium">{task.title}</td>
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(task.status)}`}
                    >
                      {task.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {task.assigned_worker ?? 'Unassigned'}
                  </td>
                  <td className="py-3 text-muted-foreground">
                    {new Date(task.created_at).toLocaleString()}
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
