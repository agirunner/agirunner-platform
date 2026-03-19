import { cn } from '../../../lib/utils.js';

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
      className={cn(
        'rounded-md px-2.5 py-2 min-w-[80px] flex flex-col gap-1',
        'transition-all duration-150',
        onClick ? 'cursor-pointer hover:opacity-80 active:scale-[0.97]' : '',
        'max-sm:min-w-0 max-sm:w-full',
      )}
      style={{ background: styles.background, border: styles.border }}
    >
      <div className="text-[11px] text-[var(--color-text-primary)] truncate font-medium">
        {stageName}
      </div>

      {agentRoles && agentRoles.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {agentRoles.map((role, i) => (
            <div
              key={`${role}-${i}`}
              title={role}
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: `var(--role-${role}, var(--color-text-tertiary))` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
