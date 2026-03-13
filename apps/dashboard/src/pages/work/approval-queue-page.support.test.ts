import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './approval-queue-page.support.ts'), 'utf8');
}

describe('approval queue page support source', () => {
  it('centralizes workflow invalidation and url param updates for the queue shell', () => {
    const source = readSource();
    expect(source).toContain('invalidateWorkflowQueries');
    expect(source).toContain('invalidateApprovalWorkflowQueries');
    expect(source).toContain('updateApprovalQueueSearchParams');
    expect(source).toContain('{ replace: true }');
  });
});
