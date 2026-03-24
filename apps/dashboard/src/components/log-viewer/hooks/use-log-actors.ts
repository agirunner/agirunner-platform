import { useQuery } from '@tanstack/react-query';
import { dashboardApi, type LogActorRecord } from '../../../lib/api.js';

export function useLogActors(baseFilters: Record<string, string> = {}, enabled = true) {
  return useQuery<{ data: LogActorRecord[] }>({
    queryKey: ['log-actors', baseFilters],
    queryFn: () => dashboardApi.getLogActors(baseFilters),
    staleTime: 60_000,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    enabled,
  });
}
