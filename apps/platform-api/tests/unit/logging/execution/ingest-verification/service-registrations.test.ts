import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LogService } from '../../../../../src/logging/execution/log-service.js';
import { createLoggedService } from '../../../../../src/logging/execution/create-logged-service.js';
import { createMockPool } from './support.js';

describe('Logging E2E Verification - service registrations', () => {
  let pool: ReturnType<typeof createMockPool>;
  let logService: LogService;

  beforeEach(() => {
    pool = createMockPool();
    logService = new LogService(pool as never);
  });

  it('oauthServiceDisconnectGeneratesAuthLog', async () => {
    const service = {
      disconnect: vi.fn().mockResolvedValue({ profileId: 'openai', status: 'disconnected' }),
    };
    const wrapped = createLoggedService(service, 'OAuthService', logService);

    await wrapped.disconnect('openai');
    await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

    const logRow = pool.rows[0];
    expect(logRow.category).toBe('auth');
    expect(logRow.operation).toContain('auth.oauth_connection');
  });

  it('orchestratorGrantServiceCreateGeneratesAuthLog', async () => {
    const service = {
      createGrant: vi.fn().mockResolvedValue({ id: 'grant-1' }),
    };
    const wrapped = createLoggedService(service, 'OrchestratorGrantService', logService);

    await wrapped.createGrant({ agent_id: 'a-1', workflow_id: 'wf-1', permissions: ['read'] });
    await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

    const logRow = pool.rows[0];
    expect(logRow.category).toBe('auth');
    expect(logRow.operation).toBe('auth.orchestrator_grant.created');
    expect(logRow.resource_type).toBe('orchestrator_grant');
  });

  it('acpSessionServiceCreateGeneratesApiLog', async () => {
    const service = {
      createOrReuseSession: vi.fn().mockResolvedValue({ id: 'sess-1', reused: false }),
    };
    const wrapped = createLoggedService(service, 'AcpSessionService', logService);

    await wrapped.createOrReuseSession({});
    await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

    const logRow = pool.rows[0];
    expect(logRow.category).toBe('api');
    expect(logRow.operation).toBe('api.acp_session.created');
  });

  it('toolTagServiceCreateGeneratesConfigLog', async () => {
    const service = {
      createToolTag: vi.fn().mockResolvedValue({ id: 'tt-1', name: 'shell_exec' }),
    };
    const wrapped = createLoggedService(service, 'ToolTagService', logService);

    await wrapped.createToolTag({ id: 'tt-1', name: 'shell_exec' });
    await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

    const logRow = pool.rows[0];
    expect(logRow.category).toBe('config');
    expect(logRow.operation).toBe('config.tool_tag.created');
    expect(logRow.resource_name).toBe('shell_exec');
  });

  it('workflowOperatorBriefServiceRecordGeneratesTaskLifecycleLog', async () => {
    const service = {
      recordBrief: vi.fn().mockResolvedValue({
        id: 'brief-1',
        workflow_id: 'wf-1',
        brief_kind: 'milestone',
      }),
    };
    const wrapped = createLoggedService(service, 'WorkflowOperatorBriefService', logService);

    await wrapped.recordBrief({ tenantId: 'tenant-1' }, 'wf-1', { requestId: 'brief-1' });
    await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

    const logRow = pool.rows[0];
    expect(logRow.category).toBe('task_lifecycle');
    expect(logRow.operation).toBe('task_lifecycle.workflow_operator_brief.recordBrief');
    expect(logRow.resource_type).toBe('workflow_operator_brief');
    expect(logRow.resource_name).toBe('milestone');
  });

  it('agentServiceRegisterGeneratesApiLog', async () => {
    const service = {
      registerAgent: vi.fn().mockResolvedValue({ id: 'agent-1', name: 'coder-01' }),
    };
    const wrapped = createLoggedService(service, 'AgentService', logService);

    await wrapped.registerAgent({});
    await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

    const logRow = pool.rows[0];
    expect(logRow.category).toBe('api');
    expect(logRow.operation).toBe('api.agent.registered');
    expect(logRow.resource_name).toBe('coder-01');
  });
});
