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
    <div className="flex items-center rounded-lg border border-border/70 bg-card/80 p-1 shadow-sm">
      {VIEW_OPTIONS.map(({ mode: optionMode, icon: Icon, label }) => (
        <Button
          key={optionMode}
          variant="ghost"
          size="sm"
          className={cn(
            'h-7 rounded-md border px-2 text-foreground/80 hover:border-border/80 hover:bg-accent/70 hover:text-foreground dark:text-foreground/75 dark:hover:bg-accent/60',
            mode === optionMode &&
              'border-stone-300 bg-white/92 text-slate-950 shadow-sm hover:border-stone-300 hover:bg-white hover:text-slate-950 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-100 dark:hover:border-slate-700 dark:hover:bg-slate-900 dark:hover:text-slate-100',
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
