import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return readFileSync(
    resolve(import.meta.dirname, './execution-inspector-filter-bar.tsx'),
    'utf8',
  );
}

describe('execution inspector filter bar source', () => {
  it('uses operator-readable labels and focus guidance', () => {
    const source = readSource();

    expect(source).toContain('Focus the execution slice');
    expect(source).toContain(
      'Narrow the inspector by board, specialist step, stage, activation, role, or runtime emitter.',
    );
    expect(source).toContain('placeholder="operation, board, step, error, or payload text"');
    expect(source).toContain('label="Board ID"');
    expect(source).toContain('label="Step ID"');
    expect(source).toContain('label="Step role"');
    expect(source).toContain('label="Emitter"');
  });

  it('MCL-006: supports collapse/expand behavior to reduce mobile vertical space', () => {
    const source = readSource();

    expect(source).toContain('isExpanded');
    expect(source).toContain('setIsExpanded');
    expect(source).toContain('countActiveFilters');
    expect(source).toContain('active filter');
    expect(source).toContain('ChevronDown');
    expect(source).toContain('ChevronUp');
    expect(source).toContain('Tap to narrow by board');
  });
});
