import { Switch } from './switch.js';

export function ToggleCard(props: {
  label: string;
  description?: string;
  meta?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange(checked: boolean): void;
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border/70 bg-muted/10 px-3 py-3">
      <div className="grid gap-1">
        <div className="text-sm font-medium">{props.label}</div>
        {props.description ? <div className="text-xs text-muted">{props.description}</div> : null}
        {props.meta ? <div className="text-xs text-muted">{props.meta}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs font-medium text-muted">
          {props.checked ? 'Enabled' : 'Disabled'}
        </span>
        <Switch
          checked={props.checked}
          disabled={props.disabled}
          onCheckedChange={props.onCheckedChange}
          aria-label={props.label}
        />
      </div>
    </div>
  );
}
