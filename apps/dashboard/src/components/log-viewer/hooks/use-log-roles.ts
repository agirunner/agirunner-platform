import { useQuery } from '@tanstack/react-query';
import { dashboardApi, type LogRoleValueRecord } from '../../../lib/api.js';

export function useLogRoles(baseFilters: Record<string, string> = {}, enabled = true) {
  return useQuery<{ data: LogRoleValueRecord[] }>({
    queryKey: ['log-roles', baseFilters],
    queryFn: () => dashboardApi.getLogRoleValues(baseFilters),
    staleTime: 300_000,
    enabled,
  });
}
