import { describe, expect, it, vi } from 'vitest';

import { WorkflowRailService } from '../../../../src/services/workflow-operations/workflow-rail-service.js';

describe('WorkflowRailService needs-action signals', () => {
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

  it('does not flag needs action from generic workflow actions alone', async () => {
    const liveService = {
      getLive: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T22:30:00.000Z',
          latestEventId: 42,
          token: 'mission-control:42',
        },
        sections: [
          {
            id: 'primary',
            title: 'Primary',
            count: 1,
            workflows: [
              {
                id: 'workflow-actions-only',
                name: 'Actions-only workflow',
                state: 'active',
                lifecycle: 'ongoing',
                currentStage: 'implementation',
                workspaceName: 'Core Product',
                playbookName: 'Delivery',
                posture: 'active',
                attentionLane: null,
                pulse: {
                  summary: 'Waiting for work',
                  tone: 'neutral',
                  updatedAt: '2026-03-27T22:29:00.000Z',
                },
                availableActions: [
                  { kind: 'add_work_item', enabled: true, scope: 'workflow' },
                  { kind: 'redrive_workflow', enabled: true, scope: 'workflow' },
                ],
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

    expect(result.ongoing_rows).toEqual([
      expect.objectContaining({
        workflow_id: 'workflow-actions-only',
        needs_action: false,
      }),
    ]);
  });

  it('does not flag needs action from failure or recoverable metrics alone when no actionable operator item exists', async () => {
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
                id: 'workflow-failed-metric',
                name: 'Failed metric workflow',
                state: 'failed',
                lifecycle: 'planned',
                currentStage: 'implementation',
                workspaceName: 'Core Product',
                playbookName: 'Delivery',
                posture: 'terminal_failed',
                attentionLane: 'needs_intervention',
                pulse: {
                  summary: 'Failed',
                  tone: 'warning',
                  updatedAt: '2026-03-27T22:29:00.000Z',
                },
                availableActions: [
                  { kind: 'redrive_workflow', enabled: true, scope: 'workflow' },
                ],
                metrics: {
                  activeTaskCount: 0,
                  activeWorkItemCount: 0,
                  blockedWorkItemCount: 0,
                  openEscalationCount: 0,
                  waitingForDecisionCount: 0,
                  failedTaskCount: 1,
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
        workflow_id: 'workflow-failed-metric',
        needs_action: false,
      }),
    ]);
  });

  it('flags needs action when approval or escalation counts are present', async () => {
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
            count: 2,
            workflows: [
              {
                id: 'workflow-awaiting-approval',
                name: 'Awaiting approval',
                state: 'active',
                lifecycle: 'planned',
                currentStage: 'review',
                workspaceName: 'Core Product',
                playbookName: 'Delivery',
                posture: 'needs_decision',
                attentionLane: 'needs_decision',
                pulse: {
                  summary: 'Waiting on approval',
                  tone: 'warning',
                  updatedAt: '2026-03-27T22:29:00.000Z',
                },
                availableActions: [],
                metrics: {
                  activeTaskCount: 1,
                  activeWorkItemCount: 1,
                  blockedWorkItemCount: 0,
                  openEscalationCount: 0,
                  waitingForDecisionCount: 1,
                  failedTaskCount: 0,
                  recoverableIssueCount: 0,
                  lastChangedAt: '2026-03-27T22:29:00.000Z',
                },
              },
              {
                id: 'workflow-open-escalation',
                name: 'Open escalation',
                state: 'active',
                lifecycle: 'planned',
                currentStage: 'implement',
                workspaceName: 'Core Product',
                playbookName: 'Delivery',
                posture: 'needs_intervention',
                attentionLane: 'needs_intervention',
                pulse: {
                  summary: 'Waiting on escalation guidance',
                  tone: 'warning',
                  updatedAt: '2026-03-27T22:29:00.000Z',
                },
                availableActions: [],
                metrics: {
                  activeTaskCount: 1,
                  activeWorkItemCount: 1,
                  blockedWorkItemCount: 0,
                  openEscalationCount: 1,
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
        workflow_id: 'workflow-awaiting-approval',
        needs_action: true,
      }),
      expect.objectContaining({
        workflow_id: 'workflow-open-escalation',
        needs_action: true,
      }),
    ]);
  });
});
