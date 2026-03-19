interface Worker {
  status: string;
}

interface FleetStatusCardProps {
  workers: Worker[];
}

export interface FleetCounts {
  online: number;
  busy: number;
  idle: number;
  down: number;
}

export function computeFleetCounts(workers: Worker[]): FleetCounts {
  const counts: FleetCounts = { online: 0, busy: 0, idle: 0, down: 0 };
  for (const worker of workers) {
    if (worker.status === 'online') counts.online++;
    else if (worker.status === 'busy') counts.busy++;
    else if (worker.status === 'idle') counts.idle++;
    else counts.down++;
  }
  return counts;
}

interface StatusRowProps {
  label: string;
  count: number;
  color: string;
}

function StatusRow({ label, count, color }: StatusRowProps): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: color,
        flexShrink: 0,
      }} />
      <span style={{ flex: 1, fontSize: '12px', color: 'var(--color-text-secondary)' }}>{label}</span>
      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)' }}>{count}</span>
    </div>
  );
}

export function FleetStatusCard({ workers }: FleetStatusCardProps): JSX.Element {
  const counts = computeFleetCounts(workers);

  return (
    <div style={{
      backgroundColor: 'var(--color-bg-secondary)',
      borderRadius: '8px',
      padding: '12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Fleet
      </div>
      <StatusRow label="Online" count={counts.online} color="var(--color-status-success)" />
      <StatusRow label="Busy" count={counts.busy} color="var(--color-status-warning)" />
      <StatusRow label="Idle" count={counts.idle} color="var(--color-text-tertiary)" />
      <StatusRow label="Down" count={counts.down} color="var(--color-status-error)" />
    </div>
  );
}
