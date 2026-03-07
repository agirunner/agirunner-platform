import { cn } from '../../lib/utils.js';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-border/50', className)} {...props} />;
}
