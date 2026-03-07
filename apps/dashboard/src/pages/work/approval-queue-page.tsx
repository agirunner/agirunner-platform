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

export function ApprovalQueuePage(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['tasks', 'awaiting_approval'],
    queryFn: () => dashboardApi.listTasks({ status: 'awaiting_approval' }),
  });

  if (isLoading) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-destructive">Error loading data</div>;

  const tasks = normalizeData(data);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Approval Queue</h1>

      {tasks.length === 0 ? (
        <p className="text-muted-foreground">No tasks awaiting approval.</p>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center justify-between rounded-lg border p-4"
            >
              <div>
                <p className="font-medium">{task.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Worker: {task.assigned_worker ?? 'Unassigned'} | Created:{' '}
                  {new Date(task.created_at).toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
