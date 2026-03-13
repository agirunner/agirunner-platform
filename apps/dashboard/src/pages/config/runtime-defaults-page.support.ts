import {
  FIELD_DEFINITIONS,
  SECTION_DEFINITIONS,
} from './runtime-defaults.schema.js';
import type { FormValues } from './runtime-defaults.types.js';

export interface RuntimeDefaultsSummaryCard {
  label: string;
  value: string;
  detail: string;
}

export interface RuntimeDefaultsSectionSummary {
  key: string;
  title: string;
  configuredCount: number;
  fieldCount: number;
  errorCount: number;
}

export function summarizeRuntimeDefaults(
  values: FormValues,
  errors: Record<string, string>,
): RuntimeDefaultsSummaryCard[] {
  const configuredCount = FIELD_DEFINITIONS.filter((field) =>
    Boolean(values[field.key]?.trim()),
  ).length;
  const errorCount = Object.keys(errors).length;
  const searchConfigured = SECTION_DEFINITIONS.find((section) => section.key === 'search')
    ? countSectionConfigured(values, 'search')
    : 0;

  return [
    {
      label: 'Configured overrides',
      value:
        configuredCount === 0 ? 'Platform defaults only' : `${configuredCount} overrides`,
      detail:
        configuredCount === 0
          ? 'No runtime defaults have been overridden yet.'
          : `${configuredCount} runtime settings currently override the baked-in platform defaults.`,
    },
    {
      label: 'Save blockers',
      value: errorCount === 0 ? 'Ready' : `${errorCount} issue${errorCount === 1 ? '' : 's'}`,
      detail:
        errorCount === 0
          ? 'No validation blockers detected.'
          : 'Resolve the highlighted validation issues before saving runtime defaults.',
    },
    {
      label: 'Search posture',
      value:
        searchConfigured === 0
          ? 'Fallback only'
          : `${searchConfigured} search setting${searchConfigured === 1 ? '' : 's'}`,
      detail:
        searchConfigured === 0
          ? 'Web research uses built-in provider defaults.'
          : `${searchConfigured} web research settings are explicitly configured.`,
    },
  ];
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

function countSectionConfigured(values: FormValues, sectionKey: string): number {
  return FIELD_DEFINITIONS.filter(
    (field) => field.section === sectionKey && Boolean(values[field.key]?.trim()),
  ).length;
}
