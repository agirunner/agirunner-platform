import {
  buildBoardColumns,
  buildParameters,
  buildStages,
  uniqueStrings,
} from './playbook-authoring-support.shared.js';
import type {
  BoardColumnDraft,
  BoardColumnValidationResult,
  ParameterDraft,
  ParameterDraftValidationResult,
  PlaybookAuthoringDraft,
  PlaybookAuthoringSummary,
  RoleDraft,
  RoleDraftValidationResult,
  WorkflowRuleValidationResult,
} from './playbook-authoring-support.types.js';

export function validateBoardColumnsDraft(
  columns: BoardColumnDraft[],
  entryColumnId = '',
): BoardColumnValidationResult {
  if (columns.length === 0) {
    return invalidBoard(
      [],
      undefined,
      undefined,
      undefined,
      'At least one board column is required.',
    );
  }
  const duplicateIds = new Set(
    columns
      .map((column) => column.id.trim().toLowerCase())
      .filter((value, index, values) => value && values.indexOf(value) !== index),
  );
  const columnErrors = columns.map((column) => ({
    id: !column.id.trim()
      ? 'Every board column needs an id.'
      : duplicateIds.has(column.id.trim().toLowerCase())
        ? 'Board column ids must be unique.'
        : undefined,
    label: !column.label.trim() ? 'Every board column needs a label.' : undefined,
  }));
  const entryColumnError =
    entryColumnId.trim().length === 0
      ? 'Choose the intake lane.'
      : columns.some((column) => column.id.trim() === entryColumnId.trim())
        ? resolveIntakeLaneError(columns, entryColumnId.trim())
        : 'Choose the intake lane from the board.';
  const blockedColumnError = resolveLaneCountError(columns, 'is_blocked', 'blocked');
  const terminalColumnError = resolveLaneCountError(columns, 'is_terminal', 'terminal');
  const laneConflictError = resolveLaneConflictError(columns);
  const blockingIssues = uniqueStrings([
    ...columnErrors.flatMap((entry) => [entry.id, entry.label]),
    entryColumnError,
    blockedColumnError,
    terminalColumnError,
    laneConflictError,
  ]);
  return {
    columnErrors,
    entryColumnError,
    blockedColumnError,
    terminalColumnError,
    blockingIssues,
    isValid: blockingIssues.length === 0,
  };
}

export function validateWorkflowRulesDraft(
  draft: Pick<PlaybookAuthoringDraft, 'stages'>,
): WorkflowRuleValidationResult {
  if (draft.stages.length === 0) {
    return {
      stageErrors: [],
      blockingIssues: ['Add at least one workflow stage.'],
      isValid: false,
    };
  }
  const duplicateNames = new Set(
    draft.stages
      .map((stage) => stage.name.trim().toLowerCase())
      .filter((value, index, values) => value && values.indexOf(value) !== index),
  );
  const stageErrors = draft.stages.map((stage) => ({
    name: !stage.name.trim()
      ? 'Every stage needs a name.'
      : duplicateNames.has(stage.name.trim().toLowerCase())
        ? 'Stage names must be unique.'
        : undefined,
    goal: !stage.goal.trim() ? 'Every stage needs a goal.' : undefined,
  }));
  const blockingIssues = uniqueStrings(stageErrors.flatMap((entry) => [entry.name, entry.goal]));
  return { stageErrors, blockingIssues, isValid: blockingIssues.length === 0 };
}

export function validateParameterDrafts(
  parameters: ParameterDraft[],
): ParameterDraftValidationResult {
  const duplicateSlugs = new Set(
    parameters
      .map((parameter) => parameter.slug.trim().toLowerCase())
      .filter((value, index, values) => value && values.indexOf(value) !== index),
  );
  const parameterErrors = parameters.map((parameter) => ({
    slug: !parameter.slug.trim()
      ? 'Every launch input needs a slug.'
      : !isValidParameterSlug(parameter.slug)
        ? 'Launch input slugs must use lowercase letters, numbers, underscores, or hyphens.'
        : duplicateSlugs.has(parameter.slug.trim().toLowerCase())
          ? 'Launch input slugs must be unique.'
          : undefined,
    title: !parameter.title.trim() ? 'Every launch input needs a title.' : undefined,
  }));
  const blockingIssues = uniqueStrings(
    parameterErrors.flatMap((entry) => [entry.slug, entry.title]),
  );
  return { parameterErrors, blockingIssues, isValid: blockingIssues.length === 0 };
}

export function validateRoleDrafts(
  roles: RoleDraft[],
  availableRoleNames: string[],
): RoleDraftValidationResult {
  const available = new Set(availableRoleNames.map((value) => value.trim()).filter(Boolean));
  const selectedRoleCount = roles.map((role) => role.value.trim()).filter(Boolean).length;
  const selectionIssue =
    selectedRoleCount === 0 ? 'Select at least one specialist for this workflow.' : undefined;
  const roleErrors = roles.map((role) => {
    const name = role.value.trim();
    return name && !available.has(name)
      ? 'Select an active specialist from the shared catalog.'
      : undefined;
  });
  const blockingIssues = uniqueStrings([selectionIssue, ...roleErrors]);
  return {
    roleErrors,
    selectionIssue,
    blockingIssues,
    isValid: blockingIssues.length === 0,
  };
}

export function reconcileValidationIssues(currentIssues: string[], nextIssues: string[]): string[] {
  if (currentIssues.length !== nextIssues.length) {
    return nextIssues;
  }

  for (let index = 0; index < currentIssues.length; index += 1) {
    if (currentIssues[index] !== nextIssues[index]) {
      return nextIssues;
    }
  }

  return currentIssues;
}

export function summarizePlaybookAuthoringDraft(
  draft: PlaybookAuthoringDraft,
): PlaybookAuthoringSummary {
  const columns = buildBoardColumns(draft.columns);
  const parameters = buildParameters(draft.parameters);
  return {
    hasProcessInstructions: draft.process_instructions.trim().length > 0,
    roleCount: draft.roles.map((entry) => entry.value.trim()).filter(Boolean).length,
    stageCount: buildStages(draft.stages).length,
    columnCount: columns.length,
    blockedColumnCount: columns.filter((column) => column.is_blocked).length,
    terminalColumnCount: columns.filter((column) => column.is_terminal).length,
    parameterCount: parameters.length,
    runtimeOverrideCount: 0,
  };
}

export function normalizeParameterSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
}

function invalidBoard(
  columnErrors: Array<{ id?: string; label?: string }>,
  entryColumnError: string | undefined,
  blockedColumnError: string | undefined,
  terminalColumnError: string | undefined,
  issue: string,
): BoardColumnValidationResult {
  return {
    columnErrors,
    entryColumnError,
    blockedColumnError,
    terminalColumnError,
    blockingIssues: [issue],
    isValid: false,
  };
}

function resolveIntakeLaneError(
  columns: BoardColumnDraft[],
  entryColumnId: string,
): string | undefined {
  const entryColumn = columns.find((column) => column.id.trim() === entryColumnId) ?? null;
  if (!entryColumn) {
    return 'Choose the intake lane from the board.';
  }
  if (entryColumn.is_blocked || entryColumn.is_terminal) {
    return 'Choose an intake lane that is not blocked or terminal.';
  }
  return undefined;
}

function resolveLaneCountError(
  columns: BoardColumnDraft[],
  field: 'is_blocked' | 'is_terminal',
  label: 'blocked' | 'terminal',
): string | undefined {
  const count = columns.filter((column) => column[field]).length;
  return count === 1 ? undefined : `Choose exactly one ${label} lane.`;
}

function resolveLaneConflictError(columns: BoardColumnDraft[]): string | undefined {
  return columns.some((column) => column.is_blocked && column.is_terminal)
    ? 'Choose different blocked and terminal lanes.'
    : undefined;
}

function isValidParameterSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/.test(value.trim());
}
