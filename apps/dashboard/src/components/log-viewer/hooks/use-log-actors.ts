import { useQuery } from '@tanstack/react-query';
import { dashboardApi, type LogActorRecord } from '../../../lib/api.js';

export function useLogActors(baseFilters: Record<string, string> = {}) {
  return useQuery<{ data: LogActorRecord[] }>({
    queryKey: ['log-actors', baseFilters],
    queryFn: () => dashboardApi.getLogActors(baseFilters),
    staleTime: 60_000,
  });
}
