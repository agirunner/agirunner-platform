import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './workflow-inspector-telemetry-panel.tsx'), 'utf8');
}

describe('workflow inspector telemetry panel source', () => {
  it('renders changed-field badges and inline diff review for memory evolution cards', () => {
    const source = readSource();

    expect(source).toContain('DiffViewer');
    expect(source).toContain('props.telemetry.spendBreakdowns.map');
    expect(source).toContain('Open filtered slice');
    expect(source).toContain('No deeper breakdown is available in this slice yet.');
    expect(source).toContain('change.changedFields.length > 0');
    expect(source).toContain('Open field diff');
    expect(source).toContain("oldLabel={change.status === 'Created' ? 'No previous value' : 'Previous value'}");
    expect(source).toContain("newLabel={change.status === 'Deleted' ? 'Deleted value' : 'Current value'}");
  });
});
