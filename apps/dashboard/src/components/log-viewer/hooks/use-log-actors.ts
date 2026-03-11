import { useQuery } from '@tanstack/react-query';
import { dashboardApi, type LogActorRecord } from '../../../lib/api.js';

export function useLogActors() {
  return useQuery<{ data: LogActorRecord[] }>({
    queryKey: ['log-actors'],
    queryFn: () => dashboardApi.getLogActors(),
    staleTime: 60_000,
  });
}
