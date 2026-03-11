import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { dashboardApi, type LogQueryResponse } from '../../../lib/api.js';
import { useLogFilters } from './use-log-filters.js';

export function useLogQuery(
  cursor?: string | null,
  enabled = true,
  refetchIntervalMs?: number,
  perPage = 100,
) {
  const { toQueryParams } = useLogFilters();

  const params = toQueryParams();
  if (cursor) params.cursor = cursor;
  params.per_page = String(perPage);

  return useQuery<LogQueryResponse>({
    queryKey: ['logs', params],
    queryFn: () => dashboardApi.queryLogs(params),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    enabled,
    refetchInterval: refetchIntervalMs,
  });
}
