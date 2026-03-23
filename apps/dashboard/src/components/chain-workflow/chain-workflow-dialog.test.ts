import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './chain-workflow-dialog.tsx'), 'utf8');
}

describe('chain workflow dialog source', () => {
  it('uses structured parameter controls instead of a raw json textarea', () => {
    const source = readSource();
    expect(source).toContain('ChainParameterField');
    expect(source).toContain('ChainStructuredEntryEditor');
    expect(source).not.toContain('Parameter Overrides (JSON)');
    expect(source).not.toContain('parseParameters(');
  });
});
