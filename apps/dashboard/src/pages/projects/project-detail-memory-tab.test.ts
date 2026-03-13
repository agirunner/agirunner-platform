import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './project-detail-memory-tab.tsx'), 'utf8');
}

describe('project detail memory tab source', () => {
  it('reuses the shared typed memory editor and table instead of native selects', () => {
    const source = readSource();
    expect(source).toContain('ProjectMemoryTable');
    expect(source).toContain('MemoryEditor');
    expect(source).toContain('SelectItem value="json"');
    expect(source).not.toContain('<select');
  });

  it('adds inline duplicate-key guidance and responsive summary packets', () => {
    const source = readSource();
    expect(source).toContain('Memory posture');
    expect(source).toContain('Choose a different key.');
    expect(source).toContain('Review and update shared memory with responsive card or table layouts');
    expect(source).toContain("saveLabel=\"Add entry\"");
  });
});
