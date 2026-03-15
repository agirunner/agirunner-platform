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
  describeLaunchParameterResolution,
  type LaunchParameterSpec,
  type LaunchParameterResolutionStep,
  type StructuredValueType,
} from './playbook-launch-support.js';

export function ParameterField(props: {
  spec: LaunchParameterSpec;
  project: DashboardProjectRecord | null;
  value: string;
  onChange(value: string): void;
}): JSX.Element {
  const resolution = describeLaunchParameterResolution({
    spec: props.spec,
    project: props.project,
    currentValue: props.value,
  });
  const projectStep = resolution.steps.find((step) => step.key === 'project-autofill');
  const defaultStep = resolution.steps.find((step) => step.key === 'playbook-default');

  return (
    <div className="grid gap-4 rounded-2xl border border-border/70 bg-muted/10 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{props.spec.label}</span>
            <Badge variant={resolution.activeSource === 'unset' ? 'outline' : 'secondary'}>
              {resolution.badgeLabel}
            </Badge>
          </div>
          {props.spec.description ? (
            <p className="text-xs text-muted">{props.spec.description}</p>
          ) : null}
          <p className="text-xs text-muted">{resolution.detail}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {props.spec.options.length > 0 ? (
            <Badge variant="outline">{props.spec.options.length} options</Badge>
          ) : null}
          <Badge variant="secondary">{props.spec.key}</Badge>
        </div>
      </div>
      <div className={resolution.steps.length > 2 ? 'grid gap-3 md:grid-cols-3' : 'grid gap-3 md:grid-cols-2'}>
        {resolution.steps.map((step) => (
          <ResolutionStepCard key={step.key} step={step} />
        ))}
      </div>

      <div className="grid gap-2">
        <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
          Launch value
        </div>
        <ValueInput
          valueType={props.spec.inputType === 'select' ? 'string' : props.spec.inputType}
          value={props.value}
          options={props.spec.options}
          onChange={props.onChange}
        />
      </div>

      {resolution.canRestoreProjectValue || resolution.canRestoreDefaultValue ? (
        <div className="flex flex-wrap gap-2">
          {resolution.canRestoreProjectValue && projectStep?.value !== undefined ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => props.onChange(projectStep.value ?? '')}
            >
              Use project autofill
            </Button>
          ) : null}
          {resolution.canRestoreDefaultValue && defaultStep?.value !== undefined ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => props.onChange(defaultStep.value ?? '')}
            >
              Restore playbook default
            </Button>
          ) : null}
        </div>
      ) : null}

      {props.spec.helpText ? <p className="text-xs text-muted">{props.spec.helpText}</p> : null}
    </div>
  );
}

function ResolutionStepCard(props: { step: LaunchParameterResolutionStep }): JSX.Element {
  return (
    <div
      className={`rounded-xl border p-3 ${
        props.step.isActive
          ? 'border-border bg-background shadow-sm'
          : 'border-border/70 bg-background/60'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium text-foreground">{props.step.label}</div>
        <Badge variant={props.step.isActive ? 'secondary' : 'outline'}>
          {props.step.isActive ? 'Active' : 'Available'}
        </Badge>
      </div>
      {props.step.value !== undefined ? (
        <p className="mt-3 break-all text-sm text-foreground">{props.step.value}</p>
      ) : (
        <p className="mt-3 text-sm text-muted">No value</p>
      )}
      <p className="mt-2 text-xs text-muted">{props.step.detail}</p>
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
