import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { dashboardApi } from '../lib/api.js';

interface PipelineDetail {
  id: string;
  name: string;
  state: string;
  context: Record<string, unknown>;
}

interface TaskListResult {
  data: Array<{ id: string; title: string; state: string; depends_on: string[] }>;
}

export function PipelineDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const pipelineId = params.id ?? '';

  const pipelineQuery = useQuery({
    queryKey: ['pipeline', pipelineId],
    queryFn: () => dashboardApi.getPipeline(pipelineId) as Promise<{ data: PipelineDetail }>,
    enabled: pipelineId.length > 0,
  });

  const taskQuery = useQuery({
    queryKey: ['tasks', pipelineId],
    queryFn: () => dashboardApi.listTasks({ pipeline_id: pipelineId }) as Promise<TaskListResult>,
    enabled: pipelineId.length > 0,
  });

  return (
    <section className="grid">
      <div className="card">
        <h2>Pipeline Detail</h2>
        {pipelineQuery.data ? (
          <div className="grid">
            <div className="row">
              <strong>{pipelineQuery.data.data.name}</strong>
              <span className="muted">{pipelineQuery.data.data.state}</span>
            </div>
            <pre className="muted">{JSON.stringify(pipelineQuery.data.data.context ?? {}, null, 2)}</pre>
          </div>
        ) : (
          <p>Loading pipeline...</p>
        )}
      </div>

      <div className="card">
        <h3>Task Graph (dependency list)</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Task</th>
              <th>State</th>
              <th>Depends On</th>
            </tr>
          </thead>
          <tbody>
            {taskQuery.data?.data.map((task) => (
              <tr key={task.id}>
                <td>
                  <Link to={`/tasks/${task.id}`}>{task.title}</Link>
                </td>
                <td>{task.state}</td>
                <td>{task.depends_on.length > 0 ? task.depends_on.join(', ') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
