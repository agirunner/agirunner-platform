import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

import { resetWorkflowsState } from '../../../../tests/integration/dashboard/support/workflows-fixture-reset.js';

type SqlOutputs = {
  workspaces?: string;
  playbooks?: string;
  blockingWorkflows?: string;
  workflows?: string;
};

function installFetchTrap() {
  const fetchMock = vi.fn(async () => {
    throw new Error('unexpected fetch call');
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
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

    const sql = String(args.at(-1) ?? '');
    if (sql.includes("COALESCE(name, '') LIKE 'E2E %'")) {
      return sqlOutputs.workflows ?? '';
    }
    if (sql.includes('state NOT IN') && sql.includes('LIMIT 20')) {
      return sqlOutputs.blockingWorkflows ?? '';
    }
    if (sql.startsWith('\n    SELECT id::text') && sql.includes('FROM public.workspaces')) {
      return sqlOutputs.workspaces ?? '';
    }
    if (sql.startsWith('\n    SELECT id::text') && sql.includes('FROM public.playbooks')) {
      return sqlOutputs.playbooks ?? '';
    }
    if (sql.includes('DELETE FROM public.workflows')) {
      return '';
    }

    throw new Error(`unexpected docker exec invocation: ${args.join(' ')}`);
  });
}

describe('resetWorkflowsState', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('refuses to seed over active non-fixture workflows', async () => {
    installExecMock({
      workspaces: 'fixture-workspace\n',
      playbooks: 'fixture-playbook-planned\n',
      blockingWorkflows: 'live-workflow|SDLC Parallel Assessors Mixed Outcomes\n',
    });
    const fetchMock = installFetchTrap();

    await expect(resetWorkflowsState()).rejects.toThrow(/active non-fixture workflows/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(execFileSyncMock).toHaveBeenCalledTimes(5);
  });

  it('purges fixture workflows, workspaces, and playbooks locally without API calls', async () => {
    installExecMock(
      {
        workspaces: 'fixture-workspace\n',
        playbooks: 'fixture-playbook-planned\nfixture-playbook-ongoing\n',
        blockingWorkflows: '',
        workflows: 'fixture-workflow-1\nfixture-workflow-2\n',
      },
      { runningContainers: ['orchestrator-primary-0', 'agirunner-platform-container-manager-1'] },
    );
    const fetchMock = installFetchTrap();

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
    expect(fetchMock).not.toHaveBeenCalled();

    const purgeCall = execFileSyncMock.mock.calls.find(
      ([command, args]) =>
        command === 'docker'
        && Array.isArray(args)
        && args[0] === 'exec'
        && typeof args.at(-1) === 'string'
        && String(args.at(-1)).includes('DELETE FROM public.workflows'),
    );

    expect(purgeCall).toBeDefined();
    const purgeSql = String((purgeCall?.[1] as string[]).at(-1) ?? '');
    expect(purgeSql).toContain('DELETE FROM public.workflow_input_packets');
    expect(purgeSql).toContain('DELETE FROM public.workflow_operator_briefs');
    expect(purgeSql).toContain('DELETE FROM public.execution_logs');
    expect(purgeSql).toContain('DELETE FROM public.workflows');
    expect(purgeSql).toContain('DELETE FROM public.workspaces');
    expect(purgeSql).toContain('DELETE FROM public.playbooks');
  });

  it('returns cleanly when there is no fixture state to purge', async () => {
    installExecMock({
      workspaces: '',
      playbooks: '',
      blockingWorkflows: '',
      workflows: '',
    });
    const fetchMock = installFetchTrap();

    await expect(resetWorkflowsState()).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(execFileSyncMock).toHaveBeenCalledTimes(5);
  });
});
