import { validateStructuredParameterDefaultValue } from './playbook-authoring-structured-controls.support.js';

export type PlaybookLifecycle = 'standard' | 'continuous';

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
  involves: string;
  human_gate: boolean;
  guidance: string;
}

export interface ParameterDraft {
  name: string;
  type: string;
  required: boolean;
  secret: boolean;
  category: string;
  maps_to: string;
  description: string;
  default_value: string;
}

export interface RuntimePoolDraft {
  enabled?: boolean;
  pool_mode: string;
  max_runtimes: string;
  priority: string;
  idle_timeout_seconds: string;
  grace_period_seconds: string;
  image: string;
  pull_policy: string;
  cpu: string;
  memory: string;
}

export interface PlaybookAuthoringDraft {
  roles: RoleDraft[];
  columns: BoardColumnDraft[];
  stages: StageDraft[];
  parameters: ParameterDraft[];
  orchestrator: {
    instructions: string;
    tools: string[];
    check_interval: string;
    stale_threshold: string;
    max_rework_iterations: string;
    max_active_tasks: string;
    max_active_tasks_per_work_item: string;
    allow_parallel_work_items: boolean;
  };
  runtime: {
    shared: RuntimePoolDraft;
    orchestrator_pool: RuntimePoolDraft;
    specialist_pool: RuntimePoolDraft;
  };
}

export interface PlaybookAuthoringSummary {
  roleCount: number;
  columnCount: number;
  blockedColumnCount: number;
  terminalColumnCount: number;
  stageCount: number;
  gatedStageCount: number;
  parameterCount: number;
  requiredParameterCount: number;
  secretParameterCount: number;
  runtimeOverrideCount: number;
}

export interface BoardColumnValidationResult {
  columnErrors: Array<{
    id?: string;
    label?: string;
  }>;
  blockingIssues: string[];
  isValid: boolean;
}

export interface ParameterDraftValidationResult {
  parameterErrors: Array<{
    category?: string;
    maps_to?: string;
    secret?: string;
  }>;
  blockingIssues: string[];
  isValid: boolean;
}

export function createDefaultAuthoringDraft(lifecycle: PlaybookLifecycle): PlaybookAuthoringDraft {
  return {
    roles: [{ value: 'developer' }],
    columns: [
      { id: 'inbox', label: 'Inbox', description: '', is_blocked: false, is_terminal: false },
      { id: 'doing', label: 'Doing', description: '', is_blocked: false, is_terminal: false },
      { id: 'done', label: 'Done', description: '', is_blocked: false, is_terminal: true },
    ],
    stages:
      lifecycle === 'continuous'
        ? [
            {
              name: 'triage',
              goal: 'Clarify and route new work',
              involves: 'developer',
              human_gate: false,
              guidance: '',
            },
            {
              name: 'delivery',
              goal: 'Complete the work item',
              involves: 'developer',
              human_gate: false,
              guidance: '',
            },
          ]
        : [
            {
              name: 'plan',
              goal: 'Plan the workflow',
              involves: 'developer',
              human_gate: false,
              guidance: '',
            },
            {
              name: 'deliver',
              goal: 'Ship the outcome',
              involves: 'developer',
              human_gate: true,
              guidance: '',
            },
          ],
    parameters: [],
    orchestrator: {
      instructions: '',
      tools: [],
      check_interval: '5m',
      stale_threshold: '30m',
      max_rework_iterations: '3',
      max_active_tasks: '4',
      max_active_tasks_per_work_item: '2',
      allow_parallel_work_items: true,
    },
    runtime: {
      shared: createRuntimePoolDraft(),
      orchestrator_pool: createRuntimePoolDraft(false),
      specialist_pool: createRuntimePoolDraft(false),
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
  return { name: '', goal: '', involves: '', human_gate: false, guidance: '' };
}

export function createEmptyParameterDraft(): ParameterDraft {
  return {
    name: '',
    type: 'string',
    required: false,
    secret: false,
    category: '',
    maps_to: '',
    description: '',
    default_value: '',
  };
}

export function createRuntimePoolDraft(enabled = true): RuntimePoolDraft {
  return {
    enabled,
    pool_mode: '',
    max_runtimes: '',
    priority: '',
    idle_timeout_seconds: '',
    grace_period_seconds: '',
    image: '',
    pull_policy: '',
    cpu: '',
    memory: '',
  };
}

export function hydratePlaybookAuthoringDraft(
  lifecycle: PlaybookLifecycle,
  definition: unknown,
): PlaybookAuthoringDraft {
  const record = asRecord(definition);
  const roles = readStringArray(record.roles).map((value) => ({ value }));
  const columns = readBoardColumns(record.board);
  const stages = readStages(record.stages);
  const parameters = readParameters(record.parameters);
  const orchestrator = readOrchestrator(record.orchestrator);
  const runtime = readRuntime(record.runtime);

  const fallback = createDefaultAuthoringDraft(lifecycle);
  return {
    roles: roles.length > 0 ? roles : fallback.roles,
    columns: columns.length > 0 ? columns : fallback.columns,
    stages: stages.length > 0 ? stages : fallback.stages,
    parameters,
    orchestrator: { ...fallback.orchestrator, ...orchestrator },
    runtime: {
      shared: { ...fallback.runtime.shared, ...runtime.shared },
      orchestrator_pool: {
        ...fallback.runtime.orchestrator_pool,
        ...runtime.orchestrator_pool,
      },
      specialist_pool: {
        ...fallback.runtime.specialist_pool,
        ...runtime.specialist_pool,
      },
    },
  };
}

export function buildPlaybookDefinition(
  lifecycle: PlaybookLifecycle,
  draft: PlaybookAuthoringDraft,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const roles = draft.roles.map((entry) => entry.value.trim()).filter(Boolean);
  const columns = draft.columns
    .map((column) => ({
      id: column.id.trim(),
      label: column.label.trim(),
      description: column.description.trim(),
      is_blocked: column.is_blocked,
      is_terminal: column.is_terminal,
    }))
    .filter((column) => column.id || column.label || column.description || column.is_blocked || column.is_terminal);
  const stages = draft.stages
    .map((stage) => ({
      name: stage.name.trim(),
      goal: stage.goal.trim(),
      involves: splitCsv(stage.involves),
      human_gate: stage.human_gate,
      guidance: stage.guidance.trim(),
    }))
    .filter((stage) => stage.name || stage.goal || stage.involves.length > 0 || stage.human_gate || stage.guidance);
  const parameters = draft.parameters
    .map((parameter) => ({
      name: parameter.name.trim(),
      type: parameter.type.trim() || 'string',
      required: parameter.required,
      secret: parameter.secret,
      category: parameter.category.trim(),
      maps_to: parameter.maps_to.trim(),
      description: parameter.description.trim(),
      default: parameter.default_value.trim(),
    }))
    .filter((parameter) =>
      parameter.name ||
      parameter.category ||
      parameter.maps_to ||
      parameter.description ||
      parameter.default ||
      parameter.required ||
      parameter.secret,
    );

  const boardColumnValidation = validateBoardColumnsDraft(draft.columns);

  if (boardColumnValidation.blockingIssues[0]) {
    return { ok: false, error: boardColumnValidation.blockingIssues[0] };
  }
  if (columns.length === 0) {
    return { ok: false, error: 'At least one board column is required.' };
  }
  if (stages.some((stage) => !stage.name || !stage.goal)) {
    return { ok: false, error: 'Every stage needs a name and goal.' };
  }
  if (hasDuplicates(stages.map((stage) => stage.name))) {
    return { ok: false, error: 'Stage names must be unique.' };
  }
  if (parameters.some((parameter) => !parameter.name)) {
    return { ok: false, error: 'Every playbook parameter needs a name.' };
  }
  if (hasDuplicates(parameters.map((parameter) => parameter.name))) {
    return { ok: false, error: 'Playbook parameter names must be unique.' };
  }
  const parameterValidation = validateParameterDrafts(draft.parameters);
  if (!parameterValidation.isValid) {
    return { ok: false, error: parameterValidation.blockingIssues[0] };
  }
  const defaultValueIssue = parameters
    .map((parameter) =>
      validateStructuredParameterDefaultValue(parameter.type, parameter.default),
    )
    .find((issue): issue is string => Boolean(issue));
  if (defaultValueIssue) {
    return { ok: false, error: defaultValueIssue };
  }

  const definition: Record<string, unknown> = {
    lifecycle,
    roles,
    board: {
      columns: columns.map((column) => compactRecord(column)),
    },
    stages: stages.map((stage) => compactRecord(stage)),
  };

  const orchestrator = compactRecord({
    instructions: draft.orchestrator.instructions.trim(),
    tools: Array.from(
      new Set(
        draft.orchestrator.tools
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      ),
    ),
    check_interval: draft.orchestrator.check_interval.trim(),
    stale_threshold: draft.orchestrator.stale_threshold.trim(),
    max_rework_iterations: parseOptionalInt(draft.orchestrator.max_rework_iterations),
    max_active_tasks: parseOptionalInt(draft.orchestrator.max_active_tasks),
    max_active_tasks_per_work_item: parseOptionalInt(draft.orchestrator.max_active_tasks_per_work_item),
    allow_parallel_work_items: draft.orchestrator.allow_parallel_work_items,
  });
  if (Object.keys(orchestrator).length > 0) {
    definition.orchestrator = orchestrator;
  }

  const runtime = compactRecord({
    ...buildRuntimePoolRecord(draft.runtime.shared),
    orchestrator_pool: buildRuntimePoolRecord(draft.runtime.orchestrator_pool, true),
    specialist_pool: buildRuntimePoolRecord(draft.runtime.specialist_pool, true),
  });
  if (Object.keys(runtime).length > 0) {
    definition.runtime = runtime;
  }

  if (parameters.length > 0) {
    definition.parameters = parameters.map((parameter) => compactRecord(parameter));
  }

  return { ok: true, value: definition };
}

export function validateBoardColumnsDraft(
  columns: BoardColumnDraft[],
): BoardColumnValidationResult {
  if (columns.length === 0) {
    return {
      columnErrors: [],
      blockingIssues: ['At least one board column is required.'],
      isValid: false,
    };
  }

  const normalizedIds = columns.map((column) => column.id.trim().toLowerCase());
  const duplicateIds = new Set(
    normalizedIds.filter((value, index) => value && normalizedIds.indexOf(value) !== index),
  );
  const columnErrors = columns.map((column) => ({
    id: readBoardColumnIdError(column, duplicateIds),
    label: readBoardColumnLabelError(column),
  }));
  const blockingIssues = Array.from(
    new Set(
      columnErrors.flatMap((column) =>
        [column.id, column.label].filter((value): value is string => Boolean(value)),
      ),
    ),
  );

  return {
    columnErrors,
    blockingIssues,
    isValid: blockingIssues.length === 0,
  };
}

export function validateParameterDrafts(
  parameters: ParameterDraft[],
): ParameterDraftValidationResult {
  const parameterErrors = parameters.map((parameter) => readParameterDraftErrors(parameter));
  const blockingIssues = Array.from(
    new Set(
      parameterErrors.flatMap((entry) =>
        [entry.category, entry.maps_to, entry.secret].filter(
          (issue): issue is string => Boolean(issue),
        ),
      ),
    ),
  );

  return {
    parameterErrors,
    blockingIssues,
    isValid: blockingIssues.length === 0,
  };
}

function buildRuntimePoolRecord(pool: RuntimePoolDraft, gated = false): Record<string, unknown> | undefined {
  if (gated && !pool.enabled) {
    return undefined;
  }
  const runtimePool = compactRecord({
    pool_mode: normalizePoolMode(pool.pool_mode),
    max_runtimes: parseOptionalInt(pool.max_runtimes),
    priority: parseOptionalInt(pool.priority),
    idle_timeout_seconds: parseOptionalInt(pool.idle_timeout_seconds),
    grace_period_seconds: parseOptionalInt(pool.grace_period_seconds),
    image: pool.image.trim(),
    pull_policy: normalizePullPolicy(pool.pull_policy),
    cpu: pool.cpu.trim(),
    memory: pool.memory.trim(),
  });
  return Object.keys(runtimePool).length > 0 ? runtimePool : undefined;
}

function compactRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) =>
      value !== '' &&
      value !== undefined &&
      !(Array.isArray(value) && value.length === 0),
    ),
  );
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readBoardColumnIdError(
  column: BoardColumnDraft,
  duplicateIds: Set<string>,
): string | undefined {
  const id = column.id.trim();
  if (!id) {
    return 'Add a stable column ID.';
  }
  if (duplicateIds.has(id.toLowerCase())) {
    return 'Column IDs must be unique.';
  }
  return undefined;
}

function readBoardColumnLabelError(column: BoardColumnDraft): string | undefined {
  if (!column.label.trim()) {
    return 'Add a column label.';
  }
  return undefined;
}

function parseOptionalInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizePoolMode(value: string): string | undefined {
  return value === 'warm' || value === 'cold' ? value : undefined;
}

function normalizePullPolicy(value: string): string | undefined {
  return value === 'always' || value === 'if-not-present' || value === 'never' ? value : undefined;
}

function hasDuplicates(values: string[]): boolean {
  const normalized = values.filter(Boolean);
  return new Set(normalized).size !== normalized.length;
}

function readParameterDraftErrors(parameter: ParameterDraft): {
  category?: string;
  maps_to?: string;
  secret?: string;
} {
  const category = parameter.category.trim();
  const mapsTo = parameter.maps_to.trim();
  const isSecret = parameter.secret;
  const hasAnyValue =
    parameter.name.trim().length > 0 ||
    category.length > 0 ||
    mapsTo.length > 0 ||
    parameter.description.trim().length > 0 ||
    parameter.default_value.trim().length > 0 ||
    parameter.required ||
    parameter.secret;

  if (!hasAnyValue) {
    return {};
  }

  const errors: {
    category?: string;
    maps_to?: string;
    secret?: string;
  } = {};

  if (mapsTo === 'project.credentials.git_token') {
    if (!isSecret) {
      errors.secret = 'Git token mappings must be marked secret.';
    }
    if (category !== 'credential') {
      errors.category = 'Git token mappings should use the Credential category.';
    }
  }

  if (mapsTo === 'project.repository_url' || mapsTo === 'project.settings.default_branch') {
    if (isSecret) {
      errors.secret = 'Repository metadata mappings cannot be marked secret.';
    }
    if (category !== 'repository') {
      errors.category = 'Repository metadata mappings should use the Repository category.';
    }
  }

  if (category === 'credential' && !isSecret) {
    errors.secret = 'Credential parameters must be marked secret.';
  }

  if (category === 'repository' && isSecret) {
    errors.secret = 'Repository parameters should stay non-secret.';
  }

  return errors;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function readBoardColumns(value: unknown): BoardColumnDraft[] {
  const board = asRecord(value);
  const columns = Array.isArray(board.columns) ? board.columns : [];
  return columns
    .map((entry) => {
      const record = asRecord(entry);
      return {
        id: readString(record.id),
        label: readString(record.label),
        description: readString(record.description),
        is_blocked: Boolean(record.is_blocked),
        is_terminal: Boolean(record.is_terminal),
      };
    })
    .filter(
      (entry) =>
        entry.id ||
        entry.label ||
        entry.description ||
        entry.is_blocked ||
        entry.is_terminal,
    );
}

function readStages(value: unknown): StageDraft[] {
  return Array.isArray(value)
    ? value
        .map((entry) => {
          const record = asRecord(entry);
          return {
            name: readString(record.name),
            goal: readString(record.goal),
            involves: readStringArray(record.involves).join(', '),
            human_gate: Boolean(record.human_gate),
            guidance: readString(record.guidance),
          };
        })
        .filter(
          (entry) =>
            entry.name ||
            entry.goal ||
            entry.involves ||
            entry.human_gate ||
            entry.guidance,
        )
    : [];
}

function readParameters(value: unknown): ParameterDraft[] {
  return Array.isArray(value)
    ? value
        .map((entry) => {
          const record = asRecord(entry);
          return {
            name: readString(record.name ?? record.key ?? record.id),
            type: readString(record.type) || 'string',
            required: Boolean(record.required),
            secret: Boolean(record.secret),
            category: readString(record.category),
            maps_to: readString(record.maps_to),
            description: readString(record.description),
            default_value: stringifyDefaultValue(
              record.default ?? record.default_value ?? record.value,
            ),
          };
        })
        .filter(
          (entry) =>
            entry.name ||
            entry.category ||
            entry.maps_to ||
            entry.description ||
            entry.default_value ||
            entry.required ||
            entry.secret,
        )
    : [];
}

function readOrchestrator(value: unknown): PlaybookAuthoringDraft['orchestrator'] {
  const record = asRecord(value);
  return {
    instructions: readString(record.instructions),
    tools: readStringArray(record.tools),
    check_interval: readString(record.check_interval),
    stale_threshold: readString(record.stale_threshold),
    max_rework_iterations: readNumberish(record.max_rework_iterations),
    max_active_tasks: readNumberish(record.max_active_tasks),
    max_active_tasks_per_work_item: readNumberish(record.max_active_tasks_per_work_item),
    allow_parallel_work_items:
      typeof record.allow_parallel_work_items === 'boolean'
        ? record.allow_parallel_work_items
        : createDefaultAuthoringDraft('continuous').orchestrator.allow_parallel_work_items,
  };
}

export function summarizePlaybookAuthoringDraft(
  draft: PlaybookAuthoringDraft,
): PlaybookAuthoringSummary {
  const roles = draft.roles.map((entry) => entry.value.trim()).filter(Boolean);
  const columns = draft.columns.filter(
    (column) =>
      column.id.trim().length > 0 ||
      column.label.trim().length > 0 ||
      column.description.trim().length > 0 ||
      column.is_blocked ||
      column.is_terminal,
  );
  const stages = draft.stages.filter(
    (stage) =>
      stage.name.trim().length > 0 ||
      stage.goal.trim().length > 0 ||
      stage.involves.trim().length > 0 ||
      stage.guidance.trim().length > 0 ||
      stage.human_gate,
  );
  const parameters = draft.parameters.filter(
    (parameter) =>
      parameter.name.trim().length > 0 ||
      parameter.category.trim().length > 0 ||
      parameter.maps_to.trim().length > 0 ||
      parameter.description.trim().length > 0 ||
      parameter.default_value.trim().length > 0 ||
      parameter.required ||
      parameter.secret,
  );
  const runtimeOverrideCount = [
    draft.runtime.orchestrator_pool.enabled !== false,
    draft.runtime.specialist_pool.enabled !== false,
  ].filter(Boolean).length;

  return {
    roleCount: roles.length,
    columnCount: columns.length,
    blockedColumnCount: columns.filter((column) => column.is_blocked).length,
    terminalColumnCount: columns.filter((column) => column.is_terminal).length,
    stageCount: stages.length,
    gatedStageCount: stages.filter((stage) => stage.human_gate).length,
    parameterCount: parameters.length,
    requiredParameterCount: parameters.filter((parameter) => parameter.required).length,
    secretParameterCount: parameters.filter((parameter) => parameter.secret).length,
    runtimeOverrideCount,
  };
}

function readRuntime(value: unknown): PlaybookAuthoringDraft['runtime'] {
  const record = asRecord(value);
  return {
    shared: readRuntimePool(record, true),
    orchestrator_pool: readRuntimePool(record.orchestrator_pool, false),
    specialist_pool: readRuntimePool(record.specialist_pool, false),
  };
}

function readRuntimePool(value: unknown, enabledByDefault: boolean): RuntimePoolDraft {
  const record = asRecord(value);
  return {
    enabled:
      enabledByDefault || Object.keys(record).length > 0
        ? true
        : false,
    pool_mode: readString(record.pool_mode),
    max_runtimes: readNumberish(record.max_runtimes),
    priority: readNumberish(record.priority),
    idle_timeout_seconds: readNumberish(record.idle_timeout_seconds),
    grace_period_seconds: readNumberish(record.grace_period_seconds),
    image: readString(record.image),
    pull_policy: readString(record.pull_policy),
    cpu: readString(record.cpu),
    memory: readString(record.memory),
  };
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readNumberish(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === 'string' ? value : '';
}

function stringifyDefaultValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}
