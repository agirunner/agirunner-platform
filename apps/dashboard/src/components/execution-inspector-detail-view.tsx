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
              Loaded {props.loadedCount} operator activity packets
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
          {props.entries.map((entry) => {
            const context = summarizeLogContext(entry);
            const isSelected = props.selectedLogId === entry.id;
            const signals = readExecutionSignals(entry);
            return (
              <button
                key={entry.id}
                type="button"
                aria-pressed={isSelected}
                className={`w-full px-5 py-4 text-left transition-colors hover:bg-border/20 ${
                  isSelected ? 'bg-border/20' : ''
                }`}
                onClick={() => props.onSelect(entry.id)}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={levelVariant(entry.level)}>{entry.level}</Badge>
                      <Badge variant={statusVariant(entry.status)}>{entry.status}</Badge>
                      <span className="text-xs text-muted">
                        {new Date(entry.created_at).toLocaleString()}
                      </span>
                      {entry.is_orchestrator_task ? (
                        <Badge variant="outline">orchestrator</Badge>
                      ) : null}
                      {signals.map((signal) => (
                        <Badge key={signal} variant="outline">
                          {signal}
                        </Badge>
                      ))}
                    </div>
                    <div className="font-medium">{describeExecutionHeadline(entry)}</div>
                    <div className="text-sm text-muted">{describeExecutionSummary(entry)}</div>
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
                  <div className="flex shrink-0 flex-wrap gap-2 text-xs text-muted">
                    <span>{formatDuration(entry.duration_ms)}</span>
                    <span>diagnostic trace {shortId(entry.trace_id)}</span>
                    <span>diagnostic span {shortId(entry.span_id)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {props.hasMore ? (
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
