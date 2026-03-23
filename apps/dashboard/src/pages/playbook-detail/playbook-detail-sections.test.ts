import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './playbook-detail-sections.tsx'), 'utf8');
}

describe('playbook detail sections source', () => {
  it('keeps revision comparison tooling available while the detail page sheds extra chrome', () => {
    const source = readSource();
    expect(source).toContain('export function PlaybookRevisionHistoryCard');
    expect(source).toContain('Revision History');
    expect(source).toContain('Compare against revision');
    expect(source).toContain('Structured Diff');
    expect(source).toContain('Rendered Snapshot Diff');
    expect(source).not.toContain('export function PlaybookEditingActionRailCard');
    expect(source).not.toContain('export function PlaybookEditOutlineCard');
  });
});
