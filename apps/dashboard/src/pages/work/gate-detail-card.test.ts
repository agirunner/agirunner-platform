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
    expect(source).toContain('Lifecycle trail');
    expect(source).toContain('Request source');
    expect(source).toContain('Gate summary');
    expect(source).toContain('Recommendation');
    expect(source).toContain('Concerns');
    expect(source).toContain('Human decision');
    expect(source).toContain('Orchestrator follow-up');
    expect(source).toContain('readGateDecisionSummary');
    expect(source).toContain('readGateRequestSourceSummary');
    expect(source).toContain('readGateResumptionSummary');
    expect(source).toContain('Open work-item flow');
    expect(source).toContain('Open follow-up activation');
    expect(source).toContain('Key artifacts');
    expect(source).toContain('Permalink');
    expect(source).toContain('Gate ID');
    expect(source).toContain('Approve Gate');
    expect(source).toContain('Reject Gate');
    expect(source).toContain('actOnGate(');
    expect(source).toContain('buildApprovalQueueGatePermalink');
  });

  it('uses stage-name highlighting inside workflow detail to match workflow permalinks', () => {
    const source = readSource();
    expect(source).toContain("props.source === 'workflow-detail'");
    expect(source).toContain("location.hash === `#gate-${props.gate.stage_name}`");
  });
});
