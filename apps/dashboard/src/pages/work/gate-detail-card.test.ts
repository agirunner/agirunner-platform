import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './gate-detail-card.tsx'), 'utf8');
}

describe('gate detail card source', () => {
  it('renders gate detail, permalinks, and gate-addressed actions', () => {
    const source = readSource();
    expect(source).toContain('Operator breadcrumbs');
    expect(source).toContain('Review packet');
    expect(source).toContain('Operator trail');
    expect(source).toContain('Request source');
    expect(source).toContain('Gate summary');
    expect(source).toContain('Recommendation');
    expect(source).toContain('Concerns');
    expect(source).toContain('Human decision');
    expect(source).toContain('Orchestrator resumption');
    expect(source).toContain('Key artifacts');
    expect(source).toContain('Permalink');
    expect(source).toContain('Gate ID');
    expect(source).toContain('Approve Gate');
    expect(source).toContain('Reject Gate');
    expect(source).toContain('actOnGate(');
    expect(source).toContain('buildApprovalQueueGatePermalink');
  });
});
