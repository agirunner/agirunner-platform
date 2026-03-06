import type { Pipeline } from '@agentbaton/sdk';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { dashboardApi } from '../lib/api.js';
import { subscribeToEvents, type StreamEventPayload } from '../lib/sse.js';

interface TaskListResult {
  data: Array<{ id: string; title: string; state: string; depends_on: string[]; created_at?: string }>;
}

interface MissionControlSummary {
  total: number;
  ready: number;
  running: number;
  blocked: number;
  completed: number;
  failed: number;
}

export function PipelineDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const pipelineId = params.id ?? '';
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState('Manual pipeline rework requested.');

  const pipelineQuery = useQuery({
    queryKey: ['pipeline', pipelineId],
    queryFn: () => dashboardApi.getPipeline(pipelineId) as Promise<Pipeline>,
    enabled: pipelineId.length > 0,
  });

  const taskQuery = useQuery({
    queryKey: ['tasks', pipelineId],
    queryFn: () => dashboardApi.listTasks({ pipeline_id: pipelineId }) as Promise<TaskListResult>,
    enabled: pipelineId.length > 0,
  });

  useEffect(() => {
    if (!pipelineId) {
      return;
    }

    return subscribeToEvents((eventType, payload) => {
      if (!shouldInvalidatePipelineRealtimeEvent(eventType, pipelineId, payload)) {
        return;
      }

      void queryClient.invalidateQueries({ queryKey: ['pipeline', pipelineId] });
      void queryClient.invalidateQueries({ queryKey: ['tasks', pipelineId] });
    });
  }, [pipelineId, queryClient]);

  const summary = useMemo(() => summarizeTasks(taskQuery.data?.data ?? []), [taskQuery.data?.data]);
  const historyQuery = useQuery({
    queryKey: ['pipeline-history', pipelineId],
    queryFn: () => dashboardApi.listEvents({ entity_type: 'pipeline', entity_id: pipelineId, per_page: '20' }),
    enabled: pipelineId.length > 0,
  });
  const costSummary = useMemo(() => {
    const tasks = taskQuery.data?.data ?? [];
    return tasks.reduce(
      (acc, task) => {
        const typedTask = task as { metrics?: { total_cost_usd?: number } };
        acc.totalCostUsd += Number(typedTask.metrics?.total_cost_usd ?? 0);
        return acc;
      },
      { totalCostUsd: 0 },
    );
  }, [taskQuery.data?.data]);

  return (
    <section className="grid">
      <div className="card">
        <h2>Pipeline Detail</h2>
        {pipelineQuery.isLoading ? <p>Loading pipeline...</p> : null}
        {pipelineQuery.error ? <p style={{ color: '#dc2626' }}>Failed to load pipeline</p> : null}
        {pipelineQuery.data ? (
          <div className="grid">
            <div className="row">
              <strong>{pipelineQuery.data.name}</strong>
              <span className={`status-badge status-${pipelineQuery.data.state}`}>{pipelineQuery.data.state}</span>
            </div>
            <pre className="muted">{JSON.stringify(pipelineQuery.data.context ?? {}, null, 2)}</pre>
          </div>
        ) : null}
      </div>

      <div className="card">
        <h3>Mission Control</h3>
        <p className="muted">Real-time phase snapshot derived from task-state gates.</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="button" onClick={() => void dashboardApi.pausePipeline(pipelineId).then(() => queryClient.invalidateQueries())}>
            Pause
          </button>
          <button type="button" className="button" onClick={() => void dashboardApi.resumePipeline(pipelineId).then(() => queryClient.invalidateQueries())}>
            Resume
          </button>
          <button type="button" className="button" onClick={() => void dashboardApi.cancelPipeline(pipelineId).then(() => queryClient.invalidateQueries())}>
            Cancel
          </button>
        </div>
        <div className="row mission-grid">
          <MissionMetric label="Total" value={summary.total} />
          <MissionMetric label="Ready" value={summary.ready} />
          <MissionMetric label="Running" value={summary.running} />
          <MissionMetric label="Blocked" value={summary.blocked} />
          <MissionMetric label="Completed" value={summary.completed} />
          <MissionMetric label="Failed" value={summary.failed} />
        </div>
        <label htmlFor="pipeline-manual-rework">Manual rework feedback</label>
        <textarea
          id="pipeline-manual-rework"
          className="input"
          rows={4}
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
        />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="button"
            onClick={() => void dashboardApi.manualReworkPipeline(pipelineId, { feedback }).then(() => queryClient.invalidateQueries())}
          >
            Manual Rework
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Cost Summary</h3>
        <p className="muted">Aggregate surfaced task cost for the pipeline.</p>
        <strong>${costSummary.totalCostUsd.toFixed(4)}</strong>
      </div>

      <div className="card">
        <h3>Task Graph (dependency list)</h3>
        {taskQuery.isLoading ? <p>Loading tasks...</p> : null}
        {taskQuery.error ? <p style={{ color: '#dc2626' }}>Failed to load tasks</p> : null}
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
                <td>
                  <span className={`status-badge status-${task.state}`}>{task.state}</span>
                </td>
                <td>{task.depends_on.length > 0 ? task.depends_on.join(', ') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Pipeline History</h3>
        {historyQuery.isLoading ? <p>Loading history...</p> : null}
        {historyQuery.error ? <p style={{ color: '#dc2626' }}>Failed to load pipeline history.</p> : null}
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
    </section>
  );
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return value.length > 0 ? value : undefined;
}

function readPipelineIdFromData(data: Record<string, unknown> | undefined): string | undefined {
  if (!data) {
    return undefined;
  }

  return (
    readNonEmptyString(data.pipeline_id)
    ?? readNonEmptyString(data.pipelineId)
    ?? readNonEmptyString(readRecord(data.task)?.pipeline_id)
    ?? readNonEmptyString(readRecord(data.task)?.pipelineId)
    ?? readNonEmptyString(readRecord(data.pipeline)?.id)
  );
}

function resolvePipelineEventPipelineId(payload: StreamEventPayload): string | undefined {
  const payloadRecord = readRecord(payload);
  const payloadData = readRecord(payloadRecord?.data);

  return (
    readPipelineIdFromData(payloadData)
    ?? readNonEmptyString(payloadRecord?.pipeline_id)
    ?? (payload.entity_type === 'pipeline' ? readNonEmptyString(payload.entity_id) : undefined)
  );
}

function resolveTaskEventPipelineId(payload: StreamEventPayload): string | undefined {
  const payloadRecord = readRecord(payload);
  return readPipelineIdFromData(readRecord(payloadRecord?.data)) ?? readNonEmptyString(payloadRecord?.pipeline_id);
}

export function shouldInvalidatePipelineRealtimeEvent(
  eventType: string,
  pipelineId: string,
  payload: StreamEventPayload,
): boolean {
  if (!pipelineId) {
    return false;
  }

  if (eventType.startsWith('pipeline.')) {
    return resolvePipelineEventPipelineId(payload) === pipelineId;
  }

  if (eventType.startsWith('task.')) {
    return resolveTaskEventPipelineId(payload) === pipelineId;
  }

  return false;
}

function MissionMetric({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="card mission-metric">
      <p className="muted">{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

export function summarizeTasks(tasks: Array<{ state: string }>): MissionControlSummary {
  return tasks.reduce<MissionControlSummary>(
    (acc, task) => {
      acc.total += 1;
      if (task.state === 'ready') {
        acc.ready += 1;
      } else if (task.state === 'running') {
        acc.running += 1;
      } else if (task.state === 'blocked' || task.state === 'awaiting_approval') {
        acc.blocked += 1;
      } else if (task.state === 'completed') {
        acc.completed += 1;
      } else if (task.state === 'failed' || task.state === 'cancelled') {
        acc.failed += 1;
      }
      return acc;
    },
    {
      total: 0,
      ready: 0,
      running: 0,
      blocked: 0,
      completed: 0,
      failed: 0,
    },
  );
}
