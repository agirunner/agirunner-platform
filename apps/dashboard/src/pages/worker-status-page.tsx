import { useQuery } from '@tanstack/react-query';

import { dashboardApi } from '../lib/api.js';

interface WorkersResult {
  data: Array<{
    id: string;
    name: string;
    runtime_type: string;
    connection_mode: string;
    status: string;
    last_heartbeat_at: string;
  }>;
}

interface AgentsResult {
  data: Array<{
    id: string;
    name: string;
    status: string;
    current_task_id: string | null;
  }>;
}

export function WorkerStatusPage(): JSX.Element {
  const workers = useQuery({
    queryKey: ['workers'],
    queryFn: () => dashboardApi.listWorkers() as Promise<WorkersResult>,
  });

  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => dashboardApi.listAgents() as Promise<AgentsResult>,
  });

  return (
    <section className="grid two">
      <div className="card">
        <h2>Workers</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Runtime</th>
              <th>Mode</th>
            </tr>
          </thead>
          <tbody>
            {workers.data?.data.map((worker) => (
              <tr key={worker.id}>
                <td>{worker.name}</td>
                <td>{worker.status}</td>
                <td>{worker.runtime_type}</td>
                <td>{worker.connection_mode}</td>
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
            {agents.data?.data.map((agent) => (
              <tr key={agent.id}>
                <td>{agent.name}</td>
                <td>{agent.status}</td>
                <td>{agent.current_task_id ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
