import { useQuery } from '@tanstack/react-query';
import { dashboardApi, type LogOperationRecord } from '../../../lib/api.js';

export function useLogOperations(category?: string, baseFilters: Record<string, string> = {}) {
  const filters: Record<string, string> = { ...baseFilters };
  if (category) filters.category = category;

  return useQuery<{ data: LogOperationRecord[] }>({
    queryKey: ['log-operations', filters],
    queryFn: () => dashboardApi.getLogOperations(filters),
    staleTime: 60_000,
  });
}
