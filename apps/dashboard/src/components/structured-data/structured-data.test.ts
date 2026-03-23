import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(
    resolve(import.meta.dirname, './structured-data.tsx'),
    'utf8',
  );
}

describe('structured data source', () => {
  it('uses explicit utility styling instead of legacy semantic classes', () => {
    const source = readSource();
    expect(source).toContain('rounded-md border border-border/70 bg-border/10 p-4');
    expect(source).toContain('text-xs font-medium uppercase tracking-wide text-muted');
    expect(source).toContain('list-disc space-y-1 pl-5 text-sm');
    expect(source).not.toContain('className="muted"');
    expect(source).not.toContain('structured-record');
    expect(source).not.toContain('structured-record-row');
    expect(source).not.toContain('structured-list');
    expect(source).not.toContain('structured-stack');
    expect(source).not.toContain('structured-subsection');
  });
});
