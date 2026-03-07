import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { dashboardApi } from '../../lib/api.js';

interface Workflow {
  id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
  description?: string;
  tasks?: Array<{ id: string; title: string; status: string }>;
}

function normalizeData(response: { data: Workflow } | Workflow): Workflow {
  if ('data' in response && !('id' in response)) {
    return (response as { data: Workflow }).data;
  }
  return response as Workflow;
}

export function WorkflowDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['workflow', id],
    queryFn: () => dashboardApi.getWorkflow(id!),
    enabled: Boolean(id),
  });

  if (isLoading) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-destructive">Error loading data</div>;

  const workflow = normalizeData(data);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">{workflow.name}</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Status</p>
          <p className="mt-1 text-lg font-medium capitalize">{workflow.status}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Created</p>
          <p className="mt-1 text-lg font-medium">
            {new Date(workflow.created_at).toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Last Updated</p>
          <p className="mt-1 text-lg font-medium">
            {new Date(workflow.updated_at).toLocaleString()}
          </p>
        </div>
      </div>

      {workflow.description && (
        <section>
          <h2 className="text-lg font-medium mb-2">Description</h2>
          <p className="text-muted-foreground">{workflow.description}</p>
        </section>
      )}

      {workflow.tasks && workflow.tasks.length > 0 && (
        <section>
          <h2 className="text-lg font-medium mb-3">Tasks</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 pr-4 font-medium">Title</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {workflow.tasks.map((task) => (
                  <tr key={task.id} className="border-b">
                    <td className="py-3 pr-4">{task.title}</td>
                    <td className="py-3 capitalize">{task.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
