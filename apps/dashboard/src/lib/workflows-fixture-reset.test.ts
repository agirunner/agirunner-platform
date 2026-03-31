import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetWorkflowsState } from '../../../../tests/integration/dashboard/support/workflows-fixture-reset.js';

describe('workflows-fixture-reset', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('omits application/json content-type on empty delete requests', async () => {
    const fetchMock = vi.fn<(typeof fetch)>().mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v1/workspaces?page=1&per_page=100')) {
        return buildJsonResponse({
          data: [{ id: 'workspace-1', slug: 'workflows-fixture-a' }],
          meta: { page: 1, pages: 1 },
        });
      }
      if (url.endsWith('/api/v1/playbooks')) {
        return buildJsonResponse({
          data: [],
        });
      }
      if (url.endsWith('/api/v1/workflows?page=1&per_page=100')) {
        return buildJsonResponse({
          data: [],
          meta: { page: 1, pages: 1 },
        });
      }
      if (url.includes('/api/v1/workspaces/workspace-1?cascade=true')) {
        expect(init?.method).toBe('DELETE');
        expect(init?.headers).toEqual({
          authorization: expect.stringMatching(/^Bearer\s+\S+/),
        });
        expect(init?.body).toBeUndefined();
        return buildJsonResponse({
          data: { id: 'workspace-1', deleted: true },
        });
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    await resetWorkflowsState();

    expect(fetchMock).toHaveBeenCalled();
  });
});

function buildJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  });
}
