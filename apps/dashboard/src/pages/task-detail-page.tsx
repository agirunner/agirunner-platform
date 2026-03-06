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
  const [reviewFeedback, setReviewFeedback] = useState('Needs revision.');
  const [preferredAgentId, setPreferredAgentId] = useState('');
  const [preferredWorkerId, setPreferredWorkerId] = useState('');
  const [escalationTarget, setEscalationTarget] = useState('');
  const [overrideOutputText, setOverrideOutputText] = useState('{}');
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
  const historyQuery = useQuery({
    queryKey: ['task-history', taskId],
    queryFn: () => dashboardApi.listEvents({ entity_type: 'task', entity_id: taskId, per_page: '20' }),
    enabled: taskId.length > 0,
  });
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

  const overrideOutput = useMemo(() => {
    try {
      return JSON.parse(overrideOutputText);
    } catch {
      return null;
    }
  }, [overrideOutputText]);

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
                onClick={() => {
                  void runAction(() => dashboardApi.rejectTask(taskData.id, { feedback: reviewFeedback }), 'Task rejected.');
                }}
              >
                Reject
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  void runAction(
                    () =>
                      dashboardApi.requestTaskChanges(taskData.id, {
                        feedback: reviewFeedback,
                        preferred_agent_id: preferredAgentId || undefined,
                        preferred_worker_id: preferredWorkerId || undefined,
                        override_input: retryPayload ?? undefined,
                      }),
                    'Task sent back for changes.',
                  );
                }}
              >
                Request Changes
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  void runAction(() => dashboardApi.skipTask(taskData.id, { reason: reviewFeedback }), 'Task skipped.');
                }}
              >
                Skip
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
              <button
                type="button"
                className="button"
                onClick={() => {
                  void runAction(
                    () =>
                      dashboardApi.reassignTask(taskData.id, {
                        preferred_agent_id: preferredAgentId || undefined,
                        preferred_worker_id: preferredWorkerId || undefined,
                        reason: reviewFeedback,
                      }),
                    'Task reassigned.',
                  );
                }}
              >
                Reassign
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  void runAction(
                    () => dashboardApi.escalateTask(taskData.id, { reason: reviewFeedback, escalation_target: escalationTarget || undefined }),
                    'Task escalated.',
                  );
                }}
              >
                Escalate
              </button>
              <button
                type="button"
                className="button"
                disabled={overrideOutput === null}
                onClick={() => {
                  void runAction(
                    () => dashboardApi.overrideTaskOutput(taskData.id, { output: overrideOutput, reason: reviewFeedback }),
                    'Task output overridden.',
                  );
                }}
              >
                Override Output
              </button>
            </div>
            <div className="grid">
              <label htmlFor="review-feedback">Review feedback</label>
              <textarea
                id="review-feedback"
                className="input"
                value={reviewFeedback}
                onChange={(event) => setReviewFeedback(event.target.value)}
                rows={4}
              />
              <label htmlFor="preferred-agent-id">Preferred agent id</label>
              <input
                id="preferred-agent-id"
                className="input"
                value={preferredAgentId}
                onChange={(event) => setPreferredAgentId(event.target.value)}
              />
              <label htmlFor="preferred-worker-id">Preferred worker id</label>
              <input
                id="preferred-worker-id"
                className="input"
                value={preferredWorkerId}
                onChange={(event) => setPreferredWorkerId(event.target.value)}
              />
              <label htmlFor="escalation-target">Escalation target</label>
              <input
                id="escalation-target"
                className="input"
                value={escalationTarget}
                onChange={(event) => setEscalationTarget(event.target.value)}
              />
              <label htmlFor="retry-override-input">Retry override_input (JSON)</label>
              <textarea
                id="retry-override-input"
                className="input"
                value={retryOverrideInput}
                onChange={(event) => setRetryOverrideInput(event.target.value)}
                rows={5}
              />
              <label htmlFor="override-output">Override output (JSON)</label>
              <textarea
                id="override-output"
                className="input"
                value={overrideOutputText}
                onChange={(event) => setOverrideOutputText(event.target.value)}
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
            {overrideOutput === null ? <p style={{ color: '#dc2626' }}>Invalid JSON in override output.</p> : null}
            {actionMessage ? <p style={{ color: '#16a34a' }}>{actionMessage}</p> : null}
            {actionError ? <p style={{ color: '#dc2626' }}>{actionError}</p> : null}
          </div>

          <div className="card">
            <h3>Execution Summary</h3>
            <pre>{JSON.stringify({ metrics: (taskData as Task & { metrics?: unknown }).metrics ?? null, verification: (taskData as Task & { verification?: unknown }).verification ?? null, metadata: taskData.metadata ?? {} }, null, 2)}</pre>
          </div>

          <div className="card">
            <h3>History</h3>
            {historyQuery.isLoading ? <p>Loading history...</p> : null}
            {historyQuery.error ? <p style={{ color: '#dc2626' }}>Failed to load history.</p> : null}
            <ul className="search-results">
              {historyQuery.data?.data.map((event) => (
                <li key={event.id}>
                  <strong>{event.type}</strong>
                  <span className="muted"> {new Date(event.created_at).toLocaleString()}</span>
                  <pre>{JSON.stringify(event.data ?? {}, null, 2)}</pre>
                </li>
              ))}
            </ul>
          </div>

          <pre>{JSON.stringify(taskData, null, 2)}</pre>
        </>
      ) : null}
    </section>
  );
}

// Re-export for tests
export { classifyTaskCapability };
