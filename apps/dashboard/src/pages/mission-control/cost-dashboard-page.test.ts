import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './cost-dashboard-page.tsx',
    './cost-dashboard-page.support.ts',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('cost dashboard page source', () => {
  it('uses board and work-item language instead of workflow-centric copy', () => {
    const source = readSource();
    expect(source).toContain('Operator Cost Dashboard');
    expect(source).toContain('active boards, work-item execution, and model usage');
    expect(source).toContain('Cost by Board');
    expect(source).toContain('Daily Board Spend Trend');
    expect(source).toContain('No board cost data.');
    expect(source).not.toContain('Track spending across workflows and models.');
    expect(source).not.toContain('Cost by Workflow');
  });

  it('keeps the existing metering-backed model usage view intact', () => {
    const source = readSource();
    expect(source).toContain("queryKey: ['metering-summary']");
    expect(source).toContain('fetchCostSummary');
    expect(source).toContain('Cost by Model Family');
    expect(source).toContain('No model cost data.');
  });

  it('leads with spend posture and a concrete next step before the charts', () => {
    const source = readSource();
    expect(source).toContain('Mission control operator surface');
    expect(source).toContain('Best next step:');
    expect(source).toContain('Open live board');
    expect(source).toContain('Immediate spend');
    expect(source).toContain('Budget posture');
    expect(source).toContain('Top board driver');
    expect(source).toContain('Model mix');
    expect(source).toContain('buildCostPosture');
  });
});
