import { vi } from 'vitest';

export function createMockPool() {
  const rows: Record<string, unknown>[] = [];
  let nextId = 1;

  return {
    rows,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (typeof sql === 'string' && sql.includes('INSERT INTO execution_logs')) {
        const p = params as unknown[];
        const row = {
          id: String(nextId++),
          tenant_id: p[0],
          trace_id: p[1],
          span_id: p[2],
          parent_span_id: p[3],
          source: p[4],
          category: p[5],
          level: p[6],
          operation: p[7],
          status: p[8],
          duration_ms: p[9],
          payload: JSON.parse(p[10] as string),
          error: p[11] ? JSON.parse(p[11] as string) : null,
          workspace_id: p[12],
          workflow_id: p[13],
          workflow_name: p[14],
          workspace_name: p[15],
          task_id: p[16],
          work_item_id: p[17],
          activation_id: p[18],
          task_title: p[19],
          stage_name: p[20],
          is_orchestrator_task: p[21],
          execution_backend: p[22],
          tool_owner: p[23],
          role: p[24],
          actor_type: p[25],
          actor_id: p[26],
          actor_name: p[27],
          resource_type: p[28],
          resource_id: p[29],
          resource_name: p[30],
          created_at: p[31] ?? new Date().toISOString(),
        };
        rows.push(row);
        return { rowCount: 1, rows: [row] };
      }
      if (
        typeof sql === 'string' &&
        sql.includes('SELECT') &&
        sql.includes('FROM execution_logs')
      ) {
        return { rowCount: rows.length, rows: [...rows] };
      }
      return { rowCount: 0, rows: [] };
    }),
  };
}
