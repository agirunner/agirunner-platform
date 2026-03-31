import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConflictError } from '../../../src/errors/domain-errors.js';
import { WorkflowSettingsService } from '../../../src/services/workflow-operations/workflow-settings-service.js';

const IDENTITY = {
  id: 'key-1',
  tenantId: 'tenant-1',
  scope: 'admin',
  ownerType: 'user',
  ownerId: 'user-1',
  keyPrefix: 'admin',
} as const;

function createPool() {
  return {
    query: vi.fn(),
  };
}

describe('WorkflowSettingsService', () => {
  let pool: ReturnType<typeof createPool>;
  let service: WorkflowSettingsService;

  beforeEach(() => {
    pool = createPool();
    service = new WorkflowSettingsService(pool as never);
  });

  it('resolves effective live visibility from workflow override when present', async () => {
    pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM workflows')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'workflow-1',
            live_visibility_mode_override: 'standard',
            live_visibility_revision: 3,
            live_visibility_updated_by_operator_id: 'user-1',
            live_visibility_updated_at: new Date('2026-03-27T23:00:00.000Z'),
          }],
        };
      }
      if (sql.includes('FROM agentic_settings')) {
        return {
          rowCount: 1,
          rows: [{
            tenant_id: 'tenant-1',
            live_visibility_mode_default: 'enhanced',
            revision: 5,
            updated_by_operator_id: 'user-2',
            updated_at: new Date('2026-03-27T22:00:00.000Z'),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.getWorkflowSettings('tenant-1', 'workflow-1');

    expect(result).toEqual({
      workflow_id: 'workflow-1',
      effective_live_visibility_mode: 'standard',
      workflow_live_visibility_mode_override: 'standard',
      source: 'workflow_override',
      revision: 3,
      updated_by_operator_id: 'user-1',
      updated_at: '2026-03-27T23:00:00.000Z',
    });
  });

  it('updates workflow override revision prospectively and rejects stale revisions', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'workflow-1',
            live_visibility_mode_override: null,
            live_visibility_revision: 2,
            live_visibility_updated_by_operator_id: null,
            live_visibility_updated_at: null,
          }],
        };
      }
      if (sql.includes('UPDATE workflows')) {
        expect(params?.[0]).toBe('enhanced');
        expect(params?.[1]).toBe('user-1');
        return {
          rowCount: 1,
          rows: [{
            id: 'workflow-1',
            live_visibility_mode_override: 'enhanced',
            live_visibility_revision: 3,
            live_visibility_updated_by_operator_id: 'user-1',
            live_visibility_updated_at: new Date('2026-03-27T23:10:00.000Z'),
          }],
        };
      }
      if (sql.includes('FROM agentic_settings')) {
        return {
          rowCount: 1,
          rows: [{
            live_visibility_mode_default: 'standard',
            revision: 4,
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.updateWorkflowSettings(IDENTITY as never, 'workflow-1', {
      liveVisibilityMode: 'enhanced',
      settingsRevision: 2,
    });

    expect(result).toEqual({
      workflow_id: 'workflow-1',
      effective_live_visibility_mode: 'enhanced',
      workflow_live_visibility_mode_override: 'enhanced',
      source: 'workflow_override',
      revision: 3,
      updated_by_operator_id: 'user-1',
      updated_at: '2026-03-27T23:10:00.000Z',
    });

    await expect(
      service.updateWorkflowSettings(IDENTITY as never, 'workflow-1', {
        liveVisibilityMode: 'standard',
        settingsRevision: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
