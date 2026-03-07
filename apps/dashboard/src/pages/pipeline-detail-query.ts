import type { QueryClient } from '@tanstack/react-query';

export async function invalidatePipelineQueries(
  queryClient: QueryClient,
  pipelineId: string,
  projectId?: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['pipeline', pipelineId] }),
    queryClient.invalidateQueries({ queryKey: ['tasks', pipelineId] }),
    queryClient.invalidateQueries({ queryKey: ['pipeline-history', pipelineId] }),
    queryClient.invalidateQueries({ queryKey: ['pipeline-config', pipelineId] }),
    queryClient.invalidateQueries({ queryKey: ['pipeline-documents', pipelineId] }),
    projectId ? queryClient.invalidateQueries({ queryKey: ['project', projectId] }) : Promise.resolve(),
    projectId
      ? queryClient.invalidateQueries({ queryKey: ['project-timeline', projectId] })
      : Promise.resolve(),
  ]);
}
