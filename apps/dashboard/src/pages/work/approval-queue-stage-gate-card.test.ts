import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './approval-queue-stage-gate-card.tsx'), 'utf8');
}

describe('approval queue stage gate card source', () => {
  it('renders stage-gate packets with explicit review disclosure and follow-up context', () => {
    const source = readSource();
    expect(source).toContain('ApprovalQueueReviewDisclosure');
    expect(source).toContain('buildWorkflowDetailPermalink');
    expect(source).toContain('source="approval-queue"');
    expect(source).toContain('renderQueuePriorityLabel');
    expect(source).toContain('Oldest wait first');
    expect(source).toContain('readGateDecisionSummary');
    expect(source).toContain('readGateResumptionSummary');
    expect(source).toContain('readGateResumeTaskSummary');
    expect(source).toContain('readGateRequestSourceSummary');
    expect(source).toContain('Gate packet');
    expect(source).toContain('Request source');
    expect(source).toContain('Orchestrator follow-up');
    expect(source).toContain('Gate review packet');
    expect(source).toContain('Open board gate');
    expect(source).toContain('Follow-up step:');
  });
});
