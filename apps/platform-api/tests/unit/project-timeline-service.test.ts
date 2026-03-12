import { describe, expect, it, vi } from 'vitest';

import { ProjectTimelineService } from '../../src/services/project-timeline-service.js';

describe('ProjectTimelineService', () => {
  it('rejects terminal-state recording for non-playbook workflows', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            id: 'workflow-1',
            project_id: 'project-1',
            playbook_id: null,
            metadata: {},
          },
        ],
      }),
    };
    const service = new ProjectTimelineService(pool as never);

    await expect(service.recordWorkflowTerminalState('tenant-1', 'workflow-1')).rejects.toThrow(
      'only support playbook workflows',
    );
  });

  it('returns only persisted summaries and drops non-playbook fallback generation', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 2,
        rows: [
          {
            id: 'workflow-1',
            name: 'Playbook Workflow',
            state: 'completed',
            started_at: null,
            completed_at: null,
            created_at: '2026-03-11T00:00:00.000Z',
            metadata: {
              run_summary: { workflow_id: 'workflow-1', kind: 'run_summary' },
            },
          },
          {
            id: 'workflow-2',
            name: 'Legacy Workflow',
            state: 'completed',
            started_at: null,
            completed_at: null,
            created_at: '2026-03-11T00:00:00.000Z',
            metadata: {},
          },
        ],
      }),
    };
    const service = new ProjectTimelineService(pool as never);

    const result = await service.getProjectTimeline('tenant-1', 'project-1');

    expect(result).toEqual([{ workflow_id: 'workflow-1', kind: 'run_summary' }]);
  });

  it('includes first-class gate events when building terminal workflow summaries', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT * FROM workflows')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'workflow-1',
              name: 'Release flow',
              state: 'completed',
              lifecycle: 'standard',
              playbook_id: 'playbook-1',
              project_id: 'project-1',
              metadata: {},
              created_at: '2026-03-10T00:00:00.000Z',
              started_at: '2026-03-10T00:10:00.000Z',
              completed_at: '2026-03-10T01:00:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('SELECT * FROM tasks')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM workflow_artifacts')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM events')) {
        return sql.includes("entity_type = 'gate'")
          ? {
              rowCount: 2,
              rows: [
                {
                  type: 'stage.gate_requested',
                  actor_type: 'agent',
                  actor_id: 'agent-1',
                  data: { workflow_id: 'workflow-1', stage_name: 'review', recommendation: 'approve' },
                  created_at: '2026-03-10T00:50:00.000Z',
                },
                {
                  type: 'stage.gate.approve',
                  actor_type: 'admin',
                  actor_id: 'admin-1',
                  data: { workflow_id: 'workflow-1', stage_name: 'review', feedback: 'Looks good' },
                  created_at: '2026-03-10T00:55:00.000Z',
                },
              ],
            }
          : { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM workflow_stages')) {
        return {
          rowCount: 1,
          rows: [
            {
              name: 'review',
              goal: 'Validate release readiness',
              human_gate: true,
              status: 'completed',
              gate_status: 'approved',
              iteration_count: 1,
              summary: 'Approved for release',
              started_at: '2026-03-10T00:45:00.000Z',
              completed_at: '2026-03-10T00:56:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('FROM workflow_work_items')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'wi-1',
              stage_name: 'review',
              column_id: 'done',
              title: 'Review release',
              completed_at: '2026-03-10T00:56:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('SELECT memory FROM projects')) {
        return { rowCount: 1, rows: [{ memory: {} }] };
      }
      return { rowCount: 0, rows: [] };
    });
    const service = new ProjectTimelineService({ query } as never);

    const summary = await service.recordWorkflowTerminalState('tenant-1', 'workflow-1');

    expect(summary).toEqual(
      expect.objectContaining({
        workflow_id: 'workflow-1',
        stage_metrics: [
          expect.objectContaining({
            name: 'review',
            gate_history: [
              expect.objectContaining({ action: 'requested', recommendation: 'approve' }),
              expect.objectContaining({ action: 'approve', feedback: 'Looks good' }),
            ],
          }),
        ],
      }),
    );
  });
});
