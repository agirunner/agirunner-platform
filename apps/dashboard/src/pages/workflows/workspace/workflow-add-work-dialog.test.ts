import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('WorkflowAddWorkDialog source', () => {
  it('removes owner-role override from the default modal and adds modify-mode steering', () => {
    const source = readFileSync(new URL('./workflow-add-work-dialog.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('Owner role');
    expect(source).toContain('Steering instruction');
    expect(source).toContain('Editable inputs');
    expect(source).not.toContain("<span className=\"font-medium\">Goal</span>");
  });
});
