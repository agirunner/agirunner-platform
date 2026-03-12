import type { Task } from '@agirunner/sdk';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import {
  BuiltInCapabilityBadge,
  classifyTaskCapability,
} from '../components/built-in-capability-badge.js';
import { dashboardApi } from '../lib/api.js';
import { subscribeToEvents } from '../lib/sse.js';
import {
  parseJsonObject,
  normalizeTaskState,
  readClarificationAnswers,
  readClarificationHistory,
  readExecutionSummary,
  readHumanEscalationResponse,
  readReworkDetails,
} from './task-detail-support.js';
import { StructuredRecordView } from '../components/structured-data.js';

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
  const historyQuery = useQuery({
    queryKey: ['task-history', taskId],
    queryFn: () => dashboardApi.listEvents({ entity_type: 'task', entity_id: taskId, per_page: '20' }),
    enabled: taskId.length > 0,
  });
  const artifactQuery = useQuery({
    queryKey: ['task-artifacts', taskId],
    queryFn: () => dashboardApi.listTaskArtifacts(taskId),
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
      if (eventTaskId === taskId && eventType.startsWith('task.')) {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ['task', taskId] }),
          queryClient.invalidateQueries({ queryKey: ['task-artifacts', taskId] }),
        ]);
      }
    });
  }, [taskId, queryClient]);

  const taskData = query.data ?? null;
  const taskState = normalizeTaskState(
    taskData?.state ?? ((taskData as Task & { status?: string } | null)?.status ?? null),
  );
  const canApprove = taskState === 'awaiting_approval';
  const canRetry = taskState === 'failed' || taskState === 'cancelled';
  const canCancel = ['pending', 'ready', 'in_progress', 'awaiting_approval', 'output_pending_review', 'escalated'].includes(
    taskState,
  );
  const retryPayload = useMemo(
    () => parseJsonObject(retryOverrideInput, 'Invalid JSON in retry override_input.'),
    [retryOverrideInput],
  );
  const overrideOutput = useMemo(
    () => parseJsonObject(overrideOutputText, 'Invalid JSON in override output.'),
    [overrideOutputText],
  );
  const clarificationHistory = useMemo(() => readClarificationHistory(taskData), [taskData]);
  const clarificationAnswers = useMemo(() => readClarificationAnswers(taskData), [taskData]);
  const reworkDetails = useMemo(() => readReworkDetails(taskData), [taskData]);
  const humanEscalationResponse = useMemo(() => readHumanEscalationResponse(taskData), [taskData]);
  const executionSummary = useMemo(() => readExecutionSummary(taskData), [taskData]);

  async function runAction(handler: () => Promise<unknown>, successMessage: string) {
    setActionError(null);
    setActionMessage(null);
    try {
      await handler();
      setActionMessage(successMessage);
      await queryClient.invalidateQueries({ queryKey: ['task', taskId] });
    } catch (error) {
      setActionError(String(error));
    }
  }

  return (
    <section className="card">
      <h2>Task Detail</h2>
      {query.isLoading ? <p>Loading task...</p> : null}
      {query.error ? <p style={{ color: '#dc2626' }}>Failed to load task</p> : null}
      {taskData ? (
        <>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{taskData.title}</strong>
              <span className={`status-badge status-${taskState}`}>{taskState}</span>
            </div>
            <p className="muted">Task id: {taskData.id}</p>
          </div>

          <BuiltInCapabilityBadge task={taskData} />

          <div className="card">
            <h3>Operator Actions</h3>
            <p className="muted">Approval, retry, change request, reassignment, escalation, and output override controls for this task.</p>
            <div className="row">
              <button type="button" className="button" disabled={!canApprove} onClick={() => void runAction(() => dashboardApi.approveTask(taskData.id), 'Task approved.')}>Approve</button>
              <button type="button" className="button" disabled={!canCancel} onClick={() => void runAction(() => dashboardApi.cancelTask(taskData.id), 'Task cancel signal sent.')}>Cancel</button>
              <button type="button" className="button" onClick={() => void runAction(() => dashboardApi.rejectTask(taskData.id, { feedback: reviewFeedback }), 'Task rejected.')}>Reject</button>
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
                        override_input: retryPayload.value ?? undefined,
                      }),
                    'Task sent back for changes.',
                  );
                }}
              >
                Request Changes
              </button>
              <button type="button" className="button" onClick={() => void runAction(() => dashboardApi.skipTask(taskData.id, { reason: reviewFeedback }), 'Task skipped.')}>Skip</button>
              <button
                type="button"
                className="button"
                disabled={!canRetry || Boolean(retryPayload.error)}
                onClick={() => {
                  void runAction(
                    () =>
                      dashboardApi.retryTask(taskData.id, {
                        override_input: retryPayload.value ?? {},
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
                disabled={Boolean(overrideOutput.error)}
                onClick={() => {
                  void runAction(
                    () => dashboardApi.overrideTaskOutput(taskData.id, { output: overrideOutput.value ?? {}, reason: reviewFeedback }),
                    'Task output overridden.',
                  );
                }}
              >
                Override Output
              </button>
            </div>
            <div className="grid">
              <label htmlFor="review-feedback">Review feedback</label>
              <textarea id="review-feedback" className="input" value={reviewFeedback} onChange={(event) => setReviewFeedback(event.target.value)} rows={4} />
              <label htmlFor="preferred-agent-id">Preferred agent id</label>
              <input id="preferred-agent-id" className="input" value={preferredAgentId} onChange={(event) => setPreferredAgentId(event.target.value)} />
              <label htmlFor="preferred-worker-id">Preferred worker id</label>
              <input id="preferred-worker-id" className="input" value={preferredWorkerId} onChange={(event) => setPreferredWorkerId(event.target.value)} />
              <label htmlFor="escalation-target">Escalation target</label>
              <input id="escalation-target" className="input" value={escalationTarget} onChange={(event) => setEscalationTarget(event.target.value)} />
              <label htmlFor="retry-override-input">Retry override_input (JSON)</label>
              <textarea id="retry-override-input" className="input" value={retryOverrideInput} onChange={(event) => setRetryOverrideInput(event.target.value)} rows={5} />
              <label htmlFor="override-output">Override output (JSON)</label>
              <textarea id="override-output" className="input" value={overrideOutputText} onChange={(event) => setOverrideOutputText(event.target.value)} rows={5} />
              <label className="row" htmlFor="retry-force">
                <input id="retry-force" type="checkbox" checked={retryForce} onChange={(event) => setRetryForce(event.target.checked)} />
                Force retry even if task appears recoverable.
              </label>
            </div>
            {retryPayload.error ? <p style={{ color: '#dc2626' }}>{retryPayload.error}</p> : null}
            {overrideOutput.error ? <p style={{ color: '#dc2626' }}>{overrideOutput.error}</p> : null}
            {actionMessage ? <p style={{ color: '#16a34a' }}>{actionMessage}</p> : null}
            {actionError ? <p style={{ color: '#dc2626' }}>{actionError}</p> : null}
          </div>

          <div className="grid two">
            <div className="card">
              <h3>Clarification & Rework</h3>
              <p className="muted">Structured clarification answers and rework metadata for this task.</p>
              <div className="row">
                <span className="status-badge">Rework count: {reworkDetails.reworkCount}</span>
                {reworkDetails.reviewAction ? <span className="status-badge">Last action: {reworkDetails.reviewAction}</span> : null}
                {reworkDetails.clarificationRequested ? <span className="status-badge">Clarification requested</span> : null}
              </div>
              {reworkDetails.reviewFeedback ? <p>{reworkDetails.reviewFeedback}</p> : null}
              <h4>Clarification Answers</h4>
              <StructuredRecordView data={clarificationAnswers} emptyMessage="No clarification answers recorded." />
              <h4>Clarification History</h4>
              <StructuredRecordView data={{ entries: clarificationHistory }} emptyMessage="No clarification history recorded." />
            </div>

            <div className="card">
              <h3>Escalation Response</h3>
              <p className="muted">Latest structured human or orchestrator escalation guidance.</p>
              <StructuredRecordView data={humanEscalationResponse} emptyMessage="No escalation response recorded." />
            </div>
          </div>

          <div className="card">
            <h3>Task Artifacts</h3>
            <p className="muted">Files and evidence produced during execution for this task.</p>
            {artifactQuery.isLoading ? <p>Loading artifacts...</p> : null}
            {artifactQuery.error ? <p style={{ color: '#dc2626' }}>Failed to load task artifacts.</p> : null}
            <div className="grid">
              {(artifactQuery.data ?? []).map((artifact) => (
                <article key={artifact.id} className="card timeline-entry">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <strong>{artifact.logical_path}</strong>
                    <span className="status-badge">{artifact.content_type}</span>
                  </div>
                  <div className="row">
                    <span className="status-badge">{artifact.size_bytes} bytes</span>
                    <span className="status-badge">{artifact.storage_backend ?? 'storage'}</span>
                  </div>
                  <a href={artifact.access_url ?? artifact.download_url} target="_blank" rel="noreferrer">
                    Download artifact
                  </a>
                </article>
              ))}
              {artifactQuery.data?.length === 0 ? <p className="muted">No task artifacts recorded yet.</p> : null}
            </div>
          </div>

          <div className="card">
            <h3>Execution Summary</h3>
            <StructuredRecordView data={executionSummary} emptyMessage="No execution summary available." />
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
                  <StructuredRecordView data={event.data} emptyMessage="No event payload." />
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </section>
  );
}

export { classifyTaskCapability };
