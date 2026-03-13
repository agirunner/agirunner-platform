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
import { ConfigField } from './config-form-controls.js';
import {
  PLATFORM_DEFAULT_SELECT_VALUE,
  PULL_POLICY_OPTIONS,
} from './runtime-defaults.schema.js';
import { RuntimeDefaultsSearchSection } from './runtime-defaults-search.js';
import type { FieldDefinition, FormValues } from './runtime-defaults.types.js';

export function RuntimeDefaultsSection({
  title,
  description,
  fields,
  values,
  errors,
  onChange,
}: {
  title: string;
  description: string;
  fields: FieldDefinition[];
  values: FormValues;
  errors: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className={fields[0]?.section === 'search' ? 'space-y-5' : 'grid gap-5 md:grid-cols-2'}>
        {fields[0]?.section === 'search' ? (
          <RuntimeDefaultsSearchSection
            fields={fields}
            values={values}
            errors={errors}
            onChange={onChange}
          />
        ) : (
          fields.map((field) => (
            <RuntimeField
              key={field.key}
              field={field}
              value={values[field.key] ?? ''}
              error={errors[field.key]}
              onChange={(nextValue) => onChange(field.key, nextValue)}
            />
          ))
        )}
      </CardContent>
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
  if (field.key === 'default_pull_policy') {
    return renderSelectField(field, value, onChange, PULL_POLICY_OPTIONS, hasError, describedBy);
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
