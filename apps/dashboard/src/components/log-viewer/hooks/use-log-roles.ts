import { useQuery } from '@tanstack/react-query';
import { dashboardApi, type LogRoleRecord } from '../../../lib/api.js';

export function useLogRoles(baseFilters: Record<string, string> = {}, enabled = true) {
  return useQuery<{ data: LogRoleRecord[] }>({
    queryKey: ['log-roles', baseFilters],
    queryFn: () => dashboardApi.getLogRoles(baseFilters),
    staleTime: 60_000,
    enabled,
  });
}
