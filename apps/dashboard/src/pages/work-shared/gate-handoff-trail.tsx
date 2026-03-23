import { Badge } from '../../components/ui/badge.js';

import { buildGateHandoffEntries } from './gate-handoff-support.js';
import type { GateIdentityShape } from './gate-detail-support.js';

export function GateHandoffTrail({ gate }: { gate: GateIdentityShape }): JSX.Element | null {
  const entries = buildGateHandoffEntries(gate);
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="rounded-md border border-border/70 bg-border/10 p-3 text-xs text-muted">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
        Operator-to-Orchestrator Handoff
      </div>
      <div className="space-y-3">
        {entries.map((entry, index) => (
          <div
            key={entry.key}
            className="grid gap-2 border-l border-border/70 pl-3 last:pb-0"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Step {index + 1}</Badge>
              <span className="font-medium text-foreground">{entry.label}</span>
              {entry.timestamp ? (
                <span>{new Date(entry.timestamp).toLocaleString()}</span>
              ) : null}
            </div>
            <p>{entry.summary}</p>
            {entry.detail ? <p>{entry.detail}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
