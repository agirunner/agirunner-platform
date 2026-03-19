import { cn } from '../../../lib/utils.js';
import type { ControlMode } from '../execution-canvas-support.js';
import { InlineActionButtons } from '../controls/inline-action-buttons.js';

interface TaskCounts {
  completed?: number;
  in_progress?: number;
  failed?: number;
  [key: string]: number | undefined;
}

interface WorkItemSummary {
  total_work_items?: number;
  open_work_item_count?: number;
  completed_work_item_count?: number;
  active_stage_count?: number;
  awaiting_gate_count?: number;
  active_stage_names?: string[];
}

export interface WorkflowStatusRowWorkflow {
  id: string;
  name: string;
  state: string;
  currentStage?: string;
  playbookName?: string;
  workspaceName?: string;
  taskCounts?: TaskCounts;
  workItemSummary?: WorkItemSummary;
  agentRoles?: string[];
  needsAttention?: boolean;
  gateWaiting?: boolean;
  escalationCount?: number;
  pendingApprovalCount?: number;
}

interface WorkflowStatusRowProps {
  workflow: WorkflowStatusRowWorkflow;
  onClick: (workflowId: string) => void;
  controlMode?: ControlMode;
  onAction?: (workflowId: string, action: string) => void;
}

export function getStatusColor(workflow: Pick<WorkflowStatusRowWorkflow, 'state' | 'needsAttention' | 'gateWaiting'>): string {
  if (workflow.state === 'failed' || workflow.state === 'cancelled') {
    return 'var(--color-status-error)';
  }
  if (workflow.gateWaiting || workflow.needsAttention) {
    return 'var(--color-status-warning)';
  }
  return 'var(--color-status-success)';
}

function formatTaskProgress(counts?: TaskCounts): string | null {
  if (!counts) return null;
  const total = Object.values(counts).reduce<number>((sum, v) => sum + (v ?? 0), 0);
  if (total === 0) return null;
  const completed = counts.completed ?? 0;
  return `${completed}/${total} tasks`;
}

function formatWorkItemProgress(summary?: WorkItemSummary): string | null {
  if (!summary || !summary.total_work_items) return null;
  const open = summary.open_work_item_count ?? 0;
  return `${open}/${summary.total_work_items} open`;
}

function formatAttentionBadge(workflow: WorkflowStatusRowWorkflow): string | null {
  const escalations = workflow.escalationCount ?? 0;
  const approvals = workflow.pendingApprovalCount ?? 0;
  if (escalations > 0) return `${escalations} escalation${escalations > 1 ? 's' : ''}`;
  if (workflow.gateWaiting || approvals > 0) return 'Gate review needed';
  return null;
}

const ACTIONABLE_STATES = new Set(['active', 'paused']);

export function WorkflowStatusRow({ workflow, onClick, controlMode, onAction }: WorkflowStatusRowProps): JSX.Element {
  const borderColor = getStatusColor(workflow);
  const taskProgress = formatTaskProgress(workflow.taskCounts);
  const workItemProgress = formatWorkItemProgress(workflow.workItemSummary);
  const attentionLabel = formatAttentionBadge(workflow);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(workflow.id)}
      onKeyDown={(e) => e.key === 'Enter' && onClick(workflow.id)}
      className={cn(
        'flex items-center gap-3 rounded-lg p-3 cursor-pointer',
        'bg-[var(--color-bg-secondary)]',
        'border border-transparent',
        'transition-all duration-150',
        'hover:border-[var(--color-border-subtle)] hover:shadow-sm',
        'active:scale-[0.995]',
      )}
      style={{ borderLeftWidth: '3px', borderLeftColor: borderColor }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-[var(--color-text-primary)] truncate">
            {workflow.name}
          </span>
          {workflow.playbookName && (
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)] font-medium">
              {workflow.playbookName}
            </span>
          )}
          {attentionLabel && (
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide"
              style={{
                color: 'var(--color-status-warning)',
                backgroundColor: 'color-mix(in srgb, var(--color-status-warning) 15%, transparent)',
              }}
            >
              {attentionLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          {workflow.currentStage && (
            <span className="text-[11px] text-[var(--color-text-tertiary)]">
              {workflow.currentStage}
            </span>
          )}
          {taskProgress && (
            <span className="text-[11px] text-[var(--color-text-secondary)] tabular-nums">
              {taskProgress}
            </span>
          )}
          {workItemProgress && (
            <span className="text-[11px] text-[var(--color-text-secondary)] tabular-nums">
              {workItemProgress}
            </span>
          )}
        </div>
      </div>

      {workflow.agentRoles && workflow.agentRoles.length > 0 && (
        <div className="flex gap-1 shrink-0">
          {workflow.agentRoles.map((role, i) => (
            <div
              key={`${role}-${i}`}
              title={role}
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: `var(--role-${role}, var(--color-text-tertiary))` }}
            />
          ))}
        </div>
      )}

      {controlMode === 'inline' && ACTIONABLE_STATES.has(workflow.state) && (
        <div
          className="shrink-0"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <InlineActionButtons
            entityType="workflow"
            entityState={workflow.state}
            onAction={(action) => onAction?.(workflow.id, action)}
          />
        </div>
      )}

      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: borderColor }}
      />
    </div>
  );
}
