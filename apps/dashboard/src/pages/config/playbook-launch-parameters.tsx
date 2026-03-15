import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import type { DashboardProjectRecord } from '../../lib/api.js';
import {
  describeLaunchParameterMapping,
  type LaunchParameterSpec,
  type StructuredValueType,
} from './playbook-launch-support.js';

export function ParameterField(props: {
  spec: LaunchParameterSpec;
  project: DashboardProjectRecord | null;
  value: string;
  onChange(value: string): void;
}): JSX.Element {
  const mapping = describeLaunchParameterMapping({
    spec: props.spec,
    project: props.project,
    currentValue: props.value,
  });

  return (
    <div className="grid gap-3 text-sm rounded-xl border border-border/70 bg-muted/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <span className="font-medium">{props.spec.label}</span>
          {props.spec.description ? (
            <p className="text-xs text-muted">{props.spec.description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {mapping ? <Badge variant="secondary">{mapping.badgeLabel}</Badge> : null}
          {props.spec.options.length > 0 ? (
            <Badge variant="outline">{props.spec.options.length} options</Badge>
          ) : null}
          <Badge variant="secondary">{props.spec.key}</Badge>
        </div>
      </div>
      {mapping ? (
        <div className="rounded-lg border border-border/70 bg-background/80 p-3">
          <p className="text-xs text-muted">{mapping.detail}</p>
          {mapping.mappedValue !== undefined ? (
            <p className="mt-2 text-sm text-foreground break-all">
              Project value: <span className="font-medium">{mapping.mappedValue}</span>
            </p>
          ) : null}
          {mapping.canRestoreMappedValue && mapping.mappedValue !== undefined ? (
            <div className="mt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => props.onChange(mapping.mappedValue ?? '')}
              >
                Use project value
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <ValueInput
        valueType={props.spec.inputType === 'select' ? 'string' : props.spec.inputType}
        value={props.value}
        options={props.spec.options}
        onChange={props.onChange}
      />
      {props.spec.helpText ? <p className="text-xs text-muted">{props.spec.helpText}</p> : null}
    </div>
  );
}

export function ValueInput(props: {
  valueType: StructuredValueType;
  value: string;
  options?: string[];
  hasError?: boolean;
  onChange(value: string): void;
}): JSX.Element {
  if (props.options && props.options.length > 0) {
    return (
      <Select
        value={props.value || '__empty__'}
        onValueChange={(value) => props.onChange(value === '__empty__' ? '' : value)}
      >
        <SelectTrigger
          aria-invalid={props.hasError ? true : undefined}
          className={props.hasError ? 'border-red-300 focus-visible:ring-red-500' : undefined}
        >
          <SelectValue placeholder="Select a value" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__empty__">Unset</SelectItem>
          {props.options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (props.valueType === 'boolean') {
    return (
      <Select
        value={props.value || '__empty__'}
        onValueChange={(value) => props.onChange(value === '__empty__' ? '' : value)}
      >
        <SelectTrigger
          aria-invalid={props.hasError ? true : undefined}
          className={props.hasError ? 'border-red-300 focus-visible:ring-red-500' : undefined}
        >
          <SelectValue placeholder="Unset" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__empty__">Unset</SelectItem>
          <SelectItem value="true">True</SelectItem>
          <SelectItem value="false">False</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (props.valueType === 'json') {
    return (
      <Textarea
        value={props.value}
        aria-invalid={props.hasError ? true : undefined}
        className={`min-h-[100px] font-mono text-xs${
          props.hasError ? ' border-red-300 focus-visible:ring-red-500' : ''
        }`}
        onChange={(event) => props.onChange(event.target.value)}
      />
    );
  }

  return (
    <Input
      type={props.valueType === 'number' ? 'number' : 'text'}
      inputMode={props.valueType === 'number' ? 'decimal' : undefined}
      value={props.value}
      aria-invalid={props.hasError ? true : undefined}
      className={props.hasError ? 'border-red-300 focus-visible:ring-red-500' : undefined}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}
