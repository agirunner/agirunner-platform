import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './workflow-work-item-history-section.tsx'), 'utf8');
}

describe('workflow work-item history section source', () => {
  it('renders operator history packets with overview metrics and linked-step drill-ins', () => {
    const source = readSource();

    expect(source).toContain('buildWorkItemHistoryOverview(props.events)');
    expect(source).toContain('buildWorkItemHistoryPacket(event)');
    expect(source).toContain('Latest operator signal');
    expect(source).toContain('overview.metrics.map((metric) =>');
    expect(source).toContain('metric.label');
    expect(source).toContain('metric.value');
    expect(source).toContain('metric.detail');
    expect(source).toContain('data-testid="work-item-history-list"');
    expect(source).toContain('Open linked step');
    expect(source).toContain('Operator review packet');
    expect(source).toContain('Open full event payload');
  });
});
