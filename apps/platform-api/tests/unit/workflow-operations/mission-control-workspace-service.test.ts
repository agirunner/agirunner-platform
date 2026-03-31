import { describe, expect, it, vi } from 'vitest';

import { MissionControlWorkspaceService } from '../../../src/services/workflow-operations/mission-control-workspace-service.js';

describe('MissionControlWorkspaceService', () => {
  it('composes overview, board, outputs, steering, and history for a selected workflow', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({
        parameters: { objective: 'ship the release' },
        context: { attempt_reason: 'baseline' },
        workflow_relations: { parent: null, children: [] },
      })),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'in_progress' }],
        work_items: [],
      })),
    };
    const liveService = {
      listWorkflowCards: vi.fn(async () => [
        {
          id: 'workflow-1',
          pulse: { summary: 'Waiting on operator decisions' },
          outputDescriptors: [],
          availableActions: [{ kind: 'pause_workflow', enabled: true }],
          metrics: {
            blockedWorkItemCount: 1,
            openEscalationCount: 0,
            failedTaskCount: 0,
            recoverableIssueCount: 0,
          },
        },
      ]),
      listWorkflowOutputDescriptors: vi.fn(async () =>
        new Map([
          [
            'workflow-1',
            [
              {
                id: 'document:1',
                title: 'release-brief',
              },
            ],
          ],
        ]),
      ),
    };
    const historyService = {
      getHistory: vi.fn(async () => ({
        version: {
          generatedAt: '2026-03-27T04:20:00.000Z',
          latestEventId: 40,
          token: 'mission-control:history',
        },
        packets: [
          {
            id: 'event:1',
            category: 'output',
          },
          {
            id: 'event:2',
            category: 'decision',
          },
        ],
      })),
    };

    const service = new MissionControlWorkspaceService(
      workflowService as never,
      liveService as never,
      historyService as never,
    );
    const response = await service.getWorkspace('tenant-1', 'workflow-1');

    expect(response.workflow).toEqual(expect.objectContaining({ id: 'workflow-1' }));
    expect(response.overview).toEqual(
      expect.objectContaining({
        currentOperatorAsk: 'Waiting on operator decisions',
        latestOutput: { id: 'document:1', title: 'release-brief' },
      }),
    );
    expect(response.board).toEqual({
      columns: [{ id: 'in_progress' }],
      work_items: [],
    });
    expect(response.outputs.feed).toEqual([{ id: 'event:1', category: 'output' }]);
    expect(response.steering.interventionHistory).toEqual([{ id: 'event:2', category: 'decision' }]);
  });
});
