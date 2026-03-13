import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './workflow-list-layouts.tsx',
    './workflow-list-board-view.tsx',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('workflow list layouts source', () => {
  it('switches the board posture view to an adaptive layout instead of a single scrolling strip', () => {
    const source = readSource();
    expect(source).toContain('Jump to posture');
    expect(source).toContain('Review the board sections in posture order without horizontal scrolling.');
    expect(source).toContain('xl:hidden');
    expect(source).toContain('hidden gap-4 xl:grid xl:grid-cols-2 2xl:grid-cols-5');
    expect(source).toContain('workflow-posture-');
  });
});
