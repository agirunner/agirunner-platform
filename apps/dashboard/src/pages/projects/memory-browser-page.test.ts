import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './memory-browser-page.tsx'), 'utf8');
}

describe('memory browser page source', () => {
  it('uses deep-linkable project, workflow, work item, and query filters', () => {
    const source = readSource();
    expect(source).toContain('useSearchParams');
    expect(source).toContain("searchParams.get('workflow')");
    expect(source).toContain("searchParams.get('work_item')");
    expect(source).toContain("next.set('q'");
  });

  it('surfaces work-item memory alongside project memory', () => {
    const source = readSource();
    expect(source).toContain('getWorkflowWorkItemMemory');
    expect(source).toContain('Work-item memory');
    expect(source).toContain('normalizeWorkItemMemoryEntries');
    expect(source).toContain('Read-only scoped memory entries');
  });
});
