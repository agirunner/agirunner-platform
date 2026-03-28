import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './cost-dashboard-page.tsx',
    './cost-dashboard-page.support.ts',
    './cost-dashboard-breakdown-cards.tsx',
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
    expect(source).toContain('dashboardApi.getCostSummary');
    expect(source).not.toContain("fetch(`${API_BASE_URL}/api/v1/metering/summary`");
    expect(source).not.toContain('authHeaders()');
    expect(source).toContain('Cost by Model Family');
    expect(source).toContain('No model cost data.');
  });

  it('leads with spend posture and a concrete next step before the charts', () => {
    const source = readSource();
    expect(source).toContain('Workflow operator surface');
    expect(source).toContain('Best next step:');
    expect(source).toContain('Open workflows');
    expect(source).toContain('Open logs');
    expect(source).toContain("navigate('/logs')");
    expect(source).toContain("navigate('/workflows')");
    expect(source).toContain('Immediate spend');
    expect(source).toContain('Budget posture');
    expect(source).toContain('Top board driver');
    expect(source).toContain('Model mix');
    expect(source).toContain('buildCostPosture');
  });

  it('adds summary-first driver packets so operators can scan spend without relying on charts alone', () => {
    const source = readSource();
    expect(source).toContain('CostDashboardBreakdownCards');
    expect(source).toContain('Board spend leaders');
    expect(source).toContain('Model spend leaders');
    expect(source).toContain('Peak spend day');
    expect(source).toContain('buildCostBreakdownSummary');
    expect(source).toContain('phone-friendly scan');
  });
});
