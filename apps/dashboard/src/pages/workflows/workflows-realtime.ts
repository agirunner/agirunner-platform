import { useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';

import { processSseBuffer } from '../../lib/sse.js';
import { readSession } from '../../lib/session.js';
import { buildWorkflowRailQueryKey } from './workflows-query.js';
import type { WorkflowPageMode } from './workflows-page.support.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

interface StreamOptions {
  path: string;
  onMessage(): void;
}

export function useWorkflowRailRealtime(
  queryClient: QueryClient,
  input: {
    mode: WorkflowPageMode;
    search: string;
    needsActionOnly: boolean;
    ongoingOnly: boolean;
    workflowId: string | null;
  },
): void {
  useEffect(() => {
    return subscribeToWorkflowOperationsStream({
      path: buildRailStreamPath(input),
      onMessage: () => {
        void queryClient.invalidateQueries({
          queryKey: buildWorkflowRailQueryKey({
            mode: input.mode,
            search: input.search,
            needsActionOnly: input.needsActionOnly,
            ongoingOnly: input.ongoingOnly,
          }),
        });
      },
    });
  }, [input.mode, input.needsActionOnly, input.ongoingOnly, input.search, input.workflowId, queryClient]);
}

export function useWorkflowWorkspaceRealtime(
  queryClient: QueryClient,
  input: {
    workflowId: string | null;
    workItemId: string | null;
    taskId: string | null;
    tabScope: 'workflow' | 'selected_work_item' | 'selected_task';
    boardMode: string;
  },
): void {
  useEffect(() => {
    if (!input.workflowId) {
      return undefined;
    }
    return subscribeToWorkflowOperationsStream({
      path: buildWorkspaceStreamPath(
        input.workflowId,
        input.workItemId,
        input.taskId,
        input.tabScope,
        input.boardMode,
      ),
      onMessage: () => {
        void queryClient.invalidateQueries({
          queryKey: ['workflows', 'workspace', input.workflowId],
        });
      },
    });
  }, [input.boardMode, input.tabScope, input.taskId, input.workflowId, input.workItemId, queryClient]);
}

function subscribeToWorkflowOperationsStream(options: StreamOptions): () => void {
  const session = readSession();
  if (!session?.accessToken) {
    return () => undefined;
  }

  const controller = new AbortController();
  void runStreamLoop(controller, session.accessToken, options);
  return () => controller.abort();
}

async function runStreamLoop(
  controller: AbortController,
  accessToken: string,
  options: StreamOptions,
): Promise<void> {
  while (!controller.signal.aborted) {
    try {
      const response = await fetch(`${API_BASE_URL}${options.path}`, {
        headers: {
          accept: 'text/event-stream',
          authorization: `Bearer ${accessToken}`,
        },
        credentials: 'include',
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        await sleep();
        continue;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!controller.signal.aborted) {
        const next = await reader.read();
        if (next.done) {
          break;
        }
        buffer += decoder.decode(next.value, { stream: true });
        buffer = processSseBuffer(buffer, () => options.onMessage());
      }
    } catch {
      if (!controller.signal.aborted) {
        await sleep();
      }
    }
  }
}

function buildRailStreamPath(input: {
  mode: WorkflowPageMode;
  search: string;
  needsActionOnly: boolean;
  ongoingOnly: boolean;
  workflowId: string | null;
}): string {
  const params = new URLSearchParams();
  params.set('mode', input.mode);
  if (input.search.trim().length > 0) {
    params.set('search', input.search.trim());
  }
  if (input.needsActionOnly) {
    params.set('needs_action_only', 'true');
  }
  if (input.ongoingOnly) {
    params.set('ongoing_only', 'true');
  }
  if (input.workflowId) {
    params.set('workflow_id', input.workflowId);
  }
  return `/api/v1/operations/workflows/stream?${params.toString()}`;
}

function buildWorkspaceStreamPath(
  workflowId: string,
  workItemId: string | null,
  taskId: string | null,
  tabScope: 'workflow' | 'selected_work_item' | 'selected_task',
  boardMode: string,
): string {
  const params = new URLSearchParams();
  params.set('tab_scope', tabScope);
  params.set('board_mode', boardMode);
  if (workItemId) {
    params.set('work_item_id', workItemId);
  }
  if (taskId) {
    params.set('task_id', taskId);
  }
  return `/api/v1/operations/workflows/${workflowId}/stream?${params.toString()}`;
}

function sleep(durationMs = 2_000): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
