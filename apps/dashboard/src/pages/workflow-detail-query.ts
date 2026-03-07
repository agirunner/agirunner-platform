import type { QueryClient } from '@tanstack/react-query';

export async function invalidateWorkflowQueries(
  queryClient: QueryClient,
  workflowId: string,
  projectId?: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['workflow', workflowId] }),
    queryClient.invalidateQueries({ queryKey: ['tasks', workflowId] }),
    queryClient.invalidateQueries({ queryKey: ['workflow-history', workflowId] }),
    queryClient.invalidateQueries({ queryKey: ['workflow-config', workflowId] }),
    queryClient.invalidateQueries({ queryKey: ['workflow-documents', workflowId] }),
    projectId ? queryClient.invalidateQueries({ queryKey: ['project', projectId] }) : Promise.resolve(),
    projectId
      ? queryClient.invalidateQueries({ queryKey: ['project-timeline', projectId] })
      : Promise.resolve(),
  ]);
}
