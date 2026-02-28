import type pg from 'pg';

export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export async function seedDefaultTenant(pool: pg.Pool): Promise<void> {
  await pool.query(
    `INSERT INTO tenants (id, name, slug)
     VALUES ($1, 'Default', 'default')
     ON CONFLICT (slug) DO NOTHING`,
    [DEFAULT_TENANT_ID],
  );
}
