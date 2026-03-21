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
import { PLATFORM_DEFAULT_SELECT_VALUE } from './runtime-defaults.schema.js';
import type {
  FieldDefinition,
  FormValues,
  SectionDefinition,
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
  onChange: (key: string, value: string) => void;
}): JSX.Element {
  return (
    <Card className="h-full">
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="text-sm leading-6">
          {description} {buildSectionStatus(configuredCount, fieldCount, errorCount)}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
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
    </Card>
  );
}

export function RuntimeAdvancedSettingsSection({
  sections,
  values,
  errors,
  isExpanded,
  onToggle,
  onChange,
}: {
  sections: Array<
    SectionDefinition & {
      fields: FieldDefinition[];
      configuredCount: number;
      fieldCount: number;
      errorCount: number;
    }
  >;
  values: FormValues;
  errors: Record<string, string>;
  isExpanded: boolean;
  onToggle(): void;
  onChange: (key: string, value: string) => void;
}): JSX.Element {
  const configuredCount = sections.reduce((total, section) => total + section.configuredCount, 0);
  const fieldCount = sections.reduce((total, section) => total + section.fieldCount, 0);
  const errorCount = sections.reduce((total, section) => total + section.errorCount, 0);

  return (
    <Card>
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 px-6 py-6 text-left"
        aria-expanded={isExpanded}
        onClick={onToggle}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-base font-semibold text-foreground">Advanced Settings</div>
          <p className="text-sm leading-6 text-muted">
            Clear any field to inherit the built-in default. Only explicit values stay overridden.{' '}
            {buildSectionStatus(configuredCount, fieldCount, errorCount)}
          </p>
        </div>
        <div className="flex items-center pt-0.5">
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 text-muted transition-transform', isExpanded && 'rotate-180')}
          />
        </div>
      </button>
      {isExpanded ? (
        <CardContent className="space-y-6 border-t border-border/70 pt-6">
          {sections.map((section, index) => (
            <div
              key={section.key}
              className={cn(index > 0 && 'border-t border-border/70 pt-6')}
            >
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">{section.title}</h3>
                <p className="text-sm leading-6 text-muted">
                  {section.description}{' '}
                  {buildSectionStatus(
                    section.configuredCount,
                    section.fieldCount,
                    section.errorCount,
                  )}
                </p>
              </div>
              <div className="mt-4 grid gap-4">
                {section.fields.map((field) => (
                  <RuntimeField
                    key={field.key}
                    field={field}
                    value={values[field.key] ?? ''}
                    error={errors[field.key]}
                    onChange={(nextValue) => onChange(field.key, nextValue)}
                  />
                ))}
              </div>
            </div>
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

function buildSectionStatus(
  configuredCount: number,
  fieldCount: number,
  errorCount: number,
): string {
  if (errorCount > 0) {
    return `${configuredCount}/${fieldCount} configured · ${errorCount} blocker${errorCount === 1 ? '' : 's'}.`;
  }

  return `${configuredCount}/${fieldCount} configured.`;
}
