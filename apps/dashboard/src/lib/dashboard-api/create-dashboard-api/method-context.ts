import type { PlatformApiClient } from '@agirunner/sdk';

import type * as Contracts from '../contracts.js';

export interface DashboardApiMethodContext {
  baseUrl: string;
  client: PlatformApiClient;
  requestFetch: typeof fetch;
  defaultManualWorkflowActivationEventType: string;
  withRefresh<T>(handler: () => Promise<T>): Promise<T>;
  requestJson<T>(
    path: string,
    options?: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: Record<string, unknown>;
      includeAuth?: boolean;
      allowNoContent?: boolean;
    },
  ): Promise<T>;
  requestData<T>(
    path: string,
    options?: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: Record<string, unknown>;
      allowNoContent?: boolean;
    },
  ): Promise<T>;
  requestBinary(path: string, options?: { method?: 'GET'; includeAuth?: boolean }): Promise<Response>;
  requestWorkflowControlAction(path: string): Promise<unknown>;
  requestWorkflowWorkItemTaskAction(
    workflowId: string,
    workItemId: string,
    taskId: string,
    action: string,
    body: Record<string, unknown>,
  ): Promise<unknown>;
  requestWorkflowWorkItemAction(
    workflowId: string,
    workItemId: string,
    action: string,
    body: Record<string, unknown>,
  ): Promise<unknown>;
  requestTaskEscalationResolution(
    taskId: string,
    payload: { instructions: string; context?: Record<string, unknown> },
    options?: { workflowId?: string | null; workItemId?: string | null },
  ): Promise<unknown>;
  normalizeEventPage(page: {
    data?: Contracts.DashboardEventRecord[];
    meta?: { has_more?: boolean; next_after?: string | number | null };
  }): Contracts.DashboardEventPage;
}
