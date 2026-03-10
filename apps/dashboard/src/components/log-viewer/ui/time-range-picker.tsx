import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover.js';
import { Button } from '../../ui/button.js';
import { Input } from '../../ui/input.js';
import { Separator } from '../../ui/separator.js';
import { cn } from '../../../lib/utils.js';

export interface TimePreset {
  label: string;
  value: string;
  durationMs: number;
}

const PRESETS: TimePreset[] = [
  { label: 'Last 15 minutes', value: '15m', durationMs: 15 * 60_000 },
  { label: 'Last 1 hour', value: '1h', durationMs: 60 * 60_000 },
  { label: 'Last 6 hours', value: '6h', durationMs: 6 * 60 * 60_000 },
  { label: 'Last 24 hours', value: '24h', durationMs: 24 * 60 * 60_000 },
  { label: 'Last 7 days', value: '7d', durationMs: 7 * 24 * 60 * 60_000 },
  { label: 'Last 30 days', value: '30d', durationMs: 30 * 24 * 60 * 60_000 },
];

export interface TimeRange {
  preset: string | null;
  from: string | null;
  to: string | null;
}

export interface TimeRangePickerProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
  className?: string;
  disabled?: boolean;
}

function formatDateForInput(date: Date): string {
  return date.toISOString().slice(0, 16);
}

function displayLabel(range: TimeRange): string {
  if (range.preset) {
    const preset = PRESETS.find((p) => p.value === range.preset);
    return preset?.label ?? range.preset;
  }
  if (range.from && range.to) {
    return `${range.from.replace('T', ' ')} \u2013 ${range.to.replace('T', ' ')}`;
  }
  return 'Select time range';
}

/** Resolve a TimeRange to absolute ISO8601 since/until values. */
export function resolveTimeRange(range: TimeRange): { since: string; until: string } | null {
  if (range.from && range.to) {
    return {
      since: new Date(range.from).toISOString(),
      until: new Date(range.to).toISOString(),
    };
  }
  if (range.preset) {
    const preset = PRESETS.find((p) => p.value === range.preset);
    if (preset) {
      const now = Date.now();
      return {
        since: new Date(now - preset.durationMs).toISOString(),
        until: new Date(now).toISOString(),
      };
    }
  }
  return null;
}

export const TimeRangePicker = forwardRef<HTMLButtonElement, TimeRangePickerProps>(
  ({ value, onChange, className, disabled }, ref) => {
    const [open, setOpen] = useState(false);
    const [customFrom, setCustomFrom] = useState(
      value.from ?? formatDateForInput(new Date(Date.now() - 60 * 60_000)),
    );
    const [customTo, setCustomTo] = useState(
      value.to ?? formatDateForInput(new Date()),
    );

    useEffect(() => {
      if (value.from) setCustomFrom(value.from);
      if (value.to) setCustomTo(value.to);
    }, [value.from, value.to]);

    const isRangeInverted = useMemo(() => {
      if (!customFrom || !customTo) return false;
      return new Date(customFrom) >= new Date(customTo);
    }, [customFrom, customTo]);

    const handlePreset = useCallback(
      (preset: string) => {
        onChange({ preset, from: null, to: null });
        setOpen(false);
      },
      [onChange],
    );

    const handleApplyCustom = useCallback(() => {
      if (!customFrom || !customTo || isRangeInverted) return;
      onChange({ preset: null, from: customFrom, to: customTo });
      setOpen(false);
    }, [customFrom, customTo, isRangeInverted, onChange]);

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            ref={ref}
            type="button"
            disabled={disabled}
            className={cn(
              'flex h-9 items-center gap-2 rounded-md border border-border bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50',
              className,
            )}
          >
            <Calendar className="h-4 w-4 text-muted" />
            <span className="whitespace-nowrap">{displayLabel(value)}</span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-72 p-1">
          {PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              className={cn(
                'flex w-full cursor-default select-none items-center rounded-sm px-3 py-1.5 text-sm outline-none transition-colors hover:bg-accent/10',
                value.preset === preset.value && 'font-medium text-accent',
              )}
              onClick={() => handlePreset(preset.value)}
            >
              {preset.label}
            </button>
          ))}

          <Separator className="my-1" />

          <div className="px-3 py-2">
            <span className="mb-2 block text-xs font-medium text-muted">Custom range</span>
            <div className="flex items-center gap-2">
              <label className="flex-1">
                <span className="mb-1 block text-xs text-muted">From</span>
                <Input
                  type="datetime-local"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-8 text-xs"
                />
              </label>
              <label className="flex-1">
                <span className="mb-1 block text-xs text-muted">To</span>
                <Input
                  type="datetime-local"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="h-8 text-xs"
                />
              </label>
            </div>
            {isRangeInverted && (
              <p className="mt-1 text-xs text-red-500">
                "From" must be before "To"
              </p>
            )}
            <Button
              size="sm"
              className="mt-2 w-full"
              onClick={handleApplyCustom}
              disabled={!customFrom || !customTo || isRangeInverted}
            >
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  },
);
TimeRangePicker.displayName = 'TimeRangePicker';

export { PRESETS as TIME_PRESETS };
