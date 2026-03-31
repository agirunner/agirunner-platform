import type { ReactNode } from 'react';

import { DashboardSectionCard } from '../../../components/layout/dashboard-section-card.js';
import { Input } from '../../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select.js';
import { ConfigField } from '../config-form-controls.js';
import type {
  FieldDefinition,
  FormValues,
} from './runtime-defaults.types.js';

export function RuntimeDefaultsSection({
  title,
  description,
  fields,
  values,
  errors,
  configuredCount,
  fieldCount,
  errorCount,
  supplementalContent,
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
  supplementalContent?: ReactNode;
  onChange: (key: string, value: string) => void;
}): JSX.Element {
  return (
    <DashboardSectionCard
      className="h-full"
      title={title}
      description={`${description} ${buildSectionStatus(configuredCount, fieldCount, errorCount)}`.trim()}
      bodyClassName="grid gap-4"
    >
        {fields.map((field) => (
          <RuntimeField
            key={field.key}
            field={field}
            value={values[field.key] ?? ''}
            error={errors[field.key]}
            onChange={(nextValue) => onChange(field.key, nextValue)}
          />
        ))}
        {supplementalContent ? (
          <div className="border-t border-border/70 pt-4">
            {supplementalContent}
          </div>
        ) : null}
    </DashboardSectionCard>
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
      value={value}
      onValueChange={onChange}
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
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function buildSectionStatus(
  configuredCount: number,
  fieldCount: number,
  errorCount: number,
): string {
  if (errorCount > 0) {
    return `${errorCount} blocker${errorCount === 1 ? '' : 's'}.`;
  }

  void configuredCount;
  void fieldCount;
  return '';
}
