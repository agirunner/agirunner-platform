import {
  FIELD_DEFINITIONS,
  SECTION_DEFINITIONS,
} from './runtime-defaults.schema.js';
import type { FieldDefinition, FormValues, SectionDefinition } from './runtime-defaults.types.js';

export const AGENTIC_PROMPT_WARNING_THRESHOLD_DEFAULT = 32000;

export interface RuntimeDefaultsSectionSummary {
  key: string;
  title: string;
  configuredCount: number;
  fieldCount: number;
  errorCount: number;
}

export function validatePromptWarningThresholdChars(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Prompt warning threshold is required.';
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return 'Prompt warning threshold must be a whole number.';
  }
  if (parsed < 1) {
    return 'Prompt warning threshold must be at least 1.';
  }
  return null;
}

export function summarizeRuntimeDefaultSections(
  values: FormValues,
  errors: Record<string, string>,
  sectionDefinitions: SectionDefinition[] = SECTION_DEFINITIONS,
  fieldDefinitions: FieldDefinition[] = FIELD_DEFINITIONS,
): RuntimeDefaultsSectionSummary[] {
  return sectionDefinitions.map((section) => {
    const fields = fieldDefinitions.filter((field) => field.section === section.key);
    return {
      key: section.key,
      title: section.title,
      configuredCount: fields.filter((field) => Boolean(values[field.key]?.trim())).length,
      fieldCount: fields.length,
      errorCount: fields.filter((field) => Boolean(errors[field.key])).length,
    };
  });
}
