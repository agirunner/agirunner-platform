import type { DatabaseQueryable } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';
import type { ExecutionEnvironmentCatalogRecord } from './execution-environment-contract.js';
import { isRecord, normalizeStringArray } from './execution-environment-contract.js';

interface CatalogRow {
  catalog_key: string;
  catalog_version: number;
  name: string;
  description: string | null;
  image: string;
  cpu: string;
  memory: string;
  pull_policy: string;
  bootstrap_commands: unknown;
  bootstrap_required_domains: unknown;
  declared_metadata: unknown;
  support_status: string;
  replacement_catalog_key: string | null;
  replacement_catalog_version: number | null;
  created_at: Date;
}

export class ExecutionEnvironmentCatalogService {
  constructor(private readonly pool: DatabaseQueryable) {}

  async listCatalog(): Promise<ExecutionEnvironmentCatalogRecord[]> {
    const result = await this.pool.query<CatalogRow>(
      `SELECT *
         FROM execution_environment_catalog
        ORDER BY name ASC, catalog_version DESC`,
    );
    return result.rows.map(toCatalogRecord);
  }

  async getCatalogEntry(
    catalogKey: string,
    catalogVersion: number,
  ): Promise<ExecutionEnvironmentCatalogRecord> {
    const result = await this.pool.query<CatalogRow>(
      `SELECT *
         FROM execution_environment_catalog
        WHERE catalog_key = $1
          AND catalog_version = $2
        LIMIT 1`,
      [catalogKey, catalogVersion],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('Execution environment catalog entry not found');
    }
    return toCatalogRecord(row);
  }
}

function toCatalogRecord(row: CatalogRow): ExecutionEnvironmentCatalogRecord {
  return {
    catalog_key: row.catalog_key,
    catalog_version: row.catalog_version,
    name: row.name,
    description: row.description,
    image: row.image,
    cpu: row.cpu,
    memory: row.memory,
    pull_policy: normalizePullPolicy(row.pull_policy),
    bootstrap_commands: normalizeStringArray(row.bootstrap_commands),
    bootstrap_required_domains: normalizeStringArray(row.bootstrap_required_domains),
    declared_metadata: isRecord(row.declared_metadata) ? row.declared_metadata : {},
    support_status: normalizeSupportStatus(row.support_status),
    replacement_catalog_key: row.replacement_catalog_key,
    replacement_catalog_version: row.replacement_catalog_version,
    created_at: row.created_at,
  };
}

function normalizePullPolicy(value: string): 'always' | 'if-not-present' | 'never' {
  return value === 'always' || value === 'never' ? value : 'if-not-present';
}

function normalizeSupportStatus(value: string): 'active' | 'deprecated' | 'blocked' {
  switch (value) {
  case 'deprecated':
  case 'blocked':
    return value;
  default:
    return 'active';
  }
}
