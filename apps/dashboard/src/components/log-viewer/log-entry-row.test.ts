import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return readFileSync(resolve(import.meta.dirname, './log-entry-row.tsx'), 'utf8');
}

describe('log entry row source', () => {
  it('uses board-first labels, shared relative timestamps, and no full-row error wash', () => {
    const source = readSource();

    expect(source).toContain("import { formatLogRelativeTime } from './log-time.js';");
    expect(source).toContain('title={formatTimestamp(entry.created_at)}');
    expect(source).toContain('{formatLogRelativeTime(entry.created_at)}');
    expect(source).toContain('>Board</th>');
    expect(source).toContain('>Activity summary</th>');
    expect(source).not.toContain("bg-red-500/5");
    expect(source).not.toContain('>Workflow</th>');
    expect(source).not.toContain('>Detail</th>');
  });
});
