import { createDefaultAuthoringDraft } from './playbook-authoring-support.defaults.js';
import {
  asRecord,
  buildBoardColumns,
  buildParameters,
  buildStages,
  compactRecord,
  hasDuplicates,
  readOptionalBooleanString,
  readOptionalIntString,
  readRecordArray,
  readString,
  readStringArray,
} from './playbook-authoring-support.shared.js';
import type {
  BoardColumnDraft,
  ParameterDraft,
  PlaybookAuthoringDraft,
  PlaybookLifecycle,
  StageDraft,
} from './playbook-authoring-support.types.js';
import {
  validateBoardColumnsDraft,
  validateParameterDrafts,
  validateWorkflowRulesDraft,
} from './playbook-authoring-support.validation.js';

export function hydratePlaybookAuthoringDraft(
  lifecycle: PlaybookLifecycle,
  definition: unknown,
): PlaybookAuthoringDraft {
  const record = asRecord(definition);
  const fallback = createDefaultAuthoringDraft(lifecycle);
  const columns = readBoardColumns(record.board);

  return {
    process_instructions:
      readString(record.process_instructions) ||
      readString(asRecord(record.orchestrator).instructions) ||
      fallback.process_instructions,
    roles: readStringArray(record.roles).map((value) => ({ value })),
    columns: columns.length > 0 ? columns : fallback.columns,
    entry_column_id: readBoardEntryColumnId(record.board, columns, fallback.entry_column_id),
    stages: readStages(record.stages),
    parameters: readParameters(record.parameters),
    orchestrator: { ...fallback.orchestrator, ...readOrchestrator(record.orchestrator) },
  };
}

export function buildPlaybookDefinition(
  lifecycle: PlaybookLifecycle,
  draft: PlaybookAuthoringDraft,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const selectedRoles = draft.roles.map((entry) => entry.value.trim()).filter(Boolean);
  const boardValidation = validateBoardColumnsDraft(draft.columns, draft.entry_column_id);
  const stageValidation = validateWorkflowRulesDraft(draft);
  const parameterValidation = validateParameterDrafts(draft.parameters);
  if (!draft.process_instructions.trim()) {
    return { ok: false, error: 'Add process instructions for the orchestrator.' };
  }
  if (selectedRoles.length === 0) {
    return { ok: false, error: 'Select at least one specialist for this workflow.' };
  }
  if (!boardValidation.isValid) {
    return { ok: false, error: boardValidation.blockingIssues[0] ?? 'Fix the board columns.' };
  }
  if (!stageValidation.isValid) {
    return { ok: false, error: stageValidation.blockingIssues[0] ?? 'Fix the workflow stages.' };
  }
  if (!parameterValidation.isValid) {
    return { ok: false, error: parameterValidation.blockingIssues[0] ?? 'Fix the launch inputs.' };
  }

  const parameters = buildParameters(draft.parameters);
  if (
    hasDuplicates(
      parameters
        .map((parameter) => parameter.slug)
        .filter((slug): slug is string => typeof slug === 'string'),
    )
  ) {
    return { ok: false, error: 'Playbook launch input slugs must be unique.' };
  }

  const definition: Record<string, unknown> = {
    lifecycle,
    process_instructions: draft.process_instructions.trim(),
    roles: selectedRoles,
    board: {
      entry_column_id: resolveEntryColumnId(draft.entry_column_id, draft.columns),
      columns: buildBoardColumns(draft.columns).map((column) => compactRecord(column)),
    },
    stages: buildStages(draft.stages).map((stage) => compactRecord(stage)),
  };
  const orchestrator = compactRecord({
    max_rework_iterations: parseOptionalInt(draft.orchestrator.max_rework_iterations),
    max_iterations: parseOptionalInt(draft.orchestrator.max_iterations),
    llm_max_retries: parseOptionalInt(draft.orchestrator.llm_max_retries),
    max_active_tasks: parseOptionalInt(draft.orchestrator.max_active_tasks),
    max_active_tasks_per_work_item: parseOptionalInt(
      draft.orchestrator.max_active_tasks_per_work_item,
    ),
    allow_parallel_work_items: parseOptionalBoolean(draft.orchestrator.allow_parallel_work_items),
  });
  if (Object.keys(orchestrator).length > 0) {
    definition.orchestrator = orchestrator;
  }
  if (parameters.length > 0) {
    definition.parameters = parameters.map((parameter) => compactRecord(parameter));
  }
  return { ok: true, value: definition };
}

function readBoardColumns(board: unknown): BoardColumnDraft[] {
  const columns = readRecordArray(asRecord(board).columns).map((entry) => ({
    id: readString(entry.id),
    label: readString(entry.label),
    description: readString(entry.description),
    is_blocked: Boolean(entry.is_blocked),
    is_terminal: Boolean(entry.is_terminal),
  }));
  return normalizeHydratedBoardColumns(columns);
}

function readBoardEntryColumnId(
  board: unknown,
  columns: BoardColumnDraft[],
  fallback: string,
): string {
  const value = readString(asRecord(board).entry_column_id).trim();
  if (
    value &&
    columns.some(
      (column) => column.id.trim() === value && !column.is_blocked && !column.is_terminal,
    )
  ) {
    return value;
  }
  return resolveHydratedEntryColumnId(columns, fallback);
}

function readStages(value: unknown): StageDraft[] {
  return readRecordArray(value).map((entry) => ({
    name: readString(entry.name),
    goal: readString(entry.goal),
    guidance: readString(entry.guidance),
  }));
}

function readParameters(value: unknown): ParameterDraft[] {
  return readRecordArray(value).map((entry) => ({
    slug: readString(entry.slug),
    title: readString(entry.title),
    required: Boolean(entry.required),
  }));
}

function readOrchestrator(value: unknown): Partial<PlaybookAuthoringDraft['orchestrator']> {
  const record = asRecord(value);
  return compactRecord({
    max_rework_iterations: readOptionalIntString(record.max_rework_iterations),
    max_iterations: readOptionalIntString(record.max_iterations),
    llm_max_retries: readOptionalIntString(record.llm_max_retries),
    max_active_tasks: readOptionalIntString(record.max_active_tasks),
    max_active_tasks_per_work_item: readOptionalIntString(record.max_active_tasks_per_work_item),
    allow_parallel_work_items: readOptionalBooleanString(record.allow_parallel_work_items),
  }) as Partial<PlaybookAuthoringDraft['orchestrator']>;
}

function resolveEntryColumnId(entryColumnId: string, columns: BoardColumnDraft[]): string {
  const trimmed = entryColumnId.trim();
  if (trimmed && columns.some((column) => column.id.trim() === trimmed)) {
    return trimmed;
  }
  return columns[0]?.id.trim() ?? 'inbox';
}

function parseOptionalInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalBoolean(value: '' | 'true' | 'false'): boolean | undefined {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return undefined;
}

function normalizeHydratedBoardColumns(columns: BoardColumnDraft[]): BoardColumnDraft[] {
  const blockedIndex = columns.findIndex((column) => column.is_blocked);
  const terminalIndex = columns.findIndex(
    (column, index) => column.is_terminal && index !== blockedIndex,
  );

  return columns.map((column, index) => ({
    ...column,
    is_blocked: blockedIndex >= 0 && index === blockedIndex,
    is_terminal: terminalIndex >= 0 && index === terminalIndex,
  }));
}

function resolveHydratedEntryColumnId(columns: BoardColumnDraft[], fallback: string): string {
  const preferredEntryColumn = columns.find(
    (column) => column.id.trim() && !column.is_blocked && !column.is_terminal,
  );
  if (preferredEntryColumn) {
    return preferredEntryColumn.id.trim();
  }

  const fallbackValue = fallback.trim();
  if (fallbackValue && columns.some((column) => column.id.trim() === fallbackValue)) {
    return fallbackValue;
  }

  return columns.find((column) => column.id.trim())?.id.trim() ?? fallbackValue;
}
