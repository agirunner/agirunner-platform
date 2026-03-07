import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../../lib/api.js';

interface EventEntry {
  id: string;
  type: string;
  message: string;
  created_at: string;
}

function normalizeData(response: { data: EventEntry[] } | EventEntry[]): EventEntry[] {
  if (Array.isArray(response)) {
    return response;
  }
  return response?.data ?? [];
}

const TYPE_COLORS: Record<string, string> = {
  info: 'bg-blue-100 text-blue-800',
  warning: 'bg-yellow-100 text-yellow-800',
  error: 'bg-red-100 text-red-800',
  success: 'bg-green-100 text-green-800',
};

function badgeClass(type: string): string {
  return TYPE_COLORS[type.toLowerCase()] ?? 'bg-gray-100 text-gray-800';
}

export function ActivityFeedPage(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['events'],
    queryFn: () => dashboardApi.listEvents(),
  });

  if (isLoading) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-destructive">Error loading data</div>;

  const events = normalizeData(data);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Activity Feed</h1>

      {events.length === 0 ? (
        <p className="text-muted-foreground">No events recorded yet.</p>
      ) : (
        <ul className="space-y-3">
          {events.map((event) => (
            <li
              key={event.id}
              className="flex items-start gap-4 rounded-lg border p-4"
            >
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeClass(event.type)}`}
              >
                {event.type}
              </span>
              <div className="flex-1">
                <p className="text-sm">{event.message}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(event.created_at).toLocaleString()}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
