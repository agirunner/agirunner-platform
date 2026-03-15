import { validateStructuredParameterDefaultValue } from './playbook-authoring-structured-controls.support.js';

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

export interface CheckpointDraft {
  name: string;
  goal: string;
  human_gate: boolean;
  entry_criteria: string;
}

export interface ReviewRuleDraft {
  from_role: string;
  reviewed_by: string;
  required: boolean;
  reject_role: string;
}

export interface ApprovalRuleDraft {
  on: 'checkpoint' | 'completion';
  checkpoint: string;
  required: boolean;
}

export interface HandoffRuleDraft {
  from_role: string;
  to_role: string;
  required: boolean;
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
  label: string;
  help_text: string;
  allowed_values: string;
}

export interface RuntimePoolDraft {
  enabled?: boolean;
  pool_mode: string;
  max_runtimes: string;
  priority: string;
  idle_timeout_seconds: string;
  grace_period_seconds: string;
  image: string;
  cpu: string;
  memory: string;
}

export interface PlaybookAuthoringDraft {
  process_instructions: string;
  roles: RoleDraft[];
  columns: BoardColumnDraft[];
  entry_column_id: string;
  checkpoints: CheckpointDraft[];
  review_rules: ReviewRuleDraft[];
  approval_rules: ApprovalRuleDraft[];
  handoff_rules: HandoffRuleDraft[];
  parameters: ParameterDraft[];
  orchestrator: {
    check_interval: string;
    stale_threshold: string;
    max_rework_iterations: string;
    max_active_tasks: string;
    max_active_tasks_per_work_item: string;
    allow_parallel_work_items: boolean;
  };
  runtime: {
    specialist_pool: RuntimePoolDraft;
  };
}

export interface PlaybookAuthoringSummary {
  hasProcessInstructions: boolean;
  roleCount: number;
  checkpointCount: number;
  gatedCheckpointCount: number;
  reviewRuleCount: number;
  requiredReviewRuleCount: number;
  approvalRuleCount: number;
  handoffRuleCount: number;
  columnCount: number;
  blockedColumnCount: number;
  terminalColumnCount: number;
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
  entryColumnError?: string;
  blockingIssues: string[];
  isValid: boolean;
}

export interface WorkflowRuleValidationResult {
  checkpointErrors: Array<{
    name?: string;
    goal?: string;
  }>;
  reviewRuleErrors: Array<string | undefined>;
  approvalRuleErrors: Array<string | undefined>;
  handoffRuleErrors: Array<string | undefined>;
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

export interface RoleDraftValidationResult {
  roleErrors: Array<string | undefined>;
  blockingIssues: string[];
  isValid: boolean;
}

export function createDefaultAuthoringDraft(lifecycle: PlaybookLifecycle): PlaybookAuthoringDraft {
  return {
    process_instructions:
      lifecycle === 'ongoing'
        ? 'Keep this workflow open, clarify new work as it arrives, require the expected reviews and handoffs, and always leave the next actor with a clear next step.'
        : 'Run this workflow as a bounded plan, move each work item through the required checkpoints, require the expected reviews and approvals, and finish only after the outcome is delivered.',
    roles: [{ value: 'developer' }],
    columns: [
      { id: 'inbox', label: 'Inbox', description: '', is_blocked: false, is_terminal: false },
      { id: 'active', label: 'Active', description: '', is_blocked: false, is_terminal: false },
      { id: 'review', label: 'In Review', description: '', is_blocked: false, is_terminal: false },
      { id: 'blocked', label: 'Blocked', description: '', is_blocked: true, is_terminal: false },
      { id: 'done', label: 'Done', description: '', is_blocked: false, is_terminal: true },
    ],
    entry_column_id: 'inbox',
    checkpoints:
      lifecycle === 'ongoing'
        ? [
            {
              name: 'triage',
              goal: 'Clarify new work and decide the next actor.',
              human_gate: false,
              entry_criteria: 'A work item has been created or updated.',
            },
            {
              name: 'delivery',
              goal: 'Deliver the requested outcome with the required review path.',
              human_gate: false,
              entry_criteria: 'The work item has enough context to begin execution.',
            },
          ]
        : [
            {
              name: 'plan',
              goal: 'Clarify the objective and produce an execution plan.',
              human_gate: false,
              entry_criteria: 'The workflow objective and source context are available.',
            },
            {
              name: 'deliver',
              goal: 'Deliver and approve the bounded outcome.',
              human_gate: true,
              entry_criteria: 'The plan is clear enough to execute.',
            },
          ],
    review_rules: [],
    approval_rules:
      lifecycle === 'planned'
        ? [{ on: 'completion', checkpoint: '', required: true }]
        : [],
    handoff_rules: [],
    parameters: [],
    orchestrator: {
      check_interval: '5m',
      stale_threshold: '30m',
      max_rework_iterations: '5',
      max_active_tasks: '4',
      max_active_tasks_per_work_item: '2',
      allow_parallel_work_items: true,
    },
    runtime: {
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

export function createEmptyCheckpointDraft(): CheckpointDraft {
  return { name: '', goal: '', human_gate: false, entry_criteria: '' };
}

export function createEmptyStageDraft(): CheckpointDraft {
  return createEmptyCheckpointDraft();
}

export function createEmptyReviewRuleDraft(): ReviewRuleDraft {
  return { from_role: '', reviewed_by: '', required: true, reject_role: '' };
}

export function createEmptyApprovalRuleDraft(): ApprovalRuleDraft {
  return { on: 'checkpoint', checkpoint: '', required: true };
}

export function createEmptyHandoffRuleDraft(): HandoffRuleDraft {
  return { from_role: '', to_role: '', required: true };
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
    label: '',
    help_text: '',
    allowed_values: '',
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
    cpu: '',
    memory: '',
  };
}

export function hydratePlaybookAuthoringDraft(
  lifecycle: PlaybookLifecycle,
  definition: unknown,
): PlaybookAuthoringDraft {
  const record = asRecord(definition);
  const fallback = createDefaultAuthoringDraft(lifecycle);
  const roles = readStringArray(record.roles).map((value) => ({ value }));
  const columns = readBoardColumns(record.board);
  const checkpoints = readCheckpoints(record);
  const reviewRules = readReviewRules(record.review_rules);
  const approvalRules = readApprovalRules(record.approval_rules);
  const handoffRules = readHandoffRules(record.handoff_rules);

  return {
    process_instructions:
      readString(record.process_instructions) ||
      readString(asRecord(record.orchestrator).instructions) ||
      fallback.process_instructions,
    roles: roles.length > 0 ? roles : fallback.roles,
    columns: columns.length > 0 ? columns : fallback.columns,
    entry_column_id: readBoardEntryColumnId(record.board, columns, fallback.entry_column_id),
    checkpoints: checkpoints.length > 0 ? checkpoints : fallback.checkpoints,
    review_rules: reviewRules.length > 0 ? reviewRules : fallback.review_rules,
    approval_rules: approvalRules.length > 0 ? approvalRules : fallback.approval_rules,
    handoff_rules: handoffRules.length > 0 ? handoffRules : fallback.handoff_rules,
    parameters: readParameters(record.parameters),
    orchestrator: { ...fallback.orchestrator, ...readOrchestrator(record.orchestrator) },
    runtime: {
      specialist_pool: {
        ...fallback.runtime.specialist_pool,
        ...readRuntime(record.runtime).specialist_pool,
      },
    },
  };
}

export function buildPlaybookDefinition(
  lifecycle: PlaybookLifecycle,
  draft: PlaybookAuthoringDraft,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const processInstructions = draft.process_instructions.trim();
  const roles = draft.roles.map((entry) => entry.value.trim()).filter(Boolean);
  const columns = buildBoardColumns(draft.columns);
  const checkpoints = buildCheckpoints(draft.checkpoints);
  const reviewRules = buildReviewRules(draft.review_rules);
  const approvalRules = buildApprovalRules(draft.approval_rules);
  const handoffRules = buildHandoffRules(draft.handoff_rules);
  const parameters = buildParameters(draft.parameters);
  const boardValidation = validateBoardColumnsDraft(draft.columns, draft.entry_column_id);
  const ruleValidation = validateWorkflowRulesDraft(draft);

  if (!processInstructions) {
    return { ok: false, error: 'Add process instructions for the orchestrator.' };
  }
  if (!boardValidation.isValid) {
    return { ok: false, error: boardValidation.blockingIssues[0] };
  }
  if (!ruleValidation.isValid) {
    return { ok: false, error: ruleValidation.blockingIssues[0] };
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
    .map((parameter) => validateStructuredParameterDefaultValue(parameter.type, parameter.default))
    .find((issue): issue is string => Boolean(issue));
  if (defaultValueIssue) {
    return { ok: false, error: defaultValueIssue };
  }

  const definition: Record<string, unknown> = {
    lifecycle,
    process_instructions: processInstructions,
    roles,
    board: {
      entry_column_id: resolveEntryColumnId(draft.entry_column_id, columns),
      columns: columns.map((column) =>
        compactRecord(column as unknown as Record<string, unknown>),
      ),
    },
    checkpoints: checkpoints.map((checkpoint) =>
      compactRecord(checkpoint as unknown as Record<string, unknown>),
    ),
  };

  if (reviewRules.length > 0) {
    definition.review_rules = reviewRules.map((rule) =>
      compactRecord(rule as unknown as Record<string, unknown>),
    );
  }
  if (approvalRules.length > 0) {
    definition.approval_rules = approvalRules.map((rule) =>
      compactRecord(rule as unknown as Record<string, unknown>),
    );
  }
  if (handoffRules.length > 0) {
    definition.handoff_rules = handoffRules.map((rule) =>
      compactRecord(rule as unknown as Record<string, unknown>),
    );
  }

  const orchestrator = compactRecord({
    check_interval: draft.orchestrator.check_interval.trim(),
    stale_threshold: draft.orchestrator.stale_threshold.trim(),
    max_rework_iterations: parseOptionalInt(draft.orchestrator.max_rework_iterations),
    max_active_tasks: parseOptionalInt(draft.orchestrator.max_active_tasks),
    max_active_tasks_per_work_item: parseOptionalInt(
      draft.orchestrator.max_active_tasks_per_work_item,
    ),
    allow_parallel_work_items: draft.orchestrator.allow_parallel_work_items,
  });
  if (Object.keys(orchestrator).length > 0) {
    definition.orchestrator = orchestrator;
  }

  const runtime = compactRecord({
    specialist_pool: buildRuntimePoolRecord(draft.runtime.specialist_pool),
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
  entryColumnId = '',
): BoardColumnValidationResult {
  if (columns.length === 0) {
    return {
      columnErrors: [],
      entryColumnError: undefined,
      blockingIssues: ['At least one board column is required.'],
      isValid: false,
    };
  }

  const duplicateIds = new Set(
    columns
      .map((column) => column.id.trim().toLowerCase())
      .filter((value, index, values) => value && values.indexOf(value) !== index),
  );

  const columnErrors = columns.map((column) => ({
    id: readBoardColumnIdError(column, duplicateIds),
    label: readBoardColumnLabelError(column),
  }));
  const entryColumnError = readEntryColumnError(columns, entryColumnId);
  const blockingIssues = Array.from(
    new Set(
      [
        ...columnErrors.flatMap((column) =>
          [column.id, column.label].filter((value): value is string => Boolean(value)),
        ),
        entryColumnError,
      ].filter((value): value is string => Boolean(value)),
    ),
  );

  return {
    columnErrors,
    entryColumnError,
    blockingIssues,
    isValid: blockingIssues.length === 0,
  };
}

export function validateWorkflowRulesDraft(
  draft: Pick<
    PlaybookAuthoringDraft,
    'roles' | 'checkpoints' | 'review_rules' | 'approval_rules' | 'handoff_rules'
  >,
): WorkflowRuleValidationResult {
  const roleNames = new Set(draft.roles.map((entry) => entry.value.trim()).filter(Boolean));
  const checkpointNames = new Set(
    draft.checkpoints.map((entry) => entry.name.trim()).filter(Boolean),
  );
  const duplicateCheckpointNames = new Set(
    draft.checkpoints
      .map((entry) => entry.name.trim().toLowerCase())
      .filter((value, index, values) => value && values.indexOf(value) !== index),
  );

  const checkpointErrors = draft.checkpoints.map((checkpoint) => ({
    name: readCheckpointNameError(checkpoint, duplicateCheckpointNames),
    goal: readCheckpointGoalError(checkpoint),
  }));
  const reviewRuleErrors = draft.review_rules.map((rule) => readReviewRuleError(rule, roleNames));
  const approvalRuleErrors = draft.approval_rules.map((rule) =>
    readApprovalRuleError(rule, checkpointNames),
  );
  const handoffRuleErrors = draft.handoff_rules.map((rule) => readHandoffRuleError(rule, roleNames));

  const blockingIssues = Array.from(
    new Set(
      [
        ...checkpointErrors.flatMap((entry) =>
          [entry.name, entry.goal].filter((value): value is string => Boolean(value)),
        ),
        ...reviewRuleErrors.filter((value): value is string => Boolean(value)),
        ...approvalRuleErrors.filter((value): value is string => Boolean(value)),
        ...handoffRuleErrors.filter((value): value is string => Boolean(value)),
      ],
    ),
  );

  return {
    checkpointErrors,
    reviewRuleErrors,
    approvalRuleErrors,
    handoffRuleErrors,
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

export function validateRoleDrafts(
  roles: RoleDraft[],
  availableRoleNames: string[],
): RoleDraftValidationResult {
  const available = new Set(availableRoleNames.map((value) => value.trim()).filter(Boolean));
  const roleErrors = roles.map((role) => {
    const name = role.value.trim();
    if (!name) {
      return undefined;
    }
    return available.has(name)
      ? undefined
      : 'Select an active role definition from the shared catalog.';
  });
  const blockingIssues = Array.from(new Set(roleErrors.filter(Boolean) as string[]));

  return {
    roleErrors,
    blockingIssues,
    isValid: blockingIssues.length === 0,
  };
}

export function summarizePlaybookAuthoringDraft(
  draft: PlaybookAuthoringDraft,
): PlaybookAuthoringSummary {
  const roles = draft.roles.map((entry) => entry.value.trim()).filter(Boolean);
  const checkpoints = buildCheckpoints(draft.checkpoints);
  const reviewRules = draft.review_rules.filter(hasReviewRuleValue);
  const approvalRules = draft.approval_rules.filter(hasApprovalRuleValue);
  const handoffRules = draft.handoff_rules.filter(hasHandoffRuleValue);
  const columns = buildBoardColumns(draft.columns);
  const parameters = buildParameters(draft.parameters);

  return {
    hasProcessInstructions: draft.process_instructions.trim().length > 0,
    roleCount: roles.length,
    checkpointCount: checkpoints.length,
    gatedCheckpointCount: checkpoints.filter((checkpoint) => checkpoint.human_gate).length,
    reviewRuleCount: reviewRules.length,
    requiredReviewRuleCount: reviewRules.filter((rule) => rule.required !== false).length,
    approvalRuleCount: approvalRules.length,
    handoffRuleCount: handoffRules.length,
    columnCount: columns.length,
    blockedColumnCount: columns.filter((column) => column.is_blocked).length,
    terminalColumnCount: columns.filter((column) => column.is_terminal).length,
    parameterCount: parameters.length,
    requiredParameterCount: parameters.filter((parameter) => parameter.required).length,
    secretParameterCount: parameters.filter((parameter) => parameter.secret).length,
    runtimeOverrideCount: draft.runtime.specialist_pool.enabled === false ? 0 : 1,
  };
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
    .filter(
      (column) =>
        column.id ||
        column.label ||
        column.description ||
        column.is_blocked ||
        column.is_terminal,
    );
}

function buildCheckpoints(checkpoints: CheckpointDraft[]): CheckpointDraft[] {
  return checkpoints
    .map((checkpoint) => ({
      name: checkpoint.name.trim(),
      goal: checkpoint.goal.trim(),
      human_gate: checkpoint.human_gate,
      entry_criteria: checkpoint.entry_criteria.trim(),
    }))
    .filter(
      (checkpoint) =>
        checkpoint.name ||
        checkpoint.goal ||
        checkpoint.human_gate ||
        checkpoint.entry_criteria,
    );
}

function buildReviewRules(reviewRules: ReviewRuleDraft[]) {
  return reviewRules
    .map((rule) => ({
      from_role: rule.from_role.trim(),
      reviewed_by: rule.reviewed_by.trim(),
      required: rule.required,
      on_reject:
        readReviewRejectRole(rule).length > 0
          ? { action: 'return_to_role' as const, role: readReviewRejectRole(rule) }
          : undefined,
    }))
    .filter(
      (rule) => rule.from_role || rule.reviewed_by || rule.required !== true || rule.on_reject,
    );
}

function buildApprovalRules(approvalRules: ApprovalRuleDraft[]) {
  return approvalRules
    .map((rule) => ({
      on: rule.on as 'checkpoint' | 'completion',
      checkpoint: rule.checkpoint.trim(),
      approved_by: 'human' as const,
      required: rule.required,
    }))
    .filter((rule) => rule.on === 'completion' || rule.checkpoint || rule.required !== true);
}

function buildHandoffRules(handoffRules: HandoffRuleDraft[]) {
  return handoffRules
    .map((rule) => ({
      from_role: rule.from_role.trim(),
      to_role: rule.to_role.trim(),
      required: rule.required,
    }))
    .filter((rule) => rule.from_role || rule.to_role || rule.required !== true);
}

function buildParameters(parameters: ParameterDraft[]) {
  return parameters
    .map((parameter) => ({
      name: parameter.name.trim(),
      type: parameter.type.trim() || 'string',
      required: parameter.required,
      secret: parameter.secret,
      category: parameter.category.trim(),
      maps_to: parameter.maps_to.trim(),
      description: parameter.description.trim(),
      default: parameter.default_value.trim(),
      label: parameter.label.trim(),
      help_text: parameter.help_text.trim(),
      allowed_values: parameter.allowed_values.trim(),
    }))
    .filter(
      (parameter) =>
        parameter.name ||
        parameter.category ||
        parameter.maps_to ||
        parameter.description ||
        parameter.default ||
        parameter.label ||
        parameter.help_text ||
        parameter.allowed_values ||
        parameter.required ||
        parameter.secret,
    );
}

function buildRuntimePoolRecord(pool: RuntimePoolDraft): Record<string, unknown> | undefined {
  if (pool.enabled === false) {
    return undefined;
  }
  const runtimePool = compactRecord({
    pool_mode: normalizePoolMode(pool.pool_mode),
    max_runtimes: parseOptionalInt(pool.max_runtimes),
    priority: parseOptionalInt(pool.priority),
    idle_timeout_seconds: parseOptionalInt(pool.idle_timeout_seconds),
    grace_period_seconds: parseOptionalInt(pool.grace_period_seconds),
    image: pool.image.trim(),
    cpu: pool.cpu.trim(),
    memory: pool.memory.trim(),
  });
  return Object.keys(runtimePool).length > 0 ? runtimePool : undefined;
}

function readEntryColumnError(columns: BoardColumnDraft[], entryColumnId: string): string | undefined {
  return resolveEntryColumnId(entryColumnId, columns)
    ? undefined
    : 'Choose a valid intake column from this board.';
}

function resolveEntryColumnId(entryColumnId: string, columns: Array<{ id: string }>): string | undefined {
  const trimmed = entryColumnId.trim();
  if (trimmed && columns.some((column) => column.id.trim() === trimmed)) {
    return trimmed;
  }
  return trimmed ? undefined : columns[0]?.id.trim() || undefined;
}

function readBoardEntryColumnId(
  value: unknown,
  columns: BoardColumnDraft[],
  fallbackEntryColumnId: string,
): string {
  const board = asRecord(value);
  const explicit = readString(board.entry_column_id);
  return (
    resolveEntryColumnId(explicit, columns) ??
    resolveEntryColumnId(fallbackEntryColumnId, columns) ??
    ''
  );
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
  return column.label.trim() ? undefined : 'Add a column label.';
}

function readCheckpointNameError(
  checkpoint: CheckpointDraft,
  duplicateNames: Set<string>,
): string | undefined {
  if (!hasCheckpointValue(checkpoint)) {
    return undefined;
  }
  const name = checkpoint.name.trim();
  if (!name) {
    return 'Add a checkpoint name.';
  }
  if (duplicateNames.has(name.toLowerCase())) {
    return 'Checkpoint names must be unique.';
  }
  return undefined;
}

function readCheckpointGoalError(checkpoint: CheckpointDraft): string | undefined {
  if (!hasCheckpointValue(checkpoint)) {
    return undefined;
  }
  return checkpoint.goal.trim() ? undefined : 'Add a checkpoint goal.';
}

function hasCheckpointValue(checkpoint: CheckpointDraft): boolean {
  return (
    checkpoint.name.trim().length > 0 ||
    checkpoint.goal.trim().length > 0 ||
    checkpoint.entry_criteria.trim().length > 0 ||
    checkpoint.human_gate
  );
}

function readReviewRuleError(rule: ReviewRuleDraft, roleNames: Set<string>): string | undefined {
  const rejectRole = readReviewRejectRole(rule);
  if (!hasReviewRuleValue(rule)) {
    return undefined;
  }
  if (!rule.from_role.trim() || !rule.reviewed_by.trim()) {
    return 'Review rules must define both the source role and the reviewer.';
  }
  if (!roleNames.has(rule.from_role.trim()) || !roleNames.has(rule.reviewed_by.trim())) {
    return 'Review rules must use roles selected in the team section.';
  }
  if (rejectRole && !roleNames.has(rejectRole)) {
    return 'Rejected review work must route back to a selected team role.';
  }
  return undefined;
}

function hasReviewRuleValue(rule: ReviewRuleDraft): boolean {
  return (
    rule.from_role.trim().length > 0 ||
    rule.reviewed_by.trim().length > 0 ||
    readReviewRejectRole(rule).length > 0 ||
    rule.required === false
  );
}

function readReviewRejectRole(rule: ReviewRuleDraft): string {
  return readString((rule as ReviewRuleDraft & { reject_role?: string }).reject_role).trim();
}

function readApprovalRuleError(
  rule: ApprovalRuleDraft,
  checkpointNames: Set<string>,
): string | undefined {
  if (!hasApprovalRuleValue(rule)) {
    return undefined;
  }
  if (rule.on === 'checkpoint' && !rule.checkpoint.trim()) {
    return 'Checkpoint approvals must target a checkpoint.';
  }
  if (rule.on === 'checkpoint' && !checkpointNames.has(rule.checkpoint.trim())) {
    return 'Checkpoint approvals must reference an existing checkpoint.';
  }
  return undefined;
}

function hasApprovalRuleValue(rule: ApprovalRuleDraft): boolean {
  return rule.on === 'completion' || rule.checkpoint.trim().length > 0 || rule.required === false;
}

function readHandoffRuleError(rule: HandoffRuleDraft, roleNames: Set<string>): string | undefined {
  if (!hasHandoffRuleValue(rule)) {
    return undefined;
  }
  if (!rule.from_role.trim() || !rule.to_role.trim()) {
    return 'Handoff rules must define both the source and destination roles.';
  }
  if (!roleNames.has(rule.from_role.trim()) || !roleNames.has(rule.to_role.trim())) {
    return 'Handoff rules must use roles selected in the team section.';
  }
  return undefined;
}

function hasHandoffRuleValue(rule: HandoffRuleDraft): boolean {
  return (
    rule.from_role.trim().length > 0 ||
    rule.to_role.trim().length > 0 ||
    rule.required === false
  );
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
    parameter.label.trim().length > 0 ||
    parameter.help_text.trim().length > 0 ||
    parameter.allowed_values.trim().length > 0 ||
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

function readCheckpoints(record: Record<string, unknown>): CheckpointDraft[] {
  const checkpoints = readCheckpointList(record.checkpoints);
  return checkpoints.length > 0 ? checkpoints : readCheckpointList(record.stages);
}

function readCheckpointList(value: unknown): CheckpointDraft[] {
  return Array.isArray(value)
    ? value
        .map((entry) => {
          const record = asRecord(entry);
          return {
            name: readString(record.name),
            goal: readString(record.goal),
            human_gate: Boolean(record.human_gate),
            entry_criteria: readString(record.entry_criteria),
          };
        })
        .filter(
          (entry) =>
            entry.name || entry.goal || entry.human_gate || entry.entry_criteria,
        )
    : [];
}

function readReviewRules(value: unknown): ReviewRuleDraft[] {
  return Array.isArray(value)
    ? value
        .map((entry) => {
          const record = asRecord(entry);
          const onReject = asRecord(record.on_reject);
          return {
            from_role: readString(record.from_role),
            reviewed_by: readString(record.reviewed_by),
            required: typeof record.required === 'boolean' ? record.required : true,
            reject_role:
              readString(record.reject_role) ||
              readString((record as { on_reject_role?: unknown }).on_reject_role) ||
              readString(onReject.role),
          };
        })
        .filter(hasReviewRuleValue)
    : [];
}

function readApprovalRules(value: unknown): ApprovalRuleDraft[] {
  return Array.isArray(value)
    ? value
        .map((entry) => {
          const record = asRecord(entry);
          return {
            on: (record.on === 'completion' ? 'completion' : 'checkpoint') as
              | 'checkpoint'
              | 'completion',
            checkpoint: readString(record.checkpoint),
            required: typeof record.required === 'boolean' ? record.required : true,
          };
        })
        .filter(hasApprovalRuleValue)
    : [];
}

function readHandoffRules(value: unknown): HandoffRuleDraft[] {
  return Array.isArray(value)
    ? value
        .map((entry) => {
          const record = asRecord(entry);
          return {
            from_role: readString(record.from_role),
            to_role: readString(record.to_role),
            required: typeof record.required === 'boolean' ? record.required : true,
          };
        })
        .filter(hasHandoffRuleValue)
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
            label: readString(record.label),
            help_text: readString(record.help_text),
            allowed_values: readString(record.allowed_values),
          };
        })
        .filter(
          (entry) =>
            entry.name ||
            entry.category ||
            entry.maps_to ||
            entry.description ||
            entry.default_value ||
            entry.label ||
            entry.help_text ||
            entry.allowed_values ||
            entry.required ||
            entry.secret,
        )
    : [];
}

function readOrchestrator(value: unknown): PlaybookAuthoringDraft['orchestrator'] {
  const record = asRecord(value);
  return {
    check_interval: readString(record.check_interval),
    stale_threshold: readString(record.stale_threshold),
    max_rework_iterations: readNumberish(record.max_rework_iterations),
    max_active_tasks: readNumberish(record.max_active_tasks),
    max_active_tasks_per_work_item: readNumberish(record.max_active_tasks_per_work_item),
    allow_parallel_work_items:
      typeof record.allow_parallel_work_items === 'boolean'
        ? record.allow_parallel_work_items
        : createDefaultAuthoringDraft('ongoing').orchestrator.allow_parallel_work_items,
  };
}

function readRuntime(value: unknown): PlaybookAuthoringDraft['runtime'] {
  const record = asRecord(value);
  return {
    specialist_pool: readRuntimePool(record.specialist_pool, false),
  };
}

function readRuntimePool(value: unknown, enabledByDefault: boolean): RuntimePoolDraft {
  const record = asRecord(value);
  return {
    enabled: enabledByDefault || Object.keys(record).length > 0 ? true : false,
    pool_mode: readString(record.pool_mode),
    max_runtimes: readNumberish(record.max_runtimes),
    priority: readNumberish(record.priority),
    idle_timeout_seconds: readNumberish(record.idle_timeout_seconds),
    grace_period_seconds: readNumberish(record.grace_period_seconds),
    image: readString(record.image),
    cpu: readString(record.cpu),
    memory: readString(record.memory),
  };
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
