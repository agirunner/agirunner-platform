import { useState } from 'react';

import type { LogEntry } from '../lib/api.js';
import { Badge } from './ui/badge.js';
import { Card, CardContent } from './ui/card.js';
import { Button } from './ui/button.js';
import {
  describeExecutionHeadline,
  describeExecutionNextAction,
  describeExecutionSummary,
  formatDuration,
  readExecutionSignals,
  summarizeLogContext,
  levelVariant,
  shortId,
  statusVariant,
} from './execution-inspector-support.js';

const INITIAL_VISIBLE_COUNT = 20;
const VISIBLE_INCREMENT = 20;

interface ExecutionInspectorDetailViewProps {
  entries: LogEntry[];
  selectedLogId: number | null;
  isLoading: boolean;
  hasMore: boolean;
  loadedCount: number;
  isSelectedOutsideSegment?: boolean;
  onSelect(logId: number): void;
  onLoadMore(): void;
  onClearSelection?(): void;
}

export function ExecutionInspectorDetailView(
  props: ExecutionInspectorDetailViewProps,
): JSX.Element {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const visibleEntries = props.entries.slice(0, visibleCount);
  const hasHiddenEntries = props.entries.length > visibleCount;

  return (
    <Card>
      <CardContent className="p-0">
        {props.isLoading ? <p className="p-5 text-sm text-muted">Loading execution entries…</p> : null}
        {!props.isLoading && props.entries.length === 0 ? (
          <p className="p-5 text-sm text-muted">No execution entries match the current filters.</p>
        ) : null}
        {!props.isLoading && props.entries.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/20 px-5 py-3 text-xs text-muted">
            <span>
              Showing {visibleEntries.length} of {props.loadedCount} operator activity packets
              {props.hasMore ? ' in the current segment' : ''}
            </span>
            {props.isSelectedOutsideSegment ? (
              <div className="flex items-center gap-3">
                <span>Selected packet is pinned outside the current segment.</span>
                {props.onClearSelection ? (
                  <Button variant="ghost" size="sm" onClick={props.onClearSelection}>
                    Return to segment
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="divide-y divide-border">
          {visibleEntries.map((entry) => {
            const context = summarizeLogContext(entry);
            const isSelected = props.selectedLogId === entry.id;
            const signals = readExecutionSignals(entry);
            const recordedAt = describeRecordedAt(entry.created_at);
            return (
              <button
                key={entry.id}
                type="button"
                aria-pressed={isSelected}
                className={`w-full overflow-hidden px-5 py-4 text-left transition-colors hover:bg-border/20 ${
                  isSelected ? 'bg-border/20' : ''
                }`}
                onClick={() => props.onSelect(entry.id)}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={levelVariant(entry.level)}>{entry.level}</Badge>
                      <Badge variant={statusVariant(entry.status)}>{entry.status}</Badge>
                      <time
                        className="text-xs text-muted"
                        dateTime={entry.created_at}
                        title={recordedAt.absolute}
                      >
                        {recordedAt.relative}
                      </time>
                      {entry.is_orchestrator_task ? (
                        <Badge variant="outline">orchestrator</Badge>
                      ) : null}
                      {signals.map((signal) => (
                        <Badge key={signal} variant="outline">
                          {signal}
                        </Badge>
                      ))}
                    </div>
                    <div className="break-words font-medium">{describeExecutionHeadline(entry)}</div>
                    <div className="break-words text-sm text-muted">{describeExecutionSummary(entry)}</div>
                    {context.length > 0 ? (
                      <div className="flex flex-wrap gap-2 text-xs text-muted">
                        {context.map((item) => (
                          <span key={item}>{item}</span>
                        ))}
                      </div>
                    ) : null}
                    <div className="text-xs text-muted">{describeExecutionNextAction(entry)}</div>
                    {entry.error?.message ? (
                      <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                        {entry.error.message}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 break-all text-xs text-muted">
                    <span>{formatDuration(entry.duration_ms)}</span>
                    <span>trace {shortId(entry.trace_id)}</span>
                    <span>span {shortId(entry.span_id)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {hasHiddenEntries ? (
          <div className="border-t border-border p-4 text-center">
            <Button
              variant="outline"
              onClick={() => setVisibleCount((current) => current + VISIBLE_INCREMENT)}
            >
              Show {Math.min(VISIBLE_INCREMENT, props.entries.length - visibleCount)} more packets
            </Button>
            <p className="mt-1 text-xs text-muted">
              {props.entries.length - visibleCount} packets hidden for performance
            </p>
          </div>
        ) : null}
        {!hasHiddenEntries && props.hasMore ? (
          <div className="border-t border-border p-4">
            <Button variant="outline" onClick={props.onLoadMore}>
              Load Older Activity
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function describeRecordedAt(createdAt: string): {
  relative: string;
  absolute: string;
} {
  const timestamp = new Date(createdAt).getTime();
  const absolute = new Date(createdAt).toLocaleString();
  if (!Number.isFinite(timestamp)) {
    return { relative: 'Unknown time', absolute };
  }

  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (elapsedMinutes < 1) {
    return { relative: 'Just now', absolute };
  }
  if (elapsedMinutes < 60) {
    return { relative: `${elapsedMinutes}m ago`, absolute };
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return { relative: `${elapsedHours}h ago`, absolute };
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  return { relative: `${elapsedDays}d ago`, absolute };
}
