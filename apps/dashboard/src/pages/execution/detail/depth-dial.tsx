import type { DepthLevel } from '../execution-canvas-support';

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
    <div style={{
      backgroundColor: 'var(--color-bg-secondary)',
      borderRadius: '20px',
      padding: '3px',
      display: 'inline-flex',
    }}>
      {DEPTH_LEVELS.map((level) => (
        <button
          key={level}
          onClick={() => onChange(level)}
          style={{
            padding: '5px 12px',
            borderRadius: '16px',
            fontSize: '10px',
            border: 'none',
            cursor: 'pointer',
            backgroundColor: value === level ? 'var(--color-accent-primary)' : 'transparent',
            color: value === level ? '#fff' : 'var(--color-text-tertiary)',
            transition: 'var(--transition-fast)',
          }}
        >
          {DEPTH_LABELS[level]}
        </button>
      ))}
    </div>
  );
}
