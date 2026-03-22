import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(
    resolve(import.meta.dirname, './task-detail-artifacts-panel.tsx'),
    'utf8',
  );
}

describe('task detail artifacts panel source', () => {
  it('reframes the artifacts tab as an operator evidence packet instead of a raw file list', () => {
    const source = readSource();
    expect(source).toContain('Artifact evidence packet');
    expect(source).toContain('Artifacts recorded');
    expect(source).toContain('Inline preview ready');
    expect(source).toContain('Download-first files');
    expect(source).toContain('Open preview workspace');
    expect(source).toContain('No artifacts published for this step yet.');
  });

  it('uses responsive cards and explicit assessment guidance for every artifact', () => {
    const source = readSource();
    expect(source).toContain('grid gap-3 md:grid-cols-3');
    expect(source).toContain('sm:flex-row sm:items-start sm:justify-between');
    expect(source).toContain('Start with the preview workspace');
    expect(source).toContain('Download-only artifact');
    expect(source).toContain('Created {formatRelativeTime(');
  });
});
