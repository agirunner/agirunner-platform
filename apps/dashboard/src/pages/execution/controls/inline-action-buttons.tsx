type WorkflowAction = 'pause' | 'resume' | 'cancel';
type TaskAction = 'retry' | 'cancel';
type GateAction = 'approve' | 'reject' | 'request_changes';

export interface InlineActionButtonsProps {
  entityType: 'workflow' | 'task' | 'gate';
  entityState: string;
  onAction: (action: string) => void;
}

const WORKFLOW_ACTIONS: Record<string, WorkflowAction[]> = {
  active: ['pause', 'cancel'],
  paused: ['resume', 'cancel'],
};

const TASK_ACTIONS: Record<string, TaskAction[]> = {
  failed: ['retry', 'cancel'],
  active: ['cancel'],
};

const GATE_ACTIONS: Record<string, GateAction[]> = {
  requested: ['approve', 'reject', 'request_changes'],
};

const ACTION_STYLES: Record<string, string> = {
  cancel: 'var(--color-status-error)',
  approve: 'var(--color-status-success)',
  pause: 'var(--color-status-warning)',
  resume: 'var(--color-accent-primary)',
  retry: 'var(--color-accent-primary)',
  reject: 'var(--color-status-error)',
  request_changes: 'var(--color-status-warning)',
};

export function getAvailableActions(entityType: string, entityState: string): string[] {
  if (entityType === 'workflow') return WORKFLOW_ACTIONS[entityState] ?? [];
  if (entityType === 'task') return TASK_ACTIONS[entityState] ?? [];
  if (entityType === 'gate') return GATE_ACTIONS[entityState] ?? [];
  return [];
}

function formatActionLabel(action: string): string {
  return action.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}

export function InlineActionButtons({ entityType, entityState, onAction }: InlineActionButtonsProps): JSX.Element {
  const actions = getAvailableActions(entityType, entityState);

  if (actions.length === 0) {
    return <></>;
  }

  return (
    <div
      data-testid="inline-action-buttons"
      style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}
    >
      {actions.map(action => (
        <button
          key={action}
          type="button"
          data-action={action}
          onClick={() => onAction(action)}
          style={{
            fontSize: '11px',
            fontFamily: 'inherit',
            padding: '2px 8px',
            borderRadius: '4px',
            border: `1px solid ${ACTION_STYLES[action] ?? 'var(--color-border-subtle)'}`,
            backgroundColor: 'transparent',
            color: ACTION_STYLES[action] ?? 'var(--color-text-secondary)',
            cursor: 'pointer',
            lineHeight: '20px',
            transition: 'background-color 0.1s',
          }}
          onMouseEnter={e => {
            const el = e.currentTarget;
            el.style.backgroundColor = `${ACTION_STYLES[action] ?? 'var(--color-border-subtle)'}22`;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          {formatActionLabel(action)}
        </button>
      ))}
    </div>
  );
}
