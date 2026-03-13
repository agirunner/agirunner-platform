import { Badge } from '../../components/ui/badge.js';

export function GovernanceReviewField(props: {
  label: string;
  value: string;
  title?: string;
  mono?: boolean;
  badgeVariant?: 'default' | 'success' | 'destructive' | 'warning' | 'secondary';
}): JSX.Element {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">{props.label}</p>
      {props.badgeVariant ? (
        <Badge variant={props.badgeVariant} className="inline-flex capitalize">
          {props.value}
        </Badge>
      ) : (
        <p className={props.mono ? 'break-all font-mono text-xs' : 'text-sm'} title={props.title}>
          {props.value}
        </p>
      )}
    </div>
  );
}
