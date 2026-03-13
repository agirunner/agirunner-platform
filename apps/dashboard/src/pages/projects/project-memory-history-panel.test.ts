import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './project-memory-history-panel.tsx',
    './project-memory-history-panel.sections.tsx',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('project memory history panel source', () => {
  it('uses structured author and key filters for history review', () => {
    const source = readSource();
    expect(source).toContain('Changed by');
    expect(source).toContain('Memory key');
    expect(source).toContain('All authors');
    expect(source).toContain('Select a memory key');
    expect(source).toContain('includeAllOption');
  });

  it('renders a per-key version trail with diff review', () => {
    const source = readSource();
    expect(source).toContain('Current focus');
    expect(source).toContain('Next review step');
    expect(source).toContain('Version trail');
    expect(source).toContain('Select a revision to compare it against the version immediately before it.');
    expect(source).toContain('Inspect the selected revision first');
    expect(source).toContain('DiffViewer');
    expect(source).toContain('Version Diff');
    expect(source).toContain('Payload');
  });
});
