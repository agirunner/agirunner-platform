import { describe, expect, it, vi } from 'vitest';

import { WorkflowRailService } from '../../../src/services/workflow-operations/workflow-rail-service.js';

describe('WorkflowRailService card robustness', () => {
  it('does not throw when a fresh workflow card is missing optional pulse or metrics fields', async () => {
    const liveService = {
      getLive: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:30:00.000Z',
          latestEventId: 42,
          token: 'mission-control:42',
        },
        sections: [
          {
            id: 'progressing',
            title: 'Progressing',
            count: 1,
            workflows: [
              {
                id: 'workflow-fresh',
                name: 'Fresh Workflow',
                state: 'pending',
                lifecycle: 'planned',
                currentStage: null,
                workspaceName: 'Core Product',
                playbookName: 'Intake',
              },
            ],
          },
        ],
        attentionItems: [],
      })),
      listWorkflowCards: vi.fn(),
    };
    const service = new WorkflowRailService(
      liveService as never,
      { getRecent: vi.fn() } as never,
      { getHistory: vi.fn() } as never,
    );

    await expect(service.getRail('tenant-1', { mode: 'live' })).resolves.toEqual(
      expect.objectContaining({
        selected_workflow_id: 'workflow-fresh',
        rows: [
          expect.objectContaining({
            workflow_id: 'workflow-fresh',
            live_summary: '',
            last_changed_at: null,
            needs_action: false,
          }),
        ],
      }),
    );
  });

  it('ignores malformed fresh workflow cards instead of crashing the rail snapshot', async () => {
    const liveService = {
      getLive: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:30:00.000Z',
          latestEventId: 42,
          token: 'mission-control:42',
        },
        sections: [
          {
            id: 'progressing',
            title: 'Progressing',
            count: 2,
            workflows: [
              null,
              {
                id: 'workflow-visible',
                name: 'Visible Workflow',
                state: 'active',
                lifecycle: 'planned',
                currentStage: 'delivery',
                workspaceName: 'Core Product',
                playbookName: 'Delivery',
                posture: 'progressing',
                attentionLane: 'watchlist',
                pulse: {
                  summary: 'Actively delivering.',
                  tone: 'progressing',
                  updatedAt: '2026-03-27T22:29:00.000Z',
                },
                metrics: {
                  activeTaskCount: 1,
                  activeWorkItemCount: 1,
                  blockedWorkItemCount: 0,
                  openEscalationCount: 0,
                  waitingForDecisionCount: 0,
                  failedTaskCount: 0,
                  recoverableIssueCount: 0,
                  lastChangedAt: '2026-03-27T22:29:00.000Z',
                },
              },
            ],
          },
        ],
        attentionItems: [],
      })),
      listWorkflowCards: vi.fn(),
    };
    const service = new WorkflowRailService(
      liveService as never,
      { getRecent: vi.fn() } as never,
      { getHistory: vi.fn() } as never,
    );

    await expect(service.getRail('tenant-1', { mode: 'live' })).resolves.toEqual(
      expect.objectContaining({
        selected_workflow_id: 'workflow-visible',
        rows: [expect.objectContaining({ workflow_id: 'workflow-visible' })],
      }),
    );
  });

  it('ignores invalid selected workflow ids instead of pinning through the live card lookup', async () => {
    const liveService = {
      getLive: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:30:00.000Z',
          latestEventId: 42,
          token: 'mission-control:42',
        },
        sections: [
          {
            id: 'progressing',
            title: 'Progressing',
            count: 1,
            workflows: [
              {
                id: 'workflow-visible',
                name: 'Visible Workflow',
                state: 'active',
                lifecycle: 'planned',
                currentStage: 'delivery',
                workspaceName: 'Core Product',
                playbookName: 'Delivery',
                posture: 'progressing',
                attentionLane: 'watchlist',
                pulse: {
                  summary: 'Actively delivering.',
                  tone: 'progressing',
                  updatedAt: '2026-03-27T22:29:00.000Z',
                },
                metrics: {
                  activeTaskCount: 1,
                  activeWorkItemCount: 1,
                  blockedWorkItemCount: 0,
                  openEscalationCount: 0,
                  waitingForDecisionCount: 0,
                  failedTaskCount: 0,
                  recoverableIssueCount: 0,
                  lastChangedAt: '2026-03-27T22:29:00.000Z',
                },
              },
            ],
          },
        ],
        attentionItems: [],
      })),
      listWorkflowCards: vi.fn(async () => {
        throw new Error('selected workflow lookup should be skipped for invalid ids');
      }),
    };
    const service = new WorkflowRailService(
      liveService as never,
      { getRecent: vi.fn() } as never,
      { getHistory: vi.fn() } as never,
    );

    const result = await service.getRail('tenant-1', {
      mode: 'live',
      selectedWorkflowId: 'workflow-not-a-uuid',
      perPage: 1,
    });

    expect(liveService.listWorkflowCards).not.toHaveBeenCalled();
    expect(result.selected_workflow_id).toBe('workflow-visible');
    expect(result.rows).toEqual([
      expect.objectContaining({ workflow_id: 'workflow-visible' }),
    ]);
  });
});
