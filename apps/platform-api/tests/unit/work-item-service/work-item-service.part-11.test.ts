import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logSafetynetTriggeredMock } from './work-item-service-test-support.js';

vi.mock('../../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: logSafetynetTriggeredMock,
}));

import { ValidationError } from '../../../src/errors/domain-errors.js';
import { WorkItemService } from '../../../src/services/work-item-service/work-item-service.js';

const identity = {
  tenantId: 'tenant-1',
  scope: 'admin',
  keyPrefix: 'admin-key',
};

beforeEach(() => {
  logSafetynetTriggeredMock.mockReset();
});

describe('WorkItemService', () => {
  it('reports requested and authored stage names when createWorkItem rejects an unknown stage', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              lifecycle: 'planned',
              state: 'active',
              metadata: {},
              active_stage_name: 'reproduce',
              definition: {
                lifecycle: 'planned',
                board: {
                  columns: [{ id: 'planned', label: 'Planned' }],
                  entry_column_id: 'planned',
                },
                stages: [
                  { name: 'reproduce', goal: 'Reproduce the issue' },
                  { name: 'implement', goal: 'Implement the fix' },
                  { name: 'review', goal: 'Review the change' },
                  { name: 'verify', goal: 'Verify the fix' },
                ],
                roles: [],
              },
            }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkItemService(
      { connect: vi.fn(async () => client) } as never,
      { emit: vi.fn() } as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.createWorkItem(
        identity as never,
        'workflow-1',
        {
          request_id: 'create-wi-unknown-stage',
          title: 'Fix Audit Export Hang',
          goal: 'Implement the fix.',
          acceptance_criteria: 'Fix is ready for review.',
          stage_name: 'fix',
        },
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        reason_code: 'unknown_stage_name',
        requested_stage_name: 'fix',
        authored_stage_names: ['reproduce', 'implement', 'review', 'verify'],
      },
    });
  });
});
