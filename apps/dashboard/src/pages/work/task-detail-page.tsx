import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { dashboardApi } from '../../lib/api.js';

interface Task {
  id: string;
  title: string;
  status: string;
  assigned_worker: string | null;
  description?: string;
  created_at: string;
  updated_at: string;
  workflow_id?: string;
  output?: string;
}

function normalizeData(response: { data: Task } | Task): Task {
  if ('data' in response && !('id' in response)) {
    return (response as { data: Task }).data;
  }
  return response as Task;
}

export function TaskDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['task', id],
    queryFn: () => dashboardApi.getTask(id!),
    enabled: Boolean(id),
  });

  if (isLoading) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-destructive">Error loading data</div>;

  const task = normalizeData(data);

  const isAwaitingApproval = task.status === 'awaiting_approval';
  const isFailed = task.status === 'failed';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{task.title}</h1>
        <div className="flex gap-2">
          {isAwaitingApproval && (
            <>
              <button
                type="button"
                className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
              >
                Approve
              </button>
              <button
                type="button"
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Reject
              </button>
            </>
          )}
          {isFailed && (
            <button
              type="button"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Retry
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Status</p>
          <p className="mt-1 text-lg font-medium capitalize">
            {task.status.replace('_', ' ')}
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Assigned Worker</p>
          <p className="mt-1 text-lg font-medium">
            {task.assigned_worker ?? 'Unassigned'}
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Created</p>
          <p className="mt-1 text-lg font-medium">
            {new Date(task.created_at).toLocaleString()}
          </p>
        </div>
      </div>

      {task.description && (
        <section>
          <h2 className="text-lg font-medium mb-2">Description</h2>
          <p className="text-muted-foreground">{task.description}</p>
        </section>
      )}

      {task.output && (
        <section>
          <h2 className="text-lg font-medium mb-2">Output</h2>
          <pre className="rounded-lg border bg-muted p-4 text-sm overflow-x-auto">
            {task.output}
          </pre>
        </section>
      )}
    </div>
  );
}
