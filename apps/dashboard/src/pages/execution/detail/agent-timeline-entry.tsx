import { ToolCallPill } from './tool-call-pill';

export interface AgentTurnData {
  id: string;
  role: string;
  turn: number;
  summary: string;
  toolCalls?: Array<{
    tool: string;
    input?: string;
    result?: string;
  }>;
  timestamp: string;
  expandedContent?: string;
}

export interface AgentTimelineEntryProps {
  entry: AgentTurnData;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export function getRoleInitial(role: string): string {
  if (role.length === 0) return '?';
  return role[0].toUpperCase();
}

function RoleAvatar({ role }: { role: string }) {
  return (
    <div style={{
      width: '28px',
      height: '28px',
      borderRadius: '50%',
      backgroundColor: `var(--role-${role}, var(--color-text-muted))`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '11px',
      fontWeight: 700,
      color: '#fff',
      flexShrink: 0,
    }}>
      {getRoleInitial(role)}
    </div>
  );
}

export function AgentTimelineEntry({ entry, isExpanded, onToggleExpand }: AgentTimelineEntryProps) {
  return (
    <div
      style={{
        borderLeft: `3px solid var(--role-${entry.role}, var(--color-text-muted))`,
        paddingLeft: '10px',
        marginBottom: '8px',
        cursor: 'pointer',
      }}
      onClick={onToggleExpand}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        <RoleAvatar role={entry.role} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
            <span style={{
              fontSize: '10px',
              color: 'var(--color-text-tertiary)',
              flexShrink: 0,
            }}>
              #{entry.turn}
            </span>
            <span style={{
              fontSize: '12px',
              color: 'var(--color-text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {entry.summary}
            </span>
            <span style={{
              fontSize: '10px',
              color: 'var(--color-text-muted)',
              marginLeft: 'auto',
              flexShrink: 0,
            }}>
              {entry.timestamp}
            </span>
          </div>
          {entry.toolCalls && entry.toolCalls.length > 0 && (
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {entry.toolCalls.map((tc, i) => (
                <ToolCallPill
                  key={i}
                  tool={tc.tool}
                  input={tc.input}
                  result={tc.result}
                />
              ))}
            </div>
          )}
          {isExpanded && entry.expandedContent && (
            <pre style={{
              marginTop: '8px',
              padding: '8px',
              borderRadius: '4px',
              backgroundColor: 'var(--color-bg-secondary)',
              fontSize: '11px',
              color: 'var(--color-text-secondary)',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {entry.expandedContent}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
