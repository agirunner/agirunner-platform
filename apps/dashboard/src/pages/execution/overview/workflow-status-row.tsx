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

export function WorkflowStatusRow({ workflow, onClick }: WorkflowStatusRowProps): JSX.Element {
  const borderColor = getStatusColor(workflow);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(workflow.id)}
      onKeyDown={(e) => e.key === 'Enter' && onClick(workflow.id)}
      style={{
        backgroundColor: 'var(--color-bg-secondary)',
        borderRadius: '6px',
        padding: '10px',
        borderLeft: `3px solid ${borderColor}`,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '13px',
          fontWeight: 500,
          color: 'var(--color-text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {workflow.name}
        </div>
        {workflow.currentStage && (
          <div style={{
            fontSize: '11px',
            color: 'var(--color-text-tertiary)',
            marginTop: '2px',
          }}>
            {workflow.currentStage}
          </div>
        )}
      </div>

      {workflow.agentRoles && workflow.agentRoles.length > 0 && (
        <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
          {workflow.agentRoles.map((role, i) => (
            <div
              key={`${role}-${i}`}
              title={role}
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: `var(--role-${role}, var(--color-text-tertiary))`,
              }}
            />
          ))}
        </div>
      )}

      <div style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: borderColor,
        flexShrink: 0,
      }} />
    </div>
  );
}
