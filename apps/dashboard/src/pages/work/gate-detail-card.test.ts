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
    expect(source).toContain('OperatorBreadcrumbTrail');
    expect(source).toContain('Review packet');
    expect(source).toContain('Lifecycle trail');
    expect(source).toContain('GateSignalCard');
    expect(source).toContain('Decision');
    expect(source).toContain('Follow-up');
    expect(source).toContain('Artifacts');
    expect(source).toContain('Request source');
    expect(source).toContain('Gate summary');
    expect(source).toContain('Recommendation');
    expect(source).toContain('Concerns');
    expect(source).toContain('Human decision');
    expect(source).toContain('Orchestrator follow-up');
    expect(source).toContain('GateHandoffTrail');
    expect(source).toContain('readGateDecisionSummary');
    expect(source).toContain('readGateRequestSourceSummary');
    expect(source).toContain('readGateResumptionSummary');
    expect(source).toContain('Open work-item flow');
    expect(source).toContain('Open follow-up activation');
    expect(source).toContain('Open follow-up step');
    expect(source).toContain('follow-up activations have been recorded');
    expect(source).toContain('Key artifacts');
    expect(source).toContain('Permalink');
    expect(source).toContain('Gate ID');
    expect(source).toContain('Approve Gate');
    expect(source).toContain('Reject Gate');
    expect(source).toContain('Follow-up error details');
    expect(source).toContain('StructuredRecordView');
    expect(source).not.toContain('JSON.stringify(resume.error)');
    expect(source).toContain('actOnGate(');
    expect(source).toContain('buildApprovalQueueGatePermalink');
  });

  it('uses stage-name highlighting inside workflow detail to match workflow permalinks', () => {
    const source = readSource();
    expect(source).toContain("props.source === 'workflow-detail'");
    expect(source).toContain("location.hash === `#gate-${props.gate.stage_name}`");
  });

  it('keeps the request-changes dialog scroll-safe for long review packets', () => {
    const source = readSource();
    expect(source).toContain('DialogContent className="sm:max-w-lg"');
    expect(source).toContain('max-h-[75vh]');
    expect(source).toContain('overflow-y-auto');
    expect(source).toContain('className="min-h-[140px]"');
    expect(source).toContain('className="w-full sm:w-auto"');
  });
});
