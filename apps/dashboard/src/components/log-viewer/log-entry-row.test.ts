import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return readFileSync(resolve(import.meta.dirname, './log-entry-row.tsx'), 'utf8');
}

describe('log entry row source', () => {
  it('uses board-first labels and relative timestamps in the compact table', () => {
    const source = readSource();

    expect(source).toContain('function formatRelativeTime(iso: string)');
    expect(source).toContain('title={formatTimestamp(entry.created_at)}');
    expect(source).toContain('{formatRelativeTime(entry.created_at)}');
    expect(source).toContain('>Board</th>');
    expect(source).toContain('>Activity summary</th>');
    expect(source).not.toContain('>Workflow</th>');
    expect(source).not.toContain('>Detail</th>');
  });
});
