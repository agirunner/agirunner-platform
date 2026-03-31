import { describe, expect, it } from 'vitest';

import { ConflictError, ValidationError } from '../../../src/errors/domain-errors.js';
import {
  handleEnvironmentWriteError,
  mergeEnvironmentUpdate,
  normalizeOptionalString,
  normalizeSlug,
  toExecutionEnvironmentRecord,
  toExecutionEnvironmentSummary,
  validateEnvironmentInput,
} from '../../../src/services/execution-environment/support.js';
import type {
  ExecutionEnvironmentRecord,
  ExecutionEnvironmentRow,
} from '../../../src/services/execution-environment/types.js';

function buildRow(overrides: Partial<ExecutionEnvironmentRow> = {}): ExecutionEnvironmentRow {
  return {
    id: 'env-1',
    tenant_id: 'tenant-1',
    slug: 'env-1',
    name: 'Ubuntu Env',
    description: 'Primary environment',
    source_kind: 'catalog',
    catalog_key: 'ubuntu',
    catalog_version: 1,
    image: 'ubuntu:24.04',
    cpu: '2',
    memory: '1Gi',
    pull_policy: 'sometimes',
    bootstrap_commands: ['bash', 7, 'grep'],
    bootstrap_required_domains: ['example.com', null],
    operator_notes: 'notes',
    declared_metadata: 'invalid',
    verified_metadata: 'invalid',
    tool_capabilities: 'invalid',
    compatibility_status: 'mystery',
    compatibility_errors: ['missing tool', 2],
    verification_contract_version: null,
    last_verified_at: null,
    is_default: true,
    is_archived: false,
    is_claimable: true,
    created_at: new Date('2026-03-01T00:00:00.000Z'),
    updated_at: new Date('2026-03-02T00:00:00.000Z'),
    support_status: null,
    usage_count: 3,
    ...overrides,
  };
}

function buildRecord(overrides: Partial<ExecutionEnvironmentRecord> = {}): ExecutionEnvironmentRecord {
  return {
    ...toExecutionEnvironmentRecord(buildRow()),
    ...overrides,
  };
}

describe('execution-environment-service support', () => {
  it('normalizes stored rows into public records', () => {
    const record = toExecutionEnvironmentRecord(buildRow());

    expect(record.pull_policy).toBe('if-not-present');
    expect(record.bootstrap_commands).toEqual(['bash', 'grep']);
    expect(record.bootstrap_required_domains).toEqual(['example.com']);
    expect(record.compatibility_status).toBe('unknown');
    expect(record.support_status).toBe('active');
    expect(record.declared_metadata).toEqual({});
    expect(record.verified_metadata).toEqual({});
    expect(record.tool_capabilities).toEqual({});
    expect(record.compatibility_errors).toEqual(['missing tool']);
  });

  it('falls back to the current contract version when building summaries', () => {
    const summary = toExecutionEnvironmentSummary(
      buildRecord({
        verification_contract_version: null,
      }),
    );

    expect(summary.verification_contract_version).toBe('v1');
  });

  it('preserves current nullable fields when update input passes null', () => {
    const merged = mergeEnvironmentUpdate(
      buildRecord({
        description: 'keep me',
        operator_notes: 'keep notes',
      }),
      {
        description: null,
        operatorNotes: null,
      },
    );

    expect(merged.description).toBe('keep me');
    expect(merged.operatorNotes).toBe('keep notes');
  });

  it('normalizes optional strings and slugs', () => {
    expect(normalizeOptionalString('  hello  ')).toBe('hello');
    expect(normalizeOptionalString('   ')).toBeNull();
    expect(normalizeSlug('  Ubuntu Env !! 2026  ')).toBe('ubuntu-env-2026');
  });

  it('validates required environment fields', () => {
    expect(() =>
      validateEnvironmentInput({
        name: '   ',
        image: 'ubuntu:24.04',
        cpu: '2',
        memory: '1Gi',
        pullPolicy: 'if-not-present',
      }),
    ).toThrowError(ValidationError);
  });

  it('translates tenant slug conflicts into domain conflicts', () => {
    expect(() =>
      handleEnvironmentWriteError({
        code: '23505',
        constraint: 'uq_execution_environments_tenant_slug',
      }),
    ).toThrowError(ConflictError);
  });
});
