import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import type { DashboardWorkflowLiveConsolePacket } from '../../../lib/api.js';
import {
  buildWorkflowConsoleFilterDescriptorsWithCounts,
  describeWorkflowConsoleEmptyState,
  describeWorkflowConsoleScope,
  filterWorkflowConsoleItems,
  getWorkflowConsoleScrollBehavior,
  getWorkflowConsoleVisibleItems,
  getWorkflowConsoleFollowBehavior,
  isWorkflowConsoleAtLiveEdge,
  orderWorkflowConsoleItemsForDisplay,
  resolveWorkflowConsoleWindowChange,
  resolveWorkflowConsoleFilterCounts,
  shouldPrefetchWorkflowConsoleHistory,
  type WorkflowConsoleFilter,
  type WorkflowConsoleFollowMode,
} from './workflow-live-console.support.js';
import { WorkflowLiveConsoleEntry } from './workflow-live-console-entry.js';
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
const TERMINAL_FOLLOW_STATUS_BASE_CLASS_NAME =
  'inline-flex items-center gap-2 rounded-md border border-slate-800/90 bg-slate-950/70 px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-slate-300';

export function WorkflowLiveConsole(props: {
  packet: DashboardWorkflowLiveConsolePacket;
  scopeLabel: string;
  scopeSubject?: 'workflow' | 'work item' | 'task';
  isScopeLoading?: boolean;
  onLoadMore(): void;
}): JSX.Element {
  const scopeSubject = props.scopeSubject ?? 'workflow';
  const containerRef = useRef<HTMLDivElement | null>(null);
  const visibleItemsRef = useRef<DashboardWorkflowLiveConsolePacket['items']>([]);
  const scrollMetricsRef = useRef({
    visibleItemIds: [] as string[],
    scrollHeight: 0,
    scrollTop: 0,
  });
  const isAtLiveEdgeRef = useRef(true);
  const backfillCursorRef = useRef<string | null>(null);
  const [followMode, setFollowMode] = useState<WorkflowConsoleFollowMode>('live');
  const [isLoadingOlderHistory, setIsLoadingOlderHistory] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<WorkflowConsoleFilter>('all');
  const consoleItems = useMemo(() => getWorkflowConsoleVisibleItems(props.packet.items), [props.packet.items]);
  const filterCounts = useMemo(
    () => resolveWorkflowConsoleFilterCounts(props.packet, props.packet.items),
    [props.packet],
  );
  const filterDescriptors = useMemo(
    () => buildWorkflowConsoleFilterDescriptorsWithCounts(consoleItems, filterCounts),
    [consoleItems, filterCounts],
  );
  const visibleItems = useMemo(
    () => orderWorkflowConsoleItemsForDisplay(filterWorkflowConsoleItems(consoleItems, selectedFilter)),
    [consoleItems, selectedFilter],
  );
  const requestOlderHistory = () => {
    if (isLoadingOlderHistory || props.packet.next_cursor === null) {
      return;
    }
    setIsLoadingOlderHistory(true);
    props.onLoadMore();
  };

  useEffect(() => {
    visibleItemsRef.current = visibleItems;
  }, [visibleItems]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
    setIsLoadingOlderHistory(false);
    const currentVisibleItems = visibleItemsRef.current;
    scrollMetricsRef.current = {
      visibleItemIds: currentVisibleItems.map((item) => item.item_id),
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
    };
    isAtLiveEdgeRef.current = true;
  }, [selectedFilter]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const previousMetrics = scrollMetricsRef.current;
    const currentItemIds = visibleItems.map((item) => item.item_id);
    const { prependedHistory, appendedLiveUpdate } = resolveWorkflowConsoleWindowChange({
      previousItemIds: previousMetrics.visibleItemIds,
      currentItemIds,
    });

    if (visibleItems.length === 0) {
      scrollMetricsRef.current = {
        visibleItemIds: currentItemIds,
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
      };
      return;
    }

    const followBehavior = getWorkflowConsoleFollowBehavior({
      followMode,
      isAtLiveEdge: isAtLiveEdgeRef.current,
      prependedHistory,
      appendedLiveUpdate,
      hasPreviousItems: previousMetrics.visibleItemIds.length > 0,
    });

    if (prependedHistory) {
      const scrollDelta = container.scrollHeight - previousMetrics.scrollHeight;
      container.scrollTop = previousMetrics.scrollTop + scrollDelta;
      setIsLoadingOlderHistory(false);
    } else if (followBehavior.shouldScrollToBottom) {
      container.scrollTop = container.scrollHeight;
    }

    scrollMetricsRef.current = {
      visibleItemIds: currentItemIds,
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
    };
    isAtLiveEdgeRef.current = isWorkflowConsoleAtLiveEdge({
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      scrollTop: container.scrollTop,
    });
  }, [followMode, visibleItems]);

  useEffect(() => {
    if (backfillCursorRef.current !== props.packet.next_cursor) {
      backfillCursorRef.current = props.packet.next_cursor;
      setIsLoadingOlderHistory(false);
    }
  }, [props.packet.next_cursor]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const shouldPreloadHistory =
      container.scrollHeight <= container.clientHeight ||
      shouldPrefetchWorkflowConsoleHistory({
        hasNextCursor: props.packet.next_cursor !== null,
        isLoadingOlderHistory,
        scrollTop: container.scrollTop,
      });

    if (shouldPreloadHistory) {
      requestOlderHistory();
    }
  }, [isLoadingOlderHistory, props.packet.next_cursor, visibleItems.length]);

  if (props.isScopeLoading) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
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
          data-live-console-loading="true"
          className={`${TERMINAL_SURFACE_CLASS_NAME} flex min-h-0 flex-1 flex-col overflow-hidden`}
        >
          <div className={TERMINAL_TOOLBAR_CLASS_NAME}>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-400">
              Refreshing scope
            </p>
          </div>
          <div className="px-4 py-5 font-mono text-sm text-slate-300">
            {`Loading live console for ${props.scopeLabel}.`}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
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
        className={`${TERMINAL_SURFACE_CLASS_NAME} flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden`}
      >
        <div className={TERMINAL_TOOLBAR_CLASS_NAME}>
          <div
            data-live-console-control-row="terminal-controls"
            className="flex min-w-0 items-center justify-between gap-3"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1 md:pb-0">
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
            <div className="flex shrink-0 items-center justify-end gap-1.5">
              <span
                data-live-console-follow-status={followMode}
                className={TERMINAL_FOLLOW_STATUS_BASE_CLASS_NAME}
              >
                <span
                  aria-hidden="true"
                  className={`inline-block size-2 rounded-full ${followMode === 'live' ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.65)]' : 'bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.45)]'}`}
                />
                {followMode === 'live' ? 'Following live' : 'Paused'}
              </span>
              <Button
                type="button"
                size="sm"
                variant={followMode === 'live' ? 'secondary' : 'ghost'}
                data-live-console-follow-control="live"
                data-state={followMode === 'live' ? 'active' : 'inactive'}
                aria-pressed={followMode === 'live'}
                title="Follow the latest terminal output"
                className="h-7 border border-slate-700/80 bg-slate-900/80 font-mono text-[11px] uppercase tracking-[0.16em] text-slate-100 hover:bg-slate-800/80 hover:text-slate-50"
                onClick={() => {
                  const container = containerRef.current;
                  if (!container) {
                    return;
                  }
                  container.scrollTop = container.scrollHeight;
                  setFollowMode('live');
                  isAtLiveEdgeRef.current = true;
                }}
              >
                Live
              </Button>
              <Button
                type="button"
                size="sm"
                variant={followMode === 'paused' ? 'secondary' : 'ghost'}
                data-live-console-follow-control="pause"
                data-state={followMode === 'paused' ? 'active' : 'inactive'}
                aria-pressed={followMode === 'paused'}
                title="Pause terminal follow mode"
                className="h-7 border border-slate-700/80 bg-slate-900/80 font-mono text-[11px] uppercase tracking-[0.16em] text-slate-100 hover:bg-slate-800/80 hover:text-slate-50"
                onClick={() => setFollowMode('paused')}
              >
                Pause
              </Button>
            </div>
          </div>
        </div>

        <div
          ref={containerRef}
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-transparent px-0 py-2 font-mono text-sm text-slate-100"
          onScroll={(event) => {
            const element = event.currentTarget;
            const scrollBehavior = getWorkflowConsoleScrollBehavior({
              followMode,
              hasNextCursor: props.packet.next_cursor !== null,
              isLoadingOlderHistory,
              scrollTop: element.scrollTop,
              scrollHeight: element.scrollHeight,
              clientHeight: element.clientHeight,
            });
            if (scrollBehavior.shouldSnapToLiveEdge) {
              element.scrollTop = element.scrollHeight;
            }
            isAtLiveEdgeRef.current = scrollBehavior.isAtLiveEdge;
            scrollMetricsRef.current.scrollHeight = element.scrollHeight;
            scrollMetricsRef.current.scrollTop = element.scrollTop;
            if (scrollBehavior.shouldPrefetchHistory) {
              requestOlderHistory();
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

        <div
          data-live-console-shell-cursor={followMode}
          className="border-t border-slate-900/90 bg-slate-950/70 px-4 py-2"
        >
          <div className="flex min-w-0 items-center gap-2 font-mono text-xs text-slate-300">
            <span className="text-sky-300">&gt;</span>
            <span className="truncate">
              {followMode === 'live' ? 'Awaiting more output' : 'Stream paused'}
            </span>
            <span
              aria-hidden="true"
              className={`inline-block h-3 w-2 rounded-[2px] ${followMode === 'live' ? 'animate-pulse bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]' : 'bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.4)]'}`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
