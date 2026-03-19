interface MetricCardProps {
  value: string | number;
  label: string;
  color?: string;
}

export function MetricCard({ value, label, color }: MetricCardProps) {
  return (
    <div style={{
      backgroundColor: 'var(--color-bg-secondary)',
      borderRadius: '6px',
      padding: '10px',
      textAlign: 'center',
    }}>
      <div style={{ color: color ?? 'var(--color-text-primary)', fontSize: '18px', fontWeight: 'bold' }}>
        {value}
      </div>
      <div style={{ color: 'var(--color-text-tertiary)', fontSize: '9px' }}>
        {label}
      </div>
    </div>
  );
}
