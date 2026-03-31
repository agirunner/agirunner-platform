import { vi } from 'vitest';

export function createPool(responses: Array<{ rowCount: number; rows: unknown[] }>) {
  return {
    query: vi.fn().mockImplementation(async () => {
      if (responses.length === 0) throw new Error('Unexpected query');
      return responses.shift();
    }),
  };
}

export function rowSet(rows: unknown[]) {
  return { rowCount: rows.length, rows };
}

export function workflowRow(overrides: Record<string, unknown>) {
  return rowSet([
    {
      id: 'workflow-1',
      state: 'active',
      started_at: null,
      completed_at: null,
      metadata: {},
      name: 'Playbook Workflow',
      parameters: {},
      playbook_id: 'playbook-1',
      ...overrides,
    },
  ]);
}
