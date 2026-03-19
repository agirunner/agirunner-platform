import { cn } from '../../lib/utils.js';
import type { ViewMode } from './execution-canvas-support.js';

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
    <div className="inline-flex rounded-full bg-[var(--color-bg-secondary)] p-0.5">
      {modes.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={cn(
            'rounded-full px-3 py-1.5 text-[10px] font-medium border-none cursor-pointer transition-all duration-150',
            value === key
              ? 'bg-[var(--color-accent-primary)] text-white shadow-sm'
              : 'bg-transparent text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
