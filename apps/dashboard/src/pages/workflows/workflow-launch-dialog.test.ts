import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('WorkflowLaunchDialog source', () => {
  it('removes budget guardrail fields from the workflow launch modal', () => {
    const source = readFileSync(new URL('./workflow-launch-dialog.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('Token budget');
    expect(source).not.toContain('Cost cap (USD)');
    expect(source).not.toContain('Max duration (minutes)');
  });
});
