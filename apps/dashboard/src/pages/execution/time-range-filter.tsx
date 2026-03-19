export type TimeRange = '1h' | '24h' | '7d' | '30d' | 'all';

interface TimeRangeFilterProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

const TIME_RANGE_OPTIONS: Array<{ value: TimeRange; label: string }> = [
  { value: '1h', label: '1h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All' },
];

export function getTimeRangeCutoff(range: TimeRange): Date | null {
  if (range === 'all') return null;
  const now = Date.now();
  const offsets: Record<Exclude<TimeRange, 'all'>, number> = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };
  return new Date(now - offsets[range]);
}

export function filterByTimeRange<T>(
  items: T[],
  range: TimeRange,
  getCreatedAt: (item: T) => string,
): T[] {
  const cutoff = getTimeRangeCutoff(range);
  if (cutoff === null) return items;
  const cutoffTime = cutoff.getTime();
  return items.filter((item) => new Date(getCreatedAt(item)).getTime() >= cutoffTime);
}

export function TimeRangeFilter({ value, onChange }: TimeRangeFilterProps): JSX.Element {
  return (
    <div
      data-testid="time-range-filter"
      className="flex items-center gap-0.5 rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-0.5"
    >
      {TIME_RANGE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`px-2 py-1 text-[11px] font-medium rounded transition-all duration-150 ${
            value === option.value
              ? 'bg-[var(--color-accent-primary)] text-white'
              : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
