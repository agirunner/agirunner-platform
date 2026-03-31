import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkflowRoutesApp,
  resetWorkflowRouteAuthMocks,
  workflowRoutes,
} from './support.js';

describe('workflow routes creation and settings', () => {
  let app: ReturnType<typeof createWorkflowRoutesApp> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    resetWorkflowRouteAuthMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    vi.clearAllMocks();
  });

  it('passes request and initial launch packet inputs through workflow creation routes', async () => {
    const createWorkflow = vi.fn().mockResolvedValue({
      id: 'workflow-1',
      name: 'Release workflow',
      live_visibility_mode_override: 'enhanced',
    });

    app = createWorkflowRoutesApp({
      workflowService: { createWorkflow },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'request-1',
        playbook_id: '00000000-0000-4000-8000-000000000002',
        workspace_id: '00000000-0000-4000-8000-000000000001',
        name: 'Release workflow',
        operator_note: 'Prioritize the verification branch first.',
        initial_input_packet: {
          summary: 'Launch packet summary',
          structured_inputs: { ticket: 'INC-42' },
        },
        live_visibility_mode: 'enhanced',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        request_id: 'request-1',
        workspace_id: '00000000-0000-4000-8000-000000000001',
        operator_note: 'Prioritize the verification branch first.',
        initial_input_packet: {
          summary: 'Launch packet summary',
          structured_inputs: { ticket: 'INC-42' },
        },
        live_visibility_mode: 'enhanced',
      }),
    );
  });

  it('passes live visibility mode through workflow creation routes', async () => {
    const createWorkflow = vi.fn().mockResolvedValue({
      id: 'workflow-1',
      name: 'Release workflow',
      live_visibility_mode_override: 'enhanced',
    });

    app = createWorkflowRoutesApp({
      workflowService: { createWorkflow },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: { authorization: 'Bearer test' },
      payload: {
        playbook_id: '00000000-0000-4000-8000-000000000002',
        workspace_id: '00000000-0000-4000-8000-000000000001',
        name: 'Release workflow',
        live_visibility_mode: 'enhanced',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        playbook_id: '00000000-0000-4000-8000-000000000002',
        workspace_id: '00000000-0000-4000-8000-000000000001',
        name: 'Release workflow',
        live_visibility_mode: 'enhanced',
      }),
    );
  });

  it('rejects workflow creation without workspace_id', async () => {
    const createWorkflow = vi.fn();

    app = createWorkflowRoutesApp({
      workflowService: { createWorkflow },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: { authorization: 'Bearer test' },
      payload: {
        playbook_id: '00000000-0000-4000-8000-000000000002',
        name: 'Release workflow',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
    expect(createWorkflow).not.toHaveBeenCalled();
  });

  it('rejects blank workflow names and work-item titles after trimming whitespace', async () => {
    const createWorkflow = vi.fn();
    const createWorkflowWorkItem = vi.fn();

    app = createWorkflowRoutesApp({
      workflowService: {
        createWorkflow,
        createWorkflowWorkItem,
      },
    });
    await app.register(workflowRoutes);

    const workflowResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: { authorization: 'Bearer test' },
      payload: {
        playbook_id: '00000000-0000-4000-8000-000000000002',
        workspace_id: '00000000-0000-4000-8000-000000000001',
        name: '   ',
      },
    });
    const workItemResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items',
      payload: {
        request_id: 'request-1',
        title: '   ',
      },
    });

    expect(workflowResponse.statusCode).toBe(422);
    expect(workItemResponse.statusCode).toBe(422);
    expect(createWorkflow).not.toHaveBeenCalled();
    expect(createWorkflowWorkItem).not.toHaveBeenCalled();
  });

  it('reads and updates workflow live visibility settings through workflow-owned routes', async () => {
    const getWorkflowSettings = vi.fn().mockResolvedValue({
      workflow_id: 'workflow-1',
      effective_live_visibility_mode: 'enhanced',
      workflow_live_visibility_mode_override: null,
      source: 'agentic_settings',
      revision: 2,
      updated_by_operator_id: 'user-1',
      updated_at: '2026-03-27T23:00:00.000Z',
    });
    const updateWorkflowSettings = vi.fn().mockResolvedValue({
      workflow_id: 'workflow-1',
      effective_live_visibility_mode: 'standard',
      workflow_live_visibility_mode_override: 'standard',
      source: 'workflow_override',
      revision: 3,
      updated_by_operator_id: 'user-1',
      updated_at: '2026-03-27T23:10:00.000Z',
    });

    app = createWorkflowRoutesApp({
      workflowSettingsService: {
        getWorkflowSettings,
        updateWorkflowSettings,
      },
    });
    await app.register(workflowRoutes);

    const headers = { authorization: 'Bearer test' };
    const getResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/settings',
      headers,
    });
    const patchResponse = await app.inject({
      method: 'PATCH',
      url: '/api/v1/workflows/workflow-1/settings',
      headers,
      payload: {
        live_visibility_mode: 'standard',
        settings_revision: 2,
      },
    });

    expect(getResponse.statusCode).toBe(200);
    expect(patchResponse.statusCode).toBe(200);
    expect(getWorkflowSettings).toHaveBeenCalledWith('tenant-1', 'workflow-1');
    expect(updateWorkflowSettings).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      {
        liveVisibilityMode: 'standard',
        settingsRevision: 2,
      },
    );
  });
});
