import {
  FIELD_DEFINITIONS,
  PRIMARY_RUNTIME_DEFAULT_SECTION_KEYS,
} from './runtime-defaults.schema.js';
import type { FieldDefinition, FormValues, RuntimeDefault } from './runtime-defaults.types.js';

export function buildEmptyForm(): FormValues {
  return Object.fromEntries(FIELD_DEFINITIONS.map((field) => [field.key, '']));
}

export function buildFormValues(defaults: RuntimeDefault[]): FormValues {
  const values = buildEmptyForm();
  const fieldsByKey = new Map(FIELD_DEFINITIONS.map((field) => [field.key, field]));
  for (const row of defaults) {
    const field = fieldsByKey.get(row.config_key);
    if (field && row.config_key in values) {
      values[row.config_key] = shouldClearAdvancedOverride(field, row.config_value)
        ? ''
        : row.config_value;
    }
  }
  return values;
}

export function buildDefaultsByKey(defaults: RuntimeDefault[]): Map<string, RuntimeDefault> {
  return new Map(defaults.map((row) => [row.config_key, row]));
}

export function isAdvancedRuntimeOverrideField(field: FieldDefinition): boolean {
  return !PRIMARY_RUNTIME_DEFAULT_SECTION_KEYS.includes(
    field.section as (typeof PRIMARY_RUNTIME_DEFAULT_SECTION_KEYS)[number],
  );
}

function shouldClearAdvancedOverride(field: FieldDefinition, value: string): boolean {
  return isAdvancedRuntimeOverrideField(field) && value.trim() === getFieldDefaultValue(field);
}

export function getFieldDefaultValue(field: FieldDefinition): string {
  return field.defaultValue ?? field.placeholder;
}

export function shouldDeleteRuntimeDefaultRow(input: {
  field: FieldDefinition;
  currentValue: string;
  existingValue?: string | null;
}): boolean {
  return planRuntimeDefaultSaveAction(input) === 'delete';
}

export function planRuntimeDefaultSaveAction(input: {
  field: FieldDefinition;
  currentValue: string;
  existingValue?: string | null;
}): 'noop' | 'delete' | 'upsert' {
  const currentValue = input.currentValue.trim();
  const existingValue = input.existingValue?.trim() ?? '';

  if (!existingValue) {
    return currentValue ? 'upsert' : 'noop';
  }

  if (!currentValue) {
    if (!isAdvancedRuntimeOverrideField(input.field)) {
      return 'delete';
    }
    return existingValue === getFieldDefaultValue(input.field) ? 'noop' : 'delete';
  }

  if (
    isAdvancedRuntimeOverrideField(input.field) &&
    currentValue === getFieldDefaultValue(input.field)
  ) {
    return existingValue === getFieldDefaultValue(input.field) ? 'noop' : 'delete';
  }

  return 'upsert';
}
