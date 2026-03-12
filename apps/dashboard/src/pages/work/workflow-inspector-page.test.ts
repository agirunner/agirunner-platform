import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './workflow-inspector-page.tsx'), 'utf8');
}

describe('workflow inspector page source', () => {
  it('scopes the shared inspector page to the workflow route parameter', () => {
    const source = readSource();
    expect(source).toContain('useParams');
    expect(source).toContain('scopedWorkflowId');
    expect(source).toContain('LogsSurface');
  });
});
