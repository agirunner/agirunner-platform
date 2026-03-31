import { useQuery } from '@tanstack/react-query';

import { dashboardApi, type DashboardPlaybookRecord } from '../../lib/api.js';

export function readWorkflowsRailPlaybooks(
  response: { data: DashboardPlaybookRecord[] } | null | undefined,
): DashboardPlaybookRecord[] {
  return response?.data ?? [];
}

export function useWorkflowsRailPlaybooks(): DashboardPlaybookRecord[] {
  const playbooksQuery = useQuery({
    queryKey: ['playbooks', 'workflows-rail'],
    queryFn: () => dashboardApi.listPlaybooks(),
    staleTime: 30_000,
  });

  return readWorkflowsRailPlaybooks(playbooksQuery.data);
}
