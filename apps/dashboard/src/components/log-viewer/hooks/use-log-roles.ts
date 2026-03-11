import { useQuery } from '@tanstack/react-query';
import { dashboardApi, type LogRoleRecord } from '../../../lib/api.js';

export function useLogRoles() {
  return useQuery<{ data: LogRoleRecord[] }>({
    queryKey: ['log-roles'],
    queryFn: () => dashboardApi.getLogRoles(),
    staleTime: 60_000,
  });
}
