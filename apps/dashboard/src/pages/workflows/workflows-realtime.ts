import { useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';

import { readCookieValue } from '../../lib/auth-callback.js';
import { processSseBuffer } from '../../lib/sse.js';
import { clearSession, readSession, writeSession } from '../../lib/session.js';
import { buildWorkflowRailQueryKey } from './workflows-query.js';
import type { WorkflowPageMode } from './workflows-page.support.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';
const AUTH_REFRESH_PATH = '/api/v1/auth/refresh';
const CSRF_COOKIE_NAME = 'agirunner_csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

let refreshPromise: Promise<string | null> | null = null;

interface StreamOptions {
  path: string;
  onMessage(): void;
}

interface StreamRequestOptions {
  path: string;
  signal: AbortSignal;
  fetcher?: typeof fetch;
}

export function useWorkflowRailRealtime(
  queryClient: QueryClient,
  input: {
    mode: WorkflowPageMode;
    search: string;
    needsActionOnly: boolean;
    ongoingOnly: boolean;
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
  }, [input.mode, input.needsActionOnly, input.ongoingOnly, input.search, queryClient]);
}

export function useWorkflowWorkspaceRealtime(
  queryClient: QueryClient,
  input: {
    workflowId: string | null;
    workItemId: string | null;
    tabScope: 'workflow' | 'selected_work_item';
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
        input.tabScope,
        input.boardMode,
      ),
      onMessage: () => {
        void queryClient.invalidateQueries({
          queryKey: ['workflows', 'workspace', input.workflowId],
        });
      },
    });
  }, [input.boardMode, input.tabScope, input.workflowId, input.workItemId, queryClient]);
}

function subscribeToWorkflowOperationsStream(options: StreamOptions): () => void {
  const session = readSession();
  if (!session?.accessToken) {
    return () => undefined;
  }

  const controller = new AbortController();
  void runStreamLoop(controller, options);
  return () => controller.abort();
}

async function runStreamLoop(
  controller: AbortController,
  options: StreamOptions,
): Promise<void> {
  while (!controller.signal.aborted) {
    try {
      const response = await requestWorkflowOperationsStreamResponse({
        path: options.path,
        signal: controller.signal,
      });
      if (!response) {
        return;
      }
      if (!response.ok) {
        if (!shouldRetryWorkflowOperationsStream(options.path, response.status)) {
          return;
        }
        await sleep();
        continue;
      }
      if (!response.body) {
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

export function shouldRetryWorkflowOperationsStream(path: string, status: number): boolean {
  if (status === 404 && isWorkflowWorkspaceStreamPath(path)) {
    return false;
  }
  return true;
}

function isWorkflowWorkspaceStreamPath(path: string): boolean {
  return /^\/api\/v1\/operations\/workflows\/[^/]+\/stream(?:\?|$)/.test(path);
}

export async function requestWorkflowOperationsStreamResponse(
  options: StreamRequestOptions,
): Promise<Response | null> {
  const fetcher = options.fetcher ?? fetch;
  const session = readSession();
  if (!session?.accessToken) {
    return null;
  }

  const response = await fetchWorkflowOperationsStream(fetcher, session.accessToken, options);
  if (response.status !== 401) {
    return response;
  }

  const refreshedAccessToken = await refreshWorkflowOperationsAccessToken(fetcher, session);
  if (!refreshedAccessToken) {
    clearWorkflowOperationsSession();
    return null;
  }

  const retriedResponse = await fetchWorkflowOperationsStream(fetcher, refreshedAccessToken, options);
  if (retriedResponse.status === 401) {
    clearWorkflowOperationsSession();
    return null;
  }

  return retriedResponse;
}

async function fetchWorkflowOperationsStream(
  fetcher: typeof fetch,
  accessToken: string,
  options: StreamRequestOptions,
): Promise<Response> {
  return fetcher(`${API_BASE_URL}${options.path}`, {
    headers: {
      accept: 'text/event-stream',
      authorization: `Bearer ${accessToken}`,
    },
    credentials: 'include',
    signal: options.signal,
  });
}

async function refreshWorkflowOperationsAccessToken(
  fetcher: typeof fetch,
  session: NonNullable<ReturnType<typeof readSession>>,
): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = refreshAccessToken(fetcher).finally(() => {
    refreshPromise = null;
  });

  const refreshedAccessToken = await refreshPromise;
  if (!refreshedAccessToken) {
    return null;
  }

  writeSession({
    accessToken: refreshedAccessToken,
    tenantId: session.tenantId,
    persistentSession: session.persistentSession,
  });

  return refreshedAccessToken;
}

async function refreshAccessToken(fetcher: typeof fetch): Promise<string | null> {
  const cookieHeader = typeof document === 'undefined' ? '' : document.cookie ?? '';
  const csrfToken = readCookieValue(cookieHeader, CSRF_COOKIE_NAME);
  if (!csrfToken) {
    return null;
  }

  const response = await fetcher(`${API_BASE_URL}${AUTH_REFRESH_PATH}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      [CSRF_HEADER_NAME]: csrfToken,
    },
  });
  if (!response.ok) {
    return null;
  }

  const payload = await response.json() as { data?: { token?: string } };
  const accessToken = payload.data?.token?.trim() ?? '';
  return accessToken.length > 0 ? accessToken : null;
}

function clearWorkflowOperationsSession(): void {
  clearSession();
  if (typeof window !== 'undefined') {
    window.location.assign('/login');
  }
}

function buildRailStreamPath(input: {
  mode: WorkflowPageMode;
  search: string;
  needsActionOnly: boolean;
  ongoingOnly: boolean;
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
  return `/api/v1/operations/workflows/stream?${params.toString()}`;
}

function buildWorkspaceStreamPath(
  workflowId: string,
  workItemId: string | null,
  tabScope: 'workflow' | 'selected_work_item',
  boardMode: string,
): string {
  const params = new URLSearchParams();
  params.set('tab_scope', tabScope);
  params.set('board_mode', boardMode);
  if (workItemId) {
    params.set('work_item_id', workItemId);
  }
  return `/api/v1/operations/workflows/${workflowId}/stream?${params.toString()}`;
}

function sleep(durationMs = 2_000): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
