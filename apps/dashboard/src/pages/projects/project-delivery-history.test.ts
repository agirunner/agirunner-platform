import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return ['./project-delivery-history.tsx', './project-delivery-history-support.ts']
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('project delivery history source', () => {
  it('renders question-driven overview packets, compact run cards, and direct operator actions', () => {
    const source = readSource();

    expect(source).toContain('Delivery Overview');
    expect(source).toContain('dashboardApi.getProjectTimeline(projectId)');
    expect(source).toContain('buildProjectDeliveryAttentionOverview');
    expect(source).toContain('buildProjectDeliveryAttentionState');
    expect(source).toContain('buildProjectDeliveryPacket');
    expect(source).toContain('Project delivery timeline');
    expect(source).toContain('What ran');
    expect(source).toContain('What failed');
    expect(source).toContain('Needs attention');
    expect(source).toContain('Inspect next');
    expect(source).toContain('Next Move');
    expect(source).toContain('Recent Signals');
    expect(source).toContain('Run Cards');
    expect(source).toContain('packet.signals.length > 0');
    expect(source).toContain('packet.signals.map');
    expect(source).toContain('Open board');
    expect(source).toContain('Open inspector');
    expect(source).not.toContain('Operator readout');
    expect(source).not.toContain('Answer the operator questions first');
    expect(source).not.toContain('Project delivery is being rebuilt');
    expect(source).toContain('grid gap-4 lg:grid-cols-2');
  });
});
