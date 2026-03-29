import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import type { DashboardWorkflowLiveConsolePacket } from '../../../lib/api.js';
import { formatRelativeTimestamp } from '../../workflow-detail/workflow-detail-presentation.js';
import {
  buildWorkflowConsoleFilterDescriptors,
  describeWorkflowConsoleCoverage,
  describeWorkflowConsoleEmptyState,
  describeWorkflowConsoleScope,
  filterWorkflowConsoleItems,
  formatWorkflowActivitySourceLabel,
  getWorkflowConsoleLineText,
  getWorkflowConsoleEntryStyle,
  orderWorkflowConsoleItemsForDisplay,
  shouldPrefetchWorkflowConsoleHistory,
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
  const scrollMetricsRef = useRef({
    firstItemId: '',
    lastItemId: '',
    scrollHeight: 0,
    scrollTop: 0,
  });
  const backfillCursorRef = useRef<string | null>(null);
  const [isPinnedToLiveEdge, setIsPinnedToLiveEdge] = useState(true);
  const [hasQueuedUpdates, setHasQueuedUpdates] = useState(false);
  const [isLoadingOlderHistory, setIsLoadingOlderHistory] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<WorkflowConsoleFilter>('all');
  const filterDescriptors = useMemo(
    () => buildWorkflowConsoleFilterDescriptors(props.packet.items),
    [props.packet.items],
  );
  const visibleItems = useMemo(
    () => orderWorkflowConsoleItemsForDisplay(filterWorkflowConsoleItems(props.packet.items, selectedFilter)),
    [props.packet.items, selectedFilter],
  );
  const coverageMessage = useMemo(
    () => describeWorkflowConsoleCoverage(props.packet.items, props.packet.next_cursor, props.packet.total_count),
    [props.packet.items, props.packet.next_cursor, props.packet.total_count],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const previousMetrics = scrollMetricsRef.current;
    const firstItemId = visibleItems[0]?.item_id ?? '';
    const lastItemId = visibleItems[visibleItems.length - 1]?.item_id ?? '';
    const prependedHistory = firstItemId !== previousMetrics.firstItemId && lastItemId === previousMetrics.lastItemId;
    const appendedLiveUpdate = lastItemId !== previousMetrics.lastItemId && firstItemId === previousMetrics.firstItemId;

    if (visibleItems.length === 0) {
      scrollMetricsRef.current = {
        firstItemId,
        lastItemId,
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
      };
      return;
    }

    if (prependedHistory) {
      const scrollDelta = container.scrollHeight - previousMetrics.scrollHeight;
      container.scrollTop = previousMetrics.scrollTop + scrollDelta;
      setIsLoadingOlderHistory(false);
    } else if (!previousMetrics.lastItemId || (appendedLiveUpdate && isPinnedToLiveEdge)) {
      container.scrollTop = container.scrollHeight;
      setHasQueuedUpdates(false);
    } else if (appendedLiveUpdate) {
      setHasQueuedUpdates(true);
    }

    scrollMetricsRef.current = {
      firstItemId,
      lastItemId,
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
    };
  }, [isPinnedToLiveEdge, visibleItems]);

  useEffect(() => {
    if (backfillCursorRef.current !== props.packet.next_cursor) {
      backfillCursorRef.current = props.packet.next_cursor;
      setIsLoadingOlderHistory(false);
    }
  }, [props.packet.next_cursor]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <p className="text-sm font-semibold text-foreground">Live Console</p>
          <p className="text-sm text-muted-foreground">
            {describeWorkflowConsoleScope(scopeSubject, props.scopeLabel)}
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
                container.scrollTop = container.scrollHeight;
                setIsPinnedToLiveEdge(true);
                setHasQueuedUpdates(false);
              }}
            >
              Jump to latest
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
        className="max-h-[28rem] overflow-x-hidden overflow-y-auto border border-slate-800 bg-[#09111f] px-0 py-2 font-mono text-sm text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        onScroll={(event) => {
          const element = event.currentTarget;
          const nextPinned =
            element.scrollHeight - element.clientHeight - element.scrollTop <= LIVE_EDGE_THRESHOLD_PX;
          setIsPinnedToLiveEdge(nextPinned);
          if (nextPinned) {
            setHasQueuedUpdates(false);
          }
          scrollMetricsRef.current.scrollHeight = element.scrollHeight;
          scrollMetricsRef.current.scrollTop = element.scrollTop;
          if (
            shouldPrefetchWorkflowConsoleHistory({
              hasNextCursor: props.packet.next_cursor !== null,
              isLoadingOlderHistory,
              scrollTop: element.scrollTop,
            })
          ) {
            setIsLoadingOlderHistory(true);
            props.onLoadMore();
          }
        }}
      >
        <div className="grid gap-0">
          {visibleItems.length === 0 ? (
            <div className="px-4 py-5 text-slate-300">
              {describeWorkflowConsoleEmptyState(selectedFilter, props.scopeLabel)}
            </div>
          ) : (
            visibleItems.map((item) => (
              <LiveConsoleEntry key={item.item_id} item={item} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function LiveConsoleEntry(props: {
  item: DashboardWorkflowLiveConsolePacket['items'][number];
}): JSX.Element {
  const { item } = props;
  const sourceLabel = formatWorkflowActivitySourceLabel(item.source_label, item.source_kind);
  const entryStyle = getWorkflowConsoleEntryStyle(item.item_kind, item.source_kind);

  return (
    <article
      data-terminal-entry={entryStyle.dataKind}
      data-terminal-source={item.source_kind}
      className={`grid gap-1 px-4 py-2 font-mono leading-6 text-sm text-slate-100 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-3 ${entryStyle.entryClassName}`}
    >
      <p className="min-w-0 break-words text-slate-100">
        <span className={entryStyle.promptClassName}>&gt; </span>
        <span className={`font-semibold ${entryStyle.sourceClassName}`}>{sourceLabel}: </span>
        <span className="text-slate-100">{getWorkflowConsoleLineText(item)}</span>
      </p>
      <span className="pl-[1.35rem] text-left text-xs text-slate-500 sm:pl-0 sm:text-right">
        {formatRelativeTimestamp(item.created_at)}
      </span>
    </article>
  );
}
