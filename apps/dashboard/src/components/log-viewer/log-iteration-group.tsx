import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { LogEntry } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { LogEntryRow } from './log-entry-row.js';
import { LogEntryDetail } from './log-entry-detail.js';
import { Button } from '../ui/button.js';
import { getCanonicalStageNames } from './log-entry-context.js';

const COL_COUNT = 11;
export const MAX_VISIBLE_ENTRIES_PER_ITERATION = 20;

export interface LogIterationGroupProps {
  iteration: number;
  entries: LogEntry[];
  isExpanded: boolean;
  onToggle: () => void;
  onFilterTrace: (traceId: string) => void;
}

const STAGE_STYLES: Record<string, string> = {
  triage: 'bg-slate-100 text-slate-700',
  planning: 'bg-blue-100 text-blue-700',
  implementation: 'bg-emerald-100 text-emerald-700',
  review: 'bg-amber-100 text-amber-700',
  verification: 'bg-teal-100 text-teal-700',
};

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
  const stages = getCanonicalStageNames(entries);
  const totalDuration = computeTotalDuration(entries);
  const entryCount = entries.length;
  const entryLabel = entryCount === 1 ? 'entry' : 'entries';

  return (
    <tr
      className="border-b border-border bg-muted/40 cursor-pointer hover:bg-muted/60 transition-colors"
      onClick={onToggle}
      tabIndex={0}
      role="button"
      aria-expanded={isExpanded}
      aria-label={`Iteration ${iteration}, ${entryCount} ${entryLabel}${isExpanded ? ', collapse' : ', expand'}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <td colSpan={COL_COUNT} className="px-3 py-2">
        <div className="flex items-center gap-2">
          <Chevron className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-semibold">Iteration {iteration}</span>

          <div className="flex items-center gap-1" aria-label={`Stages: ${stages.join(', ')}`}>
            {stages.map((stage) => (
              <span
                key={stage}
                className={cn(
                  'rounded px-1.5 py-px text-[10px] font-medium capitalize',
                  STAGE_STYLES[stage.toLowerCase()] ?? 'bg-gray-100 text-gray-600',
                )}
              >
                {stage}
              </span>
            ))}
          </div>

          {totalDuration > 0 && (
            <span className="text-xs text-muted-foreground font-mono">
              {formatDuration(totalDuration)}
            </span>
          )}

          <span className="text-xs text-muted-foreground">
            {entryCount} {entryLabel}
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
  const [visibleCount, setVisibleCount] = useState(MAX_VISIBLE_ENTRIES_PER_ITERATION);
  const bgTint = iteration % 2 === 0 ? 'bg-muted/20' : 'bg-muted/10';

  const visibleEntries = isExpanded ? entries.slice(0, visibleCount) : [];
  const hiddenCount = isExpanded ? entries.length - visibleEntries.length : 0;

  return (
    <>
      <IterationHeader
        iteration={iteration}
        entries={entries}
        isExpanded={isExpanded}
        onToggle={onToggle}
      />
      {isExpanded &&
        visibleEntries.map((entry) => {
          const isEntryExpanded = expandedEntryId === entry.id;
          return (
            <Fragment key={entry.id}>
              <LogEntryRow
                entry={entry}
                isExpanded={isEntryExpanded}
                onToggle={() => setExpandedEntryId((prev) => (prev === entry.id ? null : entry.id))}
              />
              {isEntryExpanded && (
                <tr className={cn('border-b border-border/40', bgTint)}>
                  <td colSpan={COL_COUNT} className="p-0">
                    <LogEntryDetail entry={entry} onFilterTrace={onFilterTrace} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      {isExpanded && hiddenCount > 0 && (
        <tr className="border-b border-border/40">
          <td colSpan={COL_COUNT} className="px-3 py-2 text-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setVisibleCount((prev) => prev + MAX_VISIBLE_ENTRIES_PER_ITERATION)}
              aria-label={`Show ${Math.min(hiddenCount, MAX_VISIBLE_ENTRIES_PER_ITERATION)} more entries for iteration ${iteration}`}
            >
              Show {Math.min(hiddenCount, MAX_VISIBLE_ENTRIES_PER_ITERATION)} more
              {hiddenCount > MAX_VISIBLE_ENTRIES_PER_ITERATION
                ? ` of ${hiddenCount} remaining`
                : ''}
            </Button>
          </td>
        </tr>
      )}
    </>
  );
}
