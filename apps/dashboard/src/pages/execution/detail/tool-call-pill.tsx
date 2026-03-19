export interface ToolCallPillProps {
  tool: string;
  input?: string;
  result?: string;
}

export function ToolCallPill({ tool, input, result }: ToolCallPillProps) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      padding: '1px 6px',
      borderRadius: '4px',
      backgroundColor: 'var(--color-bg-secondary)',
      fontSize: '10px',
      maxWidth: '200px',
      overflow: 'hidden',
      whiteSpace: 'nowrap',
      flexShrink: 0,
    }}>
      <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>
        {tool}
      </span>
      {input && (
        <span style={{
          color: 'var(--color-text-tertiary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {input}
        </span>
      )}
      {result && (
        <span style={{
          color: 'var(--color-text-muted)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          → {result}
        </span>
      )}
    </span>
  );
}
