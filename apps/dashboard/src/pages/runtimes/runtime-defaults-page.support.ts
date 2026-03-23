import {
  FIELD_DEFINITIONS,
  SECTION_DEFINITIONS,
} from './runtime-defaults.schema.js';
import type { FormValues } from './runtime-defaults.types.js';

export interface RuntimeDefaultsSectionSummary {
  key: string;
  title: string;
  configuredCount: number;
  fieldCount: number;
  errorCount: number;
}

export function summarizeRuntimeDefaultSections(
  values: FormValues,
  errors: Record<string, string>,
): RuntimeDefaultsSectionSummary[] {
  return SECTION_DEFINITIONS.map((section) => {
    const fields = FIELD_DEFINITIONS.filter((field) => field.section === section.key);
    return {
      key: section.key,
      title: section.title,
      configuredCount: fields.filter((field) => Boolean(values[field.key]?.trim())).length,
      fieldCount: fields.length,
      errorCount: fields.filter((field) => Boolean(errors[field.key])).length,
    };
  });
}
