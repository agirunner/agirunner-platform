import { FIELD_DEFINITIONS } from './runtime-defaults.schema.js';
import type { FormValues, RuntimeDefault } from './runtime-defaults.types.js';

export function buildEmptyForm(): FormValues {
  return Object.fromEntries(FIELD_DEFINITIONS.map((field) => [field.key, '']));
}

export function buildFormValues(defaults: RuntimeDefault[]): FormValues {
  const values = buildEmptyForm();
  for (const row of defaults) {
    if (row.config_key in values) {
      values[row.config_key] = row.config_value;
    }
  }
  return values;
}

export function buildDefaultsByKey(defaults: RuntimeDefault[]): Map<string, RuntimeDefault> {
  return new Map(defaults.map((row) => [row.config_key, row]));
}
