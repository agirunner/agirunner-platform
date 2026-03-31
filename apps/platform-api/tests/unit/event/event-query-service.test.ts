import { describe, expect, it, vi } from 'vitest';

import { EventQueryService } from '../../../src/services/event-query-service.js';

describe('EventQueryService', () => {
  it('casts workflow scope entity ids to text before reusing the workflow filter parameter', async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
    };

    const service = new EventQueryService(pool as never);

    await service.listEvents({
      tenantId: 'tenant-1',
      workflowScopeId: '84b30f41-411d-4730-942f-b5ad5ec1b8ce',
      limit: 5,
    });

    const [sql, params] = pool.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain(
      "(entity_id::text = $2 OR COALESCE(data->>'workflow_id', CASE WHEN entity_type = 'workflow' THEN entity_id::text ELSE '' END) = $2)",
    );
    expect(params).toEqual([
      'tenant-1',
      '84b30f41-411d-4730-942f-b5ad5ec1b8ce',
      6,
    ]);
  });
});
