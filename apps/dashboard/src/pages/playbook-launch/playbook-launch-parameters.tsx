import { Badge } from '../../components/ui/badge.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import {
  type LaunchParameterSpec,
  type StructuredValueType,
} from './playbook-launch-support.js';

export function ParameterField(props: {
  spec: LaunchParameterSpec;
  value: string;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <div className="grid gap-4 rounded-2xl border border-border/70 bg-muted/10 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{props.spec.title}</span>
            <Badge variant={props.spec.required ? 'secondary' : 'outline'}>
              {props.spec.required ? 'Required' : 'Optional'}
            </Badge>
          </div>
          <p className="text-xs text-muted">Provide the run-specific value for this workflow goal.</p>
        </div>
        <Badge variant="outline">{props.spec.slug}</Badge>
      </div>
      <label className="grid gap-2 text-sm">
        <span className="font-medium">Workflow Goal</span>
        <Input value={props.value} onChange={(event) => props.onChange(event.target.value)} />
      </label>
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
