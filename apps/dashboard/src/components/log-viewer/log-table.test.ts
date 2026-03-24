import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return readFileSync(resolve(import.meta.dirname, './log-table.tsx'), 'utf8');
}

describe('log table source', () => {
  it('renders a dedicated mobile raw-log card layout instead of shrinking the desktop table', () => {
    const source = readSource();

    expect(source).toContain('LogEntryMobileCard');
    expect(source).toContain("className=\"grid gap-3 md:hidden\"");
    expect(source).toContain("className=\"hidden overflow-x-auto rounded-2xl border border-border/70 bg-card/90 shadow-sm md:block\"");
    expect(source).toContain('MobileSkeletonCards');
    expect(source).toContain('COL_COUNT = 9');
    expect(source).not.toContain('exportSlot');
  });
});
