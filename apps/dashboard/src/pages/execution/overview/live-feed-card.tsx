const DEFAULT_MAX_EVENTS = 20;

interface FeedEvent {
  id: string;
  type: string;
  entityType?: string;
  actorType?: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

export type TaskNameMap = Map<string, { title: string; role: string }>;

interface LiveFeedCardProps {
  events: FeedEvent[];
  maxEvents?: number;
  taskNameMap?: TaskNameMap;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.substring(0, max) + '...' : s;
}

export function formatEventSummary(
  event: { type: string; entityType?: string; data?: Record<string, unknown> },
  taskNames?: TaskNameMap,
): string {
  const d = event.data ?? {};
  const title = (d.task_title ?? d.title ?? '') as string;
  const role = (d.task_role ?? d.role ?? '') as string;

  const taskId = d.task_id as string | undefined;
  const taskInfo = taskId ? taskNames?.get(taskId) : undefined;
  const resolvedTitle = title || (taskInfo?.title ? truncate(taskInfo.title, 40) : '');
  const resolvedRole = role || taskInfo?.role || '';
  const taskLabel = resolvedTitle ? `"${resolvedTitle}"` : '';

  switch (event.type) {
    case 'task.state_changed': {
      const to = d.to_state as string | undefined;
      if (to === 'completed') return `${resolvedRole || 'Task'} completed ${taskLabel}`.trim();
      if (to === 'in_progress') return `${resolvedRole || 'Task'} started ${taskLabel}`.trim();
      if (to === 'claimed') return `${resolvedRole || 'Task'} claimed ${taskLabel}`.trim();
      if (to === 'failed') return `${resolvedRole || 'Task'} failed ${taskLabel}`.trim();
      if (to === 'escalated') return `${resolvedRole || 'Task'} escalated ${taskLabel}`.trim();
      if (to === 'ready') return `Task ready ${taskLabel}`.trim();
      return `Task → ${to} ${taskLabel}`.trim();
    }
    case 'task.agent_escalated': {
      const reason = truncate((d.reason as string) ?? '', 60);
      return reason ? `Escalation: ${reason}` : 'Agent escalated task';
    }
    case 'task.created': return `New task created ${taskLabel}`.trim();
    case 'task.completed': return `Task completed: ${resolvedTitle || 'unknown task'}`;
    case 'task.started': return `Task started: ${resolvedTitle || 'unknown task'}`;
    case 'task.failed': return `Task failed: ${resolvedTitle || 'unknown task'}`;
    case 'task.escalated': return `Task escalated ${taskLabel}`.trim();
    case 'task.review_resolution_skipped': return 'Review auto-resolved';
    case 'workflow.state_changed': return `Workflow ${(d.to_state as string) ?? 'updated'}`;
    case 'workflow.activation_queued': return 'Orchestrator activation queued';
    case 'workflow.activation_started': return `Orchestrator activated (${d.event_count ?? 1} events)`;
    case 'workflow.activation_completed': return 'Orchestrator completed';
    case 'workflow.activation_failed': return 'Orchestrator activation failed';
    case 'workflow.activation_requeued': return 'Activation re-queued';
    case 'workflow.started': return `Workflow started: ${(d.workflow_name as string) ?? 'unknown workflow'}`;
    case 'workflow.completed': return `Workflow completed: ${(d.workflow_name as string) ?? 'unknown workflow'}`;
    case 'workflow.failed': return `Workflow failed: ${(d.workflow_name as string) ?? 'unknown workflow'}`;
    case 'work_item.created': return 'Work item created';
    case 'work_item.updated': return 'Work item updated';
    case 'work_item.moved': return 'Work item moved';
    case 'work_item.completed': return 'Work item completed';
    case 'worker.registered': return 'Worker came online';
    case 'worker.offline': return 'Worker went offline';
    case 'worker.disconnected': return 'Worker disconnected';
    case 'agent.registered': return 'Agent registered';
    case 'gate.opened': return `Gate opened: ${(d.gate_name as string) ?? 'stage gate'}`;
    case 'gate.approved': return `Gate approved: ${(d.gate_name as string) ?? 'stage gate'}`;
    default: {
      const raw = event.type.replace(/[._]/g, ' ');
      return raw.charAt(0).toUpperCase() + raw.slice(1);
    }
  }
}

function isEscalationEvent(event: FeedEvent): boolean {
  return event.type === 'task.agent_escalated' || event.type === 'task.escalated'
    || (event.type === 'task.state_changed' && event.data?.to_state === 'escalated');
}

function escalationReason(event: FeedEvent): string | null {
  const d = event.data ?? {};
  const reason = (d.reason ?? d.context_summary ?? '') as string;
  return reason ? truncate(reason, 80) : null;
}

function roleColor(roleName: string): string {
  return `var(--role-${roleName}, var(--color-accent-primary))`;
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

export function LiveFeedCard({ events, maxEvents = DEFAULT_MAX_EVENTS, taskNameMap }: LiveFeedCardProps): JSX.Element {
  const visible = events.slice(0, maxEvents);

  return (
    <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-4 flex flex-col gap-1">
      <div className="text-[11px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">
        Live Feed
      </div>
      <div className="overflow-y-auto flex flex-col gap-2 max-h-64">
        {visible.map((event) => {
          const isEscalation = isEscalationEvent(event);
          const reason = isEscalation ? escalationReason(event) : null;
          const taskId = event.data?.task_id as string | undefined;
          const taskInfo = taskId ? taskNameMap?.get(taskId) : undefined;
          const eventRole = taskInfo?.role || (event.data?.source_role as string) || '';

          return (
            <div
              key={event.id}
              className="flex items-start gap-2 group"
              style={isEscalation ? { borderLeft: '2px solid var(--color-status-warning)', paddingLeft: '6px' } : undefined}
            >
              <div
                className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                style={{ backgroundColor: isEscalation ? 'var(--color-status-warning)' : actorDotColor(event.actorType) }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {eventRole && (
                    <span
                      className="text-[9px] font-semibold uppercase tracking-wide px-1 py-0.5 rounded shrink-0"
                      style={{ color: roleColor(eventRole), backgroundColor: `color-mix(in srgb, ${roleColor(eventRole)} 15%, transparent)` }}
                    >
                      {eventRole}
                    </span>
                  )}
                  <span className="text-xs text-[var(--color-text-secondary)] truncate group-hover:text-[var(--color-text-primary)] transition-colors duration-150">
                    {formatEventSummary(event, taskNameMap)}
                  </span>
                </div>
                {reason && (
                  <div className="text-[10px] text-[var(--color-status-warning)] mt-0.5 truncate">
                    {reason}
                  </div>
                )}
              </div>
              <div className="text-[10px] text-[var(--color-text-tertiary)] shrink-0 tabular-nums">
                {formatRelativeTime(event.createdAt)}
              </div>
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="text-xs text-[var(--color-text-tertiary)] text-center py-4">
            No events yet
          </div>
        )}
      </div>
    </div>
  );
}
