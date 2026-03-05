/**
 * Task Detail Page
 *
 * FR-751 — Dashboard communicates capability boundaries.
 * Shows which tasks the built-in worker CAN vs CANNOT handle,
 * surfaced directly in the task detail view.
 */

import type { Task } from '@agentbaton/sdk';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import {
  BuiltInCapabilityBadge,
  classifyTaskCapability,
} from '../components/built-in-capability-badge.js';
import { dashboardApi } from '../lib/api.js';
import { subscribeToEvents } from '../lib/sse.js';

export function TaskDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const taskId = params.id ?? '';
  const queryClient = useQueryClient();

  const [retryOverrideInput, setRetryOverrideInput] = useState('{}');
  const [retryForce, setRetryForce] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => dashboardApi.getTask(taskId) as Promise<Task>,
    enabled: taskId.length > 0,
  });

  useEffect(() => {
    if (!taskId) {
      return;
    }

    return subscribeToEvents((eventType, payload) => {
      const eventTaskId =
        typeof payload.entity_id === 'string' && payload.entity_type === 'task'
          ? payload.entity_id
          : (typeof payload.data?.task_id === 'string' ? payload.data.task_id : undefined);

      if (eventTaskId !== taskId) {
        return;
      }

      if (eventType.startsWith('task.')) {
        void queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      }
    });
  }, [taskId, queryClient]);

  const taskData = query.data ?? null;
  const canApprove = taskData?.state === 'awaiting_approval';
  const canRetry = taskData?.state === 'failed' || taskData?.state === 'cancelled';
  const canCancel =
    taskData?.state === 'pending'
    || taskData?.state === 'ready'
    || taskData?.state === 'claimed'
    || taskData?.state === 'running'
    || taskData?.state === 'awaiting_approval'
    || taskData?.state === 'output_pending_review';

  const retryPayload = useMemo(() => {
    try {
      const parsed = JSON.parse(retryOverrideInput) as Record<string, unknown>;
      return parsed;
    } catch {
      return null;
    }
  }, [retryOverrideInput]);

  const runAction = async (handler: () => Promise<unknown>, successMessage: string): Promise<void> => {
    setActionError(null);
    setActionMessage(null);

    try {
      await handler();
      setActionMessage(successMessage);
      await queryClient.invalidateQueries({ queryKey: ['task', taskId] });
    } catch (error) {
      setActionError(String(error));
    }
  };

  return (
    <section className="card">
      <h2>Task Detail</h2>
      {query.isLoading ? <p>Loading task...</p> : null}
      {query.error ? <p style={{ color: '#dc2626' }}>Failed to load task</p> : null}
      {taskData ? (
        <>
          <BuiltInCapabilityBadge task={taskData} />

          <div className="card">
            <h3>Task Controls</h3>
            <p className="muted">Control-plane interventions for approval, retry, and cancellation.</p>
            <div className="row">
              <button
                type="button"
                className="button"
                disabled={!canApprove}
                onClick={() => {
                  void runAction(() => dashboardApi.approveTask(taskData.id), 'Task approved.');
                }}
              >
                Approve
              </button>
              <button
                type="button"
                className="button"
                disabled={!canCancel}
                onClick={() => {
                  void runAction(() => dashboardApi.cancelTask(taskData.id), 'Task cancel signal sent.');
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button"
                disabled={!canRetry || retryPayload === null}
                onClick={() => {
                  void runAction(
                    () =>
                      dashboardApi.retryTask(taskData.id, {
                        override_input: retryPayload ?? {},
                        force: retryForce,
                      }),
                    'Task retry requested.',
                  );
                }}
              >
                Retry
              </button>
            </div>
            <div className="grid">
              <label htmlFor="retry-override-input">Retry override_input (JSON)</label>
              <textarea
                id="retry-override-input"
                className="input"
                value={retryOverrideInput}
                onChange={(event) => setRetryOverrideInput(event.target.value)}
                rows={5}
              />
              <label className="row" htmlFor="retry-force">
                <input
                  id="retry-force"
                  type="checkbox"
                  checked={retryForce}
                  onChange={(event) => setRetryForce(event.target.checked)}
                />
                Force retry even if task appears recoverable.
              </label>
            </div>
            {retryPayload === null ? <p style={{ color: '#dc2626' }}>Invalid JSON in retry override_input.</p> : null}
            {actionMessage ? <p style={{ color: '#16a34a' }}>{actionMessage}</p> : null}
            {actionError ? <p style={{ color: '#dc2626' }}>{actionError}</p> : null}
          </div>

          <pre>{JSON.stringify(taskData, null, 2)}</pre>
        </>
      ) : null}
    </section>
  );
}

// Re-export for tests
export { classifyTaskCapability };
