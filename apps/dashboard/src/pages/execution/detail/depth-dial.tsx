import { cn } from '../../../lib/utils.js';
import type { DepthLevel } from '../execution-canvas-support.js';

interface DepthDialProps {
  value: DepthLevel;
  onChange: (level: DepthLevel) => void;
}

export const DEPTH_LABELS: Record<DepthLevel, string> = {
  1: 'Tasks',
  2: 'Agent Turns',
  3: 'Raw Stream',
};

const DEPTH_LEVELS: DepthLevel[] = [1, 2, 3];

export function DepthDial({ value, onChange }: DepthDialProps) {
  return (
    <div className="inline-flex rounded-full bg-[var(--color-bg-secondary)] p-0.5">
      {DEPTH_LEVELS.map((level) => (
        <button
          key={level}
          onClick={() => onChange(level)}
          className={cn(
            'rounded-full px-3 py-1.5 text-[10px] font-medium border-none cursor-pointer transition-all duration-150',
            value === level
              ? 'bg-[var(--color-accent-primary)] text-white shadow-sm'
              : 'bg-transparent text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
          )}
        >
          {DEPTH_LABELS[level]}
        </button>
      ))}
    </div>
  );
}
