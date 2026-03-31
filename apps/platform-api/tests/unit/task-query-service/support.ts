export const tenantId = '00000000-0000-0000-0000-000000000001';
export const taskId = '11111111-1111-1111-1111-111111111111';

export function createPool(row: Record<string, unknown>) {
  return {
    query: async () => ({ rowCount: 1, rows: [row] }),
  };
}
