import { cn } from '../../lib/utils.js';

export interface EmptyStateProps {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function EmptyState({ title, message, actionLabel, onAction, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 py-16 px-8 text-center', className)}>
      <div className="w-16 h-16 rounded-full bg-border/30 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full bg-border/50" />
      </div>

      <div className="flex flex-col gap-1.5">
        <h3 className="text-base font-semibold text-primary">{title}</h3>
        <p className="text-sm text-tertiary max-w-sm">{message}</p>
      </div>

      {actionLabel !== undefined && onAction !== undefined && (
        <button
          type="button"
          onClick={onAction}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-accent-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
