import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

import { resetWorkflowsState } from '../../../../tests/integration/dashboard/support/workflows-fixture-reset.js';

type FetchPayload = {
  ok?: boolean;
  status?: number;
  json?: unknown;
  text?: string;
};

type SqlOutputs = {
  workspaces?: string;
  playbooks?: string;
  blockingWorkflows?: string;
  workflows?: string;
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

function installExecMock(sqlOutputs: SqlOutputs, options: { runningContainers?: string[] } = {}) {
  execFileSyncMock.mockImplementation((command: string, args: string[]) => {
    if (command !== 'docker') {
      throw new Error(`unexpected command ${command}`);
    }

    if (args[0] === 'ps') {
      return `${(options.runningContainers ?? []).join('\n')}${options.runningContainers?.length ? '\n' : ''}`;
    }

    if (args[0] === 'stop') {
      return '';
    }

    const sql = args.at(-1) ?? '';
    if (sql.includes('FROM public.workflows') && sql.includes("COALESCE(name, '') LIKE 'E2E %'")) {
      return sqlOutputs.workflows ?? '';
    }
    if (sql.includes('FROM public.workflows') && sql.includes('state NOT IN') && sql.includes('LIMIT 20')) {
      return sqlOutputs.blockingWorkflows ?? '';
    }
    if (sql.includes('FROM public.workspaces')) {
      return sqlOutputs.workspaces ?? '';
    }
    if (sql.includes('FROM public.playbooks')) {
      return sqlOutputs.playbooks ?? '';
    }

    throw new Error(`unexpected docker exec invocation: ${args.join(' ')}`);
  });
}

describe('resetWorkflowsState', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses to seed over active non-fixture workflows', async () => {
    installExecMock({
      workspaces: 'fixture-workspace\n',
      playbooks: 'fixture-playbook-planned\n',
      blockingWorkflows: 'live-workflow|SDLC Parallel Assessors Mixed Outcomes\n',
    });
    const fetchMock = installFetchMock([]);

    await expect(resetWorkflowsState()).rejects.toThrow(/active non-fixture workflows/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(execFileSyncMock).toHaveBeenCalledTimes(5);
  });

  it('bulk deletes fixture workflows before removing their workspaces and playbooks', async () => {
    installExecMock(
      {
        workspaces: 'fixture-workspace\n',
        playbooks: 'fixture-playbook-planned\nfixture-playbook-ongoing\n',
        blockingWorkflows: '',
        workflows: 'fixture-workflow-1\nfixture-workflow-2\n',
      },
      { runningContainers: ['orchestrator-primary-0', 'agirunner-platform-container-manager-1'] },
    );
    const fetchMock = installFetchMock([
      jsonResponse({
        data: {
          deleted: true,
          deleted_workflow_count: 2,
          deleted_task_count: 4,
          deleted_workflow_ids: ['fixture-workflow-1', 'fixture-workflow-2'],
        },
      }),
      jsonResponse({ data: { id: 'fixture-workspace', deleted: true } }),
      jsonResponse({ data: { id: 'fixture-playbook-planned', deleted: true } }),
      jsonResponse({ data: { id: 'fixture-playbook-ongoing', deleted: true } }),
    ]);

    await resetWorkflowsState();

    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      1,
      'docker',
      ['ps', '--format', '{{.Names}}'],
      { encoding: 'utf8' },
    );
    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      2,
      'docker',
      ['stop', 'orchestrator-primary-0', 'agirunner-platform-container-manager-1'],
      { stdio: 'pipe' },
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const calls = fetchCalls(fetchMock);
    expect(String(calls[0]?.[0] ?? '')).toContain('/api/v1/workflows/bulk-delete');
    expect(calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ workflow_ids: ['fixture-workflow-1', 'fixture-workflow-2'] }),
    });
    expect(String(calls[1]?.[0] ?? '')).toContain('/api/v1/workspaces/fixture-workspace');
    expect(calls[1]?.[1]).toMatchObject({ method: 'DELETE' });
    expect(String(calls[2]?.[0] ?? '')).toContain('/api/v1/playbooks/fixture-playbook-planned');
    expect(calls[2]?.[1]).toMatchObject({ method: 'DELETE' });
    expect(String(calls[3]?.[0] ?? '')).toContain('/api/v1/playbooks/fixture-playbook-ongoing');
    expect(calls[3]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  it('ignores not-found cleanup calls so reset stays idempotent', async () => {
    installExecMock({
      workspaces: 'fixture-workspace\n',
      playbooks: 'fixture-playbook-planned\n',
      blockingWorkflows: '',
      workflows: '',
    });
    const fetchMock = installFetchMock([
      {
        ok: false,
        status: 404,
        text: '{"error":{"code":"NOT_FOUND","message":"Workspace not found"}}',
      },
      {
        ok: false,
        status: 404,
        text: '{"error":{"code":"NOT_FOUND","message":"Playbook not found"}}',
      },
    ]);

    await expect(resetWorkflowsState()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
