import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { dashboardApi } from '../lib/api.js';
import { subscribeToEvents } from '../lib/sse.js';

interface PipelineListResult {
  data: Array<{ id: string; name: string; state: string; created_at: string }>;
}

export function PipelineListPage(): JSX.Element {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['pipelines'],
    queryFn: () => dashboardApi.listPipelines() as Promise<PipelineListResult>,
  });

  useEffect(() => {
    return subscribeToEvents((eventType) => {
      if (eventType.startsWith('pipeline.') || eventType.startsWith('task.')) {
        void queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      }
    });
  }, [queryClient]);

  return (
    <section className="card">
      <h2>Pipelines</h2>
      <p className="muted">Live view with SSE-backed updates from /api/v1/events.</p>
      {query.isLoading ? <p>Loading pipelines...</p> : null}
      {query.error ? <p style={{ color: '#dc2626' }}>Failed to load pipelines</p> : null}
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>State</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {query.data?.data.map((pipeline) => (
            <tr key={pipeline.id}>
              <td>
                <Link to={`/pipelines/${pipeline.id}`}>{pipeline.name}</Link>
              </td>
              <td>{pipeline.state}</td>
              <td>{new Date(pipeline.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
