import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { workflowRoutes } from '../../src/api/routes/workflows.routes.js';

describe('workflow work-item memory routes', () => {
  it('registers work-item memory and scoped history endpoints', async () => {
    const app = Fastify();
    app.decorate('workflowService', {
      createWorkflow: vi.fn(),
      listWorkflows: vi.fn(),
      getWorkflow: vi.fn(),
      getWorkflowBoard: vi.fn(),
      listWorkflowStages: vi.fn(),
      listWorkflowWorkItems: vi.fn(),
      createWorkflowWorkItem: vi.fn(),
      getWorkflowWorkItem: vi.fn(),
      getWorkflowWorkItemMemory: vi.fn(),
      getWorkflowWorkItemMemoryHistory: vi.fn(),
      updateWorkflowWorkItem: vi.fn(),
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    } as never);
    app.decorate('pgPool', {} as never);
    app.decorate('config', { EVENT_STREAM_PATH: '/api/v1/events/stream' } as never);

    await app.register(workflowRoutes);

    const routes = app.printRoutes();
    expect(routes).toContain(':workItemId (GET, HEAD, PATCH)');
    expect(routes).toContain('memory (GET, HEAD)');
    expect(routes).toContain('history (GET, HEAD)');

    await app.close();
  });
});
