import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { dashboardApi } from '../lib/api.js';

export function TaskDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const taskId = params.id ?? '';

  const query = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => dashboardApi.getTask(taskId) as Promise<{ data: Record<string, unknown> }>,
    enabled: taskId.length > 0,
  });

  return (
    <section className="card">
      <h2>Task Detail</h2>
      {query.isLoading ? <p>Loading task...</p> : null}
      {query.data ? <pre>{JSON.stringify(query.data.data, null, 2)}</pre> : null}
    </section>
  );
}
