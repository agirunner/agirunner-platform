import { describe, expect, it, vi } from 'vitest';

import { WorkflowRailService } from '../../src/services/workflow-operations/workflow-rail-service.js';

describe('WorkflowRailService', () => {
  it('builds live rail rows, ongoing rows, and a default selected workflow from live workflow cards', async () => {
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
        rows: [
          expect.objectContaining({
            workflow_id: 'workflow-1',
            name: 'Release Workflow',
            posture: 'needs_decision',
            live_summary: 'Waiting on operator approval',
            needs_action: true,
            workspace_name: 'Core Product',
            playbook_name: 'Release',
          }),
        ],
      }),
    );
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
