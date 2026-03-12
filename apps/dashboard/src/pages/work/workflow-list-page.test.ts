import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './workflow-list-page.tsx'), 'utf8');
}

describe('workflow board page source', () => {
  it('keeps board labeling centered on delivery posture', () => {
    const source = readSource();
    expect(source).toContain('Delivery Boards');
    expect(source).toContain('Board Posture');
    expect(source).toContain('All Postures');
    expect(source).toContain('Search runs, stages, or projects...');
    expect(source).toContain('Failed to load delivery boards. Please try again later.');
    expect(source).toContain('No runs match the current filters.');
    expect(source).toContain('No runs');
  });
});
