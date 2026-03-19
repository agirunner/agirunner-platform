interface CostTickerProps {
  spendUsd: number;
  tokenCount: number;
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    const millions = count / 1_000_000;
    const formatted = millions % 1 === 0 ? `${millions}` : `${parseFloat(millions.toFixed(1))}`;
    return `${formatted}M`;
  }
  if (count >= 1000) {
    const thousands = Math.round(count / 1000);
    return `${thousands}K`;
  }
  return `${count}`;
}

export function CostTicker({ spendUsd, tokenCount }: CostTickerProps): JSX.Element {
  const hasData = spendUsd > 0;

  return (
    <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-4 flex flex-col gap-1">
      <div className="text-[11px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
        Cost
      </div>
      {hasData ? (
        <>
          <div className="text-xl font-bold text-[var(--color-text-primary)] tabular-nums mt-1">
            {formatUsd(spendUsd)}
          </div>
          <div className="text-xs text-[var(--color-text-secondary)]">
            {formatTokenCount(tokenCount)} tokens
          </div>
        </>
      ) : (
        <div className="text-sm text-[var(--color-text-tertiary)] mt-1">
          No cost data
        </div>
      )}
    </div>
  );
}
