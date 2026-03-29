import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import type { DashboardWorkflowLiveConsolePacket } from '../../../lib/api.js';
import {
  buildWorkflowConsoleFilterDescriptors,
  describeWorkflowConsoleCoverage,
  describeWorkflowConsoleEmptyState,
  describeWorkflowConsoleScope,
  filterWorkflowConsoleItems,
  getWorkflowConsoleVisibleItems,
  getWorkflowConsoleFollowBehavior,
  orderWorkflowConsoleItemsForDisplay,
  shouldPrefetchWorkflowConsoleHistory,
  type WorkflowConsoleFilter,
  type WorkflowConsoleFollowMode,
} from './workflow-live-console.support.js';
import { WorkflowLiveConsoleEntry } from './workflow-live-console-entry.js';

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
  const [followMode, setFollowMode] = useState<WorkflowConsoleFollowMode>('live');
  const [hasQueuedUpdates, setHasQueuedUpdates] = useState(false);
  const [isLoadingOlderHistory, setIsLoadingOlderHistory] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<WorkflowConsoleFilter>('all');
  const consoleItems = useMemo(() => getWorkflowConsoleVisibleItems(props.packet.items), [props.packet.items]);
  const filterDescriptors = useMemo(
    () => buildWorkflowConsoleFilterDescriptors(consoleItems),
    [consoleItems],
  );
  const visibleItems = useMemo(
    () => orderWorkflowConsoleItemsForDisplay(filterWorkflowConsoleItems(consoleItems, selectedFilter)),
    [consoleItems, selectedFilter],
  );
  const coverageMessage = useMemo(
    () =>
      describeWorkflowConsoleCoverage(
        consoleItems,
        props.packet.next_cursor,
        props.packet.total_count,
      ),
    [consoleItems, props.packet.next_cursor, props.packet.total_count],
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

    const followBehavior = getWorkflowConsoleFollowBehavior({
      followMode,
      prependedHistory,
      appendedLiveUpdate,
      hasPreviousItems: previousMetrics.lastItemId.length > 0,
    });

    if (prependedHistory) {
      const scrollDelta = container.scrollHeight - previousMetrics.scrollHeight;
      container.scrollTop = previousMetrics.scrollTop + scrollDelta;
      setIsLoadingOlderHistory(false);
    } else if (followBehavior.shouldScrollToBottom) {
      container.scrollTop = container.scrollHeight;
      setHasQueuedUpdates(false);
    } else if (followBehavior.shouldQueueUpdates) {
      setHasQueuedUpdates(true);
    }

    scrollMetricsRef.current = {
      firstItemId,
      lastItemId,
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
    };
  }, [followMode, visibleItems]);

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
        </div>
      </div>

      <div
        data-live-console-surface="terminal"
        data-live-console-follow-mode={followMode}
        className={TERMINAL_SURFACE_CLASS_NAME}
      >
        <div className={TERMINAL_TOOLBAR_CLASS_NAME}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={followMode === 'live' ? 'secondary' : 'ghost'}
                data-live-console-follow-control="live"
                aria-pressed={followMode === 'live'}
                className="h-7 border border-slate-700/80 bg-slate-900/80 font-mono text-[11px] uppercase tracking-[0.16em] text-slate-100 hover:bg-slate-800/80 hover:text-slate-50"
                onClick={() => {
                  const container = containerRef.current;
                  if (!container) {
                    return;
                  }
                  container.scrollTop = container.scrollHeight;
                  setFollowMode('live');
                  setHasQueuedUpdates(false);
                }}
              >
                Live
              </Button>
              <Button
                type="button"
                size="sm"
                variant={followMode === 'paused' ? 'secondary' : 'ghost'}
                data-live-console-follow-control="pause"
                aria-pressed={followMode === 'paused'}
                className="h-7 border border-slate-700/80 bg-slate-900/80 font-mono text-[11px] uppercase tracking-[0.16em] text-slate-100 hover:bg-slate-800/80 hover:text-slate-50"
                onClick={() => setFollowMode('paused')}
              >
                Pause
              </Button>
            </div>
            {hasQueuedUpdates ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 border border-slate-700/80 bg-slate-900/70 font-mono text-[11px] uppercase tracking-[0.16em] text-slate-200 hover:bg-slate-800/80 hover:text-slate-50"
                onClick={() => {
                  const container = containerRef.current;
                  if (!container) {
                    return;
                  }
                  container.scrollTop = container.scrollHeight;
                  setHasQueuedUpdates(false);
                }}
              >
                Jump to latest
              </Button>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
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
            const isNearLiveEdge =
              element.scrollHeight - element.clientHeight - element.scrollTop <=
              LIVE_EDGE_THRESHOLD_PX;
            if (isNearLiveEdge) {
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
              visibleItems.map((item) => <WorkflowLiveConsoleEntry key={item.item_id} item={item} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
