import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('WorkflowRedriveDialog source', () => {
  it('removes low-level parameter and structured-input controls from the operator redrive modal', () => {
    const source = readFileSync(new URL('./workflow-redrive-dialog.tsx', import.meta.url), 'utf8');

    expect(source).toContain('Redrive summary');
    expect(source).toContain('Steering instruction');
    expect(source).toContain('Redrive files');
    expect(source).not.toContain('Parameter overrides');
    expect(source).not.toContain('Structured redrive inputs');
    expect(source).not.toContain('ChainStructuredEntryEditor');
    expect(source).not.toContain('Add parameter override');
  });

  it('validates the required summary without referencing an undefined field', () => {
    const source = readFileSync(new URL('./workflow-redrive-dialog.tsx', import.meta.url), 'utf8');

    expect(source).toContain('if (!summary.trim())');
    expect(source).not.toContain('!name.trim()');
  });
});
