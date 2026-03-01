/**
 * TenantScopedRepository — data-access layer wrapper that automatically applies
 * tenant_id filtering to every query.
 *
 * Implements FR-150 (all entities scoped to tenant), FR-152 (tenant filter at
 * data-access layer), and FR-761 (all entities tenant-scoped).
 *
 * Every method on this class injects `tenant_id = $1` as the first WHERE
 * condition, making it structurally impossible to accidentally omit tenant
 * isolation from a query.
 */

import type { DatabaseQueryable } from './database.js';

export interface TenantRow {
  tenant_id: string;
  [key: string]: unknown;
}

/**
 * A lightweight query wrapper that enforces tenant isolation at the
 * data-access layer.  All methods prepend `tenant_id = $<n>` to the
 * WHERE clause so callers cannot forget it.
 */
export class TenantScopedRepository {
  constructor(
    private readonly db: DatabaseQueryable,
    private readonly tenantId: string,
  ) {}

  /**
   * Fetches all rows from `table` that belong to this tenant.
   * Additional WHERE conditions are AND-ed after the tenant filter.
   *
   * @param table       - Unquoted table name (must be a known entity table)
   * @param columns     - Comma-separated SELECT list (e.g. "id, name, state")
   * @param conditions  - Additional WHERE fragments (each using $n placeholders,
   *                      where n starts at 2 because $1 is always tenant_id)
   * @param values      - Bind values for the extra conditions
   */
  async findAll<T extends TenantRow>(
    table: string,
    columns: string,
    conditions: string[] = [],
    values: unknown[] = [],
  ): Promise<T[]> {
    const allConditions = ['tenant_id = $1', ...conditions];
    const allValues = [this.tenantId, ...values];
    const where = allConditions.join(' AND ');
    const result = await this.db.query<T>(
      `SELECT ${columns} FROM ${table} WHERE ${where}`,
      allValues,
    );
    return result.rows;
  }

  /**
   * Fetches a single row by its primary `id` column, scoped to this tenant.
   * Returns `null` when not found rather than throwing so callers can decide
   * whether a missing row is an error.
   */
  async findById<T extends TenantRow>(
    table: string,
    columns: string,
    id: string,
  ): Promise<T | null> {
    const result = await this.db.query<T>(
      `SELECT ${columns} FROM ${table} WHERE tenant_id = $1 AND id = $2`,
      [this.tenantId, id],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Counts rows in `table` that match this tenant and any extra conditions.
   */
  async count(
    table: string,
    conditions: string[] = [],
    values: unknown[] = [],
  ): Promise<number> {
    const allConditions = ['tenant_id = $1', ...conditions];
    const allValues = [this.tenantId, ...values];
    const where = allConditions.join(' AND ');
    const result = await this.db.query<{ total: string }>(
      `SELECT COUNT(*)::int AS total FROM ${table} WHERE ${where}`,
      allValues,
    );
    return Number(result.rows[0].total);
  }

  /**
   * Checks whether at least one row matching the tenant and conditions exists.
   */
  async exists(
    table: string,
    conditions: string[] = [],
    values: unknown[] = [],
  ): Promise<boolean> {
    return (await this.count(table, conditions, values)) > 0;
  }

  /**
   * Returns the `tenantId` this repository is scoped to.
   * Useful for passing downstream to nested service calls.
   */
  get scopedTenantId(): string {
    return this.tenantId;
  }
}
