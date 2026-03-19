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

export function formatEventSummary(event: { type: string; entityType?: string; data?: Record<string, unknown> }): string {
  const d = event.data ?? {};
  const title = (d.task_title ?? d.title ?? '') as string;
  const role = (d.task_role ?? d.role ?? '') as string;

  switch (event.type) {
    case 'task.state_changed': {
      const to = d.to_state as string | undefined;
      if (to === 'completed') return title ? `${role || 'Task'} completed: ${title}` : 'Task completed';
      if (to === 'in_progress') return title ? `${role || 'Task'} started: ${title}` : 'Task started';
      if (to === 'claimed') return title ? `Task claimed: ${title}` : 'Task claimed';
      if (to === 'failed') return title ? `Task failed: ${title}` : 'Task failed';
      if (to === 'ready') return title ? `Task ready: ${title}` : 'Task ready';
      if (to === 'escalated') return 'Task escalated';
      return `Task ${to ?? 'unknown'}`;
    }
    case 'task.created': return title ? `Task created: ${title}` : 'New task created';
    case 'task.completed': return `Task completed: ${title || 'unknown task'}`;
    case 'task.started': return `Task started: ${title || 'unknown task'}`;
    case 'task.failed': return `Task failed: ${title || 'unknown task'}`;
    case 'task.agent_escalated': return 'Agent escalated task';
    case 'task.escalated': return 'Task escalated';
    case 'task.review_resolution_skipped': return 'Review resolution skipped';
    case 'workflow.state_changed': return `Workflow ${(d.to_state as string) ?? 'updated'}`;
    case 'workflow.activation_queued': return 'Orchestrator activation queued';
    case 'workflow.activation_started': return 'Orchestrator activated';
    case 'workflow.activation_completed': return 'Orchestrator completed activation';
    case 'workflow.activation_failed': return 'Orchestrator activation failed';
    case 'workflow.activation_requeued': return 'Activation re-queued';
    case 'workflow.started': return `Workflow started: ${(d.workflow_name as string) ?? 'unknown workflow'}`;
    case 'workflow.completed': return `Workflow completed: ${(d.workflow_name as string) ?? 'unknown workflow'}`;
    case 'workflow.failed': return `Workflow failed: ${(d.workflow_name as string) ?? 'unknown workflow'}`;
    case 'work_item.created': return 'Work item created';
    case 'work_item.updated': return 'Work item updated';
    case 'work_item.moved': return 'Work item moved';
    case 'work_item.completed': return 'Work item completed';
    case 'worker.registered': return 'Worker registered';
    case 'worker.offline': return 'Worker went offline';
    case 'worker.disconnected': return 'Worker disconnected';
    case 'agent.registered': return 'Agent registered';
    case 'gate.opened': return `Gate opened: ${(d.gate_name as string) ?? 'stage gate'}`;
    case 'gate.approved': return `Gate approved: ${(d.gate_name as string) ?? 'stage gate'}`;
    default: {
      const raw = event.type.replace(/\./g, ' ').replace(/_/g, ' ');
      return raw.charAt(0).toUpperCase() + raw.slice(1);
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
