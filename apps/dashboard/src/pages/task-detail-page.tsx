/**
 * Task Detail Page
 *
 * FR-751 — Dashboard communicates capability boundaries.
 * Shows which tasks the built-in worker CAN vs CANNOT handle,
 * surfaced directly in the task detail view.
 */

import type { Task } from '@agentbaton/sdk';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import {
  BuiltInCapabilityBadge,
  classifyTaskCapability,
} from '../components/built-in-capability-badge.js';
import { dashboardApi } from '../lib/api.js';

export function TaskDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const taskId = params.id ?? '';

  const query = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => dashboardApi.getTask(taskId) as Promise<Task>,
    enabled: taskId.length > 0,
  });

  const taskData = query.data ?? null;

  return (
    <section className="card">
      <h2>Task Detail</h2>
      {query.isLoading ? <p>Loading task...</p> : null}
      {query.error ? <p style={{ color: '#dc2626' }}>Failed to load task</p> : null}
      {taskData ? (
        <>
          {/* FR-751: surface capability boundary for this task */}
          <BuiltInCapabilityBadge task={taskData} />
          <pre>{JSON.stringify(taskData, null, 2)}</pre>
        </>
      ) : null}
    </section>
  );
}

// Re-export for tests
export { classifyTaskCapability };
