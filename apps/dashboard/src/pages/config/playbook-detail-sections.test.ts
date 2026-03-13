import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './playbook-detail-sections.tsx'), 'utf8');
}

describe('playbook detail sections source', () => {
  it('provides a dedicated editing rail and section outline for long playbooks', () => {
    const source = readSource();
    expect(source).toContain('export function PlaybookEditingActionRailCard');
    expect(source).toContain('Editing Actions');
    expect(source).toContain('grid gap-2 sm:grid-cols-2 xl:grid-cols-1');
    expect(source).toContain('export function PlaybookEditOutlineCard');
    expect(source).toContain('Jump to Editor Sections');
    expect(source).toContain('hover:bg-muted/20');
  });
});
