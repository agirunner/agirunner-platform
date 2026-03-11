import { List, Layers, Users } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { Button } from '../ui/button.js';

export type LogViewMode = 'flat' | 'by-iteration' | 'by-task';

export interface LogViewToggleProps {
  mode: LogViewMode;
  onChange: (mode: LogViewMode) => void;
}

const VIEW_OPTIONS: { mode: LogViewMode; icon: typeof List; label: string }[] = [
  { mode: 'flat', icon: List, label: 'Flat' },
  { mode: 'by-iteration', icon: Layers, label: 'By iteration' },
  { mode: 'by-task', icon: Users, label: 'By task' },
];

export function LogViewToggle({ mode, onChange }: LogViewToggleProps): JSX.Element {
  return (
    <div className="flex items-center rounded-md border border-border">
      {VIEW_OPTIONS.map(({ mode: optionMode, icon: Icon, label }) => (
        <Button
          key={optionMode}
          variant="ghost"
          size="sm"
          className={cn(
            'h-7 rounded-none px-2 first:rounded-l-md last:rounded-r-md',
            mode === optionMode && 'bg-muted',
          )}
          onClick={() => onChange(optionMode)}
          title={label}
        >
          <Icon className="h-3.5 w-3.5" />
        </Button>
      ))}
    </div>
  );
}
