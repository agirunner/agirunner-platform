import type { DatabasePool } from '../../../../db/database.js';

export async function getLatestEventId(
  pool: DatabasePool,
  tenantId: string,
): Promise<number | null> {
  const result = await pool.query<{ latest_event_id: number | null }>(
    'SELECT MAX(id)::int AS latest_event_id FROM events WHERE tenant_id = $1',
    [tenantId],
  );
  return result.rows[0]?.latest_event_id ?? null;
}
