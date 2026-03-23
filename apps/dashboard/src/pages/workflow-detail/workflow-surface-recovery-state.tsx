import { AlertTriangle } from 'lucide-react';

import { Button } from '../components/ui/button.js';

export function WorkflowSurfaceRecoveryState(props: {
  title: string;
  detail: string;
  actionLabel?: string;
  onRetry?: () => void;
}): JSX.Element {
  return (
    <div className="grid gap-3 rounded-xl border border-amber-300/70 bg-amber-50/80 px-4 py-4 text-sm text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="grid gap-1">
          <div className="font-medium text-foreground">{props.title}</div>
          <p className="leading-6 text-current">{props.detail}</p>
        </div>
      </div>
      {props.onRetry ? (
        <div className="flex justify-start">
          <Button type="button" size="sm" variant="outline" onClick={props.onRetry}>
            {props.actionLabel ?? 'Retry'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
