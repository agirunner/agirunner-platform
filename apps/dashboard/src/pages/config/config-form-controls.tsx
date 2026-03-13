import {
  useId,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';

import { AlertCircle } from 'lucide-react';

import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import { ToggleCard } from '../../components/ui/toggle-card.js';
import { cn } from '../../lib/utils.js';

interface ConfigFieldRenderProps {
  descriptionId?: string;
  errorId?: string;
  describedBy?: string;
  isInvalid: boolean;
}

export function ConfigField(props: {
  fieldId?: string;
  label: string;
  description?: ReactNode;
  error?: string;
  action?: ReactNode;
  className?: string;
  children: (context: ConfigFieldRenderProps) => ReactNode;
}): JSX.Element {
  const generatedId = useId();
  const fieldId = props.fieldId ?? `config-field-${generatedId.replace(/:/g, '')}`;
  const descriptionId = props.description ? `${fieldId}-description` : undefined;
  const errorId = props.error ? `${fieldId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('grid gap-2 text-sm', props.className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={fieldId} className="font-medium text-foreground">
          {props.label}
        </label>
        {props.action}
      </div>
      {props.children({
        descriptionId,
        errorId,
        describedBy,
        isInvalid: Boolean(props.error),
      })}
      {props.description ? (
        <p id={descriptionId} className="text-xs leading-5 text-muted">
          {props.description}
        </p>
      ) : null}
      {props.error ? (
        <p id={errorId} className="flex items-start gap-2 text-xs leading-5 text-red-600 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{props.error}</span>
        </p>
      ) : null}
    </div>
  );
}

export function ConfigInputField(props: {
  fieldId: string;
  label: string;
  description?: ReactNode;
  error?: string;
  className?: string;
  inputProps: Omit<ComponentPropsWithoutRef<typeof Input>, 'id' | 'aria-describedby' | 'aria-invalid'>;
}): JSX.Element {
  return (
    <ConfigField
      fieldId={props.fieldId}
      label={props.label}
      description={props.description}
      error={props.error}
      className={props.className}
    >
      {({ describedBy, isInvalid }) => (
        <Input
          id={props.fieldId}
          aria-describedby={describedBy}
          aria-invalid={isInvalid}
          {...props.inputProps}
        />
      )}
    </ConfigField>
  );
}

export function ConfigTextAreaField(props: {
  fieldId: string;
  label: string;
  description?: ReactNode;
  error?: string;
  className?: string;
  textAreaProps: Omit<
    ComponentPropsWithoutRef<typeof Textarea>,
    'id' | 'aria-describedby' | 'aria-invalid'
  >;
}): JSX.Element {
  return (
    <ConfigField
      fieldId={props.fieldId}
      label={props.label}
      description={props.description}
      error={props.error}
      className={props.className}
    >
      {({ describedBy, isInvalid }) => (
        <Textarea
          id={props.fieldId}
          aria-describedby={describedBy}
          aria-invalid={isInvalid}
          {...props.textAreaProps}
        />
      )}
    </ConfigField>
  );
}

export function ConfigSelectField(props: {
  fieldId: string;
  label: string;
  value: string;
  description?: ReactNode;
  error?: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onValueChange(value: string): void;
  triggerClassName?: string;
  triggerTestId?: string;
}): JSX.Element {
  return (
    <ConfigField
      fieldId={props.fieldId}
      label={props.label}
      description={props.description}
      error={props.error}
      className={props.className}
    >
      {({ describedBy, isInvalid }) => (
        <Select
          value={props.value}
          disabled={props.disabled}
          onValueChange={props.onValueChange}
        >
          <SelectTrigger
            id={props.fieldId}
            aria-describedby={describedBy}
            aria-invalid={isInvalid}
            className={props.triggerClassName}
            data-testid={props.triggerTestId}
          >
            <SelectValue placeholder={props.placeholder} />
          </SelectTrigger>
          <SelectContent>
            {props.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </ConfigField>
  );
}

export function ConfigToggleField(props: {
  label: string;
  description?: string;
  meta?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange(checked: boolean): void;
  className?: string;
}): JSX.Element {
  return (
    <div className={props.className}>
      <ToggleCard
        label={props.label}
        description={props.description}
        meta={props.meta}
        checked={props.checked}
        disabled={props.disabled}
        onCheckedChange={props.onCheckedChange}
      />
    </div>
  );
}
