import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import type { DashboardWorkflowLiveConsolePacket } from '../../../lib/api.js';
import { cn } from '../../../lib/utils.js';
import { formatRelativeTimestamp } from '../../workflow-detail/workflow-detail-presentation.js';

const LIVE_EDGE_THRESHOLD_PX = 48;

export function WorkflowLiveConsole(props: {
  packet: DashboardWorkflowLiveConsolePacket;
  selectedWorkItemId: string | null;
  onLoadMore(): void;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isPinnedToLiveEdge, setIsPinnedToLiveEdge] = useState(true);
  const [hasQueuedUpdates, setHasQueuedUpdates] = useState(false);
  const previousItemCount = useRef(props.packet.items.length);

  const sortedItems = useMemo(
    () => [...props.packet.items].sort((left, right) => left.created_at.localeCompare(right.created_at)),
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
      container.scrollTop = container.scrollHeight;
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
            Streaming operator headlines and milestone briefs, logged historically for this workflow.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {props.selectedWorkItemId ? <Badge variant="outline">Scoped to selected work item</Badge> : null}
          {hasQueuedUpdates ? (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const container = containerRef.current;
                if (!container) {
                  return;
                }
                container.scrollTop = container.scrollHeight;
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
        className="max-h-[28rem] overflow-y-auto rounded-2xl border border-slate-800 bg-[#09111f] p-4 font-mono text-sm text-slate-100 shadow-inner"
        onScroll={(event) => {
          const element = event.currentTarget;
          const distanceFromBottom =
            element.scrollHeight - (element.scrollTop + element.clientHeight);
          const nextPinned = distanceFromBottom <= LIVE_EDGE_THRESHOLD_PX;
          setIsPinnedToLiveEdge(nextPinned);
          if (nextPinned) {
            setHasQueuedUpdates(false);
          }
        }}
      >
        <div className="grid gap-3">
          {sortedItems.length === 0 ? (
            <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-4 text-slate-300">
              No live headlines have been recorded for this workflow yet.
            </div>
          ) : (
            sortedItems.map((item) => (
              <article
                key={item.item_id}
                className={cn(
                  'grid gap-2 rounded-xl border p-3',
                  item.item_kind === 'platform_notice'
                    ? 'border-amber-500/30 bg-amber-500/10'
                    : item.item_kind === 'milestone_brief'
                      ? 'border-emerald-500/20 bg-emerald-500/10'
                      : 'border-slate-700 bg-slate-950/50',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="border-current text-[10px] uppercase tracking-[0.2em]">
                    {humanizeToken(item.item_kind)}
                  </Badge>
                  <span className="text-xs text-slate-400">
                    {formatRelativeTimestamp(item.created_at)}
                  </span>
                </div>
                <p className="text-sm font-semibold text-slate-50">{item.headline}</p>
                <p className="text-sm leading-6 text-slate-300">{item.summary}</p>
              </article>
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

function humanizeToken(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
