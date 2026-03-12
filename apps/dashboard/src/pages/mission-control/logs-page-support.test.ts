import { describe, expect, it } from 'vitest';

import { DEFAULT_INSPECTOR_FILTERS } from '../../components/execution-inspector-support.js';
import { buildInspectorOverviewCards } from './logs-page-support.js';

describe('logs page support', () => {
  it('builds operator-first inspector overview cards', () => {
    const cards = buildInspectorOverviewCards(
      {
        ...DEFAULT_INSPECTOR_FILTERS,
        stageName: 'review',
        level: 'warn',
        timeWindowHours: '6',
      },
      '',
      {
        data: {
          totals: {
            count: 40,
            error_count: 5,
            total_duration_ms: 32_000,
          },
          groups: [
            {
              group: 'tool',
              count: 20,
              error_count: 5,
              avg_duration_ms: 1_000,
              total_duration_ms: 20_000,
              agg: { total_cost_usd: 1.25 },
            },
          ],
        },
      },
      [{ operation: 'tool.exec', count: 12 }],
    );

    expect(cards).toEqual([
      {
        title: 'Focus',
        value: 'Stage review',
        detail: '6h window • warnings and errors',
      },
      {
        title: 'Attention',
        value: '5 errors',
        detail: '13% of 40 entries need review',
      },
      {
        title: 'Spend signal',
        value: '$1.2500',
        detail: '32.00 s recorded runtime',
      },
    ]);
  });

  it('falls back to top activity when the current slice is healthy', () => {
    const cards = buildInspectorOverviewCards(
      DEFAULT_INSPECTOR_FILTERS,
      'workflow-123456789',
      {
        data: {
          totals: {
            count: 18,
            error_count: 0,
            total_duration_ms: 500,
          },
          groups: [],
        },
      },
      [{ operation: 'llm.chat', count: 9 }],
    );

    expect(cards[0]).toEqual({
      title: 'Focus',
      value: 'Board workflow',
      detail: '1d window • info and above',
    });
    expect(cards[1]).toEqual({
      title: 'Attention',
      value: 'Healthy slice',
      detail: 'llm.chat leads with 9 entries',
    });
  });
});
