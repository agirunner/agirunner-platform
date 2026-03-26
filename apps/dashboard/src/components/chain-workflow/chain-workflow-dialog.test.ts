import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './chain-workflow-dialog.tsx'), 'utf8');
}

describe('chain workflow dialog source', () => {
  it('uses declared workflow goals instead of raw or ad hoc parameter payloads', () => {
    const source = readSource();
    expect(source).toContain('ChainParameterField');
    expect(source).toContain('Workflow Goals');
    expect(source).toContain('Provide the declared workflow goals for the chained run.');
    expect(source).toContain('buildParametersFromDrafts(');
    expect(source).not.toContain('ChainStructuredEntryEditor');
    expect(source).not.toContain('mergeStructuredObjects');
    expect(source).not.toContain('defaultParameterDraftValue');
    expect(source).not.toContain('Parameter Overrides (JSON)');
    expect(source).not.toContain('parseParameters(');
  });
});
