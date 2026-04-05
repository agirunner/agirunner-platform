import { Badge } from '../../components/ui/badge.js';
import type { DashboardWorkflowRailRow } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { formatRelativeTimestamp } from '../workflow-detail/workflow-detail-presentation.js';

export function WorkflowRailRowCard(props: {
  row: DashboardWorkflowRailRow;
  isSelected: boolean;
  onSelect(workflowId: string): void;
}): JSX.Element {
  const primaryStatus = buildWorkflowPrimaryStatus(props.row);

  return (
    <button
      type="button"
      className={cn(
        'grid w-full min-w-0 max-w-full gap-2 rounded-xl border px-3 py-3 text-left transition-[border-color,background-color,color] duration-150',
        props.isSelected
          ? 'border-sky-700/90 bg-sky-200/95 text-sky-950 ring-2 ring-sky-500/70 dark:border-sky-200/90 dark:bg-sky-300/20 dark:text-sky-50 dark:ring-sky-300/45'
          : 'border-border/70 bg-background/85 hover:border-border hover:bg-background',
      )}
      onClick={() => props.onSelect(props.row.workflow_id)}
    >
      <div className="grid min-w-0 gap-2">
        <div className="min-w-0">
          <p
            className={cn(
              'truncate text-sm font-semibold',
              props.isSelected ? 'text-sky-950 dark:text-sky-50' : 'text-foreground',
            )}
          >
            {props.row.name}
          </p>
          <p
            className={cn(
              'truncate text-xs',
              props.isSelected ? 'text-sky-900/75 dark:text-sky-100/85' : 'text-muted-foreground',
            )}
          >
            {[props.row.playbook_name, props.row.workspace_name].filter(Boolean).join(' • ') || 'Workflow'}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {props.row.needs_action ? <Badge variant="warning">Needs action</Badge> : null}
          {props.row.lifecycle === 'ongoing' ? <Badge variant="outline">Ongoing</Badge> : null}
        </div>
      </div>

      <div
        className={cn(
          'flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs',
          props.isSelected ? 'text-sky-900/75 dark:text-sky-100/85' : 'text-muted-foreground',
        )}
      >
        <span>{humanizePosture(props.row.posture)}</span>
        <span>{formatRelativeTimestamp(props.row.last_changed_at)}</span>
      </div>

      {primaryStatus ? (
        <p
          className={cn(
            'text-sm',
            props.isSelected ? 'text-sky-950 dark:text-sky-50' : 'text-foreground',
          )}
        >
          {primaryStatus}
        </p>
      ) : null}
    </button>
  );
}

function humanizePosture(value: string | null): string {
  if (!value) {
    return 'Workflow';
  }
  if (value === 'waiting_by_design') {
    return 'Waiting for Work';
  }
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function buildWorkflowPrimaryStatus(row: DashboardWorkflowRailRow): string | null {
  const counts = row.counts;
  if (counts.active_work_item_count === 0 && counts.active_task_count > 0) {
    return 'Orchestrator working';
  }
  if (shouldShowRoutingState(row)) {
    return 'Routing next step';
  }
  return null;
}

function shouldShowRoutingState(row: DashboardWorkflowRailRow): boolean {
  return row.counts.active_task_count === 0
    && (row.lifecycle === 'ongoing' || row.posture === 'waiting_by_design');
}
