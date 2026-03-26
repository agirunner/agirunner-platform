export type PlaybookLifecycle = 'planned' | 'ongoing';

export interface RoleDraft {
  value: string;
}

export interface BoardColumnDraft {
  id: string;
  label: string;
  description: string;
  is_blocked: boolean;
  is_terminal: boolean;
}

export interface StageDraft {
  name: string;
  goal: string;
  guidance: string;
}

export interface ParameterDraft {
  slug: string;
  title: string;
  required: boolean;
}

export interface PlaybookAuthoringDraft {
  process_instructions: string;
  roles: RoleDraft[];
  columns: BoardColumnDraft[];
  entry_column_id: string;
  stages: StageDraft[];
  parameters: ParameterDraft[];
  orchestrator: {
    max_rework_iterations: string;
    max_iterations: string;
    llm_max_retries: string;
    max_active_tasks: string;
    max_active_tasks_per_work_item: string;
    allow_parallel_work_items: '' | 'true' | 'false';
  };
}

export interface PlaybookAuthoringSummary {
  hasProcessInstructions: boolean;
  roleCount: number;
  stageCount: number;
  columnCount: number;
  blockedColumnCount: number;
  terminalColumnCount: number;
  parameterCount: number;
  runtimeOverrideCount: number;
}

export interface BoardColumnValidationResult {
  columnErrors: Array<{ id?: string; label?: string }>;
  entryColumnError?: string;
  blockingIssues: string[];
  isValid: boolean;
}

export interface WorkflowRuleValidationResult {
  stageErrors: Array<{ name?: string; goal?: string }>;
  blockingIssues: string[];
  isValid: boolean;
}

export interface ParameterDraftValidationResult {
  parameterErrors: Array<{ slug?: string; title?: string }>;
  blockingIssues: string[];
  isValid: boolean;
}

export interface RoleDraftValidationResult {
  roleErrors: Array<string | undefined>;
  selectionIssue?: string;
  blockingIssues: string[];
  isValid: boolean;
}

export function createDefaultAuthoringDraft(lifecycle: PlaybookLifecycle): PlaybookAuthoringDraft {
  return {
    process_instructions:
      lifecycle === 'ongoing'
        ? 'Mandatory outcomes: keep the workflow moving, clarify new work as it arrives, and close each work item with usable output or recorded callouts. Preferred steps: seek specialist reviews, approvals, assessments, and escalations when they improve the outcome, but if a preferred step cannot complete the orchestrator must still drive to the closest responsible result, record residual risks, and close the workflow when the mandatory outcomes are satisfied.'
        : 'Mandatory outcomes: produce the requested result, move each work item through the defined stages, and close the workflow once the required output exists. Preferred steps: seek specialist reviews, approvals, assessments, and escalations when they improve quality, but if a preferred step cannot complete the orchestrator must still drive to the closest responsible result, record residual risks and waived steps, and close the workflow when the mandatory outcomes are satisfied.',
    roles: [],
    columns: [
      { id: 'inbox', label: 'Inbox', description: '', is_blocked: false, is_terminal: false },
      { id: 'active', label: 'Active', description: '', is_blocked: false, is_terminal: false },
      { id: 'review', label: 'Review', description: '', is_blocked: false, is_terminal: false },
      { id: 'blocked', label: 'Blocked', description: '', is_blocked: true, is_terminal: false },
      { id: 'done', label: 'Done', description: '', is_blocked: false, is_terminal: true },
    ],
    entry_column_id: 'inbox',
    stages: [],
    parameters: [],
    orchestrator: {
      max_rework_iterations: '',
      max_iterations: '',
      llm_max_retries: '',
      max_active_tasks: '',
      max_active_tasks_per_work_item: '',
      allow_parallel_work_items: '',
    },
  };
}

export function createEmptyRoleDraft(): RoleDraft {
  return { value: '' };
}

export function createEmptyColumnDraft(): BoardColumnDraft {
  return { id: '', label: '', description: '', is_blocked: false, is_terminal: false };
}

export function createEmptyStageDraft(): StageDraft {
  return { name: '', goal: '', guidance: '' };
}

export function createEmptyParameterDraft(): ParameterDraft {
  return {
    slug: '',
    title: '',
    required: false,
  };
}

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
  if (hasDuplicates(parameters.map((parameter) => parameter.slug))) {
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

export function validateBoardColumnsDraft(
  columns: BoardColumnDraft[],
  entryColumnId = '',
): BoardColumnValidationResult {
  if (columns.length === 0) {
    return invalidBoard([], undefined, 'At least one board column is required.');
  }
  const duplicateIds = new Set(
    columns
      .map((column) => column.id.trim().toLowerCase())
      .filter((value, index, values) => value && values.indexOf(value) !== index),
  );
  const columnErrors = columns.map((column) => ({
    id: !column.id.trim() ? 'Every board column needs an id.' : duplicateIds.has(column.id.trim().toLowerCase()) ? 'Board column ids must be unique.' : undefined,
    label: !column.label.trim() ? 'Every board column needs a label.' : undefined,
  }));
  const entryColumnError =
    entryColumnId.trim().length === 0
      ? 'Choose the default intake column.'
      : columns.some((column) => column.id.trim() === entryColumnId.trim())
        ? undefined
        : 'Choose a default intake column from the board.';
  const blockingIssues = uniqueStrings([
    ...columnErrors.flatMap((entry) => [entry.id, entry.label]),
    entryColumnError,
  ]);
  return { columnErrors, entryColumnError, blockingIssues, isValid: blockingIssues.length === 0 };
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
    slug:
      !parameter.slug.trim()
        ? 'Every launch input needs a slug.'
        : !isValidParameterSlug(parameter.slug)
          ? 'Launch input slugs must use lowercase letters, numbers, underscores, or hyphens.'
          : duplicateSlugs.has(parameter.slug.trim().toLowerCase())
            ? 'Launch input slugs must be unique.'
            : undefined,
    title:
      !parameter.title.trim()
        ? 'Every launch input needs a title.'
        : undefined,
  }));
  const blockingIssues = uniqueStrings(parameterErrors.flatMap((entry) => [entry.slug, entry.title]));
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

export function reconcileValidationIssues(
  currentIssues: string[],
  nextIssues: string[],
): string[] {
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

function invalidBoard(
  columnErrors: Array<{ id?: string; label?: string }>,
  entryColumnError: string | undefined,
  issue: string,
): BoardColumnValidationResult {
  return { columnErrors, entryColumnError, blockingIssues: [issue], isValid: false };
}

function buildBoardColumns(columns: BoardColumnDraft[]): BoardColumnDraft[] {
  return columns
    .map((column) => ({
      id: column.id.trim(),
      label: column.label.trim(),
      description: column.description.trim(),
      is_blocked: column.is_blocked,
      is_terminal: column.is_terminal,
    }))
    .filter((column) => column.id || column.label || column.description || column.is_blocked || column.is_terminal);
}

function buildStages(stages: StageDraft[]): StageDraft[] {
  return stages
    .map((stage) => ({
      name: stage.name.trim(),
      goal: stage.goal.trim(),
      guidance: stage.guidance.trim(),
    }))
    .filter((stage) => stage.name || stage.goal || stage.guidance);
}

function buildParameters(parameters: ParameterDraft[]): Array<Record<string, unknown>> {
  return parameters
    .map((parameter) => ({
      slug: parameter.slug.trim(),
      title: parameter.title.trim(),
      required: parameter.required,
    }))
    .filter((parameter) => Boolean(parameter.slug));
}

function readBoardColumns(board: unknown): BoardColumnDraft[] {
  return readRecordArray(asRecord(board).columns).map((entry) => ({
    id: readString(entry.id),
    label: readString(entry.label),
    description: readString(entry.description),
    is_blocked: Boolean(entry.is_blocked),
    is_terminal: Boolean(entry.is_terminal),
  }));
}

function readBoardEntryColumnId(board: unknown, columns: BoardColumnDraft[], fallback: string): string {
  const value = readString(asRecord(board).entry_column_id);
  return columns.some((column) => column.id === value) ? value : fallback;
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

export function normalizeParameterSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
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

function readOptionalIntString(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
}

function readOptionalBooleanString(value: unknown): '' | 'true' | 'false' | undefined {
  if (value === true) {
    return 'true';
  }
  if (value === false) {
    return 'false';
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => readString(entry).trim()).filter(Boolean)
    : [];
}

function hasDuplicates(values: string[]): boolean {
  return new Set(values.filter(Boolean)).size !== values.filter(Boolean).length;
}

function isValidParameterSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/.test(value.trim());
}

function compactRecord<T extends object>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== ''),
  ) as T;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
