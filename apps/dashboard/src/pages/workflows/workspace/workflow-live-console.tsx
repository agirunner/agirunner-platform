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
const TERMINAL_SURFACE_CLASS_NAME =
  'rounded-xl border border-slate-900/90 bg-[#08111f] text-slate-100 shadow-[0_18px_40px_rgba(2,6,23,0.28)]';
const TERMINAL_TOOLBAR_CLASS_NAME = 'border-b border-slate-800/80 bg-slate-950/80 px-4 py-3';
const TERMINAL_FILTER_BASE_CLASS_NAME =
  'inline-flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-1.5 font-mono text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70';
const TERMINAL_FILTER_ACTIVE_CLASS_NAME =
  'border-slate-500/80 bg-slate-100/12 text-slate-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]';
const TERMINAL_FILTER_INACTIVE_CLASS_NAME =
  'border-slate-800/90 bg-transparent text-slate-400 hover:border-slate-600/80 hover:text-slate-100';
const TERMINAL_FILTER_COUNT_CLASS_NAME =
  'rounded-sm border border-slate-600/80 bg-slate-900/80 px-1.5 py-0 font-mono text-[11px] leading-5 text-slate-200';

export function WorkflowLiveConsole(props: {
  packet: DashboardWorkflowLiveConsolePacket;
  scopeLabel: string;
  scopeSubject?: 'workflow' | 'work item' | 'task';
  onLoadMore(): void;
}): JSX.Element {
  const scopeSubject = props.scopeSubject ?? 'workflow';
  const containerRef = useRef<HTMLDivElement | null>(null);
  const visibleItemsRef = useRef<DashboardWorkflowLiveConsolePacket['items']>([]);
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
    () =>
      orderWorkflowConsoleItemsForDisplay(
        filterWorkflowConsoleItems(props.packet.items, selectedFilter),
      ),
    [props.packet.items, selectedFilter],
  );
  const coverageMessage = useMemo(
    () =>
      describeWorkflowConsoleCoverage(
        props.packet.items,
        props.packet.next_cursor,
        props.packet.total_count,
      ),
    [props.packet.items, props.packet.next_cursor, props.packet.total_count],
  );

  useEffect(() => {
    visibleItemsRef.current = visibleItems;
  }, [visibleItems]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
    setIsPinnedToLiveEdge(true);
    setHasQueuedUpdates(false);
    setIsLoadingOlderHistory(false);
    const currentVisibleItems = visibleItemsRef.current;
    scrollMetricsRef.current = {
      firstItemId: currentVisibleItems[0]?.item_id ?? '',
      lastItemId: currentVisibleItems[currentVisibleItems.length - 1]?.item_id ?? '',
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
    };
  }, [selectedFilter]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const previousMetrics = scrollMetricsRef.current;
    const firstItemId = visibleItems[0]?.item_id ?? '';
    const lastItemId = visibleItems[visibleItems.length - 1]?.item_id ?? '';
    const prependedHistory =
      firstItemId !== previousMetrics.firstItemId && lastItemId === previousMetrics.lastItemId;
    const appendedLiveUpdate =
      lastItemId !== previousMetrics.lastItemId && firstItemId === previousMetrics.firstItemId;

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

      <div data-live-console-surface="terminal" className={TERMINAL_SURFACE_CLASS_NAME}>
        <div className={TERMINAL_TOOLBAR_CLASS_NAME}>
          <div className="flex flex-wrap gap-2">
            {filterDescriptors.map((descriptor) => {
              const isSelected = selectedFilter === descriptor.filter;
              return (
                <button
                  key={descriptor.filter}
                  type="button"
                  data-live-console-filter={descriptor.filter}
                  data-state={isSelected ? 'active' : 'inactive'}
                  className={`${TERMINAL_FILTER_BASE_CLASS_NAME} ${isSelected ? TERMINAL_FILTER_ACTIVE_CLASS_NAME : TERMINAL_FILTER_INACTIVE_CLASS_NAME}`}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedFilter(descriptor.filter)}
                >
                  <span className="truncate">{descriptor.label}</span>
                  <span
                    data-live-console-filter-count={String(descriptor.count)}
                    className={TERMINAL_FILTER_COUNT_CLASS_NAME}
                  >
                    {descriptor.count}
                  </span>
                </button>
              );
            })}
          </div>
          {coverageMessage ? (
            <p className="mt-2 text-xs text-slate-400">{coverageMessage}</p>
          ) : null}
        </div>

        <div
          ref={containerRef}
          className="max-h-[28rem] overflow-x-hidden overflow-y-auto bg-transparent px-0 py-2 font-mono text-sm text-slate-100"
          onScroll={(event) => {
            const element = event.currentTarget;
            const nextPinned =
              element.scrollHeight - element.clientHeight - element.scrollTop <=
              LIVE_EDGE_THRESHOLD_PX;
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
          <div className="grid gap-px">
            {visibleItems.length === 0 ? (
              <div className="px-4 py-5 text-slate-300">
                {describeWorkflowConsoleEmptyState(selectedFilter, props.scopeLabel)}
              </div>
            ) : (
              visibleItems.map((item) => <LiveConsoleEntry key={item.item_id} item={item} />)
            )}
          </div>
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
