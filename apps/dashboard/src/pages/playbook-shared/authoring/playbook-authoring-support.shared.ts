import type {
  BoardColumnDraft,
  ParameterDraft,
  PlaybookAuthoringDraft,
  StageDraft,
} from './playbook-authoring-support.types.js';

export function buildBoardColumns(columns: BoardColumnDraft[]): BoardColumnDraft[] {
  return columns
    .map((column) => ({
      id: column.id.trim(),
      label: column.label.trim(),
      description: column.description.trim(),
      is_blocked: column.is_blocked,
      is_terminal: column.is_terminal,
    }))
    .filter(
      (column) =>
        column.id || column.label || column.description || column.is_blocked || column.is_terminal,
    );
}

export function buildStages(stages: StageDraft[]): StageDraft[] {
  return stages
    .map((stage) => ({
      name: stage.name.trim(),
      goal: stage.goal.trim(),
      guidance: stage.guidance.trim(),
    }))
    .filter((stage) => stage.name || stage.goal || stage.guidance);
}

export function buildParameters(parameters: ParameterDraft[]): Array<Record<string, unknown>> {
  return parameters
    .map((parameter) => ({
      slug: parameter.slug.trim(),
      title: parameter.title.trim(),
      required: parameter.required,
    }))
    .filter((parameter) => Boolean(parameter.slug));
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

export function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => readString(entry).trim()).filter(Boolean) : [];
}

export function readOptionalIntString(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
}

export function readOptionalBooleanString(value: unknown): '' | 'true' | 'false' | undefined {
  if (value === true) {
    return 'true';
  }
  if (value === false) {
    return 'false';
  }
  return undefined;
}

export function hasDuplicates(values: string[]): boolean {
  return new Set(values.filter(Boolean)).size !== values.filter(Boolean).length;
}

export function compactRecord<T extends object>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== ''),
  ) as T;
}

export function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export type PlaybookOrchestratorDraft = PlaybookAuthoringDraft['orchestrator'];
