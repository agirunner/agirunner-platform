import type { FastifyPluginAsync } from 'fastify';

import { authenticateApiKey, withAllowedScopes } from '../../auth/fastify-auth-hook.js';
import { readUuidOrUndefined } from '../../lib/uuid.js';
import type { WorkflowRailMode } from '../../services/workflow-operations/workflow-operations-types.js';

function readPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readBooleanFlag(value: unknown): boolean {
  return value === 'true' || value === '1' || value === true;
}

function readRailMode(value: unknown): WorkflowRailMode {
  return value === 'recent' || value === 'history' ? value : 'live';
}

function prefersSse(request: { headers: Record<string, unknown> }): boolean {
  const accept = request.headers.accept;
  return typeof accept === 'string' && accept.includes('text/event-stream');
}

function writeSse(reply: { raw: NodeJS.WritableStream & { write: (chunk: string) => boolean; end: () => void } }, data: unknown) {
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

function applyWorkflowStreamHeaders(
  request: { headers: Record<string, unknown> },
  reply: {
    raw: NodeJS.WritableStream & {
      setHeader: (name: string, value: string) => void;
    };
  },
): void {
  const origin = request.headers.origin;
  if (typeof origin === 'string' && origin.length > 0) {
    reply.raw.setHeader('Access-Control-Allow-Origin', origin);
    reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
}

export const workflowOperationsRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [authenticateApiKey, withAllowedScopes(['agent', 'admin'])] };

  async function handleRail(request: {
    auth?: { tenantId: string };
    query: {
      mode?: string;
      page?: string;
      per_page?: string;
      needs_action_only?: string;
      ongoing_only?: string;
      search?: string;
      workflow_id?: string;
    };
  }) {
    const query = request.query;
    if ('workflowOperationsRailService' in app && app.workflowOperationsRailService) {
      return {
        data: await app.workflowOperationsRailService.getRail(request.auth!.tenantId, {
          mode: readRailMode(query.mode),
          needsActionOnly: readBooleanFlag(query.needs_action_only),
          ongoingOnly: readBooleanFlag(query.ongoing_only),
          search: query.search,
          page: readPositiveInt(query.page, 1),
          perPage: readPositiveInt(query.per_page, 100),
          selectedWorkflowId: readUuidOrUndefined(query.workflow_id),
        }),
      };
    }
    return {
      data: await app.workflowOperationsLiveService.getLive(request.auth!.tenantId, {
        page: readPositiveInt(query.page, 1),
        perPage: readPositiveInt(query.per_page, 100),
      }),
    };
  }

  async function handleRecent(request: {
    auth?: { tenantId: string };
    query: { limit?: string };
  }) {
    const query = request.query;
    return {
      data: await app.workflowOperationsRecentService.getRecent(request.auth!.tenantId, {
        limit: readPositiveInt(query.limit, 50),
      }),
    };
  }

  async function handleHistory(request: {
    auth?: { tenantId: string };
    query: { workflow_id?: string; limit?: string };
  }) {
    const query = request.query;
    return {
      data: await app.workflowOperationsHistoryService.getHistory(request.auth!.tenantId, {
        workflowId: query.workflow_id,
        limit: readPositiveInt(query.limit, 100),
      }),
    };
  }

  async function handleWorkspace(request: {
    auth?: { tenantId: string };
    params: { id: string };
    query: {
      board_mode?: string;
      board_filters?: string;
      work_item_id?: string;
      task_id?: string;
      tab_scope?: 'workflow' | 'selected_work_item' | 'selected_task';
      live_console_after?: string;
      live_console_limit?: string;
      briefs_after?: string;
      history_after?: string;
      deliverables_after?: string;
      briefs_limit?: string;
      history_limit?: string;
      deliverables_limit?: string;
      output_limit?: string;
    };
  }) {
    const params = request.params;
    const query = request.query;
    return {
      data: await app.workflowOperationsWorkspaceService.getWorkspace(request.auth!.tenantId, params.id, {
        boardMode: query.board_mode,
        boardFilters: query.board_filters,
        workItemId: query.work_item_id,
        taskId: query.task_id,
        tabScope: query.tab_scope ?? 'workflow',
        liveConsoleAfter: query.live_console_after,
        liveConsoleLimit: readPositiveInt(query.live_console_limit, 50),
        briefsAfter: query.briefs_after,
        briefsLimit: readPositiveInt(query.briefs_limit, 50),
        historyAfter: query.history_after,
        deliverablesAfter: query.deliverables_after,
        historyLimit: readPositiveInt(query.history_limit, 50),
        deliverablesLimit: readPositiveInt(query.deliverables_limit ?? query.output_limit, 10),
      }),
    };
  }

  async function handleRailStream(request: {
    auth?: { tenantId: string };
    query: {
      mode?: string;
      needs_action_only?: string;
      ongoing_only?: string;
      search?: string;
      after_cursor?: string;
      workflow_id?: string;
    };
    headers: Record<string, unknown>;
  }, reply: {
    raw: NodeJS.WritableStream & { setHeader: (name: string, value: string) => void; write: (chunk: string) => boolean; end: () => void };
    send: (payload: unknown) => unknown;
  }) {
    const query = request.query;
    const batch = await app.workflowOperationsStreamService.buildRailBatch(request.auth!.tenantId, {
      mode: readRailMode(query.mode),
      needsActionOnly: readBooleanFlag(query.needs_action_only),
      ongoingOnly: readBooleanFlag(query.ongoing_only),
      search: query.search,
      selectedWorkflowId: readUuidOrUndefined(query.workflow_id),
      afterCursor: query.after_cursor,
    });
    if (!prefersSse(request)) {
      return reply.send({ data: batch });
    }
    applyWorkflowStreamHeaders(request, reply);
    writeSse(reply, batch);
    let currentCursor = batch.cursor;
    const unsubscribe = app.eventStreamService.subscribe(request.auth!.tenantId, {}, (event) => {
      void app.workflowOperationsStreamService
        .buildRailBatch(request.auth!.tenantId, {
          mode: readRailMode(query.mode),
          needsActionOnly: readBooleanFlag(query.needs_action_only),
          ongoingOnly: readBooleanFlag(query.ongoing_only),
          search: query.search,
          selectedWorkflowId: readUuidOrUndefined(query.workflow_id),
          afterCursor: currentCursor,
        })
        .then((nextBatch) => {
          currentCursor = nextBatch.cursor;
          writeSse(reply, nextBatch);
        });
      void event;
    });
    (request as { raw?: NodeJS.EventEmitter }).raw?.on('close', () => {
      unsubscribe();
      reply.raw.end();
    });
    return reply;
  }

  async function handleWorkspaceStream(request: {
    auth?: { tenantId: string };
    params: { id: string };
    query: {
      after_cursor?: string;
      board_mode?: string;
      board_filters?: string;
      work_item_id?: string;
      task_id?: string;
      tab_scope?: 'workflow' | 'selected_work_item' | 'selected_task';
    };
    headers: Record<string, unknown>;
    raw?: NodeJS.EventEmitter;
  }, reply: {
    raw: NodeJS.WritableStream & { setHeader: (name: string, value: string) => void; write: (chunk: string) => boolean; end: () => void };
    send: (payload: unknown) => unknown;
  }) {
    const batch = await app.workflowOperationsStreamService.buildWorkspaceBatch(
      request.auth!.tenantId,
      request.params.id,
      {
        afterCursor: request.query.after_cursor,
        boardMode: request.query.board_mode,
        boardFilters: request.query.board_filters,
        workItemId: request.query.work_item_id,
        taskId: request.query.task_id,
        tabScope: request.query.tab_scope ?? 'workflow',
      },
    );
    if (!prefersSse(request)) {
      return reply.send({ data: batch });
    }
    applyWorkflowStreamHeaders(request, reply);
    writeSse(reply, batch);
    let currentCursor = batch.cursor;
    let currentLiveConsoleHead = batch.surface_cursors?.live_console_head ?? null;
    let currentBriefsHead = batch.surface_cursors?.briefs_head ?? null;
    let currentHistoryHead = batch.surface_cursors?.history_head ?? null;
    let currentDeliverablesHead = batch.surface_cursors?.deliverables_head ?? null;
    let refreshInFlight = false;
    let refreshQueued = false;
    const refresh = () => {
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }
      refreshInFlight = true;
      void app.workflowOperationsStreamService
        .buildWorkspaceBatch(request.auth!.tenantId, request.params.id, {
          afterCursor: currentCursor,
          boardMode: request.query.board_mode,
          boardFilters: request.query.board_filters,
          workItemId: request.query.work_item_id,
          taskId: request.query.task_id,
          tabScope: request.query.tab_scope ?? 'workflow',
          liveConsoleHeadCursor: currentLiveConsoleHead,
          briefsHeadCursor: currentBriefsHead,
          historyHeadCursor: currentHistoryHead,
          deliverablesHeadCursor: currentDeliverablesHead,
        })
        .then((nextBatch) => {
          currentCursor = nextBatch.cursor;
          currentLiveConsoleHead = nextBatch.surface_cursors?.live_console_head ?? currentLiveConsoleHead;
          currentBriefsHead = nextBatch.surface_cursors?.briefs_head ?? currentBriefsHead;
          currentHistoryHead = nextBatch.surface_cursors?.history_head ?? currentHistoryHead;
          currentDeliverablesHead = nextBatch.surface_cursors?.deliverables_head ?? currentDeliverablesHead;
          if (nextBatch.events.length > 0) {
            writeSse(reply, nextBatch);
          }
        })
        .finally(() => {
          refreshInFlight = false;
          if (refreshQueued) {
            refreshQueued = false;
            refresh();
          }
        });
    };
    const unsubscribeEvents = app.eventStreamService.subscribe(
      request.auth!.tenantId,
      { workflowId: request.params.id },
      refresh,
    );
    const unsubscribeLogs = app.logStreamService.subscribe(
      request.auth!.tenantId,
      {
        workflowId: request.params.id,
        category: ['agent_loop', 'task_lifecycle'],
      },
      () => {
        refresh();
      },
    );
    request.raw?.on('close', () => {
      unsubscribeEvents();
      unsubscribeLogs();
      reply.raw.end();
    });
    return reply;
  }

  app.get('/api/v1/operations/workflows', auth, async (request) => {
    const query = request.query as { mode?: string };
    switch (query.mode) {
      case 'recent':
      case 'history':
        if ('workflowOperationsRailService' in app && app.workflowOperationsRailService) {
          return handleRail(request as never);
        }
        return query.mode === 'recent' ? handleRecent(request as never) : handleHistory(request as never);
      case 'live':
      default:
        return handleRail(request as never);
    }
  });

  app.get('/api/v1/operations/workflows/:id/workspace', auth, (request) => handleWorkspace(request as never));
  app.get('/api/v1/operations/workflows/stream', auth, (request, reply) =>
    handleRailStream(request as never, reply as never),
  );
  app.get('/api/v1/operations/workflows/:id/stream', auth, (request, reply) =>
    handleWorkspaceStream(request as never, reply as never),
  );

};
