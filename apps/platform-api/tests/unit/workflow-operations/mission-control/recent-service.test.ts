import { describe, expect, it, vi } from 'vitest';

import { MissionControlRecentService } from '../../../../src/services/workflow-operations/mission-control/recent-service.js';

describe('MissionControlRecentService', () => {
  it('turns recent tenant events into review packets with workflow carryover state', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: 12,
            type: 'stage.gate.approve',
            entity_type: 'workflow',
            entity_id: 'workflow-1',
            actor_type: 'user',
            actor_id: 'operator-1',
            data: {
              workflow_id: 'workflow-1',
              summary: 'Release gate approved',
            },
            created_at: '2026-03-27T04:05:00.000Z',
          },
        ],
        rowCount: 1,
      })),
    };
    const liveService = {
      getLatestEventId: vi.fn(async () => 21),
      listWorkflowCards: vi.fn(async () => [
        {
          id: 'workflow-1',
          name: 'Release Workflow',
          posture: 'needs_decision',
          outputDescriptors: [],
        },
      ]),
    };

    const service = new MissionControlRecentService(pool as never, liveService as never);
    const response = await service.getRecent('tenant-1', { limit: 10 });

    expect(liveService.listWorkflowCards).toHaveBeenCalledWith('tenant-1', {
      workflowIds: ['workflow-1'],
    });
    expect(response.version.latestEventId).toBe(21);
    expect(response.packets).toEqual([
      expect.objectContaining({
        workflowId: 'workflow-1',
        workflowName: 'Release Workflow',
        category: 'decision',
        summary: 'Release gate approved',
        carryover: true,
      }),
    ]);
  });

  it('suppresses heartbeat activation noise from recent review packets', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: 12,
            type: 'workflow.activation.started',
            entity_type: 'workflow',
            entity_id: 'workflow-1',
            actor_type: 'system',
            actor_id: null,
            data: {
              workflow_id: 'workflow-1',
              reason: 'heartbeat',
            },
            created_at: '2026-03-27T04:05:00.000Z',
          },
          {
            id: 13,
            type: 'workflow.output.published',
            entity_type: 'workflow',
            entity_id: 'workflow-1',
            actor_type: 'system',
            actor_id: null,
            data: {
              workflow_id: 'workflow-1',
              summary: 'Release packet published',
            },
            created_at: '2026-03-27T04:06:00.000Z',
          },
        ],
        rowCount: 2,
      })),
    };
    const liveService = {
      getLatestEventId: vi.fn(async () => 21),
      listWorkflowCards: vi.fn(async () => [
        {
          id: 'workflow-1',
          name: 'Release Workflow',
          posture: 'progressing',
          outputDescriptors: [],
        },
      ]),
    };

    const service = new MissionControlRecentService(pool as never, liveService as never);
    const response = await service.getRecent('tenant-1', { limit: 10 });

    expect(response.packets).toHaveLength(1);
    expect(response.packets[0]).toEqual(
      expect.objectContaining({
        title: 'Workflow Output Published',
        summary: 'Release packet published',
      }),
    );
  });

  it('drops internal low-level events that do not resolve to an operator-readable workflow packet', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: 12,
            type: 'task.started',
            entity_type: 'task',
            entity_id: 'task-1',
            actor_type: 'system',
            actor_id: null,
            data: {
              reason: 'task_started',
            },
            created_at: '2026-03-27T04:05:00.000Z',
          },
          {
            id: 13,
            type: 'workflow.activation.started',
            entity_type: 'workflow',
            entity_id: 'workflow-1',
            actor_type: 'system',
            actor_id: null,
            data: {
              workflow_id: 'workflow-1',
              reason: 'queued_events',
            },
            created_at: '2026-03-27T04:06:00.000Z',
          },
          {
            id: 14,
            type: 'workflow.operator_brief.recorded',
            entity_type: 'workflow',
            entity_id: 'workflow-1',
            actor_type: 'system',
            actor_id: null,
            data: {
              workflow_id: 'workflow-1',
              summary: 'Publication package approved and released.',
            },
            created_at: '2026-03-27T04:07:00.000Z',
          },
        ],
        rowCount: 3,
      })),
    };
    const liveService = {
      getLatestEventId: vi.fn(async () => 21),
      listWorkflowCards: vi.fn(async () => [
        {
          id: 'workflow-1',
          name: 'Release Workflow',
          posture: 'completed',
          outputDescriptors: [],
        },
      ]),
    };

    const service = new MissionControlRecentService(pool as never, liveService as never);
    const response = await service.getRecent('tenant-1', { limit: 10 });

    expect(response.packets).toEqual([
      expect.objectContaining({
        workflowId: 'workflow-1',
        workflowName: 'Release Workflow',
        summary: 'Publication package approved and released.',
      }),
    ]);
    expect(liveService.listWorkflowCards).toHaveBeenCalledWith('tenant-1', {
      workflowIds: ['workflow-1'],
    });
  });

  it('falls back to the workflow pulse summary when a recent event has no operator-readable summary', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: 15,
            type: 'task.created',
            entity_type: 'task',
            entity_id: 'task-1',
            actor_type: 'system',
            actor_id: null,
            data: {
              workflow_id: 'workflow-1',
            },
            created_at: '2026-03-27T04:08:00.000Z',
          },
        ],
        rowCount: 1,
      })),
    };
    const liveService = {
      getLatestEventId: vi.fn(async () => 21),
      listWorkflowCards: vi.fn(async () => [
        {
          id: 'workflow-1',
          name: 'Release Workflow',
          posture: 'needs_intervention',
          pulse: {
            summary: 'Approval gate is blocked by operator decision.',
          },
          outputDescriptors: [],
        },
      ]),
    };

    const service = new MissionControlRecentService(pool as never, liveService as never);
    const response = await service.getRecent('tenant-1', { limit: 10 });

    expect(response.packets).toEqual([
      expect.objectContaining({
        workflowId: 'workflow-1',
        summary: 'Approval gate is blocked by operator decision.',
      }),
    ]);
  });
});
