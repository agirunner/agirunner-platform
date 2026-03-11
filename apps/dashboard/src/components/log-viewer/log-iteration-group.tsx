import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, Filter } from 'lucide-react';
import type { LogEntry } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { LogEntryRow } from './log-entry-row.js';
import { LogEntryDetail } from './log-entry-detail.js';
import { Button } from '../ui/button.js';

const COL_COUNT = 11;

export interface LogIterationGroupProps {
  iteration: number;
  entries: LogEntry[];
  isExpanded: boolean;
  onToggle: () => void;
  onFilterTrace: (traceId: string) => void;
}

const PHASE_STYLES: Record<string, string> = {
  think: 'bg-violet-100 text-violet-700',
  plan: 'bg-blue-100 text-blue-700',
  act: 'bg-emerald-100 text-emerald-700',
  observe: 'bg-amber-100 text-amber-700',
  verify: 'bg-teal-100 text-teal-700',
};

function extractPhases(entries: LogEntry[]): string[] {
  const phases = new Set<string>();
  for (const entry of entries) {
    const phase = entry.payload?.phase;
    if (typeof phase === 'string' && phase !== '') {
      phases.add(phase.toLowerCase());
    }
  }
  return Array.from(phases);
}

function computeTotalDuration(entries: LogEntry[]): number {
  let total = 0;
  for (const entry of entries) {
    if (entry.duration_ms != null) {
      total += entry.duration_ms;
    }
  }
  return total;
}

function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function IterationHeader({
  iteration,
  entries,
  isExpanded,
  onToggle,
}: {
  iteration: number;
  entries: LogEntry[];
  isExpanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  const Chevron = isExpanded ? ChevronDown : ChevronRight;
  const phases = extractPhases(entries);
  const totalDuration = computeTotalDuration(entries);

  return (
    <tr
      className="border-b border-border bg-muted/40 cursor-pointer hover:bg-muted/60 transition-colors"
      onClick={onToggle}
    >
      <td colSpan={COL_COUNT} className="px-3 py-2">
        <div className="flex items-center gap-2">
          <Chevron className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Iteration {iteration}</span>

          <div className="flex items-center gap-1">
            {phases.map((phase) => (
              <span
                key={phase}
                className={cn(
                  'rounded px-1.5 py-px text-[10px] font-medium capitalize',
                  PHASE_STYLES[phase] ?? 'bg-gray-100 text-gray-600',
                )}
              >
                {phase}
              </span>
            ))}
          </div>

          {totalDuration > 0 && (
            <span className="text-xs text-muted-foreground font-mono">
              {formatDuration(totalDuration)}
            </span>
          )}

          <span className="text-xs text-muted-foreground">
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>
      </td>
    </tr>
  );
}

export function LogIterationGroup({
  iteration,
  entries,
  isExpanded,
  onToggle,
  onFilterTrace,
}: LogIterationGroupProps): JSX.Element {
  const [expandedEntryId, setExpandedEntryId] = useState<number | null>(null);
  const bgTint = iteration % 2 === 0 ? 'bg-muted/20' : 'bg-muted/10';

  return (
    <>
      <IterationHeader
        iteration={iteration}
        entries={entries}
        isExpanded={isExpanded}
        onToggle={onToggle}
      />
      {isExpanded &&
        entries.map((entry) => {
          const isEntryExpanded = expandedEntryId === entry.id;
          return (
            <Fragment key={entry.id}>
              <LogEntryRow
                entry={entry}
                isExpanded={isEntryExpanded}
                onToggle={() =>
                  setExpandedEntryId((prev) =>
                    prev === entry.id ? null : entry.id,
                  )
                }
              />
              {isEntryExpanded && (
                <tr className={cn('border-b border-border/40', bgTint)}>
                  <td colSpan={COL_COUNT} className="p-0">
                    <LogEntryDetail
                      entry={entry}
                      onFilterTrace={onFilterTrace}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
    </>
  );
}
