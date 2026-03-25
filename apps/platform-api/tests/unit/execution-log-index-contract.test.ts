import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const RISKY_INCLUDE_COLUMNS = new Set([
  'actor_name',
  'error',
  'operation',
  'payload',
  'resource_name',
  'role',
  'stage_name',
  'task_title',
  'workflow_name',
  'workspace_name',
]);

const MIGRATION_FILES = [
  resolve(process.cwd(), 'src/db/migrations/0001_init.sql'),
  resolve(process.cwd(), 'src/db/migrations/0007_execution_log_workflow_context.sql'),
  resolve(process.cwd(), 'src/db/migrations/0050_execution_log_filter_indexes.sql'),
];

function collectExecutionLogIncludeViolations(sql: string) {
  const violations: Array<{ indexName: string; columns: string[] }> = [];
  const statements = sql
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.includes('ON ONLY public.execution_logs'))
    .filter((statement) => statement.includes('INCLUDE'));

  for (const statement of statements) {
    const indexNameMatch = statement.match(/^CREATE INDEX\s+(\S+)/m);
    const includeMatch = statement.match(/INCLUDE\s*\(([^)]+)\)/m);
    if (!indexNameMatch || !includeMatch) {
      continue;
    }

    const indexName = indexNameMatch[1];
    const columns = includeMatch[1]
      .split(',')
      .map((value) => value.trim().replace(/^"+|"+$/g, ''))
      .filter((value) => RISKY_INCLUDE_COLUMNS.has(value));

    if (columns.length > 0) {
      violations.push({ indexName, columns });
    }
  }

  return violations;
}

describe('execution_logs covering indexes', () => {
  it('do not include wide text or json columns', () => {
    const violations = MIGRATION_FILES.flatMap((file) =>
      collectExecutionLogIncludeViolations(readFileSync(file, 'utf8')),
    );

    expect(violations).toEqual([]);
  });

  it('includes the required search and hot-filter indexes', () => {
    const sql = MIGRATION_FILES.map((file) => readFileSync(file, 'utf8')).join('\n');

    expect(sql).toContain('idx_exlogs_search_document');
    expect(sql).toContain('idx_exlogs_tenant_workspace_time');
    expect(sql).toContain('idx_exlogs_tenant_workflow_time');
    expect(sql).toContain('idx_exlogs_tenant_task_time');
    expect(sql).toContain('idx_exlogs_tenant_trace_time');
    expect(sql).toContain('idx_exlogs_tenant_workflow_operation_time');
    expect(sql).toContain('idx_exlogs_tenant_workflow_role_time');
    expect(sql).toContain('idx_exlogs_tenant_workflow_actor_time');
  });

  it('uses an immutable search-document expression in migrations', () => {
    const sql = MIGRATION_FILES.map((file) => readFileSync(file, 'utf8')).join('\n');

    expect(sql).not.toContain('CONCAT_WS(');
    expect(sql).toContain("COALESCE(operation, '')");
  });
});
