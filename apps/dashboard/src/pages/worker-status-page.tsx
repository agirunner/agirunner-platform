import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { dashboardApi } from '../lib/api.js';
import { subscribeToEvents } from '../lib/sse.js';

interface WorkerItem {
  id: string;
  name: string;
  runtime_type: string;
  connection_mode: string;
  status: string;
  last_heartbeat_at: string;
}

interface AgentItem {
  id: string;
  name: string;
  status: string;
  current_task_id: string | null;
}

export function WorkerStatusPage(): JSX.Element {
  const queryClient = useQueryClient();

  const workers = useQuery({
    queryKey: ['workers'],
    queryFn: () => dashboardApi.listWorkers() as Promise<WorkerItem[]>,
  });

  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => dashboardApi.listAgents() as Promise<AgentItem[]>,
  });

  useEffect(() => {
    return subscribeToEvents(
      (eventType, payload) => {
        const entityType = typeof payload.entity_type === 'string' ? payload.entity_type : '';
        if (
          eventType.startsWith('worker.')
          || eventType.startsWith('agent.')
          || entityType === 'worker'
          || entityType === 'agent'
          || eventType.startsWith('task.')
        ) {
          void queryClient.invalidateQueries({ queryKey: ['workers'] });
          void queryClient.invalidateQueries({ queryKey: ['agents'] });
        }
      },
      { entityTypes: ['worker', 'agent', 'task'] },
    );
  }, [queryClient]);

  return (
    <section className="grid two">
      <div className="card">
        <h2>Workers</h2>
        <p className="muted">Live heartbeat-driven worker status and runtime connectivity.</p>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Runtime</th>
              <th>Mode</th>
              <th>Last Heartbeat</th>
            </tr>
          </thead>
          <tbody>
            {workers.data?.map((worker) => (
              <tr key={worker.id}>
                <td>{worker.name}</td>
                <td>
                  <span className={`status-badge status-${worker.status}`}>{worker.status}</span>
                </td>
                <td>{worker.runtime_type}</td>
                <td>{worker.connection_mode}</td>
                <td>{new Date(worker.last_heartbeat_at).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>Agents</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Current Task</th>
            </tr>
          </thead>
          <tbody>
            {agents.data?.map((agent) => (
              <tr key={agent.id}>
                <td>{agent.name}</td>
                <td>
                  <span className={`status-badge status-${agent.status}`}>{agent.status}</span>
                </td>
                <td>{agent.current_task_id ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
