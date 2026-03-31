import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearSession, readSession, writeSession } from '../../lib/session.js';
import {
  applyRailStreamBatch,
  applyWorkspaceStreamBatch,
  requestWorkflowOperationsStreamResponse,
  shouldRetryWorkflowOperationsStream,
} from './workflows-realtime.js';

function mockBrowserStorage() {
  const localStore = new Map<string, string>();
  const sessionStore = new Map<string, string>();
  vi.stubGlobal('localStorage', createStorage(localStore));
  vi.stubGlobal('sessionStorage', createStorage(sessionStore));
}

function createStorage(store: Map<string, string>) {
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

describe('requestWorkflowOperationsStreamResponse', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockBrowserStorage();
    clearSession();
    vi.stubGlobal('document', {
      cookie: 'agirunner_csrf_token=csrf-token-1',
    });
  });

  it('refreshes the browser session and retries the stream after a 401 response', async () => {
    writeSession({
      accessToken: 'expired-token',
      tenantId: 'tenant-1',
      persistentSession: true,
    });

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { token: 'fresh-token' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('event: message\ndata: {"ok":true}\n\n', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      );

    const response = await requestWorkflowOperationsStreamResponse({
      path: '/api/v1/operations/workflows/stream?mode=live',
      fetcher: fetchMock,
      signal: new AbortController().signal,
    });

    expect(response?.status).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v1/operations/workflows/stream?mode=live',
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: 'text/event-stream',
          authorization: 'Bearer expired-token',
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v1/auth/refresh',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-csrf-token': 'csrf-token-1',
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v1/operations/workflows/stream?mode=live',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer fresh-token',
        }),
      }),
    );
    expect(readSession()?.accessToken).toBe('fresh-token');
  });

  it('clears the session when the stream cannot refresh after a 401', async () => {
    writeSession({
      accessToken: 'expired-token',
      tenantId: 'tenant-1',
      persistentSession: true,
    });

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }));

    const response = await requestWorkflowOperationsStreamResponse({
      path: '/api/v1/operations/workflows/stream?mode=live',
      fetcher: fetchMock,
      signal: new AbortController().signal,
    });

    expect(response).toBeNull();
    expect(readSession()).toBeNull();
  });
});

describe('shouldRetryWorkflowOperationsStream', () => {
  it('treats deleted workflow workspace streams as terminal when the backend returns 404', () => {
    expect(
      shouldRetryWorkflowOperationsStream(
        '/api/v1/operations/workflows/workflow-1/stream?tab_scope=selected_work_item',
        404,
      ),
    ).toBe(false);
  });

  it('keeps retrying transient workflow stream failures', () => {
    expect(
      shouldRetryWorkflowOperationsStream(
        '/api/v1/operations/workflows/workflow-1/stream?tab_scope=selected_work_item',
        503,
      ),
    ).toBe(true);
  });

  it('does not change retry behavior for the shared rail stream endpoint', () => {
    expect(
      shouldRetryWorkflowOperationsStream(
        '/api/v1/operations/workflows/stream?mode=live',
        404,
      ),
    ).toBe(true);
  });
});

describe('applyRailStreamBatch', () => {
  it('upserts rail rows in place without dropping the current selection or count context', () => {
    const next = applyRailStreamBatch(
      {
        generated_at: '2026-03-30T12:00:00.000Z',
        latest_event_id: 11,
        snapshot_version: 'workflow-operations:11',
        mode: 'live',
        rows: [
          {
            workflow_id: 'workflow-1',
            name: 'Workflow 1',
            state: 'active',
            lifecycle: 'planned',
            current_stage: null,
            workspace_name: 'Workspace',
            playbook_name: 'Playbook',
            posture: 'progressing',
            live_summary: 'Working',
            last_changed_at: '2026-03-30T12:00:00.000Z',
            needs_action: false,
            counts: {
              active_task_count: 1,
              active_work_item_count: 1,
              blocked_work_item_count: 0,
              open_escalation_count: 0,
              waiting_for_decision_count: 0,
              failed_task_count: 0,
            },
          },
        ],
        ongoing_rows: [],
        selected_workflow_id: 'workflow-1',
        visible_count: 1,
        total_count: 18,
        next_cursor: null,
      },
      {
        generated_at: '2026-03-30T12:01:00.000Z',
        latest_event_id: 12,
        snapshot_version: 'workflow-operations:12',
        cursor: 'workflow-operations:12',
        events: [
          {
            event_type: 'rail_row_upsert',
            cursor: 'workflow-operations:12',
            snapshot_version: 'workflow-operations:12',
            workflow_id: 'workflow-1',
            payload: {
              workflow_id: 'workflow-1',
              name: 'Workflow 1',
              state: 'active',
              lifecycle: 'ongoing',
              current_stage: null,
              workspace_name: 'Workspace',
              playbook_name: 'Playbook',
              posture: 'progressing',
              live_summary: 'Still working',
              last_changed_at: '2026-03-30T12:01:00.000Z',
              needs_action: false,
              counts: {
                active_task_count: 2,
                active_work_item_count: 1,
                blocked_work_item_count: 0,
                open_escalation_count: 0,
                waiting_for_decision_count: 0,
                failed_task_count: 0,
              },
            },
          },
        ],
      },
    );

    expect(next).toBeDefined();
    if (!next) {
      throw new Error('expected rail packet');
    }
    expect(next.selected_workflow_id).toBe('workflow-1');
    expect(next.visible_count).toBe(1);
    expect(next.total_count).toBe(18);
    expect(next.rows).toEqual([]);
    expect(next.ongoing_rows).toEqual([
      expect.objectContaining({
        workflow_id: 'workflow-1',
        lifecycle: 'ongoing',
        live_summary: 'Still working',
      }),
    ]);
  });
});

describe('applyWorkspaceStreamBatch', () => {
  it('patches workspace slices in place instead of requiring a full query invalidation', () => {
    const next = applyWorkspaceStreamBatch(
      {
        generated_at: '2026-03-30T12:00:00.000Z',
        latest_event_id: 11,
        snapshot_version: 'workflow-operations:11',
        workflow_id: 'workflow-1',
        workflow: null,
        sticky_strip: {
          workflow_id: 'workflow-1',
          workflow_name: 'Workflow 1',
          posture: 'progressing',
          summary: 'Before',
          approvals_count: 0,
          escalations_count: 0,
          blocked_work_item_count: 0,
          active_task_count: 1,
          active_work_item_count: 1,
          steering_available: true,
        },
        board: { columns: [], work_items: [], active_stages: [], awaiting_gate_count: 0, stage_summary: [] },
        bottom_tabs: {
          current_scope_kind: 'workflow',
          current_work_item_id: null,
          current_task_id: null,
          counts: {
            details: 1,
            needs_action: 0,
            live_console_activity: 1,
            briefs: 0,
            history: 0,
            deliverables: 0,
          },
        },
        needs_action: { items: [], total_count: 0, default_sort: 'priority_desc' },
        steering: { items: [], total_count: 0 },
        live_console: {
          generated_at: '2026-03-30T12:00:00.000Z',
          latest_event_id: 11,
          snapshot_version: 'workflow-operations:11',
          items: [],
          total_count: 0,
          counts: { all: 0, turn_updates: 0, briefs: 0, steering: 0 },
          next_cursor: null,
          live_visibility_mode: 'enhanced',
        },
        briefs: { items: [], total_count: 0, next_cursor: null },
        history: { items: [], groups: [], total_count: 0, next_cursor: null },
        deliverables: { inputs_and_provenance: [], final_deliverables: [], in_progress_deliverables: [], next_cursor: null, total_count: 0 },
        redrive_lineage: null,
      } as never,
      {
        generated_at: '2026-03-30T12:01:00.000Z',
        latest_event_id: 12,
        snapshot_version: 'workflow-operations:12',
        cursor: 'workflow-operations:12',
        events: [
          {
            event_type: 'workspace_sticky_update',
            cursor: 'workflow-operations:12',
            snapshot_version: 'workflow-operations:12',
            workflow_id: 'workflow-1',
            payload: {
              workflow_id: 'workflow-1',
              workflow_name: 'Workflow 1',
              posture: 'needs_intervention',
              summary: 'After',
              approvals_count: 1,
              escalations_count: 0,
              blocked_work_item_count: 0,
              active_task_count: 1,
              active_work_item_count: 1,
              steering_available: true,
            },
          },
          {
            event_type: 'workspace_tab_counts_update',
            cursor: 'workflow-operations:12',
            snapshot_version: 'workflow-operations:12',
            workflow_id: 'workflow-1',
            payload: {
              details: 1,
              needs_action: 1,
              live_console_activity: 1,
              briefs: 0,
              history: 0,
              deliverables: 0,
            },
          },
        ],
      },
    );

    expect(next).toBeDefined();
    if (!next) {
      throw new Error('expected workspace packet');
    }
    expect(next.sticky_strip?.summary).toBe('After');
    expect(next.sticky_strip?.approvals_count).toBe(1);
    expect(next.bottom_tabs.counts.needs_action).toBe(1);
  });
});
