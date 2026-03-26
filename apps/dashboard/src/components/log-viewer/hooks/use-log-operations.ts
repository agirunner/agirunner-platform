import { useQuery } from '@tanstack/react-query';
import { dashboardApi, type LogOperationValueRecord } from '../../../lib/api.js';

export function useLogOperations(
  category?: string,
  baseFilters: Record<string, string> = {},
  enabled = true,
) {
  const filters: Record<string, string> = { ...baseFilters };
  if (category) filters.category = category;

  return useQuery<{ data: LogOperationValueRecord[] }>({
    queryKey: ['log-operations', filters],
    queryFn: () => dashboardApi.getLogOperationValues(filters),
    staleTime: 300_000,
    enabled,
  });
}
