import { useQuery } from '@tanstack/react-query';
import { dashboardApi, type LogStatsResponse } from '../../../lib/api.js';
import { useLogFilters } from './use-log-filters.js';

export function useLogStats(refetchIntervalMs?: number) {
  const { toQueryParams } = useLogFilters();
  const params = toQueryParams();
  params.group_by = 'category';

  return useQuery<LogStatsResponse>({
    queryKey: ['log-stats', params],
    queryFn: () => dashboardApi.getLogStats(params),
    staleTime: 30_000,
    refetchInterval: refetchIntervalMs,
  });
}
