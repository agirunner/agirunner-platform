import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSearchResults, createDashboardApi } from './api.js';
import { clearSession, readSession, writeSession } from './session.js';

function readApiSource() {
  const contractsSource = readFileSync(
    resolve(import.meta.dirname, './dashboard-api/contracts.ts'),
    'utf8',
  );
  const implementationSource = readFileSync(
    resolve(import.meta.dirname, './dashboard-api/create-dashboard-api.ts'),
    'utf8',
  );
  return `${contractsSource}\n${implementationSource}`;
}

function readInterfaceBlock(source: string, interfaceName: string) {
  const start =
    source.indexOf(`export interface ${interfaceName} {`) >= 0
      ? source.indexOf(`export interface ${interfaceName} {`)
      : source.indexOf(`interface ${interfaceName} {`);
  if (start < 0) {
    throw new Error(`Interface ${interfaceName} not found`);
  }
  const end = source.indexOf('\n}\n', start);
  if (end < 0) {
    throw new Error(`Interface ${interfaceName} end not found`);
  }
  return source.slice(start, end);
}

function readExportBlock(source: string, name: string) {
  const interfaceStart = source.indexOf(`export interface ${name} {`);
  if (interfaceStart >= 0) {
    const end = source.indexOf('\n}\n', interfaceStart);
    if (end < 0) {
      throw new Error(`Interface ${name} end not found`);
    }
    return source.slice(interfaceStart, end);
  }

  const typeStart = source.indexOf(`export type ${name} =`);
  if (typeStart < 0) {
    throw new Error(`Export ${name} not found`);
  }
  let depth = 0;
  let seenEquals = false;
  for (let index = typeStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '=') {
      seenEquals = true;
    }
    if (!seenEquals) {
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (char === ';' && depth === 0) {
      return source.slice(typeStart, index);
    }
  }
  throw new Error(`Type ${name} end not found`);
}

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

describe('dashboard api auth/session behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockBrowserStorage();
    clearSession();
  });

  it('keeps live workflow contracts free of template and phase-era fields', () => {
    const workflowBlock = readExportBlock(readApiSource(), 'DashboardWorkflowRecord');

    expect(workflowBlock).not.toContain('template_id');
    expect(workflowBlock).not.toContain('template_name');
    expect(workflowBlock).not.toContain('template_version');
    expect(workflowBlock).not.toContain('current_phase');
    expect(workflowBlock).not.toContain('workflow_phase');
    expect(workflowBlock).not.toContain('phases');
  });

  it('keeps dashboard workflow and task records on canonical state aliases', () => {
    const source = readApiSource();
    const workflowBaseBlock = readInterfaceBlock(source, 'DashboardWorkflowRecordBase');
    const workflowBlock = readExportBlock(source, 'DashboardWorkflowRecord');

    expect(source).toContain('export type DashboardTaskState = TaskState;');
    expect(source).toContain('export type DashboardWorkflowState = WorkflowState;');
    expect(source).toContain('export interface DashboardTaskRecord extends Task {');
    expect(workflowBaseBlock).toContain('state: DashboardWorkflowState;');
    expect(workflowBlock).toContain("lifecycle: 'ongoing';");
    expect(workflowBlock).toContain('current_stage?: never;');
    expect(workflowBlock).toContain("lifecycle?: 'planned' | null;");
    expect(workflowBlock).toContain('current_stage?: string | null;');
    expect(workflowBlock).not.toContain('current_checkpoint');
    expect(source).not.toContain('DashboardApprovalTaskRecord');
    expect(source).not.toContain('DashboardWorkflowWorkItemCheckpointCompatibility');
    expect(source).not.toContain('DashboardWorkflowWorkItemCheckpointKey');
    expect(source).not.toContain('actOnStageGate(');
  });

  it('keeps workflow work-item actions on the workflow-scoped contract', () => {
    const source = readApiSource();
    const apiBlock = readExportBlock(source, 'DashboardApi');
    expect(apiBlock).toContain('retryWorkflowWorkItem(');
    expect(source).toContain(
      "requestWorkflowWorkItemAction(workflowId, workItemId, 'retry', payload)",
    );
    expect(apiBlock).toContain('skipWorkflowWorkItem(');
    expect(source).toContain(
      "requestWorkflowWorkItemAction(workflowId, workItemId, 'skip', payload)",
    );
    expect(apiBlock).toContain('reassignWorkflowWorkItemTask(');
    expect(source).toContain('requestWorkflowWorkItemTaskAction(');
    expect(source).toContain("'reassign'");
    expect(source).toContain('/reassign');
    expect(apiBlock).toContain('resolveWorkflowWorkItemTaskEscalation(');
    expect(source).toContain("'resolve-escalation'");
    expect(source).toContain('/resolve-escalation');
  });

  it('routes workflow-linked escalation resolution through the workflow work-item operator flow', async () => {
    writeSession({ accessToken: 'token-1', tenantId: 'tenant-1' });

    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ data: { id: 'task-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      baseUrl: 'http://platform.test',
      client: client as never,
      fetcher,
    });

    await api.resolveTaskEscalation(
      'task-1',
      { instructions: 'Resume with captured operator guidance.' },
      { workflowId: 'workflow-1', workItemId: 'wi-1' },
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'http://platform.test/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/resolve-escalation',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('keeps standalone escalation resolution on the raw task endpoint', async () => {
    writeSession({ accessToken: 'token-1', tenantId: 'tenant-1' });

    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ data: { id: 'task-standalone-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      baseUrl: 'http://platform.test',
      client: client as never,
      fetcher,
    });

    await api.resolveTaskEscalation('task-standalone-1', {
      instructions: 'Continue using the standalone task flow.',
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'http://platform.test/api/v1/tasks/task-standalone-1/resolve-escalation',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('exposes typed workspace settings posture in the dashboard api contract', () => {
    const source = readApiSource();
    const workspaceSettingsBlock = readExportBlock(source, 'DashboardWorkspaceSettingsRecord');
    const workspaceSettingsInputBlock = readExportBlock(source, 'DashboardWorkspaceSettingsInput');
    const workspaceSummaryBlock = readExportBlock(source, 'DashboardWorkspaceListSummary');
    const workspaceRecordBlock = readExportBlock(source, 'DashboardWorkspaceRecord');
    const patchWorkspaceBlock = readExportBlock(source, 'DashboardWorkspacePatchInput');

    expect(workspaceSettingsBlock).toContain('default_branch?: string | null;');
    expect(workspaceSettingsBlock).toContain('git_user_name?: string | null;');
    expect(workspaceSettingsBlock).toContain('git_user_email?: string | null;');
    expect(workspaceSettingsBlock).toContain('credentials?: DashboardWorkspaceCredentialPosture;');
    expect(workspaceSettingsBlock).not.toContain(
      'model_overrides?: Record<string, DashboardRoleModelOverride>;',
    );
    expect(workspaceSettingsBlock).toContain('workspace_brief?: string | null;');
    expect(workspaceSettingsInputBlock).toContain('credentials?: DashboardWorkspaceCredentialInput;');
    expect(workspaceSettingsInputBlock).not.toContain(
      'model_overrides?: Record<string, DashboardRoleModelOverride>;',
    );
    expect(workspaceSummaryBlock).toContain('active_workflow_count: number;');
    expect(workspaceSummaryBlock).toContain('completed_workflow_count: number;');
    expect(workspaceSummaryBlock).toContain('attention_workflow_count: number;');
    expect(workspaceRecordBlock).toContain('settings?: DashboardWorkspaceSettingsRecord;');
    expect(workspaceRecordBlock).toContain('summary?: DashboardWorkspaceListSummary;');
    expect(patchWorkspaceBlock).toContain('settings?: DashboardWorkspaceSettingsInput;');
  });

  it('exposes execution backend and tool ownership in dashboard api contracts', () => {
    const source = readApiSource();
    const toolTagBlock = readInterfaceBlock(source, 'DashboardToolTagRecord');
    const taskBlock = source.slice(
      source.indexOf('export interface DashboardTaskRecord extends Task {'),
      source.indexOf('\n}\n', source.indexOf('export interface DashboardTaskRecord extends Task {')),
    );
    const logEntryBlock = readInterfaceBlock(source, 'LogEntry');
    const liveContainerBlock = readInterfaceBlock(source, 'DashboardLiveContainerRecord');

    expect(toolTagBlock).toContain("owner?: 'runtime' | 'task';");
    expect(taskBlock).toContain("execution_backend: 'runtime_only' | 'runtime_plus_task';");
    expect(taskBlock).toContain('used_task_sandbox: boolean;');
    expect(taskBlock).toContain('execution_environment?: DashboardExecutionEnvironmentRecord | null;');
    expect(logEntryBlock).toContain("execution_backend?: 'runtime_only' | 'runtime_plus_task' | null;");
    expect(logEntryBlock).toContain("tool_owner?: 'runtime' | 'task' | null;");
    expect(logEntryBlock).toContain('execution_environment_name?: string | null;');
    expect(logEntryBlock).toContain('execution_environment_image?: string | null;');
    expect(logEntryBlock).toContain('execution_environment_distro?: string | null;');
    expect(logEntryBlock).toContain('execution_environment_package_manager?: string | null;');
    expect(liveContainerBlock).toContain(
      "execution_backend?: 'runtime_only' | 'runtime_plus_task' | null;",
    );
    expect(liveContainerBlock).toContain('execution_environment_name?: string | null;');
    expect(liveContainerBlock).toContain('execution_environment_image?: string | null;');
    expect(liveContainerBlock).toContain('execution_environment_distro?: string | null;');
    expect(liveContainerBlock).toContain('execution_environment_package_manager?: string | null;');
  });

  it('exposes typed mission control read models and read methods in the dashboard api contract', () => {
    const source = readApiSource();
    const apiBlock = readExportBlock(source, 'DashboardApi');
    const liveBlock = readExportBlock(source, 'DashboardMissionControlLiveResponse');
    const sectionBlock = readExportBlock(source, 'DashboardMissionControlLiveSection');
    const cardBlock = readExportBlock(source, 'DashboardMissionControlWorkflowCard');
    const packetBlock = readExportBlock(source, 'DashboardMissionControlPacket');
    const workspaceBlock = readExportBlock(source, 'DashboardMissionControlWorkspaceResponse');
    const actionBlock = readExportBlock(source, 'DashboardMissionControlActionAvailability');
    const outputBlock = readExportBlock(source, 'DashboardMissionControlOutputDescriptor');

    expect(apiBlock).toContain('getMissionControlLive(');
    expect(apiBlock).toContain('getMissionControlRecent(');
    expect(apiBlock).toContain('getMissionControlHistory(');
    expect(apiBlock).toContain('getMissionControlWorkflowWorkspace(');
    expect(liveBlock).toContain('sections: DashboardMissionControlLiveSection[];');
    expect(liveBlock).toContain('attentionItems: DashboardMissionControlAttentionItem[];');
    expect(sectionBlock).toContain("id: 'needs_action' | 'at_risk' | 'progressing' | 'waiting' | 'recently_changed';");
    expect(cardBlock).toContain('posture: DashboardMissionControlWorkflowPosture;');
    expect(cardBlock).toContain('outputDescriptors: DashboardMissionControlOutputDescriptor[];');
    expect(cardBlock).toContain('availableActions: DashboardMissionControlActionAvailability[];');
    expect(packetBlock).toContain('carryover: boolean;');
    expect(workspaceBlock).toContain('workflow: DashboardMissionControlWorkflowCard | null;');
    expect(workspaceBlock).toContain('overview: DashboardMissionControlWorkspaceOverview | null;');
    expect(workspaceBlock).toContain('interventionHistory: DashboardMissionControlPacket[];');
    expect(actionBlock).toContain('confirmationLevel: DashboardMissionControlConfirmationLevel;');
    expect(outputBlock).toContain('primaryLocation: DashboardMissionControlOutputLocation;');
  });

  it('refreshes token and retries request when access token is expired', async () => {
    writeSession({ accessToken: 'expired-token', tenantId: 'tenant-1' });

    const listWorkflows = vi
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 401: token expired'))
      .mockResolvedValueOnce({
        data: [],
        pagination: { page: 1, per_page: 50, total: 0, total_pages: 1 },
      });

    const client = {
      refreshSession: vi.fn().mockResolvedValue({ token: 'fresh-token' }),
      setAccessToken: vi.fn(),
      listWorkflows,
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({ client: client as never });

    await api.listWorkflows();

    expect(client.refreshSession).toHaveBeenCalledTimes(1);
    expect(client.setAccessToken).toHaveBeenCalledWith('fresh-token');
    expect(listWorkflows).toHaveBeenCalledTimes(2);
    expect(readSession()).toEqual({
      accessToken: 'fresh-token',
      tenantId: 'tenant-1',
      persistentSession: false,
    });
  });

  it('requests mission control live, recent, history, and workflow workspace read models from the platform api', async () => {
    writeSession({ accessToken: 'mc-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn() as unknown as typeof fetch;
    vi.mocked(fetcher)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              version: {
                generatedAt: '2026-03-27T18:00:00.000Z',
                latestEventId: 10,
                token: 'live-token',
              },
              sections: [],
              attentionItems: [],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              version: {
                generatedAt: '2026-03-27T18:01:00.000Z',
                latestEventId: 11,
                token: 'recent-token',
              },
              packets: [],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              version: {
                generatedAt: '2026-03-27T18:02:00.000Z',
                latestEventId: 12,
                token: 'history-token',
              },
              packets: [],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              version: {
                generatedAt: '2026-03-27T18:03:00.000Z',
                latestEventId: 13,
                token: 'workspace-token',
              },
              workflow: null,
              overview: null,
              board: null,
              outputs: {
                deliverables: [],
                feed: [],
              },
              steering: {
                availableActions: [],
                interventionHistory: [],
              },
              history: {
                packets: [],
              },
            },
          }),
          { status: 200 },
        ),
      );

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.getMissionControlLive({ page: 2, perPage: 25 });
    await api.getMissionControlRecent({ limit: 15 });
    await api.getMissionControlHistory({ workflowId: 'workflow-1', limit: 20 });
    await api.getMissionControlWorkflowWorkspace('workflow-1', {
      historyLimit: 12,
      outputLimit: 4,
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v1/operations/workflows?mode=live&page=2&per_page=25',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer mc-token',
        }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v1/operations/workflows?mode=recent&limit=15',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v1/operations/workflows?mode=history&workflow_id=workflow-1&limit=20',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      'http://localhost:8080/api/v1/operations/workflows/workflow-1/workspace?history_limit=12&output_limit=4',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
  });

  it('clears session and redirects to login when refresh token is expired', async () => {
    writeSession({ accessToken: 'expired-token', tenantId: 'tenant-1' });

    const locationAssign = vi.fn();
    vi.stubGlobal('window', {
      location: {
        assign: locationAssign,
      },
    });

    const client = {
      refreshSession: vi.fn().mockRejectedValue(new Error('HTTP 401: refresh expired')),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn().mockRejectedValue(new Error('HTTP 401: token expired')),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({ client: client as never });

    await expect(api.listWorkflows()).rejects.toThrow('HTTP 401: refresh expired');
    expect(readSession()).toBeNull();
    expect(locationAssign).toHaveBeenCalledWith('/login');
  });

  it('persists tenant bootstrap in localStorage and keeps the access token session-scoped by default', async () => {
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi
        .fn()
        .mockResolvedValue({ token: 'ephemeral-token', tenant_id: 'tenant-1' }),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({ client: client as never });
    await api.login('ar_admin_test_key');

    expect(readSession()).toEqual({
      accessToken: 'ephemeral-token',
      tenantId: 'tenant-1',
      persistentSession: true,
    });
    expect(sessionStorage.getItem('agirunner.tenantId')).toBeNull();
    expect(localStorage.getItem('agirunner.tenantId')).toBe('tenant-1');
    expect(localStorage.getItem('agirunner.accessToken')).toBeNull();
    expect(sessionStorage.getItem('agirunner.accessToken')).toBe('ephemeral-token');
  });

  it('keeps tenant bootstrap in sessionStorage when persistent login is disabled', async () => {
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi
        .fn()
        .mockResolvedValue({ token: 'ephemeral-token', tenant_id: 'tenant-1' }),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({ client: client as never });
    await api.login('ar_admin_test_key', false);

    expect(readSession()).toEqual({
      accessToken: 'ephemeral-token',
      tenantId: 'tenant-1',
      persistentSession: false,
    });
    expect(sessionStorage.getItem('agirunner.tenantId')).toBe('tenant-1');
    expect(localStorage.getItem('agirunner.tenantId')).toBeNull();
    expect(localStorage.getItem('agirunner.accessToken')).toBeNull();
    expect(sessionStorage.getItem('agirunner.accessToken')).toBe('ephemeral-token');
  });

  it('calls server-side logout before clearing the local session', async () => {
    writeSession({ accessToken: 'logout-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { logged_out: true } }), { status: 200 }),
      ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });
    await api.logout();

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/auth/logout',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }),
    );
    expect(readSession()).toBeNull();
  });

  it('treats 204 no-content deletes as success for llm providers', async () => {
    writeSession({ accessToken: 'api-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 })) as unknown as typeof fetch;

    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await expect(api.deleteLlmProvider('provider-1')).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/config/llm/providers/provider-1',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer api-token',
        }),
      }),
    );
  });

  it('treats 204 no-content deletes as success for remote MCP servers', async () => {
    writeSession({ accessToken: 'api-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 })) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await expect(api.deleteRemoteMcpServer('mcp-1')).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/remote-mcp-servers/mcp-1',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer api-token',
        }),
      }),
    );
  });

  it('deletes workspace memory entries through the dedicated workspace-memory delete route', async () => {
    writeSession({ accessToken: 'api-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { id: 'workspace-1', memory: {} } }), { status: 200 }),
      ) as unknown as typeof fetch;

    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.removeWorkspaceMemory('workspace-1', 'operator_note');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workspaces/workspace-1/memory/operator_note',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer api-token',
        }),
      }),
    );
  });

  it('manages workspace-owned artifact files through dedicated workspace file routes', async () => {
    writeSession({ accessToken: 'artifact-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn() as unknown as typeof fetch;
    vi
      .mocked(fetcher)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'file-1',
                workspace_id: 'workspace-1',
                key: 'brief-md',
                description: 'Initial brief',
                file_name: 'brief.md',
                content_type: 'text/markdown',
                size_bytes: 128,
                created_at: '2026-03-14T18:00:00.000Z',
                download_url: '/api/v1/workspaces/workspace-1/files/file-1/content',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'file-1',
                workspace_id: 'workspace-1',
                key: 'brief-md',
                description: 'Initial brief',
                file_name: 'brief.md',
                content_type: 'text/markdown',
                size_bytes: 128,
                created_at: '2026-03-14T18:00:00.000Z',
                download_url: '/api/v1/workspaces/workspace-1/files/file-1/content',
              },
            ],
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response('artifact-bytes', {
          status: 200,
          headers: {
            'content-type': 'text/markdown; charset=utf-8',
            'content-disposition': 'attachment; filename="brief.md"',
            'content-length': '14',
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 })) as unknown as typeof fetch;

    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const files = await api.listWorkspaceArtifactFiles('workspace-1');
    await api.uploadWorkspaceArtifactFiles('workspace-1', [
      {
        file_name: 'brief.md',
        description: 'Initial brief',
        content_base64: Buffer.from('# Brief').toString('base64'),
        content_type: 'text/markdown',
      },
    ]);
    const download = await api.downloadWorkspaceArtifactFile('workspace-1', 'file-1');
    await api.deleteWorkspaceArtifactFile('workspace-1', 'file-1');

    expect(files[0]?.key).toBe('brief-md');
    expect(download.file_name).toBe('brief.md');
    expect(download.content_type).toBe('text/markdown; charset=utf-8');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/workspaces/workspace-1/files',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/workspaces/workspace-1/files/batch',
    );
    expect(vi.mocked(fetcher).mock.calls[2][0]).toBe(
      'http://localhost:8080/api/v1/workspaces/workspace-1/files/file-1/content',
    );
    expect(vi.mocked(fetcher).mock.calls[3][0]).toBe(
      'http://localhost:8080/api/v1/workspaces/workspace-1/files/file-1',
    );
  });

  it('creates playbook workflows through the dashboard api surface', async () => {
    writeSession({ accessToken: 'api-token', tenantId: 'tenant-1' });

    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn().mockResolvedValue({ id: 'pipe-1' }),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      baseUrl: 'http://localhost:8080',
    });
    const workflow = await api.createWorkflow({
      playbook_id: 'playbook-1',
      name: 'Test Run',
      budget: {
        token_budget: 120000,
        cost_cap_usd: 12.5,
        max_duration_minutes: 90,
      },
    });

    expect(client.createWorkflow).toHaveBeenCalledWith({
      playbook_id: 'playbook-1',
      name: 'Test Run',
      budget: {
        token_budget: 120000,
        cost_cap_usd: 12.5,
        max_duration_minutes: 90,
      },
    });
    expect(workflow).toEqual({ id: 'pipe-1' });
  });

  it('loads workflow budget through the dashboard api surface', async () => {
    writeSession({ accessToken: 'budget-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            tokens_used: 45000,
            tokens_limit: 120000,
            cost_usd: 6.25,
            cost_limit_usd: 12.5,
            elapsed_minutes: 42,
            duration_limit_minutes: 90,
            task_count: 6,
            orchestrator_activations: 4,
            tokens_remaining: 75000,
            cost_remaining_usd: 6.25,
            time_remaining_minutes: 48,
            warning_dimensions: ['cost'],
            exceeded_dimensions: [],
            warning_threshold_ratio: 0.8,
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const budget = await api.getWorkflowBudget('workflow-1');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workflows/workflow-1/budget',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer budget-token',
        }),
      }),
    );
    expect(budget.tokens_remaining).toBe(75000);
    expect(budget.warning_dimensions).toEqual(['cost']);
  });

  it('loads workflow events through the cursor-based workflow api surface', async () => {
    writeSession({ accessToken: 'events-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 42,
              type: 'workflow.activation_started',
              entity_type: 'workflow',
              entity_id: 'workflow-1',
              actor_type: 'orchestrator',
              actor_id: 'task-1',
              data: { workflow_id: 'workflow-1', activation_id: 'activation-1' },
              created_at: '2026-03-12T12:00:00.000Z',
            },
          ],
          meta: {
            has_more: true,
            next_after: 42,
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });
    const response = await api.listWorkflowEvents('workflow-1', {
      limit: '20',
      after: '100',
    });

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workflows/workflow-1/events?limit=20&after=100',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer events-token',
        }),
      }),
    );
    expect(response).toEqual({
      data: [
        {
          id: 42,
          type: 'workflow.activation_started',
          entity_type: 'workflow',
          entity_id: 'workflow-1',
          actor_type: 'orchestrator',
          actor_id: 'task-1',
          data: { workflow_id: 'workflow-1', activation_id: 'activation-1' },
          created_at: '2026-03-12T12:00:00.000Z',
        },
      ],
      meta: {
        has_more: true,
        next_after: '42',
      },
    });
  });

  it('enqueues manual workflow activations through the dashboard api surface', async () => {
    writeSession({ accessToken: 'activation-token', tenantId: 'tenant-1' });
    vi.stubGlobal('crypto', {
      randomUUID: () => 'request-123',
    });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: 'activation-1',
            activation_id: 'activation-1',
            workflow_id: 'workflow-1',
            request_id: 'request-123',
            reason: 'Reassess board state',
            event_type: 'operator.manual_enqueue',
            payload: { source: 'workflow-detail-activations-card' },
            state: 'queued',
            queued_at: '2026-03-13T12:00:00.000Z',
          },
        }),
        { status: 201 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const activation = await api.enqueueWorkflowActivation('workflow-1', {
      reason: 'Reassess board state',
      payload: { source: 'workflow-detail-activations-card' },
    });

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workflows/workflow-1/activations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer activation-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body ?? '{}'))).toEqual({
      request_id: 'request-123',
      reason: 'Reassess board state',
      event_type: 'operator.manual_enqueue',
      payload: { source: 'workflow-detail-activations-card' },
    });
    expect(activation.request_id).toBe('request-123');
    expect(activation.event_type).toBe('operator.manual_enqueue');
  });

  it('posts workflow cancellation with a generated request id', async () => {
    writeSession({ accessToken: 'workflow-token', tenantId: 'tenant-1' });
    vi.stubGlobal('crypto', {
      randomUUID: () => 'cancel-request-123',
    });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: 'workflow-1',
            state: 'paused',
            metadata: { cancel_requested_at: '2026-03-13T12:00:00.000Z' },
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.cancelWorkflow('workflow-1');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workflows/workflow-1/cancel',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer workflow-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body ?? '{}'))).toEqual({
      request_id: 'cancel-request-123',
    });
  });

  it('posts workflow pause with a generated request id', async () => {
    writeSession({ accessToken: 'workflow-token', tenantId: 'tenant-1' });
    vi.stubGlobal('crypto', {
      randomUUID: () => 'pause-request-123',
    });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: 'workflow-1',
            state: 'paused',
            metadata: { pause_requested_at: '2026-03-13T12:00:00.000Z' },
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.pauseWorkflow('workflow-1');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workflows/workflow-1/pause',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer workflow-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body ?? '{}'))).toEqual({
      request_id: 'pause-request-123',
    });
  });

  it('posts workflow resume with a generated request id', async () => {
    writeSession({ accessToken: 'workflow-token', tenantId: 'tenant-1' });
    vi.stubGlobal('crypto', {
      randomUUID: () => 'resume-request-123',
    });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: 'workflow-1',
            state: 'active',
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.resumeWorkflow('workflow-1');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workflows/workflow-1/resume',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer workflow-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body ?? '{}'))).toEqual({
      request_id: 'resume-request-123',
    });
  });

  it('updates playbooks through the dashboard api surface', async () => {
    writeSession({ accessToken: 'api-token', tenantId: 'tenant-1' });

    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      updatePlaybook: vi.fn().mockResolvedValue({ id: 'playbook-1', name: 'Delivery' }),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      baseUrl: 'http://localhost:8080',
    });
    const playbook = await api.updatePlaybook('playbook-1', {
      name: 'Delivery',
      outcome: 'Ship work',
      definition: { lifecycle: 'ongoing' },
    });

    expect(client.updatePlaybook).toHaveBeenCalledWith('playbook-1', {
      name: 'Delivery',
      outcome: 'Ship work',
      definition: { lifecycle: 'ongoing' },
    });
    expect(playbook).toEqual({ id: 'playbook-1', name: 'Delivery' });
  });

  it('does not expose retired workspace or workflow model override endpoints through the dashboard api surface', () => {
    const source = readApiSource();
    const dashboardApiBlock = readExportBlock(source, 'DashboardApi');
    const createWorkflowBlock = source.slice(
      source.indexOf('createWorkflow(payload: {'),
      source.indexOf('\n  createWorkflowWorkItem(', source.indexOf('createWorkflow(payload: {')),
    );

    expect(dashboardApiBlock).not.toContain('getWorkspaceModelOverrides(');
    expect(dashboardApiBlock).not.toContain('getResolvedWorkspaceModels(');
    expect(dashboardApiBlock).not.toContain('getWorkflowModelOverrides(');
    expect(dashboardApiBlock).not.toContain('getResolvedWorkflowModels(');
    expect(dashboardApiBlock).not.toContain('previewEffectiveModels(');
    expect(createWorkflowBlock).not.toContain('model_overrides?: Record<string, DashboardRoleModelOverride>;');
    expect(source).not.toContain('/api/v1/workspaces/${workspaceId}/model-overrides');
    expect(source).not.toContain('/api/v1/workflows/${workflowId}/model-overrides');
    expect(source).not.toContain('/api/v1/config/llm/resolve-preview');
  });

  it('loads and updates workflow work items through the dashboard api surface', async () => {
    writeSession({ accessToken: 'api-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'wi-1',
              workflow_id: 'wf-1',
              stage_name: 'build',
              title: 'Implement feature',
              column_id: 'todo',
              priority: 'normal',
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'wi-1',
              workflow_id: 'wf-1',
              stage_name: 'build',
              title: 'Implement feature',
              column_id: 'todo',
              priority: 'high',
              notes: 'Updated',
            },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });
    const workItem = await api.getWorkflowWorkItem('wf-1', 'wi-1');
    const updatedWorkItem = await api.updateWorkflowWorkItem('wf-1', 'wi-1', {
      priority: 'high',
      notes: 'Updated',
    });

    expect(workItem.id).toBe('wi-1');
    expect(updatedWorkItem.priority).toBe('high');
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v1/workflows/wf-1/work-items/wi-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v1/workflows/wf-1/work-items/wi-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('verifies workspace git access through the dashboard api surface', async () => {
    writeSession({ accessToken: 'api-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            ok: true,
            repository_url: 'https://github.com/example/private-repo.git',
            default_branch: 'main',
            branch_verified: true,
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const result = await (api as any).verifyWorkspaceGitAccess('workspace-1', {
      repository_url: 'https://github.com/example/private-repo.git',
      default_branch: 'main',
      git_token_mode: 'preserve',
    });

    expect(result).toEqual({
      ok: true,
      repository_url: 'https://github.com/example/private-repo.git',
      default_branch: 'main',
      branch_verified: true,
    });
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workspaces/workspace-1/verify-git-access',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          repository_url: 'https://github.com/example/private-repo.git',
          default_branch: 'main',
          git_token_mode: 'preserve',
        }),
      }),
    );
  });

  it('sends bearer token when loading metrics if an in-memory access token exists', async () => {
    writeSession({ accessToken: 'metrics-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 200 })) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });
    const body = await api.getMetrics();

    expect(body).toBe('ok');
    const [, options] = vi.mocked(fetcher).mock.calls[0];
    const headers = options?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer metrics-token');
  });

  it('loads metrics using cookie-only auth when no in-memory access token exists', async () => {
    writeSession({ accessToken: null, tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 200 })) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });
    const body = await api.getMetrics();

    expect(body).toBe('ok');
    const [, options] = vi.mocked(fetcher).mock.calls[0];
    expect(options?.headers).toBeUndefined();
    expect(options?.credentials).toBe('include');
  });

  it('loads the cost dashboard summary through the shared dashboard client contract', async () => {
    writeSession({ accessToken: 'cost-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            today: 1,
            this_week: 2,
            this_month: 3,
            budget_total: 4,
            budget_remaining: 1,
            by_workflow: [],
            by_model: [],
            daily_trend: [],
            totalTokensInput: 10,
            totalTokensOutput: 20,
            totalCostUsd: 3,
            totalWallTimeMs: 400,
            eventCount: 2,
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });
    const summary = await api.getCostSummary();

    expect(summary.totalCostUsd).toBe(3);
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/metering/summary',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('calls runtime customization endpoints with typed dashboard methods', async () => {
    writeSession({ accessToken: 'runtime-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              state: 'unconfigured',
              customization_enabled: false,
              active_digest: 'ghcr.io/agirunner/runtime:base',
              resolved_reasoning: {
                orchestrator_level: 'medium',
                internal_workers_level: 'medium',
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              valid: true,
              manifest: {
                template: 'node',
                base_image: 'ghcr.io/agirunner/runtime@sha256:1234',
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              build_id: 'build-1',
              state: 'gated',
              link_ready: true,
              digest: 'sha256:build',
              manifest: {
                template: 'node',
                base_image: 'ghcr.io/agirunner/runtime@sha256:1234',
              },
            },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });
    const status = await api.getCustomizationStatus();
    const validation = await api.validateCustomization({
      manifest: {
        template: 'node',
        base_image: 'ghcr.io/agirunner/runtime@sha256:1234',
      },
    });
    const build = await api.createCustomizationBuild({
      manifest: {
        template: 'node',
        base_image: 'ghcr.io/agirunner/runtime@sha256:1234',
      },
    });

    expect(status.state).toBe('unconfigured');
    expect(validation.valid).toBe(true);
    expect(build.build_id).toBe('build-1');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/runtime/customizations/status',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/runtime/customizations/validate',
    );
    expect(vi.mocked(fetcher).mock.calls[2][0]).toBe(
      'http://localhost:8080/api/v1/runtime/customizations/builds',
    );
  });

  it('supports reconstruct export and build link through the dashboard api', async () => {
    writeSession({ accessToken: 'runtime-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              state: 'linked',
              manifest: {
                template: 'python',
                base_image: 'ghcr.io/agirunner/runtime@sha256:5678',
              },
              profile: {
                manifest: {
                  template: 'python',
                  base_image: 'ghcr.io/agirunner/runtime@sha256:5678',
                },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              artifact_type: 'profile',
              format: 'yaml',
              content: 'name: runtime-profile',
              redaction_applied: true,
              scan_passed: true,
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              build_id: 'build-2',
              state: 'linked',
              linked: true,
              configured_digest: 'sha256:build-2',
              active_digest: 'sha256:base',
            },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });
    const reconstruct = await api.reconstructCustomization();
    const exported = await api.exportCustomization({ artifact_type: 'profile', format: 'yaml' });
    const linked = await api.linkCustomizationBuild({ build_id: 'build-2' });

    expect(reconstruct.profile.manifest.template).toBe('python');
    expect(exported.redaction_applied).toBe(true);
    expect(linked.linked).toBe(true);
    const validateCall = vi.mocked(fetcher).mock.calls[1];
    expect(validateCall[0]).toBe(
      'http://localhost:8080/api/v1/runtime/customizations/reconstruct/export',
    );
    expect(validateCall[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }),
    );
  });

  it('calls workflow cockpit endpoints with typed dashboard methods', async () => {
    writeSession({ accessToken: 'workflow-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { workflow_id: 'pipe-1', resolved_config: { retries: 2 } } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ workflow_id: 'pipe-1', kind: 'run_summary' }] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'artifact-1',
                workflow_id: 'pipe-1',
                task_id: 'task-1',
                logical_path: 'artifact:pipe-1/release-notes.md',
                content_type: 'text/markdown',
                size_bytes: 2048,
                created_at: '2026-03-12T08:00:00.000Z',
                download_url: '/api/v1/tasks/task-1/artifacts/artifact-1',
                metadata: {},
                workflow_name: 'Ship release',
                workflow_state: 'active',
                work_item_id: 'wi-1',
                work_item_title: 'Package release',
                stage_name: 'delivery',
                role: 'writer',
                task_title: 'Build release notes',
                task_state: 'completed',
                preview_eligible: true,
                preview_mode: 'text',
              },
            ],
            meta: {
              page: 1,
              per_page: 50,
              total: 1,
              total_pages: 1,
              has_more: false,
              summary: {
                total_artifacts: 1,
                previewable_artifacts: 1,
                total_bytes: 2048,
                workflow_count: 1,
                work_item_count: 1,
                task_count: 1,
                role_count: 1,
              },
              filters: {
                workflows: [{ id: 'pipe-1', name: 'Ship release' }],
                work_items: [
                  {
                    id: 'wi-1',
                    title: 'Package release',
                    workflow_id: 'pipe-1',
                    stage_name: 'delivery',
                  },
                ],
                tasks: [
                  {
                    id: 'task-1',
                    title: 'Build release notes',
                    workflow_id: 'pipe-1',
                    work_item_id: 'wi-1',
                    stage_name: 'delivery',
                  },
                ],
                stages: ['delivery'],
                roles: ['writer'],
                content_types: ['text/markdown'],
              },
            },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const config = await api.getResolvedWorkflowConfig('pipe-1', true);
    const timeline = await api.getWorkspaceTimeline('workspace-1');
    const artifacts = await api.listWorkspaceArtifacts('workspace-1', {
      q: 'release',
      preview_mode: 'inline',
      page: '1',
      per_page: '50',
    });

    expect(config.resolved_config).toEqual({ retries: 2 });
    expect(timeline[0].kind).toBe('run_summary');
    expect(artifacts.data[0]?.id).toBe('artifact-1');
    expect(artifacts.meta.summary.total_artifacts).toBe(1);
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/workflows/pipe-1/config/resolved?show_layers=true',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/workspaces/workspace-1/timeline',
    );
    expect(vi.mocked(fetcher).mock.calls[2][0]).toBe(
      'http://localhost:8080/api/v1/workspaces/workspace-1/artifacts?q=release&preview_mode=inline&page=1&per_page=50',
    );
  });

  it('lists workspaces and starts a planning workflow through typed dashboard methods', async () => {
    writeSession({ accessToken: 'planning-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'workspace-1',
                name: 'Alpha',
                slug: 'alpha',
                summary: {
                  active_workflow_count: 1,
                  completed_workflow_count: 3,
                  attention_workflow_count: 2,
                },
              },
            ],
            meta: { total: 1 },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'pipe-9', name: 'AI Planning' } }), {
          status: 201,
        }),
      ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const workspaces = await api.listWorkspaces();
    const planning = await api.createPlanningWorkflow('workspace-1', {
      brief: 'Plan the next workflow increment.',
      name: 'AI Planning',
    });

    expect(workspaces.data[0].id).toBe('workspace-1');
    expect(workspaces.data[0].summary).toEqual({
      active_workflow_count: 1,
      completed_workflow_count: 3,
      attention_workflow_count: 2,
    });
    expect((planning as { data?: { id?: string } }).data?.id).toBe('pipe-9');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/workspaces?per_page=50',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/workspaces/workspace-1/planning-workflow',
    );
  });

  it('loads content and memory surfaces through typed dashboard methods', async () => {
    writeSession({ accessToken: 'content-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'workspace-1',
              name: 'Atlas',
              slug: 'atlas',
              memory: {
                last_run_summary: { kind: 'run_summary' },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'workspace-1',
              name: 'Atlas',
              slug: 'atlas',
              memory: {
                last_run_summary: { kind: 'run_summary' },
                operator_note: { summary: 'check rollout' },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                logical_name: 'workspace_brief',
                scope: 'workspace',
                source: 'repository',
                repository: 'origin',
                path: 'docs/brief.md',
                metadata: {},
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'artifact-1',
                task_id: 'task-1',
                logical_path: 'artifact:pipe-1/report.json',
                content_type: 'application/json',
                size_bytes: 128,
                checksum_sha256: 'abc',
                metadata: {},
                retention_policy: {},
                created_at: '2026-03-07T00:00:00.000Z',
                download_url: '/api/v1/tasks/task-1/artifacts/artifact-1',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              entries: [
                {
                  key: 'summary',
                  value: { ok: true },
                  event_id: 12,
                  updated_at: '2026-03-07T00:00:00.000Z',
                  actor_type: 'agent',
                  actor_id: 'agent-1',
                  workflow_id: 'pipe-1',
                  work_item_id: 'wi-1',
                  task_id: 'task-1',
                  stage_name: 'design',
                },
              ],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              history: [
                {
                  key: 'summary',
                  value: { ok: true },
                  event_id: 13,
                  event_type: 'updated',
                  updated_at: '2026-03-08T00:00:00.000Z',
                  actor_type: 'agent',
                  actor_id: 'agent-1',
                  workflow_id: 'pipe-1',
                  work_item_id: 'wi-1',
                  task_id: 'task-1',
                  stage_name: 'design',
                },
              ],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response('# Summary\n\nSafe content', {
          status: 200,
          headers: {
            'content-type': 'text/markdown; charset=utf-8',
            'content-disposition': 'attachment; filename="summary.md"',
            'content-length': '23',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response('artifact-bytes', {
          status: 200,
          headers: {
            'content-type': 'application/octet-stream',
            'content-disposition': 'attachment; filename="bundle.zip"',
            'content-length': '14',
          },
        }),
      ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const workspace = await api.getWorkspace('workspace-1');
    const updated = await api.patchWorkspaceMemory('workspace-1', {
      key: 'operator_note',
      value: { summary: 'check rollout' },
    });
    const documents = await api.listWorkflowDocuments('pipe-1');
    const artifacts = await api.listTaskArtifacts('task-1');
    const workItemMemory = await api.getWorkflowWorkItemMemory('pipe-1', 'wi-1');
    const workItemMemoryHistory = await api.getWorkflowWorkItemMemoryHistory('pipe-1', 'wi-1');
    const artifactContent = await api.readTaskArtifactContent('task-1', 'artifact-1');
    const artifactDownload = await api.downloadTaskArtifact('task-1', 'artifact-1');

    expect(workspace.memory?.last_run_summary).toEqual({ kind: 'run_summary' });
    expect(updated.memory?.operator_note).toEqual({ summary: 'check rollout' });
    expect(documents[0].logical_name).toBe('workspace_brief');
    expect(artifacts[0].id).toBe('artifact-1');
    expect(workItemMemory.entries[0]?.key).toBe('summary');
    expect(workItemMemoryHistory.history[0]?.event_type).toBe('updated');
    expect(artifactContent.file_name).toBe('summary.md');
    expect(artifactContent.content_type).toBe('text/markdown; charset=utf-8');
    expect(artifactDownload.file_name).toBe('bundle.zip');
    expect(artifactDownload.content_type).toBe('application/octet-stream');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/workspaces/workspace-1',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/workspaces/workspace-1/memory',
    );
    expect(vi.mocked(fetcher).mock.calls[2][0]).toBe(
      'http://localhost:8080/api/v1/workflows/pipe-1/documents',
    );
    expect(vi.mocked(fetcher).mock.calls[3][0]).toBe(
      'http://localhost:8080/api/v1/tasks/task-1/artifacts',
    );
    expect(vi.mocked(fetcher).mock.calls[4][0]).toBe(
      'http://localhost:8080/api/v1/workflows/pipe-1/work-items/wi-1/memory',
    );
    expect(vi.mocked(fetcher).mock.calls[5][0]).toBe(
      'http://localhost:8080/api/v1/workflows/pipe-1/work-items/wi-1/memory/history?limit=100',
    );
    expect(vi.mocked(fetcher).mock.calls[6][0]).toBe(
      'http://localhost:8080/api/v1/tasks/task-1/artifacts/artifact-1',
    );
    expect(vi.mocked(fetcher).mock.calls[7][0]).toBe(
      'http://localhost:8080/api/v1/tasks/task-1/artifacts/artifact-1',
    );
  });

  it('surfaces schema validation details in HTTP error messages', async () => {
    writeSession({ accessToken: 'content-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: 'Invalid request body',
            details: {
              issues: {
                fieldErrors: {
                  cadence_minutes: ['cadence_minutes is required for interval schedules'],
                },
                formErrors: [],
              },
            },
          },
        }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {
        refreshSession: vi.fn(),
        setAccessToken: vi.fn(),
        listWorkflows: vi.fn(),
        exchangeApiKey: vi.fn(),
        getWorkflow: vi.fn(),
        createWorkflow: vi.fn(),
        listTasks: vi.fn(),
        getTask: vi.fn(),
        listWorkers: vi.fn(),
        listAgents: vi.fn(),
      } as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await expect(
      api.createWorkflowDocument('wf-1', {
        logical_name: 'broken-schedule',
        source: 'repository',
      }),
    ).rejects.toThrow(
      'HTTP 422: Invalid request body (cadence_minutes is required for interval schedules)',
    );
  });

  it('manages workflow documents and task artifacts through typed dashboard mutations', async () => {
    writeSession({ accessToken: 'content-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn() as unknown as typeof fetch;
    vi
      .mocked(fetcher)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              logical_name: 'workspace_brief',
              scope: 'workflow',
              source: 'repository',
              title: 'Workspace Brief',
              description: 'Primary brief',
              metadata: { audience: 'operator' },
              repository: 'org/repo',
              path: 'docs/brief.md',
            },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              logical_name: 'workspace_brief',
              scope: 'workflow',
              source: 'external',
              title: 'Workspace Brief',
              description: 'Updated brief',
              metadata: { audience: 'operator' },
              url: 'https://example.com/brief',
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'artifact-2',
              task_id: 'task-1',
              logical_path: 'artifact:task-1/report.md',
              content_type: 'text/markdown',
              size_bytes: 128,
              checksum_sha256: 'abc',
              metadata: { source: 'smoke' },
              retention_policy: {},
              created_at: '2026-03-12T00:00:00.000Z',
              download_url: '/api/v1/tasks/task-1/artifacts/artifact-2',
            },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 })) as unknown as typeof fetch;

    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const createdDocument = await api.createWorkflowDocument('pipe-1', {
      logical_name: 'workspace_brief',
      source: 'repository',
      repository: 'org/repo',
      path: 'docs/brief.md',
      metadata: { audience: 'operator' },
    });
    const updatedDocument = await api.updateWorkflowDocument('pipe-1', 'workspace_brief', {
      source: 'external',
      url: 'https://example.com/brief',
      description: 'Updated brief',
    });
    await api.deleteWorkflowDocument('pipe-1', 'workspace_brief');
    const uploadedArtifact = await api.uploadTaskArtifact('task-1', {
      path: 'artifact:task-1/report.md',
      content_base64: 'Ym9keQ==',
      content_type: 'text/markdown',
      metadata: { source: 'smoke' },
    });
    await api.deleteTaskArtifact('task-1', 'artifact-2');

    expect(createdDocument.logical_name).toBe('workspace_brief');
    expect(updatedDocument.source).toBe('external');
    expect(uploadedArtifact.id).toBe('artifact-2');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/workflows/pipe-1/documents',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/workflows/pipe-1/documents/workspace_brief',
    );
    expect(String(vi.mocked(fetcher).mock.calls[2][0])).toMatch(
      /^http:\/\/localhost:8080\/api\/v1\/workflows\/pipe-1\/documents\/workspace_brief\?request_id=/,
    );
    expect(vi.mocked(fetcher).mock.calls[3][0]).toBe(
      'http://localhost:8080/api/v1/tasks/task-1/artifacts',
    );
    expect(vi.mocked(fetcher).mock.calls[4][0]).toBe(
      'http://localhost:8080/api/v1/tasks/task-1/artifacts/artifact-2',
    );
    expect(vi.mocked(fetcher).mock.calls[0][1]?.method).toBe('POST');
    expect(vi.mocked(fetcher).mock.calls[1][1]?.method).toBe('PATCH');
    expect(vi.mocked(fetcher).mock.calls[2][1]?.method).toBe('DELETE');
    expect(vi.mocked(fetcher).mock.calls[3][1]?.method).toBe('POST');
    expect(vi.mocked(fetcher).mock.calls[4][1]?.method).toBe('DELETE');
  });

  it('loads split fleet pool status and fleet worker desired state through typed dashboard methods', async () => {
    writeSession({ accessToken: 'fleet-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn() as unknown as typeof fetch;
    vi.mocked(fetcher)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              global_max_runtimes: 20,
              total_running: 9,
              total_idle: 4,
              total_executing: 7,
              total_draining: 1,
              worker_pools: [
                {
                  pool_kind: 'orchestrator',
                  desired_workers: 2,
                  desired_replicas: 2,
                  enabled_workers: 2,
                  draining_workers: 0,
                  running_containers: 2,
                },
                {
                  pool_kind: 'specialist',
                  desired_workers: 4,
                  desired_replicas: 8,
                  enabled_workers: 4,
                  draining_workers: 1,
                  running_containers: 7,
                },
              ],
              by_playbook: [],
              by_playbook_pool: [
                {
                  playbook_id: 'pb-1',
                  playbook_name: 'Ship V2',
                  pool_kind: 'orchestrator',
                  pool_mode: 'warm',
                  max_runtimes: 2,
                  running: 2,
                  idle: 0,
                  executing: 1,
                  pending_tasks: 0,
                  active_workflows: 3,
                  draining: 0,
                },
              ],
              recent_events: [],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'worker-1',
                worker_name: 'orchestrator-1',
                role: 'orchestrator',
                pool_kind: 'orchestrator',
                runtime_image: 'ghcr.io/agirunner/orchestrator:latest',
                cpu_limit: '2',
                memory_limit: '2g',
                network_policy: 'restricted',
                environment: {},
                llm_provider: 'openai',
                llm_model: 'gpt-5',
                llm_api_key_secret_ref_configured: true,
                replicas: 1,
                enabled: true,
                restart_requested: false,
                draining: false,
                version: 1,
                created_at: '2026-03-11T00:00:00.000Z',
                updated_at: '2026-03-11T00:00:00.000Z',
                updated_by: null,
                actual: [],
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'runtime:runtime-1',
                kind: 'runtime',
                container_id: 'runtime-container-1',
                name: 'runtime-specialist-1',
                state: 'running',
                status: 'Up 4 minutes',
                image: 'ghcr.io/agirunner/runtime:local',
                cpu_limit: '2',
                memory_limit: '1536m',
                started_at: '2026-03-21T18:24:00.000Z',
                last_seen_at: '2026-03-21T18:30:00.000Z',
                role_name: 'developer',
                playbook_id: 'playbook-1',
                playbook_name: 'Bug Investigation',
                workflow_id: 'workflow-1',
                workflow_name: 'Fix login bug',
                task_id: 'task-1',
                task_title: 'Investigate auth timeout',
                activity_state: 'executing',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'worker-2',
              worker_name: 'specialist-1',
              role: 'developer',
              pool_kind: 'specialist',
              runtime_image: 'ghcr.io/agirunner/specialist:latest',
              cpu_limit: '2',
              memory_limit: '2g',
              network_policy: 'restricted',
              environment: {},
              llm_provider: null,
              llm_model: null,
              llm_api_key_secret_ref_configured: false,
              replicas: 2,
              enabled: true,
              restart_requested: false,
              draining: false,
              version: 1,
              created_at: '2026-03-11T00:00:00.000Z',
              updated_at: '2026-03-11T00:00:00.000Z',
              updated_by: null,
              actual: [],
            },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'worker-2',
              worker_name: 'specialist-1',
              role: 'reviewer',
              pool_kind: 'specialist',
              runtime_image: 'ghcr.io/agirunner/specialist:stable',
              cpu_limit: '4',
              memory_limit: '4g',
              network_policy: 'open',
              environment: { FEATURE_FLAG: 'enabled' },
              llm_provider: 'openai',
              llm_model: 'gpt-5',
              llm_api_key_secret_ref_configured: true,
              replicas: 3,
              enabled: false,
              restart_requested: false,
              draining: false,
              version: 2,
              created_at: '2026-03-11T00:00:00.000Z',
              updated_at: '2026-03-11T01:00:00.000Z',
              updated_by: null,
              actual: [],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const status = await api.fetchFleetStatus();
    const workers = await api.fetchFleetWorkers();
    const liveContainers = await api.fetchLiveContainers();
    const created = await api.createFleetWorker({
      workerName: 'specialist-1',
      role: 'developer',
      runtimeImage: 'ghcr.io/agirunner/specialist:latest',
      poolKind: 'specialist',
    });
    const updated = await api.updateFleetWorker('worker-2', {
      role: 'reviewer',
      runtimeImage: 'ghcr.io/agirunner/specialist:stable',
      cpuLimit: '4',
      memoryLimit: '4g',
      networkPolicy: 'open',
      environment: { FEATURE_FLAG: 'enabled' },
      llmProvider: 'openai',
      llmModel: 'gpt-5',
      llmApiKeySecretRef: 'secret:tenant/openai',
      replicas: 3,
      enabled: false,
    });
    await api.restartFleetWorker('worker-2');
    await api.drainFleetWorker('worker-2');
    await api.deleteFleetWorker('worker-2');

    expect(status.worker_pools[0]?.pool_kind).toBe('orchestrator');
    expect(status.by_playbook_pool[0]?.pool_kind).toBe('orchestrator');
    expect(workers[0]?.pool_kind).toBe('orchestrator');
    expect(liveContainers[0]?.kind).toBe('runtime');
    expect(created.pool_kind).toBe('specialist');
    expect(updated.llm_api_key_secret_ref_configured).toBe(true);
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe('http://localhost:8080/api/v1/fleet/status');
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe('http://localhost:8080/api/v1/fleet/workers');
    expect(vi.mocked(fetcher).mock.calls[2][0]).toBe('http://localhost:8080/api/v1/fleet/live-containers');
    expect(vi.mocked(fetcher).mock.calls[3][0]).toBe(
      'http://localhost:8080/api/v1/fleet/workers',
    );
    expect(vi.mocked(fetcher).mock.calls[4][0]).toBe(
      'http://localhost:8080/api/v1/fleet/workers/worker-2',
    );
    expect(vi.mocked(fetcher).mock.calls[5][0]).toBe(
      'http://localhost:8080/api/v1/fleet/workers/worker-2/restart',
    );
    expect(vi.mocked(fetcher).mock.calls[6][0]).toBe(
      'http://localhost:8080/api/v1/fleet/workers/worker-2/drain',
    );
    expect(vi.mocked(fetcher).mock.calls[7][0]).toBe(
      'http://localhost:8080/api/v1/fleet/workers/worker-2',
    );
  });

  it('uses workflow operator record endpoints for mission control launch, steering, and redrive actions', async () => {
    writeSession({ accessToken: 'operator-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn() as unknown as typeof fetch;
    vi.mocked(fetcher)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'packet-1',
                workflow_id: 'workflow-1',
                work_item_id: null,
                packet_kind: 'launch',
                source: 'operator',
                summary: 'Launch files',
                structured_inputs: {},
                metadata: {},
                created_by_type: 'user',
                created_by_id: 'user-1',
                created_at: '2026-03-27T00:00:00.000Z',
                updated_at: '2026-03-27T00:00:00.000Z',
                files: [],
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'packet-2',
              workflow_id: 'workflow-1',
              work_item_id: null,
              packet_kind: 'launch',
              source: 'operator',
              summary: 'Launch files',
              structured_inputs: {},
              metadata: {},
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: '2026-03-27T00:00:00.000Z',
              updated_at: '2026-03-27T00:00:00.000Z',
              files: [],
            },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'intervention-1',
                workflow_id: 'workflow-1',
                work_item_id: null,
                task_id: null,
                kind: 'steering_instruction',
                origin: 'mission_control',
                status: 'recorded',
                summary: 'Focus on verification',
                note: null,
                structured_action: {},
                metadata: {},
                created_by_type: 'user',
                created_by_id: 'user-1',
                created_at: '2026-03-27T00:00:00.000Z',
                updated_at: '2026-03-27T00:00:00.000Z',
                files: [],
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'intervention-2',
              workflow_id: 'workflow-1',
              work_item_id: null,
              task_id: null,
              kind: 'steering_instruction',
              origin: 'mission_control',
              status: 'recorded',
              summary: 'Focus on verification',
              note: null,
              structured_action: {},
              metadata: {},
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: '2026-03-27T00:00:00.000Z',
              updated_at: '2026-03-27T00:00:00.000Z',
              files: [],
            },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'session-1',
                workflow_id: 'workflow-1',
                title: 'Operator steering',
                status: 'active',
                created_by_type: 'user',
                created_by_id: 'user-1',
                created_at: '2026-03-27T00:00:00.000Z',
                updated_at: '2026-03-27T00:00:00.000Z',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'session-2',
              workflow_id: 'workflow-1',
              title: 'Operator steering',
              status: 'active',
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: '2026-03-27T00:00:00.000Z',
              updated_at: '2026-03-27T00:00:00.000Z',
            },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'message-1',
                workflow_id: 'workflow-1',
                steering_session_id: 'session-1',
                role: 'operator',
                content: 'Focus on verification',
                structured_proposal: {},
                intervention_id: null,
                created_by_type: 'user',
                created_by_id: 'user-1',
                created_at: '2026-03-27T00:00:00.000Z',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'message-2',
              workflow_id: 'workflow-1',
              steering_session_id: 'session-1',
              role: 'operator',
              content: 'Focus on verification',
              structured_proposal: {},
              intervention_id: null,
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: '2026-03-27T00:00:00.000Z',
            },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              source_workflow_id: 'workflow-1',
              attempt_number: 2,
              workflow: {
                id: 'workflow-2',
                name: 'Release retry',
              },
              input_packet: null,
            },
          }),
          { status: 201 },
        ),
      ) as unknown as typeof fetch;

    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const packets = await api.listWorkflowInputPackets('workflow-1');
    const createdPacket = await api.createWorkflowInputPacket('workflow-1', {
      packet_kind: 'launch',
      summary: 'Launch files',
      files: [],
    });
    const interventions = await api.listWorkflowInterventions('workflow-1');
    const createdIntervention = await api.createWorkflowIntervention('workflow-1', {
      kind: 'steering_instruction',
      summary: 'Focus on verification',
    });
    const sessions = await api.listWorkflowSteeringSessions('workflow-1');
    const createdSession = await api.createWorkflowSteeringSession('workflow-1', {
      title: 'Operator steering',
    });
    const messages = await api.listWorkflowSteeringMessages('workflow-1', 'session-1');
    const appendedMessage = await api.appendWorkflowSteeringMessage('workflow-1', 'session-1', {
      content: 'Focus on verification',
    });
    const redrive = await api.redriveWorkflow('workflow-1', {
      request_id: 'request-1',
      name: 'Release retry',
      summary: 'Retry with corrected inputs',
    });

    expect(packets[0].id).toBe('packet-1');
    expect(createdPacket.id).toBe('packet-2');
    expect(interventions[0].id).toBe('intervention-1');
    expect(createdIntervention.id).toBe('intervention-2');
    expect(sessions[0].id).toBe('session-1');
    expect(createdSession.id).toBe('session-2');
    expect(messages[0].id).toBe('message-1');
    expect(appendedMessage.id).toBe('message-2');
    expect(redrive.workflow.id).toBe('workflow-2');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/input-packets',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/input-packets',
    );
    expect(vi.mocked(fetcher).mock.calls[2][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/interventions',
    );
    expect(vi.mocked(fetcher).mock.calls[3][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/interventions',
    );
    expect(vi.mocked(fetcher).mock.calls[4][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/steering-sessions',
    );
    expect(vi.mocked(fetcher).mock.calls[5][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/steering-sessions',
    );
    expect(vi.mocked(fetcher).mock.calls[6][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/steering-sessions/session-1/messages',
    );
    expect(vi.mocked(fetcher).mock.calls[7][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/steering-sessions/session-1/messages',
    );
    expect(vi.mocked(fetcher).mock.calls[8][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/redrives',
    );
  });

  it('uses persisted platform instruction endpoints for current state, versions, restore, and clear', async () => {
    writeSession({ accessToken: 'api-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { version: 3, content: '# Current', format: 'markdown' },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: 'ver-2', version: 2, content: '# Older', format: 'markdown' }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { version: 4, content: '# Restored', format: 'markdown' },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { version: 5, content: '', format: 'text' },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await expect(api.getPlatformInstructions()).resolves.toMatchObject({ version: 3 });
    await expect(api.listPlatformInstructionVersions()).resolves.toMatchObject([{ version: 2 }]);
    await expect(
      api.updatePlatformInstructions({ content: '# Restored', format: 'markdown' }),
    ).resolves.toMatchObject({ version: 4 });
    await expect(api.clearPlatformInstructions()).resolves.toMatchObject({
      version: 5,
      content: '',
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v1/platform/instructions',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({ Authorization: 'Bearer api-token' }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v1/platform/instructions/versions',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v1/platform/instructions',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      'http://localhost:8080/api/v1/platform/instructions',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
      }),
    );
  });

  it('updates workspace spec through the dashboard api surface', async () => {
    writeSession({ accessToken: 'spec-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            workspace_id: 'workspace-1',
            version: 4,
            spec: {
              config: { repository: 'agirunner/agirunner-test-fixtures' },
            },
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await expect(
      api.updateWorkspaceSpec('workspace-1', {
        config: { repository: 'agirunner/agirunner-test-fixtures' },
      }),
    ).resolves.toMatchObject({ version: 4 });

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workspaces/workspace-1/spec',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
      }),
    );
  });

  it('unwraps workspace spec envelopes when reading the dashboard api surface', async () => {
    writeSession({ accessToken: 'spec-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            workspace_id: 'workspace-1',
            version: 5,
            created_at: '2026-03-14T19:00:00.000Z',
            spec: {
              config: { repository: 'agirunner/agirunner-test-fixtures' },
              instructions: { summary: 'Keep the checkout steady.' },
            },
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await expect(api.getWorkspaceSpec('workspace-1')).resolves.toEqual({
      workspace_id: 'workspace-1',
      version: 5,
      created_at: '2026-03-14T19:00:00.000Z',
      created_by_id: undefined,
      created_by_type: undefined,
      config: { repository: 'agirunner/agirunner-test-fixtures' },
      instructions: { summary: 'Keep the checkout steady.' },
      resources: undefined,
      documents: undefined,
      tools: undefined,
    });
  });
});

describe('dashboard global search', () => {
  it('buildSearchResults creates task, workflow, workspace, playbook, and agent route targets', () => {
    const results = buildSearchResults('build', {
      workflows: [{ id: 'workflow-1', name: 'Build Workflow', state: 'running' }],
      tasks: [{ id: 'task-1', title: 'Build artifact', state: 'ready' }],
      workspaces: [{ id: 'workspace-1', name: 'Build Workspace' }],
      playbooks: [{ id: 'playbook-1', name: 'Build Playbook' }],
      workers: [{ id: 'worker-1', name: 'Builder worker', status: 'online' }],
      agents: [{ id: 'agent-1', name: 'Builder agent', status: 'idle' }],
    });

    expect(results.map((result) => result.type)).toEqual([
      'workflow',
      'task',
      'workspace',
      'playbook',
      'agent',
    ]);
    expect(results[0].href).toBe('/workflows?rail=workflow&workflow=workflow-1');
    expect(results[1].href).toBe('/work/tasks/task-1');
    expect(results[2].href).toBe('/design/workspaces/workspace-1');
    expect(results[3].href).toBe('/design/playbooks/playbook-1');
    expect(results[4].href).toBe('/diagnostics/live-containers');
  });

  it('search() merges matches from all dashboard resources', async () => {
    writeSession({ accessToken: 'token', tenantId: 'tenant-1' });

    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      exchangeApiKey: vi.fn(),
      listWorkflows: vi.fn().mockResolvedValue({
        data: [{ id: 'workflow-1', name: 'Test Workflow', state: 'running' }],
      }),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi
        .fn()
        .mockResolvedValue({ data: [{ id: 'task-1', title: 'Test task', state: 'ready' }] }),
      getTask: vi.fn(),
      listWorkers: vi
        .fn()
        .mockResolvedValue([{ id: 'worker-1', name: 'Test worker', status: 'online' }]),
      listAgents: vi
        .fn()
        .mockResolvedValue([{ id: 'agent-1', name: 'Test agent', status: 'idle' }]),
      listWorkspaces: vi
        .fn()
        .mockResolvedValue({ data: [{ id: 'workspace-1', name: 'Test workspace' }] }),
      listPlaybooks: vi
        .fn()
        .mockResolvedValue({ data: [{ id: 'playbook-1', name: 'Test playbook' }] }),
    };
    const api = createDashboardApi({
      client: client as never,
      baseUrl: 'http://localhost:8080',
    });
    const results = await api.search('test');

    expect(results).toHaveLength(5);
    expect(client.listWorkflows).toHaveBeenCalledWith({ per_page: 50 });
    expect(client.listTasks).toHaveBeenCalledWith({ per_page: 50 });
    expect(client.listWorkspaces).toHaveBeenCalledWith({ per_page: 50 });
    expect(client.listPlaybooks).toHaveBeenCalled();
  });

  it('deletes a workspace through the shared api client', async () => {
    writeSession({ accessToken: 'delete-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 }),
      ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.deleteWorkspace('workspace-42');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workspaces/workspace-42',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer delete-token',
        }),
      }),
    );
  });

  it('loads workspace delete impact through the shared api client', async () => {
    writeSession({ accessToken: 'delete-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            workflows: 3,
            active_workflows: 1,
            tasks: 8,
            active_tasks: 2,
            work_items: 4,
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await expect(api.getWorkspaceDeleteImpact('workspace-42')).resolves.toEqual({
      workflows: 3,
      active_workflows: 1,
      tasks: 8,
      active_tasks: 2,
      work_items: 4,
    });

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workspaces/workspace-42/delete-impact',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer delete-token',
        }),
      }),
    );
  });

  it('deletes a workspace with cascade enabled through the shared api client', async () => {
    writeSession({ accessToken: 'delete-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { deleted: true } }), { status: 200 }),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.deleteWorkspace('workspace-42', { cascade: true });

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workspaces/workspace-42?cascade=true',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer delete-token',
        }),
      }),
    );
  });

  it('loads playbook delete impact through the shared api client', async () => {
    writeSession({ accessToken: 'delete-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            revision: {
              workflows: 1,
              active_workflows: 0,
              tasks: 2,
              active_tasks: 0,
              work_items: 1,
            },
            family: {
              revisions: 4,
              workflows: 7,
              active_workflows: 2,
              tasks: 18,
              active_tasks: 4,
              work_items: 9,
            },
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await expect(api.getPlaybookDeleteImpact('playbook-42')).resolves.toEqual({
      revision: {
        workflows: 1,
        active_workflows: 0,
        tasks: 2,
        active_tasks: 0,
        work_items: 1,
      },
      family: {
        revisions: 4,
        workflows: 7,
        active_workflows: 2,
        tasks: 18,
        active_tasks: 4,
        work_items: 9,
      },
    });

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/playbooks/playbook-42/delete-impact',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer delete-token',
        }),
      }),
    );
  });

  it('deletes a playbook family permanently through the shared api client', async () => {
    writeSession({ accessToken: 'delete-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { deleted: true } }), { status: 200 }),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.deletePlaybookPermanently('playbook-42');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/playbooks/playbook-42/permanent',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer delete-token',
        }),
      }),
    );
  });

  it('asks the config assistant through the shared api client', async () => {
    writeSession({ accessToken: 'assistant-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            reply: 'Your runtime defaults look good.',
            suggestions: [
              {
                path: 'runtime.timeout',
                current_value: '300',
                suggested_value: '600',
                description: 'Increase timeout for long-running tasks',
              },
            ],
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const result = await api.askConfigAssistant('Review my runtime defaults');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/config/assistant',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer assistant-token',
        }),
        body: JSON.stringify({ question: 'Review my runtime defaults' }),
      }),
    );
    expect(result.reply).toBe('Your runtime defaults look good.');
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions![0].path).toBe('runtime.timeout');
  });

});
