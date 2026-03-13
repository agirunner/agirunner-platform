import { describe, expect, it } from 'vitest';

import { describeSpendBreakdownCoverage } from './workflow-inspector-breakdown-coverage.js';

describe('workflow inspector breakdown coverage', () => {
  it('summarizes hidden spend outside the visible breakdown slice', () => {
    expect(
      describeSpendBreakdownCoverage({
        nounSingular: 'task',
        nounPlural: 'tasks',
        totalCount: 5,
        visibleCount: 3,
        totalCostUsd: 9.5,
        visibleCostUsd: 7.25,
      }),
    ).toEqual({
      label: 'Showing top 3 of 5 tasks',
      detail:
        '$7.2500 of $9.5000 is visible here. 2 more tasks account for $2.2500 outside the visible entries.',
    });
  });
});
