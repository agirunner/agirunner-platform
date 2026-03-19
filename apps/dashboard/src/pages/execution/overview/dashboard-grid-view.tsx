import { cn } from '../../../lib/utils.js';
import { MetricCard } from './metric-card.js';
import { formatEventSummary, type TaskNameMap } from './live-feed-card.js';

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
  taskNameMap?: TaskNameMap;
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
  const spend = spendUsd > 0 ? `$${spendUsd.toFixed(2)}` : '\u2014';
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

function formatEventLabel(event: FeedEvent, taskNames?: TaskNameMap): string {
  return formatEventSummary(event, taskNames);
}

function AttentionList({ workflows, onSelect }: { workflows: Workflow[]; onSelect: (id: string) => void }): JSX.Element {
  const items = workflows.filter(needsAttention);

  if (items.length === 0) {
    return (
      <div className="text-xs text-[var(--color-text-tertiary)] py-3">
        No items need attention
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {items.map(w => (
        <div
          key={w.id}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(w.id)}
          onKeyDown={(e) => e.key === 'Enter' && onSelect(w.id)}
          className={cn(
            'flex items-center justify-between rounded-lg p-3 cursor-pointer',
            'bg-[var(--color-bg-secondary)]',
            'border border-transparent',
            'transition-all duration-150',
            'hover:border-[var(--color-border-subtle)] hover:shadow-sm',
          )}
          style={{ borderLeftWidth: '3px', borderLeftColor: badgeColor(w) }}
        >
          <span className="text-[13px] text-[var(--color-text-primary)] font-medium">{w.name}</span>
          <span
            className="text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: badgeColor(w) }}
          >
            {attentionBadge(w)}
          </span>
        </div>
      ))}
    </div>
  );
}

function RecentActivity({ events, taskNameMap }: { events: FeedEvent[]; taskNameMap?: TaskNameMap }): JSX.Element {
  const visible = events.slice(0, MAX_RECENT_EVENTS);

  if (visible.length === 0) {
    return (
      <div className="text-xs text-[var(--color-text-tertiary)] py-3">
        No recent activity
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {visible.map(event => (
        <div key={event.id} className="flex items-center gap-2 group">
          <div className="flex-1 text-xs text-[var(--color-text-secondary)] truncate group-hover:text-[var(--color-text-primary)] transition-colors duration-150">
            {formatEventLabel(event, taskNameMap)}
          </div>
          <div className="text-[10px] text-[var(--color-text-tertiary)] shrink-0 tabular-nums">
            {formatRelativeTime(event.createdAt)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DashboardGridView({ workflows, events, spendUsd, onSelectWorkflow, taskNameMap }: DashboardGridViewProps): JSX.Element {
  const metrics = computeMetrics(workflows, spendUsd);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard value={metrics.active} label="Active" />
        <MetricCard value={metrics.attention} label="Needs Attention" color="var(--color-status-warning)" />
        <MetricCard value={metrics.completed} label="Completed Today" />
        <MetricCard value={metrics.spend} label="Daily Spend" />
      </div>

      <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-4">
        <div className="text-[11px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-3">
          Needs Attention
        </div>
        <AttentionList workflows={workflows} onSelect={onSelectWorkflow} />
      </div>

      <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-4">
        <div className="text-[11px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-3">
          Recent Activity
        </div>
        <RecentActivity events={events} taskNameMap={taskNameMap} />
      </div>
    </div>
  );
}
