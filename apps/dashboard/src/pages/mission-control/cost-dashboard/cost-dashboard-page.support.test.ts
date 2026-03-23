import { describe, expect, it } from 'vitest';

import {
  buildCostBreakdownSummary,
  buildCostPosture,
  budgetPercentUsed,
  formatCurrency,
} from './cost-dashboard-page.support.js';

describe('cost dashboard support', () => {
  it('formats cost posture for an active budget warning', () => {
    const posture = buildCostPosture({
      today: 18.75,
      this_week: 96.4,
      this_month: 210.2,
      budget_total: 240,
      budget_remaining: 35,
      by_workflow: [
        { name: 'Board Alpha', cost: 88.5 },
        { name: 'Board Beta', cost: 32.1 },
      ],
      by_model: [
        { model: 'gpt-5.4', cost: 144.25 },
        { model: 'o4-mini', cost: 18.9 },
      ],
      daily_trend: [],
    });

    expect(posture.heading).toBe('Budget attention is rising');
    expect(posture.detail).toContain('Review Board Alpha first');
    expect(posture.nextAction).toContain('inspect the latest orchestrator turn');
    expect(posture.packets[1]).toMatchObject({
      label: 'Budget posture',
      value: '85% used',
      warning: true,
    });
    expect(posture.packets[2]).toMatchObject({
      label: 'Top board driver',
      value: 'Board Alpha',
    });
    expect(posture.packets[3]).toMatchObject({
      label: 'Model mix',
      value: 'gpt-5.4',
    });
  });

  it('keeps stable guidance when budget has room and no spend records yet', () => {
    const posture = buildCostPosture({
      today: 0,
      this_week: 0,
      this_month: 0,
      budget_total: 0,
      budget_remaining: 0,
      by_workflow: [],
      by_model: [],
      daily_trend: [],
    });

    expect(posture.heading).toBe('Spend posture is stable');
    expect(posture.nextAction).toContain('confirm spend is flowing from active work');
    expect(posture.packets[1].detail).toBe('Budget has not been configured yet');
    expect(posture.packets[2].value).toBe('No board spend recorded yet');
  });

  it('formats currency and budget percentage helpers', () => {
    expect(formatCurrency(12.345)).toBe('$12.35');
    expect(budgetPercentUsed(100, 60)).toBe(40);
    expect(budgetPercentUsed(0, 0)).toBe(0);
  });

  it('builds a summary-first breakdown for boards, models, and peak spend day', () => {
    const breakdown = buildCostBreakdownSummary({
      today: 18.75,
      this_week: 96.4,
      this_month: 210.2,
      budget_total: 240,
      budget_remaining: 35,
      by_workflow: [
        { name: 'Board Alpha', cost: 88.5 },
        { name: 'Board Beta', cost: 32.1 },
        { name: 'Board Gamma', cost: 20.4 },
      ],
      by_model: [
        { model: 'gpt-5.4', cost: 144.25 },
        { model: 'o4-mini', cost: 18.9 },
      ],
      daily_trend: [
        { date: '2026-03-10', cost: 22.5 },
        { date: '2026-03-11', cost: 31.5 },
        { date: '2026-03-12', cost: 18.4 },
      ],
    });

    expect(breakdown.boardDrivers).toEqual([
      {
        label: 'Board Alpha',
        value: '$88.50',
        detail: '63% of reported spend in this lane',
      },
      {
        label: 'Board Beta',
        value: '$32.10',
        detail: '23% of reported spend in this lane',
      },
      {
        label: 'Board Gamma',
        value: '$20.40',
        detail: '14% of reported spend in this lane',
      },
    ]);
    expect(breakdown.modelDrivers[0]).toEqual({
      label: 'gpt-5.4',
      value: '$144.25',
      detail: '88% of reported spend in this lane',
    });
    expect(breakdown.peakSpendDay).toEqual({
      label: '2026-03-11',
      value: '$31.50',
      detail: '44% of the visible daily trend',
    });
  });
});
