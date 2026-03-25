import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-accent text-white',
        secondary:
          'border-slate-700 bg-slate-700 text-white dark:border-zinc-300 dark:bg-zinc-300 dark:text-zinc-950',
        info: 'border-sky-600 bg-sky-600 text-white dark:border-sky-400 dark:bg-sky-400 dark:text-sky-950',
        destructive:
          'border-rose-700 bg-rose-700 text-white dark:border-rose-400 dark:bg-rose-400 dark:text-rose-950',
        outline: 'border-border text-foreground',
        success:
          'border-green-700 bg-green-700 text-white dark:border-green-400 dark:bg-green-400 dark:text-green-950',
        warning:
          'border-amber-700 bg-amber-700 text-white dark:border-amber-300 dark:bg-amber-300 dark:text-amber-950',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps): JSX.Element {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
