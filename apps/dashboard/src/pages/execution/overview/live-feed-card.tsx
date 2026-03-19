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
    <div style={{
      backgroundColor: 'var(--color-bg-secondary)',
      borderRadius: '8px',
      padding: '12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
    }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
        Live Feed
      </div>
      <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {visible.map((event) => (
          <div key={event.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
            <div style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: actorDotColor(event.actorType),
              marginTop: '3px',
              flexShrink: 0,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {formatEventSummary(event)}
              </div>
            </div>
            <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', flexShrink: 0 }}>
              {formatRelativeTime(event.createdAt)}
            </div>
          </div>
        ))}
        {visible.length === 0 && (
          <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', textAlign: 'center', padding: '8px 0' }}>
            No events yet
          </div>
        )}
      </div>
    </div>
  );
}
