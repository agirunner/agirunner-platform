import { Switch } from './switch.js';

export function ToggleCard(props: {
  label: string;
  description?: string;
  meta?: string;
  checked: boolean;
  checkedLabel?: string;
  uncheckedLabel?: string;
  disabled?: boolean;
  onCheckedChange(checked: boolean): void;
}): JSX.Element {
  return (
    <div
      role="button"
      tabIndex={props.disabled ? -1 : 0}
      className="flex items-start justify-between gap-3 rounded-md border border-border/70 bg-muted/10 px-3 py-3"
      aria-disabled={props.disabled}
      onClick={() => {
        if (!props.disabled) {
          props.onCheckedChange(!props.checked);
        }
      }}
      onKeyDown={(event) => {
        if (props.disabled) {
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          props.onCheckedChange(!props.checked);
        }
      }}
    >
      <div className="grid gap-1">
        <div className="text-sm font-medium">{props.label}</div>
        {props.description ? <div className="text-xs text-muted">{props.description}</div> : null}
        {props.meta ? <div className="text-xs text-muted">{props.meta}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>
        <span className="text-xs font-medium text-muted">
          {props.checked ? (props.checkedLabel ?? 'Enabled') : (props.uncheckedLabel ?? 'Disabled')}
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
