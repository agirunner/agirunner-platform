import { Card, CardContent } from './ui/card.js';
import { cn } from '../lib/utils.js';

export function DashboardMetricCard(props: {
  label: string;
  value: number;
  tone?: 'default' | 'success' | 'warning';
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs font-medium uppercase tracking-wide text-muted">{props.label}</div>
        <div
          className={cn(
            'mt-2 text-2xl font-semibold',
            props.tone === 'success' && 'text-green-700 dark:text-green-400',
            props.tone === 'warning' && 'text-amber-700 dark:text-amber-400',
          )}
        >
          {props.value}
        </div>
      </CardContent>
    </Card>
  );
}
