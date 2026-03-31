import type { FastifyInstance } from 'fastify';

import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';
import { ValidationError } from '../../../errors/domain-errors.js';
import { WorkspaceMemoryScopeService } from '../../../services/workspace/memory/workspace-memory-scope-service.js';
import { TaskAgentScopeService } from '../../../services/task/task-agent-scope-service.js';

export function registerTaskPlatformMemoryReadRoutes(
  app: FastifyInstance,
  services: {
    taskScopeService: TaskAgentScopeService;
    workspaceMemoryScopeService: WorkspaceMemoryScopeService;
  },
) {
  app.get(
    '/api/v1/tasks/:id/memory',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const query = request.query as { key?: string; keys?: string | string[] };
      const task = await services.taskScopeService.loadAgentOwnedActiveTask(request.auth!, params.id);
      if (!task.workspace_id) {
        throw new ValidationError('Task is not linked to a workspace');
      }
      const workspace = await app.workspaceService.getWorkspace(request.auth!.tenantId, task.workspace_id);
      const memory = await services.workspaceMemoryScopeService.filterVisibleTaskMemory({
        tenantId: request.auth!.tenantId,
        workspaceId: task.workspace_id as string,
        workflowId: task.workflow_id as string,
        workItemId: task.work_item_id,
        currentMemory: (workspace.memory ?? {}) as Record<string, unknown>,
      });
      const selectedKeys = readMemoryKeysQuery(query.keys);
      if (selectedKeys.length > 0) {
        return { data: { memory: selectMemoryEntries(memory, selectedKeys) } };
      }
      if (query.key) {
        return { data: { key: query.key, value: memory[query.key] } };
      }
      return { data: { memory } };
    },
  );

  app.get(
    '/api/v1/tasks/:id/memory/search',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const query = request.query as { q?: string };
      const searchQuery = query.q?.trim();
      if (!searchQuery) {
        throw new ValidationError('q is required');
      }
      const task = await services.taskScopeService.loadAgentOwnedActiveTask(request.auth!, params.id);
      if (!task.workspace_id) {
        throw new ValidationError('Task is not linked to a workspace');
      }
      const workspace = await app.workspaceService.getWorkspace(request.auth!.tenantId, task.workspace_id);
      const matches = await services.workspaceMemoryScopeService.searchVisibleTaskMemory({
        tenantId: request.auth!.tenantId,
        workspaceId: task.workspace_id as string,
        workflowId: task.workflow_id as string,
        workItemId: task.work_item_id,
        currentMemory: (workspace.memory ?? {}) as Record<string, unknown>,
        query: searchQuery,
      });
      return { data: { matches } };
    },
  );
}

function readMemoryKeysQuery(raw: string | string[] | undefined): string[] {
  if (Array.isArray(raw)) {
    return raw.map((value) => value.trim()).filter((value) => value.length > 0);
  }
  const value = raw?.trim();
  return value ? [value] : [];
}

function selectMemoryEntries(memory: Record<string, unknown>, keys: string[]) {
  return keys.reduce<Record<string, unknown>>((selected, key) => {
    if (key in memory) {
      selected[key] = memory[key];
    }
    return selected;
  }, {});
}
