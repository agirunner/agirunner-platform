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
    <div className="flex items-center gap-2.5 py-0.5">
      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      <span className="flex-1 text-xs text-[var(--color-text-secondary)]">{label}</span>
      <span className="text-[13px] font-semibold text-[var(--color-text-primary)] tabular-nums">{count}</span>
    </div>
  );
}

export function FleetStatusCard({ workers }: FleetStatusCardProps): JSX.Element {
  const counts = computeFleetCounts(workers);

  return (
    <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-4 flex flex-col gap-2">
      <div className="text-[11px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1">
        Fleet
      </div>
      <StatusRow label="Online" count={counts.online} color="var(--color-status-success)" />
      <StatusRow label="Busy" count={counts.busy} color="var(--color-status-warning)" />
      <StatusRow label="Idle" count={counts.idle} color="var(--color-text-tertiary)" />
      <StatusRow label="Down" count={counts.down} color="var(--color-status-error)" />
    </div>
  );
}
