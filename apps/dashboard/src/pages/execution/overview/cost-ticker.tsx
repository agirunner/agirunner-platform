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
  return (
    <div style={{
      backgroundColor: 'var(--color-bg-secondary)',
      borderRadius: '8px',
      padding: '12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
    }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Cost
      </div>
      <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
        {formatUsd(spendUsd)}
      </div>
      <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
        {formatTokenCount(tokenCount)} tokens
      </div>
    </div>
  );
}
