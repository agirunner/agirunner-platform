import { useQuery } from '@tanstack/react-query';
import { dashboardApi, type LogActorKindValueRecord } from '../../../lib/api.js';

export function useLogActors(baseFilters: Record<string, string> = {}, enabled = true) {
  return useQuery<{ data: LogActorKindValueRecord[] }>({
    queryKey: ['log-actors', baseFilters],
    queryFn: () => dashboardApi.getLogActorKindValues(baseFilters),
    staleTime: 300_000,
    enabled,
  });
}
