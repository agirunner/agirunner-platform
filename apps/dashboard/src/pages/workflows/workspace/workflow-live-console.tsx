import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import type { DashboardWorkflowLiveConsolePacket } from '../../../lib/api.js';
import { formatRelativeTimestamp } from '../../workflow-detail/workflow-detail-presentation.js';

const LIVE_EDGE_THRESHOLD_PX = 48;

export function WorkflowLiveConsole(props: {
  packet: DashboardWorkflowLiveConsolePacket;
  selectedWorkItemId: string | null;
  selectedTaskId: string | null;
  onLoadMore(): void;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isPinnedToLiveEdge, setIsPinnedToLiveEdge] = useState(true);
  const [hasQueuedUpdates, setHasQueuedUpdates] = useState(false);
  const previousItemCount = useRef(props.packet.items.length);

  const sortedItems = useMemo(
    () => [...props.packet.items].sort((left, right) => right.created_at.localeCompare(left.created_at)),
    [props.packet.items],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const itemCountIncreased = props.packet.items.length > previousItemCount.current;
    previousItemCount.current = props.packet.items.length;
    if (!itemCountIncreased) {
      return;
    }

    if (isPinnedToLiveEdge) {
      container.scrollTop = 0;
      setHasQueuedUpdates(false);
      return;
    }

    setHasQueuedUpdates(true);
  }, [isPinnedToLiveEdge, props.packet.items.length]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Live Console</p>
          <p className="text-sm text-muted-foreground">
            Turn updates and milestone briefs for the current workflow.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {props.selectedTaskId ? (
            <Badge variant="outline">Scoped to selected task</Badge>
          ) : props.selectedWorkItemId ? (
            <Badge variant="outline">Scoped to selected work item</Badge>
          ) : null}
          {hasQueuedUpdates ? (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const container = containerRef.current;
                if (!container) {
                  return;
                }
                container.scrollTop = 0;
                setIsPinnedToLiveEdge(true);
                setHasQueuedUpdates(false);
              }}
            >
              New updates
            </Button>
          ) : null}
        </div>
      </div>

      <div
        ref={containerRef}
        className="max-h-[28rem] overflow-y-auto rounded-2xl border border-slate-800 bg-[#09111f] p-3 font-mono text-sm text-slate-100 shadow-inner"
        onScroll={(event) => {
          const element = event.currentTarget;
          const nextPinned = element.scrollTop <= LIVE_EDGE_THRESHOLD_PX;
          setIsPinnedToLiveEdge(nextPinned);
          if (nextPinned) {
            setHasQueuedUpdates(false);
          }
        }}
      >
        <div className="grid gap-2">
          {sortedItems.length === 0 ? (
            <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-4 text-slate-300">
              No live headlines have been recorded for this workflow yet.
            </div>
          ) : (
            sortedItems.map((item) => (
              <LiveConsoleEntry key={item.item_id} item={item} />
            ))
          )}
        </div>
      </div>

      {props.packet.items.length > 0 ? (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="outline" onClick={props.onLoadMore}>
            Load older headlines
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function LiveConsoleEntry(props: {
  item: DashboardWorkflowLiveConsolePacket['items'][number];
}): JSX.Element {
  const { item } = props;
  const accentClass = item.item_kind === 'platform_notice'
    ? 'text-amber-300'
    : item.item_kind === 'milestone_brief'
      ? 'text-emerald-300'
      : 'text-emerald-300';
  const sourceClass = item.item_kind === 'platform_notice'
    ? 'text-amber-200'
    : item.item_kind === 'milestone_brief'
      ? 'text-emerald-200'
      : 'text-emerald-200';
  return (
    <article className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 font-mono leading-6 text-sm text-slate-100">
      <p className="min-w-0 break-words">
        <span className={accentClass}>&gt; </span>
        <span className={`font-semibold ${sourceClass}`}>{item.source_label}: </span>
        <span className="text-slate-100">{normalizeConsoleText(item.headline)}</span>
      </p>
      <span className="text-right text-xs text-slate-500">{formatRelativeTimestamp(item.created_at)}</span>
    </article>
  );
}

function normalizeConsoleText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
