import { formatCost } from '../../components/execution-inspector-support.js';

export function describeSpendBreakdownCoverage(input: {
  nounSingular: string;
  nounPlural: string;
  totalCount: number;
  visibleCount: number;
  totalCostUsd: number;
  visibleCostUsd: number;
}): {
  label: string;
  detail: string;
} {
  if (input.totalCount <= 0 || input.totalCostUsd <= 0) {
    return {
      label: `No ${input.nounSingular} spend recorded`,
      detail: `No ${input.nounSingular}-level spend is available in this inspector lane yet.`,
    };
  }

  if (input.visibleCount >= input.totalCount) {
    return {
      label: `Showing all ${input.totalCount} ${pluralize(input.totalCount, input.nounSingular, input.nounPlural)}`,
      detail: `${formatCost(input.totalCostUsd)} of recorded spend is visible in this slice.`,
    };
  }

  const remainingCount = Math.max(input.totalCount - input.visibleCount, 0);
  const remainingCostUsd = Math.max(input.totalCostUsd - input.visibleCostUsd, 0);
  return {
    label: `Showing top ${input.visibleCount} of ${input.totalCount} ${input.nounPlural}`,
    detail: `${formatCost(input.visibleCostUsd)} of ${formatCost(input.totalCostUsd)} is visible here. ${remainingCount} more ${pluralize(remainingCount, input.nounSingular, input.nounPlural)} account for ${formatCost(remainingCostUsd)} outside the visible entries.`,
  };
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}
