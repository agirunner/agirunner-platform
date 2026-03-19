const DEFAULT_MAX_EVENTS = 20;

interface FeedEvent {
  id: string;
  type: string;
  entityType?: string;
  actorType?: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

interface LiveFeedCardProps {
  events: FeedEvent[];
  maxEvents?: number;
}

export function formatEventSummary(event: Pick<FeedEvent, 'type' | 'entityType' | 'data'>): string {
  const data = event.data ?? {};

  switch (event.type) {
    case 'task.completed':
      return `Task completed: ${data['task_title'] ?? 'unknown task'}`;
    case 'task.started':
      return `Task started: ${data['task_title'] ?? 'unknown task'}`;
    case 'task.failed':
      return `Task failed: ${data['task_title'] ?? 'unknown task'}`;
    case 'workflow.started':
      return `Workflow started: ${data['workflow_name'] ?? 'unknown workflow'}`;
    case 'workflow.completed':
      return `Workflow completed: ${data['workflow_name'] ?? 'unknown workflow'}`;
    case 'workflow.failed':
      return `Workflow failed: ${data['workflow_name'] ?? 'unknown workflow'}`;
    case 'gate.opened':
      return `Gate opened: ${data['gate_name'] ?? 'stage gate'}`;
    case 'gate.approved':
      return `Gate approved: ${data['gate_name'] ?? 'stage gate'}`;
    default: {
      const label = event.entityType ? `${event.entityType} ` : '';
      return `${label}${event.type}`;
    }
  }
}

function formatRelativeTime(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

function actorDotColor(actorType?: string): string {
  if (!actorType) return 'var(--color-text-tertiary)';
  return `var(--role-${actorType}, var(--color-accent-primary))`;
}

export function LiveFeedCard({ events, maxEvents = DEFAULT_MAX_EVENTS }: LiveFeedCardProps): JSX.Element {
  const visible = events.slice(0, maxEvents);

  return (
    <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-4 flex flex-col gap-1">
      <div className="text-[11px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">
        Live Feed
      </div>
      <div className="overflow-y-auto flex flex-col gap-2 max-h-64">
        {visible.map((event) => (
          <div key={event.id} className="flex items-start gap-2 group">
            <div
              className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
              style={{ backgroundColor: actorDotColor(event.actorType) }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-[var(--color-text-secondary)] truncate group-hover:text-[var(--color-text-primary)] transition-colors duration-150">
                {formatEventSummary(event)}
              </div>
            </div>
            <div className="text-[10px] text-[var(--color-text-tertiary)] shrink-0 tabular-nums">
              {formatRelativeTime(event.createdAt)}
            </div>
          </div>
        ))}
        {visible.length === 0 && (
          <div className="text-xs text-[var(--color-text-tertiary)] text-center py-4">
            No events yet
          </div>
        )}
      </div>
    </div>
  );
}
