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

export function AlertsApprovalsPage(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['tasks', 'awaiting_approval'],
    queryFn: () => dashboardApi.listTasks({ status: 'awaiting_approval' }),
  });

  if (isLoading) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-destructive">Error loading data</div>;

  const tasks = normalizeData(data);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Alerts & Approvals</h1>

      {tasks.length === 0 ? (
        <p className="text-muted-foreground">No tasks awaiting approval.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 pr-4 font-medium">Title</th>
                <th className="pb-2 pr-4 font-medium">Assigned Worker</th>
                <th className="pb-2 pr-4 font-medium">Created</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id} className="border-b">
                  <td className="py-3 pr-4">{task.title}</td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {task.assigned_worker ?? 'Unassigned'}
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {new Date(task.created_at).toLocaleString()}
                  </td>
                  <td className="py-3">
                    <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800">
                      Awaiting Approval
                    </span>
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
