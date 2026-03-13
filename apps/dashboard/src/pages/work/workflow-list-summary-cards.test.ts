import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './workflow-list-summary-cards.tsx'), 'utf8');
}

describe('workflow list summary cards source', () => {
  it('surfaces progress, attention, and spend coverage as operator posture packets', () => {
    const source = readSource();
    expect(source).toContain('Boards in Scope');
    expect(source).toContain('Delivery Progress');
    expect(source).toContain('Attention Posture');
    expect(source).toContain('Spend Coverage');
    expect(source).toContain('describeCollectionProgress');
    expect(source).toContain('describeCollectionAttention');
    expect(source).toContain('describeCollectionSpend');
    expect(source).toContain('need review');
  });
});
