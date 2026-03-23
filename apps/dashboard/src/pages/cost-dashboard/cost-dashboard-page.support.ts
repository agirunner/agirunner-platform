export interface CostSummaryRecord {
  today: number;
  this_week: number;
  this_month: number;
  budget_total: number;
  budget_remaining: number;
  by_workflow: Array<{ name: string; cost: number }>;
  by_model: Array<{ model: string; cost: number }>;
  daily_trend: Array<{ date: string; cost: number }>;
}

export interface CostPosturePacket {
  label: string;
  value: string;
  detail: string;
  warning?: boolean;
}

export interface CostPostureSummary {
  heading: string;
  detail: string;
  nextAction: string;
  packets: CostPosturePacket[];
}

export interface CostBreakdownEntry {
  label: string;
  value: string;
  detail: string;
}

export interface CostBreakdownSummary {
  boardDrivers: CostBreakdownEntry[];
  modelDrivers: CostBreakdownEntry[];
  peakSpendDay: CostBreakdownEntry | null;
}

export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function budgetPercentUsed(total: number, remaining: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.round(((total - remaining) / total) * 100);
}

export function buildCostPosture(summary: CostSummaryRecord): CostPostureSummary {
  const percentUsed = budgetPercentUsed(summary.budget_total, summary.budget_remaining);
  const boardDriver = findHighestCost(
    summary.by_workflow,
    'No board spend recorded yet',
    (entry) => entry.name,
  );
  const modelDriver = findHighestCost(
    summary.by_model,
    'No model spend recorded yet',
    (entry) => entry.model,
  );
  const isWarning = percentUsed >= 80;

  return {
    heading: isWarning ? 'Budget attention is rising' : 'Spend posture is stable',
    detail: buildPostureDetail({
      percentUsed,
      boardDriver,
      modelDriver,
      isWarning,
    }),
    nextAction: buildNextAction({
      percentUsed,
      boardDriver,
      modelDriver,
      isWarning,
    }),
    packets: [
      {
        label: 'Immediate spend',
        value: formatCurrency(summary.today),
        detail: `${formatCurrency(summary.this_week)} this week • ${formatCurrency(summary.this_month)} this month`,
      },
      {
        label: 'Budget posture',
        value: `${percentUsed}% used`,
        detail:
          summary.budget_total > 0
            ? `${formatCurrency(summary.budget_remaining)} remaining of ${formatCurrency(summary.budget_total)}`
            : 'Budget has not been configured yet',
        warning: isWarning,
      },
      {
        label: 'Top board driver',
        value: boardDriver.label,
        detail: boardDriver.detail,
      },
      {
        label: 'Model mix',
        value: modelDriver.label,
        detail: modelDriver.detail,
      },
    ],
  };
}

export function buildCostBreakdownSummary(summary: CostSummaryRecord): CostBreakdownSummary {
  return {
    boardDrivers: buildTopCostEntries(
      summary.by_workflow,
      (entry) => entry.name,
      'No board drivers published yet',
    ),
    modelDrivers: buildTopCostEntries(
      summary.by_model,
      (entry) => entry.model,
      'No model drivers published yet',
    ),
    peakSpendDay: buildPeakSpendDay(summary.daily_trend),
  };
}

function findHighestCost<T extends { cost: number }>(
  items: T[],
  emptyLabel: string,
  getLabel: (item: T) => string,
): {
  label: string;
  detail: string;
} {
  if (items.length === 0) {
    return {
      label: emptyLabel,
      detail: 'Review a live board or model after the next execution cycle publishes spend.',
    };
  }

  const highest = [...items].sort((left, right) => right.cost - left.cost)[0]!;
  return {
    label: getLabel(highest),
    detail: `${formatCurrency(highest.cost)} reported so far`,
  };
}

function buildTopCostEntries<T extends { cost: number }>(
  items: T[],
  getLabel: (item: T) => string,
  emptyLabel: string,
): CostBreakdownEntry[] {
  if (items.length === 0) {
    return [
      {
        label: emptyLabel,
        value: formatCurrency(0),
        detail: 'This list will populate after the next spend-reporting cycle.',
      },
    ];
  }

  const totalCost = items.reduce((sum, item) => sum + item.cost, 0);
  return [...items]
    .sort((left, right) => right.cost - left.cost)
    .slice(0, 3)
    .map((item) => ({
      label: getLabel(item),
      value: formatCurrency(item.cost),
      detail: `${formatPercent(item.cost, totalCost)} of reported spend in this lane`,
    }));
}

function buildPeakSpendDay(
  dailyTrend: Array<{ date: string; cost: number }>,
): CostBreakdownEntry | null {
  if (dailyTrend.length === 0) {
    return null;
  }

  const totalCost = dailyTrend.reduce((sum, item) => sum + item.cost, 0);
  const peakDay = [...dailyTrend].sort((left, right) => right.cost - left.cost)[0]!;

  return {
    label: peakDay.date,
    value: formatCurrency(peakDay.cost),
    detail: `${formatPercent(peakDay.cost, totalCost)} of the visible daily trend`,
  };
}

function formatPercent(value: number, total: number): string {
  if (total <= 0) {
    return '0%';
  }
  return `${Math.round((value / total) * 100)}%`;
}

function buildPostureDetail(input: {
  percentUsed: number;
  boardDriver: { label: string; detail: string };
  modelDriver: { label: string; detail: string };
  isWarning: boolean;
}): string {
  if (input.isWarning) {
    return `Budget usage has crossed the watch threshold. Review ${input.boardDriver.label} first, then confirm whether ${input.modelDriver.label} is the right model mix for the current board load.`;
  }
  return `Spend remains within the current budget posture. Keep an eye on ${input.boardDriver.label} and validate that ${input.modelDriver.label} still matches the quality bar before volume increases.`;
}

function buildNextAction(input: {
  percentUsed: number;
  boardDriver: { label: string; detail: string };
  modelDriver: { label: string; detail: string };
  isWarning: boolean;
}): string {
  if (input.isWarning) {
    return `Open the highest-cost board, inspect the latest orchestrator turn, and confirm whether the current model choice or retry pattern is still justified.`;
  }
  if (input.percentUsed === 0) {
    return 'Use the live board to confirm spend is flowing from active work before you rely on the charts below.';
  }
  return `Use the board and model charts below to confirm whether ${input.boardDriver.label} or ${input.modelDriver.label} needs a cost-control follow-up.`;
}
