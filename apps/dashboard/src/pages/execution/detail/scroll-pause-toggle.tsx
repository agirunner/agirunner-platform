interface ScrollPauseToggleProps {
  isPaused: boolean;
  onToggle: () => void;
}

export function ScrollPauseToggle({ isPaused, onToggle }: ScrollPauseToggleProps) {
  return (
    <button
      onClick={onToggle}
      title={isPaused ? 'Resume auto-scroll' : 'Pause auto-scroll'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        borderRadius: '12px',
        fontSize: '11px',
        border: '1px solid var(--color-border-subtle)',
        cursor: 'pointer',
        backgroundColor: isPaused ? 'var(--color-bg-secondary)' : 'transparent',
        color: isPaused ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)',
        transition: 'var(--transition-fast)',
      }}
    >
      <span style={{
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        backgroundColor: isPaused ? 'var(--color-text-tertiary)' : 'var(--color-status-success)',
        flexShrink: 0,
      }} />
      Auto-scroll
    </button>
  );
}
