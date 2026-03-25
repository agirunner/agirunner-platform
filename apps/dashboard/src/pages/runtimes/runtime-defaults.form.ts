import {
  FIELD_DEFINITIONS,
} from './runtime-defaults.schema.js';
import type { FieldDefinition, FormValues, RuntimeDefault } from './runtime-defaults.types.js';

export function buildEmptyForm(fieldDefinitions: FieldDefinition[] = FIELD_DEFINITIONS): FormValues {
  return Object.fromEntries(
    fieldDefinitions.map((field) => [field.key, getFieldDefaultValue(field)]),
  );
}

export function buildFormValues(
  defaults: RuntimeDefault[],
  fieldDefinitions: FieldDefinition[] = FIELD_DEFINITIONS,
): FormValues {
  const values = buildEmptyForm(fieldDefinitions);
  const fieldsByKey = new Map(fieldDefinitions.map((field) => [field.key, field]));
  for (const row of defaults) {
    const field = fieldsByKey.get(row.config_key);
    if (field && row.config_key in values) {
      values[row.config_key] = row.config_value;
    }
  }
  return values;
}

export function buildDefaultsByKey(defaults: RuntimeDefault[]): Map<string, RuntimeDefault> {
  return new Map(defaults.map((row) => [row.config_key, row]));
}

export function getFieldDefaultValue(field: FieldDefinition): string {
  return field.defaultValue ?? field.placeholder;
}

export function planRuntimeDefaultSaveAction(input: {
  field: FieldDefinition;
  currentValue: string;
  existingValue?: string | null;
}): 'noop' | 'upsert' {
  const currentValue = input.currentValue.trim();
  const existingValue = input.existingValue?.trim() ?? '';

  if (!currentValue || currentValue === existingValue) {
    return 'noop';
  }

  void input.field;
  return 'upsert';
}
