import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

import { resetWorkflowsState } from '../../tests/e2e/support/workflows-fixture-reset.js';

type FetchPayload = {
  ok?: boolean;
  status?: number;
  json?: unknown;
  text?: string;
};

function jsonResponse(payload: unknown): FetchPayload {
  return {
    ok: true,
    status: 200,
    json: payload,
    text: JSON.stringify(payload),
  };
}

function installFetchMock(responses: FetchPayload[]) {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error('unexpected fetch call');
    }
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      async json() {
        return next.json ?? {};
      },
      async text() {
        return next.text ?? '';
      },
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function fetchCalls(fetchMock: ReturnType<typeof vi.fn>): Array<[unknown, RequestInit | undefined]> {
  return fetchMock.mock.calls as Array<[unknown, RequestInit | undefined]>;
}

describe('resetWorkflowsState', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses to seed over active non-fixture workflows', async () => {
    const fetchMock = installFetchMock([
      jsonResponse({
        data: [
          { id: 'fixture-workspace', slug: 'workflows-fixture-123' },
          { id: 'live-workspace', slug: 'sdlc-parallel-assessors-mixed-outcomes-20260329012241' },
        ],
        meta: { page: 1, per_page: 100, pages: 1, total: 2 },
      }),
      jsonResponse({
        data: [
          { id: 'fixture-playbook', slug: 'planned-workflows-fixture-123' },
          { id: 'live-playbook', slug: 'live-test-sdlc-parallel-assessors-mixed-outcomes-v1' },
        ],
      }),
      jsonResponse({
        data: [
          {
            id: 'live-workflow',
            name: 'SDLC Parallel Assessors Mixed Outcomes',
            workspace_id: 'live-workspace',
            playbook_id: 'live-playbook',
            state: 'active',
          },
        ],
        meta: { page: 1, per_page: 100, pages: 1, total: 1 },
      }),
    ]);

    await expect(resetWorkflowsState()).rejects.toThrow(
      /active non-fixture workflows/i,
    );

    expect(execFileSyncMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const calls = fetchCalls(fetchMock);
    expect(String(calls[0]?.[0] ?? '')).toContain('/api/v1/workspaces?page=1&per_page=100');
    expect(String(calls[1]?.[0] ?? '')).toContain('/api/v1/playbooks');
    expect(String(calls[2]?.[0] ?? '')).toContain('/api/v1/workflows?page=1&per_page=100');
  });

  it('cleans up only seeded fixture workspaces and playbooks through the API', async () => {
    const fetchMock = installFetchMock([
      jsonResponse({
        data: [
          { id: 'fixture-workspace', slug: 'workflows-fixture-123' },
          { id: 'live-workspace', slug: 'shared-live-run' },
        ],
        meta: { page: 1, per_page: 100, pages: 1, total: 2 },
      }),
      jsonResponse({
        data: [
          { id: 'fixture-playbook-planned', slug: 'planned-workflows-fixture-123' },
          { id: 'fixture-playbook-ongoing', slug: 'ongoing-workflows-fixture-123' },
          { id: 'live-playbook', slug: 'shared-live-run' },
        ],
      }),
      jsonResponse({
        data: [
          {
            id: 'fixture-workflow',
            name: 'E2E Planned Terminal Brief',
            workspace_id: 'fixture-workspace',
            playbook_id: 'fixture-playbook-planned',
            state: 'active',
          },
          {
            id: 'live-terminal-workflow',
            name: 'Shared live workflow',
            workspace_id: 'live-workspace',
            playbook_id: 'live-playbook',
            state: 'completed',
          },
        ],
        meta: { page: 1, per_page: 100, pages: 1, total: 2 },
      }),
      jsonResponse({ data: { id: 'fixture-workspace', deleted: true } }),
      jsonResponse({ data: { id: 'fixture-playbook-planned', deleted: true } }),
      jsonResponse({ data: { id: 'fixture-playbook-ongoing', deleted: true } }),
    ]);

    await resetWorkflowsState();

    expect(execFileSyncMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const calls = fetchCalls(fetchMock);
    expect(String(calls[3]?.[0] ?? '')).toContain(
      '/api/v1/workspaces/fixture-workspace?cascade=true',
    );
    expect(calls[3]?.[1]).toMatchObject({ method: 'DELETE' });
    expect(String(calls[4]?.[0] ?? '')).toContain(
      '/api/v1/playbooks/fixture-playbook-planned/permanent',
    );
    expect(calls[4]?.[1]).toMatchObject({ method: 'DELETE' });
    expect(String(calls[5]?.[0] ?? '')).toContain(
      '/api/v1/playbooks/fixture-playbook-ongoing/permanent',
    );
    expect(calls[5]?.[1]).toMatchObject({ method: 'DELETE' });
  });
});
