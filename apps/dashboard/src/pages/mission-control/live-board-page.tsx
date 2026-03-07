import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../../lib/api.js';

interface Workflow {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

interface Worker {
  id: string;
  name: string;
  status: string;
}

interface EventEntry {
  id: string;
  type: string;
  message: string;
  created_at: string;
}

function countByStatus<T extends { status: string }>(items: T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
  }
  return counts;
}

function normalizeData<T>(response: { data: T[] } | T[]): T[] {
  if (Array.isArray(response)) {
    return response;
  }
  return response?.data ?? [];
}

export function LiveBoardPage(): JSX.Element {
  const workflows = useQuery({
    queryKey: ['workflows'],
    queryFn: () => dashboardApi.listWorkflows(),
  });

  const workers = useQuery({
    queryKey: ['workers'],
    queryFn: () => dashboardApi.listWorkers(),
  });

  const events = useQuery({
    queryKey: ['events-recent'],
    queryFn: () => dashboardApi.listEvents(),
  });

  const isLoading = workflows.isLoading || workers.isLoading || events.isLoading;
  const hasError = workflows.error || workers.error || events.error;

  if (isLoading) return <div className="p-4">Loading...</div>;
  if (hasError) return <div className="p-4 text-destructive">Error loading data</div>;

  const workflowList = normalizeData<Workflow>(workflows.data);
  const workerList = normalizeData<Worker>(workers.data);
  const eventList = normalizeData<EventEntry>(events.data);

  const workflowCounts = countByStatus(workflowList);
  const workerCounts = countByStatus(workerList);
  const recentEvents = eventList.slice(0, 10);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold mb-4">Live Board</h1>

      <section>
        <h2 className="text-lg font-medium mb-3">Workflow Status</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Object.entries(workflowCounts).map(([status, count]) => (
            <div
              key={status}
              className="rounded-lg border bg-card p-4 shadow-sm"
            >
              <p className="text-sm text-muted-foreground capitalize">{status}</p>
              <p className="text-3xl font-bold">{count}</p>
            </div>
          ))}
          <div className="rounded-lg border bg-card p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">Total</p>
            <p className="text-3xl font-bold">{workflowList.length}</p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3">Worker Health</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Object.entries(workerCounts).map(([status, count]) => (
            <div
              key={status}
              className="rounded-lg border bg-card p-4 shadow-sm"
            >
              <p className="text-sm text-muted-foreground capitalize">{status}</p>
              <p className="text-3xl font-bold">{count}</p>
            </div>
          ))}
          <div className="rounded-lg border bg-card p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">Total Workers</p>
            <p className="text-3xl font-bold">{workerList.length}</p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3">Recent Events</h2>
        {recentEvents.length === 0 ? (
          <p className="text-muted-foreground">No recent events.</p>
        ) : (
          <ul className="space-y-2">
            {recentEvents.map((event) => (
              <li
                key={event.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                    {event.type}
                  </span>
                  <span className="text-sm">{event.message}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(event.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
