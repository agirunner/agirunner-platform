import type { DashboardPlaybookRecord } from '../../../lib/api.js';

export interface LaunchParameterSpec {
  slug: string;
  title: string;
  required: boolean;
}

export interface LaunchDefinitionSummary {
  roles: string[];
  stageNames: string[];
  boardColumns: Array<{ id: string; label: string }>;
  parameterSpecs: LaunchParameterSpec[];
}

export function readLaunchDefinition(
  playbook: DashboardPlaybookRecord | null,
): LaunchDefinitionSummary {
  const definition = asRecord(playbook?.definition);
  return {
    roles: readStringArray(definition.roles),
    stageNames: readStageNames(definition),
    boardColumns: readBoardColumns(definition.board),
    parameterSpecs: readParameterSpecs(definition.parameters),
  };
}

export function readRequiredParameterError(
  specs: LaunchParameterSpec[],
  drafts: Record<string, string>,
): string | undefined {
  const missingRequired = specs.find(
    (spec) => spec.required && (drafts[spec.slug]?.trim().length ?? 0) === 0,
  );
  return missingRequired
    ? `Enter a value for required launch input '${missingRequired.title}'.`
    : undefined;
}

function readParameterSpecs(value: unknown): LaunchParameterSpec[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => readParameterSpec(entry))
    .filter((entry): entry is LaunchParameterSpec => entry !== null);
}

function readParameterSpec(value: unknown): LaunchParameterSpec | null {
  const record = asRecord(value);
  const slug = readNonEmptyString(record.slug);
  const title = readNonEmptyString(record.title);
  if (!slug || !title) {
    return null;
  }
  return {
    slug,
    title,
    required: record.required === true,
  };
}

function readStageNames(definition: Record<string, unknown>): string[] {
  return readNamedFlowEntries(definition.stages);
}

function readNamedFlowEntries(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => readNonEmptyString(asRecord(entry).name))
    .filter((entry): entry is string => Boolean(entry));
}

function readBoardColumns(value: unknown): Array<{ id: string; label: string }> {
  const board = asRecord(value);
  const columns = Array.isArray(board.columns) ? board.columns : [];
  return columns
    .map((entry) => {
      const record = asRecord(entry);
      const id = readNonEmptyString(record.id);
      if (!id) {
        return null;
      }
      return {
        id,
        label: readNonEmptyString(record.label) ?? id,
      };
    })
    .filter((entry): entry is { id: string; label: string } => entry !== null);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
