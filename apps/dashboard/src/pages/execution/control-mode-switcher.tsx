import { cn } from '../../lib/utils.js';
import type { ControlMode } from './execution-canvas-support.js';

interface ControlModeSwitcherProps {
  value: ControlMode;
  onChange: (mode: ControlMode) => void;
}

const MODES: { key: ControlMode; label: string }[] = [
  { key: 'inline', label: 'Inline' },
  { key: 'command-center', label: 'Cmd Center' },
  { key: 'command-palette', label: 'Palette' },
];

export function ControlModeSwitcher({ value, onChange }: ControlModeSwitcherProps) {
  return (
    <div
      data-testid="control-mode-switcher"
      className="inline-flex rounded-full bg-[var(--color-bg-secondary)] p-0.5"
    >
      {MODES.map(({ key, label }) => (
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
