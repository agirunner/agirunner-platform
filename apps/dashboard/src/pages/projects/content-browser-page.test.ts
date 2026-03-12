import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './content-browser-page.tsx'), 'utf8');
}

describe('content browser page source', () => {
  it('uses deep-linkable workflow, work item, task, and tab filters', () => {
    const source = readSource();
    expect(source).toContain('useSearchParams');
    expect(source).toContain("searchParams.get('project')");
    expect(source).toContain("next.set('workflow'");
    expect(source).toContain("next.set('work_item'");
    expect(source).toContain("next.set('task'");
    expect(source).toContain("next.set('tab'");
  });

  it('surfaces workflow and work-item scoped execution browsing', () => {
    const source = readSource();
    expect(source).toContain('listWorkflowWorkItems');
    expect(source).toContain('Execution Scope');
    expect(source).toContain('Work item');
    expect(source).toContain('filterTasksByWorkItem');
  });
});
