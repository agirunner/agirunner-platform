import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { STATUS_FILTER_OPTIONS, matchesStatusFilter } from './search-filter-bar.js';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './search-filter-bar.tsx'), 'utf8');
}

describe('SearchFilterBar source', () => {
  it('exports SearchFilterBar function', () => {
    const source = readSource();

    expect(source).toContain('export function SearchFilterBar(');
  });

  it('accepts all required props', () => {
    const source = readSource();

    expect(source).toContain('searchQuery:');
    expect(source).toContain('onSearchChange:');
    expect(source).toContain('statusFilter:');
    expect(source).toContain('onStatusFilterChange:');
    expect(source).toContain('playbookFilter');
    expect(source).toContain('onPlaybookFilterChange');
    expect(source).toContain('workspaceFilter');
    expect(source).toContain('onWorkspaceFilterChange');
  });

  it('includes search input with correct placeholder', () => {
    const source = readSource();

    expect(source).toContain('Search workflows...');
  });

  it('includes all status filter options', () => {
    const source = readSource();

    expect(source).toContain('Active');
    expect(source).toContain('Needs Attention');
    expect(source).toContain('Completed');
    expect(source).toContain('Failed');
  });
});

describe('STATUS_FILTER_OPTIONS', () => {
  it('includes all five status options', () => {
    expect(STATUS_FILTER_OPTIONS).toHaveLength(5);
  });

  it('has null value for the All option', () => {
    const allOption = STATUS_FILTER_OPTIONS.find((o) => o.label === 'All');

    expect(allOption).toBeDefined();
    expect(allOption?.value).toBeNull();
  });

  it('has string values for non-All options', () => {
    const nonAll = STATUS_FILTER_OPTIONS.filter((o) => o.label !== 'All');

    for (const option of nonAll) {
      expect(typeof option.value).toBe('string');
    }
  });
});

describe('matchesStatusFilter', () => {
  it('returns true when filter is null (show all)', () => {
    expect(matchesStatusFilter('active', null)).toBe(true);
    expect(matchesStatusFilter('failed', null)).toBe(true);
  });

  it('returns true when status matches filter', () => {
    expect(matchesStatusFilter('active', 'active')).toBe(true);
    expect(matchesStatusFilter('failed', 'failed')).toBe(true);
  });

  it('returns false when status does not match filter', () => {
    expect(matchesStatusFilter('active', 'failed')).toBe(false);
    expect(matchesStatusFilter('completed', 'active')).toBe(false);
  });
});
