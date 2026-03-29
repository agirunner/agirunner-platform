import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import type { DashboardWorkflowLiveConsolePacket } from '../../../lib/api.js';
import { formatRelativeTimestamp } from '../../workflow-detail/workflow-detail-presentation.js';
import {
  buildWorkflowConsoleFilterDescriptors,
  describeWorkflowConsoleCoverage,
  describeWorkflowConsoleEmptyState,
  filterWorkflowConsoleItems,
  formatWorkflowActivitySourceLabel,
  getWorkflowConsoleEntryStyle,
  normalizeWorkflowConsoleText,
  type WorkflowConsoleFilter,
} from './workflow-live-console.support.js';

const LIVE_EDGE_THRESHOLD_PX = 48;

export function WorkflowLiveConsole(props: {
  packet: DashboardWorkflowLiveConsolePacket;
  scopeLabel: string;
  scopeSubject?: 'workflow' | 'work item' | 'task';
  onLoadMore(): void;
}): JSX.Element {
  const scopeSubject = props.scopeSubject ?? 'workflow';
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isPinnedToLiveEdge, setIsPinnedToLiveEdge] = useState(true);
  const [hasQueuedUpdates, setHasQueuedUpdates] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<WorkflowConsoleFilter>('all');
  const filterDescriptors = useMemo(
    () => buildWorkflowConsoleFilterDescriptors(props.packet.items),
    [props.packet.items],
  );
  const visibleItems = useMemo(
    () => filterWorkflowConsoleItems(props.packet.items, selectedFilter),
    [props.packet.items, selectedFilter],
  );
  const coverageMessage = useMemo(
    () => describeWorkflowConsoleCoverage(props.packet.items, props.packet.next_cursor, props.packet.total_count),
    [props.packet.items, props.packet.next_cursor, props.packet.total_count],
  );
  const previousVisibleItemCount = useRef(visibleItems.length);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const itemCountIncreased = visibleItems.length > previousVisibleItemCount.current;
    previousVisibleItemCount.current = visibleItems.length;
    if (!itemCountIncreased) {
      return;
    }

    if (isPinnedToLiveEdge) {
      container.scrollTop = 0;
      setHasQueuedUpdates(false);
      return;
    }

    setHasQueuedUpdates(true);
  }, [isPinnedToLiveEdge, visibleItems.length]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <p className="text-sm font-semibold text-foreground">Live Console</p>
          <p className="text-sm text-muted-foreground">
            Turn updates and milestone briefs for {props.scopeLabel}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {scopeSubject !== 'workflow' ? <Badge variant="outline">{props.scopeLabel}</Badge> : null}
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

      <div className="flex flex-wrap gap-2">
        {filterDescriptors.map((descriptor) => (
          <Button
            key={descriptor.filter}
            type="button"
            size="sm"
            variant={selectedFilter === descriptor.filter ? 'secondary' : 'outline'}
            aria-pressed={selectedFilter === descriptor.filter}
            onClick={() => setSelectedFilter(descriptor.filter)}
          >
            <span>{descriptor.label}</span>
            <Badge variant={selectedFilter === descriptor.filter ? 'secondary' : 'outline'}>
              {descriptor.count}
            </Badge>
          </Button>
        ))}
      </div>
      {coverageMessage ? (
        <p className="text-xs text-muted-foreground">{coverageMessage}</p>
      ) : null}

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
          {visibleItems.length === 0 ? (
            <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-4 text-slate-300">
              {describeWorkflowConsoleEmptyState(selectedFilter, props.scopeLabel)}
            </div>
          ) : (
            visibleItems.map((item) => (
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
