import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { dashboardApi } from '../../lib/api.js';
import type { WorkflowsPageState } from './workflows-page.support.js';
import { combineWorkflowRailPages, getNextWorkflowRailPageParam } from './workflows-rail-pagination.js';
import { buildWorkflowRailQueryKey } from './workflows-query.js';

const RAIL_PAGE_SIZE = 100;

type WorkflowRailQueryState = Pick<
  WorkflowsPageState,
  'mode' | 'search' | 'needsActionOnly' | 'lifecycleFilter' | 'playbookId' | 'updatedWithin'
>;

export function useWorkflowRailData(pageState: WorkflowRailQueryState) {
  const railQuery = useInfiniteQuery({
    queryKey: buildWorkflowRailQueryKey(pageState),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      dashboardApi.getWorkflowRail({
        mode: pageState.mode,
        page: pageParam,
        perPage: RAIL_PAGE_SIZE,
        needsActionOnly: pageState.needsActionOnly,
        lifecycleFilter: pageState.lifecycleFilter,
        search: pageState.search,
        playbookId: pageState.playbookId ?? undefined,
        updatedWithin: pageState.updatedWithin,
      }),
    getNextPageParam: getNextWorkflowRailPageParam,
  });
  const railPacket = useMemo(
    () => combineWorkflowRailPages(railQuery.data),
    [railQuery.data],
  );

  return { railPacket, railQuery };
}
