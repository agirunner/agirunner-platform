import type { QueryClient } from '@tanstack/react-query';

export async function invalidateWorkflowQueries(
  queryClient: QueryClient,
  workflowId: string,
  workspaceId?: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['workflow', workflowId] }),
    queryClient.invalidateQueries({ queryKey: ['tasks', workflowId] }),
    queryClient.invalidateQueries({ queryKey: ['workflow-board', workflowId] }),
    queryClient.invalidateQueries({ queryKey: ['workflow-stages', workflowId] }),
    queryClient.invalidateQueries({ queryKey: ['workflow-activations', workflowId] }),
    queryClient.invalidateQueries({ queryKey: ['workflow-budget', workflowId] }),
    queryClient.invalidateQueries({ queryKey: ['workflow-gates', workflowId] }),
    queryClient.invalidateQueries({ queryKey: ['workflow-model-overrides', workflowId] }),
    queryClient.invalidateQueries({ queryKey: ['workflow-resolved-models', workflowId] }),
    queryClient.invalidateQueries({ queryKey: ['workflow-history', workflowId] }),
    queryClient.invalidateQueries({ queryKey: ['workflow-config', workflowId] }),
    queryClient.invalidateQueries({ queryKey: ['workflow-documents', workflowId] }),
    workspaceId ? queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] }) : Promise.resolve(),
    workspaceId
      ? queryClient.invalidateQueries({ queryKey: ['workspace-timeline', workspaceId] })
      : Promise.resolve(),
  ]);
}
