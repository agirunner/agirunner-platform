import { forwardRef } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select.js';
import { cn } from '../../../lib/utils.js';

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

type LogLevel = (typeof LOG_LEVELS)[number];

const levelLabels: Record<LogLevel, string> = {
  debug: 'Debug and above',
  info: 'Info and above',
  warn: 'Warn and above',
  error: 'Errors only',
};

export interface LevelSelectorProps {
  value: LogLevel;
  onChange: (level: LogLevel) => void;
  className?: string;
  disabled?: boolean;
}

export const LevelSelector = forwardRef<HTMLButtonElement, LevelSelectorProps>(
  ({ value, onChange, className, disabled }, ref) => (
    <Select value={value} onValueChange={(v) => onChange(v as LogLevel)} disabled={disabled}>
      <SelectTrigger ref={ref} className={cn('w-[180px]', className)}>
        <SelectValue placeholder="Select level" />
      </SelectTrigger>
      <SelectContent>
        {LOG_LEVELS.map((level) => (
          <SelectItem key={level} value={level}>
            {levelLabels[level]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
);
LevelSelector.displayName = 'LevelSelector';

export { LOG_LEVELS, type LogLevel };
