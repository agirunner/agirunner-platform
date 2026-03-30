import { describe, expect, it, vi } from 'vitest';

import { WorkflowRailService } from '../../src/services/workflow-operations/workflow-rail-service.js';

describe('WorkflowRailService', () => {
  it('builds live rail rows with ongoing workflows split into the pinned ongoing rail section', async () => {
    const liveService = {
      getLive: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:30:00.000Z',
          latestEventId: 42,
          token: 'mission-control:42',
        },
        sections: [
          {
            id: 'needs_action',
            title: 'Needs Action',
            count: 1,
            workflows: [
              {
                id: 'workflow-1',
                name: 'Release Workflow',
                state: 'active',
                lifecycle: 'ongoing',
                currentStage: null,
                workspaceName: 'Core Product',
                playbookName: 'Release',
                posture: 'needs_decision',
                pulse: {
                  summary: 'Waiting on operator approval',
                  tone: 'waiting',
                  updatedAt: '2026-03-27T22:29:00.000Z',
                },
                metrics: {
                  activeTaskCount: 1,
                  activeWorkItemCount: 2,
                  blockedWorkItemCount: 0,
                  openEscalationCount: 1,
                  waitingForDecisionCount: 1,
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
    };
    const recentService = { getRecent: vi.fn() };
    const historyService = { getHistory: vi.fn() };

    const service = new WorkflowRailService(
      liveService as never,
      recentService as never,
      historyService as never,
    );

    const result = await service.getRail('tenant-1', { mode: 'live' });

    expect(result).toEqual(
      expect.objectContaining({
        snapshot_version: 'workflow-operations:42',
        selected_workflow_id: 'workflow-1',
        ongoing_rows: [expect.objectContaining({ workflow_id: 'workflow-1' })],
        rows: [],
      }),
    );
  });

  it('still auto-selects the first visible ongoing workflow when the main live list is empty', async () => {
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
                id: 'workflow-ongoing',
                name: 'Intake Workflow',
                state: 'active',
                lifecycle: 'ongoing',
                currentStage: null,
                workspaceName: 'Core Product',
                playbookName: 'Intake',
                posture: 'progressing',
                pulse: {
                  summary: 'Orchestrator is routing the first work item.',
                  tone: 'progressing',
                  updatedAt: '2026-03-27T22:29:00.000Z',
                },
                metrics: {
                  activeTaskCount: 1,
                  activeWorkItemCount: 0,
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
    };
    const service = new WorkflowRailService(
      liveService as never,
      { getRecent: vi.fn() } as never,
      { getHistory: vi.fn() } as never,
    );

    const result = await service.getRail('tenant-1', { mode: 'live' });

    expect(result.rows).toEqual([]);
    expect(result.ongoing_rows).toEqual([
      expect.objectContaining({
        workflow_id: 'workflow-ongoing',
      }),
    ]);
    expect(result.selected_workflow_id).toBe('workflow-ongoing');
  });

  it('pins a selected workflow into the live rail when it falls outside the paged slice', async () => {
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
      listWorkflowCards: vi.fn(async () => [
        {
          id: '00000000-0000-4000-8000-000000000123',
          name: 'Fresh Workflow',
          state: 'pending',
          lifecycle: 'planned',
          currentStage: 'intake',
          workspaceName: 'Core Product',
          playbookName: 'Intake',
          posture: 'waiting_by_design',
          attentionLane: 'watchlist',
          pulse: {
            summary: 'Queued for the next workflow event.',
            tone: 'waiting',
            updatedAt: '2026-03-27T22:30:00.000Z',
          },
          metrics: {
            activeTaskCount: 0,
            activeWorkItemCount: 0,
            blockedWorkItemCount: 0,
            openEscalationCount: 0,
            waitingForDecisionCount: 0,
            failedTaskCount: 0,
            recoverableIssueCount: 0,
            lastChangedAt: '2026-03-27T22:30:00.000Z',
          },
        },
      ]),
    };
    const service = new WorkflowRailService(
      liveService as never,
      { getRecent: vi.fn() } as never,
      { getHistory: vi.fn() } as never,
    );

    const result = await service.getRail('tenant-1', {
      mode: 'live',
      selectedWorkflowId: '00000000-0000-4000-8000-000000000123',
      perPage: 1,
    });

    expect(liveService.listWorkflowCards).toHaveBeenCalledWith('tenant-1', {
      workflowIds: ['00000000-0000-4000-8000-000000000123'],
      page: 1,
      perPage: 1,
    });
    expect(result.selected_workflow_id).toBe('00000000-0000-4000-8000-000000000123');
    expect(result.rows).toEqual([
      expect.objectContaining({ workflow_id: '00000000-0000-4000-8000-000000000123' }),
      expect.objectContaining({ workflow_id: 'workflow-visible' }),
    ]);
  });

  it('keeps a selected workflow visible even when live rail filters would otherwise exclude it', async () => {
    const liveService = {
      getLive: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:30:00.000Z',
          latestEventId: 42,
          token: 'mission-control:42',
        },
        sections: [
          {
            id: 'needs_action',
            title: 'Needs Action',
            count: 1,
            workflows: [
              {
                id: 'workflow-needs-action',
                name: 'Needs Action Workflow',
                state: 'active',
                lifecycle: 'planned',
                currentStage: 'implementation',
                workspaceName: 'Core Product',
                playbookName: 'Delivery',
                posture: 'needs_intervention',
                attentionLane: 'needs_intervention',
                pulse: {
                  summary: 'Waiting on operator steering.',
                  tone: 'warning',
                  updatedAt: '2026-03-27T22:29:00.000Z',
                },
                metrics: {
                  activeTaskCount: 0,
                  activeWorkItemCount: 0,
                  blockedWorkItemCount: 1,
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
      listWorkflowCards: vi.fn(async () => [
        {
          id: '00000000-0000-4000-8000-000000000456',
          name: 'Fresh Workflow',
          state: 'pending',
          lifecycle: 'planned',
          currentStage: 'intake',
          workspaceName: 'Core Product',
          playbookName: 'Intake',
          posture: 'waiting_by_design',
          attentionLane: 'watchlist',
          pulse: {
            summary: 'Queued for the next workflow event.',
            tone: 'waiting',
            updatedAt: '2026-03-27T22:30:00.000Z',
          },
          metrics: {
            activeTaskCount: 0,
            activeWorkItemCount: 0,
            blockedWorkItemCount: 0,
            openEscalationCount: 0,
            waitingForDecisionCount: 0,
            failedTaskCount: 0,
            recoverableIssueCount: 0,
            lastChangedAt: '2026-03-27T22:30:00.000Z',
          },
        },
      ]),
    };
    const service = new WorkflowRailService(
      liveService as never,
      { getRecent: vi.fn() } as never,
      { getHistory: vi.fn() } as never,
    );

    const result = await service.getRail('tenant-1', {
      mode: 'live',
      needsActionOnly: true,
      selectedWorkflowId: '00000000-0000-4000-8000-000000000456',
    });

    expect(result.selected_workflow_id).toBe('00000000-0000-4000-8000-000000000456');
    expect(result.rows).toEqual([
      expect.objectContaining({ workflow_id: '00000000-0000-4000-8000-000000000456' }),
      expect.objectContaining({ workflow_id: 'workflow-needs-action' }),
    ]);
  });

  it('does not flag needs action from posture alone when no concrete actionable counts or workflow actions exist', async () => {
    const liveService = {
      getLive: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:30:00.000Z',
          latestEventId: 42,
          token: 'mission-control:42',
        },
        sections: [
          {
            id: 'needs_action',
            title: 'Needs Action',
            count: 1,
            workflows: [
              {
                id: 'workflow-posture-only',
                name: 'Posture-only workflow',
                state: 'active',
                lifecycle: 'planned',
                currentStage: 'implementation',
                workspaceName: 'Core Product',
                playbookName: 'Delivery',
                posture: 'needs_intervention',
                attentionLane: 'needs_intervention',
                pulse: {
                  summary: 'Needs intervention',
                  tone: 'warning',
                  updatedAt: '2026-03-27T22:29:00.000Z',
                },
                availableActions: [],
                metrics: {
                  activeTaskCount: 0,
                  activeWorkItemCount: 0,
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
    };
    const service = new WorkflowRailService(
      liveService as never,
      { getRecent: vi.fn() } as never,
      { getHistory: vi.fn() } as never,
    );

    const result = await service.getRail('tenant-1', { mode: 'live' });

    expect(result.rows).toEqual([
      expect.objectContaining({
        workflow_id: 'workflow-posture-only',
        needs_action: false,
      }),
    ]);
  });

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

  it('builds recent rail rows from recent packets when recent mode is selected', async () => {
    const liveService = { getLive: vi.fn() };
    const recentService = {
      getRecent: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:31:00.000Z',
          latestEventId: 84,
          token: 'mission-control:84',
        },
        packets: [
          {
            workflowId: 'workflow-2',
            workflowName: 'Spec Workflow',
            posture: 'completed',
            summary: 'Final brief published',
            changedAt: '2026-03-27T22:30:00.000Z',
          },
        ],
      })),
    };
    const historyService = { getHistory: vi.fn() };

    const service = new WorkflowRailService(
      liveService as never,
      recentService as never,
      historyService as never,
    );

    const result = await service.getRail('tenant-1', { mode: 'recent' });

    expect(result).toEqual(
      expect.objectContaining({
        snapshot_version: 'workflow-operations:84',
        selected_workflow_id: 'workflow-2',
        rows: [
          expect.objectContaining({
            workflow_id: 'workflow-2',
            name: 'Spec Workflow',
            posture: 'completed',
            live_summary: 'Final brief published',
          }),
        ],
      }),
    );
  });
});
