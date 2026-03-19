import { cn } from '../../../lib/utils.js';

interface WorkflowStatusRowWorkflow {
  id: string;
  name: string;
  state: string;
  currentStage?: string;
  agentRoles?: string[];
  needsAttention?: boolean;
  gateWaiting?: boolean;
}

interface WorkflowStatusRowProps {
  workflow: WorkflowStatusRowWorkflow;
  onClick: (workflowId: string) => void;
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

// TODO: Add long-press handler on mobile to show quick actions (pause, cancel, view logs).
// Requires a useRef timer approach: onTouchStart starts a ~500ms timer, onTouchEnd/onTouchMove clears it.
// Quick actions overlay needs design input before implementation.
// Tracked in: /home/mark/codex/TODO.md
export function WorkflowStatusRow({ workflow, onClick }: WorkflowStatusRowProps): JSX.Element {
  const borderColor = getStatusColor(workflow);

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
        <div className="text-[13px] font-medium text-[var(--color-text-primary)] truncate">
          {workflow.name}
        </div>
        {workflow.currentStage && (
          <div className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5">
            {workflow.currentStage}
          </div>
        )}
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

      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: borderColor }}
      />
    </div>
  );
}
