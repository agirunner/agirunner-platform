import type { ViewMode } from './execution-canvas-support';

interface ViewModeSwitcherProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function ViewModeSwitcher({ value, onChange }: ViewModeSwitcherProps) {
  const modes: { key: ViewMode; label: string }[] = [
    { key: 'war-room', label: 'War Room' },
    { key: 'dashboard-grid', label: 'Grid' },
    { key: 'timeline-lanes', label: 'Lanes' },
  ];

  return (
    <div style={{
      backgroundColor: 'var(--color-bg-secondary)',
      borderRadius: '20px',
      padding: '3px',
      display: 'inline-flex',
    }}>
      {modes.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          style={{
            padding: '5px 12px',
            borderRadius: '16px',
            fontSize: '10px',
            border: 'none',
            cursor: 'pointer',
            backgroundColor: value === key ? 'var(--color-accent-primary)' : 'transparent',
            color: value === key ? '#fff' : 'var(--color-text-tertiary)',
            transition: 'var(--transition-fast)',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
