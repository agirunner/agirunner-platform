import { useEffect, useRef, useState } from 'react';

import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import type { DashboardWorkflowLiveConsolePacket } from '../../../lib/api.js';
import { formatRelativeTimestamp } from '../../workflow-detail/workflow-detail-presentation.js';
import {
  formatWorkflowActivitySourceLabel,
  getWorkflowConsoleEntryStyle,
  normalizeWorkflowConsoleText,
} from './workflow-live-console.support.js';

const LIVE_EDGE_THRESHOLD_PX = 48;

export function WorkflowLiveConsole(props: {
  packet: DashboardWorkflowLiveConsolePacket;
  selectedWorkItemId: string | null;
  selectedTaskId: string | null;
  scopeSubject?: 'workflow' | 'work item' | 'task';
  onLoadMore(): void;
}): JSX.Element {
  const scopeSubject = props.scopeSubject ?? 'workflow';
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isPinnedToLiveEdge, setIsPinnedToLiveEdge] = useState(true);
  const [hasQueuedUpdates, setHasQueuedUpdates] = useState(false);
  const previousItemCount = useRef(props.packet.items.length);

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
            Turn updates and milestone briefs for this {scopeSubject}.
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
        className="max-h-[28rem] overflow-x-hidden overflow-y-auto rounded-2xl border border-slate-800 bg-[#09111f] p-3 font-mono text-sm text-slate-100 shadow-inner"
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
          {props.packet.items.length === 0 ? (
            <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-4 text-slate-300">
              No live headlines have been recorded for this {scopeSubject} yet.
            </div>
          ) : (
            props.packet.items.map((item) => (
              <LiveConsoleEntry key={item.item_id} item={item} />
            ))
          )}
        </div>
      </div>

      {props.packet.next_cursor ? (
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
  const sourceLabel = formatWorkflowActivitySourceLabel(item.source_label, item.source_kind);
  const entryStyle = getWorkflowConsoleEntryStyle(item.item_kind);

  return (
    <article
      data-terminal-entry={entryStyle.dataKind}
      className={`grid gap-1 border-l-2 px-3 py-2 font-mono leading-6 text-sm text-slate-100 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-3 ${entryStyle.entryClassName}`}
    >
      <p className="min-w-0 break-words text-slate-100">
        <span className={entryStyle.promptClassName}>&gt; </span>
        <span className={`font-semibold ${entryStyle.sourceClassName}`}>{sourceLabel}: </span>
        <span className="text-slate-100">{normalizeWorkflowConsoleText(item.headline)}</span>
      </p>
      <span className="pl-[1.35rem] text-left text-xs text-slate-500 sm:pl-0 sm:text-right">
        {formatRelativeTimestamp(item.created_at)}
      </span>
    </article>
  );
}
