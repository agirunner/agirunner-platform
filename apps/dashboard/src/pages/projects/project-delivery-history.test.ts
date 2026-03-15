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
    expect(source).toContain('buildProjectDeliveryAttentionOverview(entries)');
    expect(source).toContain('buildProjectDeliveryAttentionState(entry)');
    expect(source).toContain('buildProjectDeliveryPacket(entry)');
    expect(source).toContain('What ran');
    expect(source).toContain('What failed');
    expect(source).toContain('Needs attention');
    expect(source).toContain('Inspect next');
    expect(source).toContain('Next Move');
    expect(source).toContain('Recent Signals');
    expect(source).toContain('packet.signals.length > 0');
    expect(source).toContain('packet.signals.map');
    expect(source).toContain('Open board');
    expect(source).toContain('Open automation');
    expect(source).not.toContain('Operator readout');
    expect(source).not.toContain('Answer the operator questions first');
    expect(source).not.toContain('packet.summary');
    expect(source).toContain('w-full flex-col gap-2 sm:flex-row');
  });
});
