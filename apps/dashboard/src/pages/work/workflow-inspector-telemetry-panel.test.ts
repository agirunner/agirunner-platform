import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './workflow-inspector-telemetry-panel.tsx'), 'utf8');
}

describe('workflow inspector telemetry panel source', () => {
  it('adds operator focus, spend posture, and memory-review hierarchy to the telemetry panel', () => {
    const source = readSource();

    expect(source).toContain('Operator focus');
    expect(source).toContain('buildTelemetryFocusPacket');
    expect(source).toContain('Open highest-impact slice');
    expect(source).toContain('Spend posture');
    expect(source).toContain('Telemetry breakdowns');
    expect(source).toContain('Memory evolution review');
    expect(source).toContain('DiffViewer');
    expect(source).toContain('props.telemetry.spendBreakdowns.map');
    expect(source).toContain('section.coverageLabel');
    expect(source).toContain('section.coverageDetail');
    expect(source).toContain('Open spend slice');
    expect(source).toContain('Open breakdown slice');
    expect(source).toContain('No deeper breakdown is available in this slice yet.');
    expect(source).toContain('change.changedFields.length > 0');
    expect(source).toContain('Open field diff');
    expect(source).toContain("oldLabel={change.status === 'Created' ? 'No previous value' : 'Previous value'}");
    expect(source).toContain("newLabel={change.status === 'Deleted' ? 'Deleted value' : 'Current value'}");
  });
});
