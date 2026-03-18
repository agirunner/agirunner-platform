import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(
    resolve(import.meta.dirname, './workflow-work-item-task-review-dialogs.tsx'),
    'utf8',
  );
}

describe('workflow work item task review dialogs source', () => {
  it('uses real scroll-safe dialogs for step rework, escalation guidance, and reassignment', () => {
    const source = readSource();
    expect(source).toContain('<Dialog');
    expect(source).toContain('DialogContent className="max-h-[75vh] overflow-y-auto sm:max-w-lg"');
    expect(source).toContain('Request Step Changes');
    expect(source).toContain('Provide Operator Guidance');
    expect(source).toContain('Reassign Step');
    expect(source).toContain('SearchableCombobox');
  });
});
