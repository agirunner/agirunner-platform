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

  it('surfaces work-item memory and history alongside project memory', () => {
    const source = readSource();
    expect(source).toContain('getWorkflowWorkItemMemory');
    expect(source).toContain('getWorkflowWorkItemMemoryHistory');
    expect(source).toContain('Work-item memory');
    expect(source).toContain('Work-item memory history');
    expect(source).toContain('normalizeWorkItemMemoryEntries');
    expect(source).toContain('normalizeWorkItemMemoryHistoryEntries');
    expect(source).toContain('Read-only scoped memory entries');
  });

  it('supports discoverable project-scoped memory routes', () => {
    const source = readSource();
    expect(source).toContain('scopedProjectId');
    expect(source).toContain('Back to Project');
    expect(source).toContain('disabled={scopedProjectId.length > 0}');
  });
});
