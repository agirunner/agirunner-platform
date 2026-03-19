interface MetricCardProps {
  value: string | number;
  label: string;
  color?: string;
}

export function MetricCard({ value, label, color }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-4 text-center transition-all duration-150 hover:border-[var(--color-border-subtle)]">
      <div
        className="text-lg font-bold tabular-nums"
        style={{ color: color ?? 'var(--color-text-primary)' }}
      >
        {value}
      </div>
      <div className="text-[11px] text-[var(--color-text-tertiary)] mt-1 uppercase tracking-wide font-medium">
        {label}
      </div>
    </div>
  );
}
