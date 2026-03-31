import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkflowTerminalBriefService } from '../../../src/services/workflow-operations/workflow-terminal-brief-service.js';

describe('WorkflowTerminalBriefService', () => {
  let pool: { query: ReturnType<typeof vi.fn> };
  let briefService: { recordBrief: ReturnType<typeof vi.fn> };
  let service: WorkflowTerminalBriefService;

  beforeEach(() => {
    pool = { query: vi.fn() };
    briefService = { recordBrief: vi.fn() };
    service = new WorkflowTerminalBriefService(pool as never, briefService as never);
  });

  it('persists a platform-authored terminal brief when no final orchestrator brief exists', async () => {
    pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM workflows')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'workflow-1',
            name: 'Release Workflow',
            state: 'failed',
            completion_callouts: {
              risks_and_callouts: ['Verification failed twice.'],
            },
            metadata: {
              final_summary: 'Release failed in verification.',
            },
          }],
        };
      }
      if (sql.includes('FROM workflow_operator_briefs')) {
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    briefService.recordBrief.mockResolvedValue({
      id: 'brief-1',
      workflow_id: 'workflow-1',
      short_brief: { headline: 'Release workflow failed.' },
      detailed_brief_json: { summary: 'Release failed in verification.' },
    });

    const result = await service.ensureTerminalBrief({
      tenantId: 'tenant-1',
      workflowId: 'workflow-1',
    });

    expect(briefService.recordBrief).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'system',
      }),
      'workflow-1',
      expect.objectContaining({
        briefKind: 'terminal',
        briefScope: 'workflow_timeline',
        sourceKind: 'platform',
        statusKind: 'failed',
      }),
    );
    expect(result).toEqual(expect.objectContaining({ id: 'brief-1' }));
  });
});
