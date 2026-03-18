import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'admin',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'prefix',
    };
  },
  withScope: () => async () => {},
}));

describe('scheduled work item trigger routes', () => {
  let app: ReturnType<typeof fastify> | undefined;
  let scheduledWorkItemTriggerService: {
    createTrigger: ReturnType<typeof vi.fn>;
    listTriggers: ReturnType<typeof vi.fn>;
    updateTrigger: ReturnType<typeof vi.fn>;
    deleteTrigger: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    scheduledWorkItemTriggerService = {
      createTrigger: vi.fn(),
      listTriggers: vi.fn(),
      updateTrigger: vi.fn(),
      deleteTrigger: vi.fn(),
    };
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('accepts daily schedules with null cadence_minutes', async () => {
    const { scheduledWorkItemTriggerRoutes } = await import('../../src/api/routes/scheduled-work-item-triggers.routes.js');
    scheduledWorkItemTriggerService.createTrigger.mockResolvedValue({
      id: 'trigger-1',
      schedule_type: 'daily_time',
      cadence_minutes: null,
      daily_time: '09:30',
      timezone: 'America/New_York',
    });

    app = fastify();
    registerErrorHandler(app);
    app.decorate('scheduledWorkItemTriggerService', scheduledWorkItemTriggerService);
    await app.register(scheduledWorkItemTriggerRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/scheduled-work-item-triggers',
      headers: { authorization: 'Bearer test' },
      payload: {
        name: 'Morning triage',
        source: 'workspace.schedule',
        workflow_id: '11111111-1111-4111-8111-111111111111',
        schedule_type: 'daily_time',
        cadence_minutes: null,
        daily_time: '09:30',
        timezone: 'America/New_York',
        defaults: {
          title: 'Run inbox triage',
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(scheduledWorkItemTriggerService.createTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      {
        name: 'Morning triage',
        source: 'workspace.schedule',
        workflow_id: '11111111-1111-4111-8111-111111111111',
        schedule_type: 'daily_time',
        cadence_minutes: null,
        daily_time: '09:30',
        timezone: 'America/New_York',
        defaults: {
          title: 'Run inbox triage',
        },
      },
    );
  });

  it('rejects interval schedules without cadence_minutes', async () => {
    const { scheduledWorkItemTriggerRoutes } = await import('../../src/api/routes/scheduled-work-item-triggers.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('scheduledWorkItemTriggerService', scheduledWorkItemTriggerService);
    await app.register(scheduledWorkItemTriggerRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/scheduled-work-item-triggers',
      headers: { authorization: 'Bearer test' },
      payload: {
        name: 'Interval triage',
        source: 'workspace.schedule',
        workflow_id: '11111111-1111-4111-8111-111111111111',
        schedule_type: 'interval',
        cadence_minutes: null,
        defaults: {
          title: 'Run inbox triage',
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toEqual(
      expect.objectContaining({
        code: 'SCHEMA_VALIDATION_FAILED',
        message: 'Invalid request body',
      }),
    );
    expect(scheduledWorkItemTriggerService.createTrigger).not.toHaveBeenCalled();
  });

  it('accepts patch payloads that switch a trigger to daily_time mode', async () => {
    const { scheduledWorkItemTriggerRoutes } = await import('../../src/api/routes/scheduled-work-item-triggers.routes.js');
    scheduledWorkItemTriggerService.updateTrigger.mockResolvedValue({
      id: 'trigger-1',
      schedule_type: 'daily_time',
    });

    app = fastify();
    registerErrorHandler(app);
    app.decorate('scheduledWorkItemTriggerService', scheduledWorkItemTriggerService);
    await app.register(scheduledWorkItemTriggerRoutes);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/scheduled-work-item-triggers/trigger-1',
      headers: { authorization: 'Bearer test' },
      payload: {
        schedule_type: 'daily_time',
        cadence_minutes: null,
        daily_time: '09:30',
        timezone: 'America/New_York',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(scheduledWorkItemTriggerService.updateTrigger).toHaveBeenCalledWith(
      'tenant-1',
      'trigger-1',
      {
        schedule_type: 'daily_time',
        cadence_minutes: null,
        daily_time: '09:30',
        timezone: 'America/New_York',
      },
    );
  });
});
