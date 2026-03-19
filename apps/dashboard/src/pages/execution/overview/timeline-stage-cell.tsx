export type StageCellStatus = 'completed' | 'active' | 'waiting' | 'failed' | 'pending';

interface StageCellStyles {
  background: string;
  border: string;
}

export function getStageCellStyles(status: StageCellStatus): StageCellStyles {
  switch (status) {
    case 'completed':
      return {
        background: 'rgba(34,197,94,0.2)',
        border: '1px solid rgba(34,197,94,0.4)',
      };
    case 'active':
      return {
        background: 'transparent',
        border: '2px solid var(--color-accent-primary)',
      };
    case 'waiting':
      return {
        background: 'transparent',
        border: '2px solid var(--color-status-warning)',
      };
    case 'failed':
      return {
        background: 'transparent',
        border: '2px solid var(--color-status-error)',
      };
    case 'pending':
      return {
        background: 'var(--color-bg-primary)',
        border: '1px solid var(--color-border-default)',
      };
  }
}

export interface TimelineStageCellProps {
  status: StageCellStatus;
  stageName: string;
  agentRoles?: string[];
  onClick?: () => void;
}

export function TimelineStageCell({ status, stageName, agentRoles, onClick }: TimelineStageCellProps): JSX.Element {
  const styles = getStageCellStyles(status);

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      title={stageName}
      style={{
        background: styles.background,
        border: styles.border,
        borderRadius: '4px',
        padding: '6px 8px',
        minWidth: '80px',
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      }}
    >
      <div style={{
        fontSize: '11px',
        color: 'var(--color-text-primary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {stageName}
      </div>

      {agentRoles && agentRoles.length > 0 && (
        <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
          {agentRoles.map((role, i) => (
            <div
              key={`${role}-${i}`}
              title={role}
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: `var(--role-${role}, var(--color-text-tertiary))`,
                flexShrink: 0,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
