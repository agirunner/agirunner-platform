import { ChevronDown } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { cn } from '../../lib/utils.js';
import { ConfigField } from './config-form-controls.js';
import {
  PLATFORM_DEFAULT_SELECT_VALUE,
} from './runtime-defaults.schema.js';
import type { FieldDefinition, FormValues } from './runtime-defaults.types.js';

export function RuntimeDefaultsSection({
  title,
  description,
  fields,
  values,
  errors,
  configuredCount,
  fieldCount,
  errorCount,
  isExpanded,
  onToggle,
  onChange,
}: {
  title: string;
  description: string;
  fields: FieldDefinition[];
  values: FormValues;
  errors: Record<string, string>;
  configuredCount: number;
  fieldCount: number;
  errorCount: number;
  isExpanded: boolean;
  onToggle(): void;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <Card>
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 px-6 py-6 text-left"
        aria-expanded={isExpanded}
        onClick={onToggle}
      >
        <CardHeader className="p-0">
          <CardTitle className="text-lg">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
          <p className="text-sm leading-6 text-muted">
            {configuredCount}/{fieldCount} configured
            {errorCount > 0 ? ` · ${errorCount} validation blocker${errorCount === 1 ? '' : 's'}` : ' · No validation blockers'}
          </p>
        </CardHeader>
        <span className="flex items-center gap-2 pt-1 text-xs font-medium uppercase tracking-[0.18em] text-muted">
          {isExpanded ? 'Hide' : 'Show'}
          <ChevronDown className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-180')} />
        </span>
      </button>
      {isExpanded ? (
        <CardContent className="grid gap-5 border-t border-border/70 md:grid-cols-2">
          {fields.map((field) => (
            <RuntimeField
              key={field.key}
              field={field}
              value={values[field.key] ?? ''}
              error={errors[field.key]}
              onChange={(nextValue) => onChange(field.key, nextValue)}
            />
          ))}
        </CardContent>
      ) : null}
    </Card>
  );
}

function RuntimeField({
  field,
  value,
  error,
  onChange,
}: {
  field: FieldDefinition;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <ConfigField
      fieldId={field.key}
      label={field.label}
      description={field.description}
      error={error}
    >
      {({ describedBy, isInvalid }) =>
        renderFieldControl(field, value, onChange, isInvalid, describedBy)
      }
    </ConfigField>
  );
}

function renderFieldControl(
  field: FieldDefinition,
  value: string,
  onChange: (value: string) => void,
  hasError: boolean,
  describedBy?: string,
) {
  if (field.options && field.options.length > 0) {
    return renderSelectField(field, value, onChange, field.options, hasError, describedBy);
  }
  return (
    <Input
      id={field.key}
      type={field.configType === 'number' ? 'number' : 'text'}
      inputMode={field.inputMode}
      min={field.min}
      max={field.max}
      step={field.step}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={field.placeholder}
      aria-invalid={hasError}
      aria-describedby={describedBy}
      className="h-10"
      data-testid={`field-${field.key}`}
    />
  );
}

function renderSelectField(
  field: FieldDefinition,
  value: string,
  onChange: (value: string) => void,
  options: readonly string[],
  hasError: boolean,
  describedBy?: string,
) {
  return (
    <Select
      value={value || PLATFORM_DEFAULT_SELECT_VALUE}
      onValueChange={(nextValue) =>
        onChange(nextValue === PLATFORM_DEFAULT_SELECT_VALUE ? '' : nextValue)
      }
    >
      <SelectTrigger
        id={field.key}
        className="h-10"
        aria-invalid={hasError}
        aria-describedby={describedBy}
        data-testid={`field-${field.key}`}
      >
        <SelectValue placeholder={field.placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={PLATFORM_DEFAULT_SELECT_VALUE}>Use platform default</SelectItem>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
