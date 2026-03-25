import {
  FIELD_DEFINITIONS,
  PRIMARY_RUNTIME_DEFAULT_SECTION_KEYS,
} from './runtime-defaults.schema.js';
import type { FieldDefinition, FormValues, RuntimeDefault } from './runtime-defaults.types.js';

export function buildEmptyForm(fieldDefinitions: FieldDefinition[] = FIELD_DEFINITIONS): FormValues {
  return Object.fromEntries(fieldDefinitions.map((field) => [field.key, '']));
}

export function buildFormValues(
  defaults: RuntimeDefault[],
  fieldDefinitions: FieldDefinition[] = FIELD_DEFINITIONS,
  primarySectionKeys: readonly string[] = PRIMARY_RUNTIME_DEFAULT_SECTION_KEYS,
): FormValues {
  const values = buildEmptyForm(fieldDefinitions);
  const fieldsByKey = new Map(fieldDefinitions.map((field) => [field.key, field]));
  for (const row of defaults) {
    const field = fieldsByKey.get(row.config_key);
    if (field && row.config_key in values) {
      values[row.config_key] = shouldClearAdvancedOverride(field, row.config_value, primarySectionKeys)
        ? ''
        : row.config_value;
    }
  }
  return values;
}

export function buildDefaultsByKey(defaults: RuntimeDefault[]): Map<string, RuntimeDefault> {
  return new Map(defaults.map((row) => [row.config_key, row]));
}

export function isAdvancedRuntimeOverrideField(
  field: FieldDefinition,
  primarySectionKeys: readonly string[] = PRIMARY_RUNTIME_DEFAULT_SECTION_KEYS,
): boolean {
  return !primarySectionKeys.includes(
    field.section as (typeof primarySectionKeys)[number],
  );
}

function shouldClearAdvancedOverride(
  field: FieldDefinition,
  value: string,
  primarySectionKeys: readonly string[] = PRIMARY_RUNTIME_DEFAULT_SECTION_KEYS,
): boolean {
  return (
    isAdvancedRuntimeOverrideField(field, primarySectionKeys)
    && value.trim() === getFieldDefaultValue(field)
  );
}

export function getFieldDefaultValue(field: FieldDefinition): string {
  return field.defaultValue ?? field.placeholder;
}

export function shouldDeleteRuntimeDefaultRow(input: {
  field: FieldDefinition;
  currentValue: string;
  existingValue?: string | null;
  primarySectionKeys?: readonly string[];
}): boolean {
  return planRuntimeDefaultSaveAction(input) === 'delete';
}

export function planRuntimeDefaultSaveAction(input: {
  field: FieldDefinition;
  currentValue: string;
  existingValue?: string | null;
  primarySectionKeys?: readonly string[];
}): 'noop' | 'delete' | 'upsert' {
  const currentValue = input.currentValue.trim();
  const existingValue = input.existingValue?.trim() ?? '';
  const primarySectionKeys = input.primarySectionKeys ?? PRIMARY_RUNTIME_DEFAULT_SECTION_KEYS;

  if (!existingValue) {
    return currentValue ? 'upsert' : 'noop';
  }

  if (!currentValue) {
    if (!isAdvancedRuntimeOverrideField(input.field, primarySectionKeys)) {
      return 'delete';
    }
    return existingValue === getFieldDefaultValue(input.field) ? 'noop' : 'delete';
  }

  if (
    isAdvancedRuntimeOverrideField(input.field, primarySectionKeys) &&
    currentValue === getFieldDefaultValue(input.field)
  ) {
    return existingValue === getFieldDefaultValue(input.field) ? 'noop' : 'delete';
  }

  return 'upsert';
}
