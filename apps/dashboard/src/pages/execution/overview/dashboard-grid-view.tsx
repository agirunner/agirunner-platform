import { MetricCard } from './metric-card';

const MAX_RECENT_EVENTS = 10;

interface Workflow {
  id: string;
  name: string;
  state: string;
  needsAttention?: boolean;
  gateWaiting?: boolean;
}

interface FeedEvent {
  id: string;
  type: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

export interface DashboardGridViewProps {
  workflows: Workflow[];
  events: FeedEvent[];
  spendUsd: number;
  onSelectWorkflow: (workflowId: string) => void;
}

export interface Metrics {
  active: number;
  attention: number;
  completed: number;
  spend: string;
}

function needsAttention(workflow: Workflow): boolean {
  return workflow.state === 'failed' || !!workflow.needsAttention || !!workflow.gateWaiting;
}

export function computeMetrics(workflows: Workflow[], spendUsd: number): Metrics {
  const active = workflows.filter(w => w.state === 'active').length;
  const completed = workflows.filter(w => w.state === 'completed').length;
  const attention = workflows.filter(needsAttention).length;
  const spend = `$${spendUsd.toFixed(2)}`;
  return { active, attention, completed, spend };
}

function attentionBadge(workflow: Workflow): string {
  if (workflow.state === 'failed') return 'Failed';
  if (workflow.gateWaiting) return 'Gate waiting';
  return 'Needs attention';
}

function badgeColor(workflow: Workflow): string {
  if (workflow.state === 'failed') return 'var(--color-status-error)';
  return 'var(--color-status-warning)';
}

function formatRelativeTime(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.floor(diffMin / 60)}h ago`;
}

function formatEventLabel(event: FeedEvent): string {
  const data = event.data ?? {};
  switch (event.type) {
    case 'task.completed': return `Task completed: ${data['task_title'] ?? 'unknown'}`;
    case 'task.started': return `Task started: ${data['task_title'] ?? 'unknown'}`;
    case 'task.failed': return `Task failed: ${data['task_title'] ?? 'unknown'}`;
    case 'workflow.started': return `Workflow started: ${data['workflow_name'] ?? 'unknown'}`;
    case 'workflow.completed': return `Workflow completed: ${data['workflow_name'] ?? 'unknown'}`;
    case 'workflow.failed': return `Workflow failed: ${data['workflow_name'] ?? 'unknown'}`;
    default: return event.type;
  }
}

function AttentionList({ workflows, onSelect }: { workflows: Workflow[]; onSelect: (id: string) => void }): JSX.Element {
  const items = workflows.filter(needsAttention);

  if (items.length === 0) {
    return (
      <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', padding: '8px 0' }}>
        No items need attention
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {items.map(w => (
        <div
          key={w.id}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(w.id)}
          onKeyDown={(e) => e.key === 'Enter' && onSelect(w.id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--color-bg-secondary)',
            borderRadius: '6px',
            padding: '8px 10px',
            cursor: 'pointer',
            borderLeft: `3px solid ${badgeColor(w)}`,
          }}
        >
          <span style={{ fontSize: '13px', color: 'var(--color-text-primary)' }}>{w.name}</span>
          <span style={{
            fontSize: '10px',
            color: badgeColor(w),
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}>
            {attentionBadge(w)}
          </span>
        </div>
      ))}
    </div>
  );
}

function RecentActivity({ events }: { events: FeedEvent[] }): JSX.Element {
  const visible = events.slice(0, MAX_RECENT_EVENTS);

  if (visible.length === 0) {
    return (
      <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', padding: '8px 0' }}>
        No recent activity
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {visible.map(event => (
        <div key={event.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ flex: 1, fontSize: '12px', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {formatEventLabel(event)}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', flexShrink: 0 }}>
            {formatRelativeTime(event.createdAt)}
          </div>
        </div>
      ))}
    </div>
  );
}

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  color: 'var(--color-text-tertiary)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '8px',
};

export function DashboardGridView({ workflows, events, spendUsd, onSelectWorkflow }: DashboardGridViewProps): JSX.Element {
  const metrics = computeMetrics(workflows, spendUsd);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
        <MetricCard value={metrics.active} label="Active" />
        <MetricCard value={metrics.attention} label="Needs Attention" color="var(--color-status-warning)" />
        <MetricCard value={metrics.completed} label="Completed Today" />
        <MetricCard value={metrics.spend} label="Daily Spend" />
      </div>

      <div>
        <div style={sectionHeaderStyle}>Needs Attention</div>
        <AttentionList workflows={workflows} onSelect={onSelectWorkflow} />
      </div>

      <div>
        <div style={sectionHeaderStyle}>Recent Activity</div>
        <RecentActivity events={events} />
      </div>
    </div>
  );
}
