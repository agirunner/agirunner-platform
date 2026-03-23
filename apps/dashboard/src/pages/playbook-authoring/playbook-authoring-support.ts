import { validateStructuredParameterDefaultValue } from './playbook-authoring-structured-controls.support.js';

export type PlaybookLifecycle = 'planned' | 'ongoing';
export type AssessmentOutcomeActionDraft =
  | ''
  | 'reopen_subject'
  | 'route_to_role'
  | 'block_subject'
  | 'escalate'
  | 'terminate_branch';
export type RuleMaterialityDraft = '' | 'material' | 'non_material';
export type RevisionRetentionDraft =
  | ''
  | 'invalidate_all'
  | 'retain_advisory_only'
  | 'retain_named_assessors'
  | 'retain_non_material_only';
export type BranchTerminationPolicyDraft =
  | 'stop_branch_only'
  | 'stop_branch_and_descendants'
  | 'stop_all_siblings';

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

export interface AssessmentRuleDraft {
  subject_role: string;
  assessed_by: string;
  checkpoint: string;
  required: boolean;
  materiality: RuleMaterialityDraft;
  assessment_retention: RevisionRetentionDraft;
  approval_retention: RevisionRetentionDraft;
  request_changes_action: 'reopen_subject' | 'route_to_role';
  request_changes_target: string;
  rejected_action: 'block_subject' | 'route_to_role' | 'terminate_branch';
  rejected_target: string;
  allow_blocked_decision: boolean;
  blocked_action: 'block_subject' | 'route_to_role' | 'escalate' | 'terminate_branch';
  blocked_target: string;
}

export interface ApprovalRuleDraft {
  on: 'checkpoint' | 'completion';
  checkpoint: string;
  required: boolean;
  materiality: RuleMaterialityDraft;
  assessment_retention: RevisionRetentionDraft;
  approval_retention: RevisionRetentionDraft;
  allow_blocked_decision: boolean;
  approval_before_assessment: boolean;
}

export interface BranchPolicyDraft {
  branch_key: string;
  termination_policy: BranchTerminationPolicyDraft;
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

export interface PlaybookAuthoringDraft {
  process_instructions: string;
  roles: RoleDraft[];
  columns: BoardColumnDraft[];
  entry_column_id: string;
  checkpoints: CheckpointDraft[];
  assessment_rules: AssessmentRuleDraft[];
  approval_rules: ApprovalRuleDraft[];
  branch_policies: BranchPolicyDraft[];
  handoff_rules: HandoffRuleDraft[];
  parameters: ParameterDraft[];
  orchestrator: {
    max_rework_iterations: string;
    max_iterations: string;
    llm_max_retries: string;
    max_active_tasks: string;
    max_active_tasks_per_work_item: string;
    allow_parallel_work_items: boolean;
  };
}

export interface PlaybookAuthoringSummary {
  hasProcessInstructions: boolean;
  roleCount: number;
  checkpointCount: number;
  gatedCheckpointCount: number;
  assessmentRuleCount: number;
  requiredAssessmentRuleCount: number;
  approvalRuleCount: number;
  branchPolicyCount: number;
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
  assessmentRuleErrors: Array<string | undefined>;
  approvalRuleErrors: Array<string | undefined>;
  branchPolicyErrors: Array<{
    branch_key?: string;
  }>;
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
        ? 'Keep this workflow open, clarify new work as it arrives, require the expected assessments and handoffs, and always leave the next actor with a clear next step.'
        : 'Run this workflow as a bounded plan, move each work item through the required checkpoints, require the expected assessments and approvals, and finish only after the outcome is delivered.',
    roles: [],
    columns: [
      { id: 'inbox', label: 'Inbox', description: '', is_blocked: false, is_terminal: false },
      { id: 'active', label: 'Active', description: '', is_blocked: false, is_terminal: false },
      { id: 'review', label: 'In Review', description: '', is_blocked: false, is_terminal: false },
      { id: 'blocked', label: 'Blocked', description: '', is_blocked: true, is_terminal: false },
      { id: 'done', label: 'Done', description: '', is_blocked: false, is_terminal: true },
    ],
    entry_column_id: 'inbox',
    checkpoints: [],
    assessment_rules: [],
    approval_rules: [],
    branch_policies: [],
    handoff_rules: [],
    parameters: [],
    orchestrator: {
      max_rework_iterations: '5',
      max_iterations: '',
      llm_max_retries: '',
      max_active_tasks: '4',
      max_active_tasks_per_work_item: '2',
      allow_parallel_work_items: true,
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

export function createEmptyAssessmentRuleDraft(): AssessmentRuleDraft {
  return {
    subject_role: '',
    assessed_by: '',
    checkpoint: '',
    required: true,
    materiality: '',
    assessment_retention: '',
    approval_retention: '',
    request_changes_action: 'reopen_subject',
    request_changes_target: '',
    rejected_action: 'block_subject',
    rejected_target: '',
    allow_blocked_decision: false,
    blocked_action: 'block_subject',
    blocked_target: '',
  };
}

export function createEmptyApprovalRuleDraft(): ApprovalRuleDraft {
  return {
    on: 'checkpoint',
    checkpoint: '',
    required: true,
    materiality: '',
    assessment_retention: '',
    approval_retention: '',
    allow_blocked_decision: false,
    approval_before_assessment: false,
  };
}

export function createEmptyBranchPolicyDraft(): BranchPolicyDraft {
  return {
    branch_key: '',
    termination_policy: 'stop_branch_only',
  };
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

export function hydratePlaybookAuthoringDraft(
  lifecycle: PlaybookLifecycle,
  definition: unknown,
): PlaybookAuthoringDraft {
  const record = asRecord(definition);
  const fallback = createDefaultAuthoringDraft(lifecycle);
  const roles = readStringArray(record.roles).map((value) => ({ value }));
  const columns = readBoardColumns(record.board);
  const checkpoints = readCheckpoints(record);
  const assessmentRules = readAssessmentRules(record.assessment_rules);
  const approvalRules = readApprovalRules(record.approval_rules);
  const branchPolicies = readBranchPolicies(record.branch_policies);
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
    assessment_rules: assessmentRules.length > 0 ? assessmentRules : fallback.assessment_rules,
    approval_rules: approvalRules.length > 0 ? approvalRules : fallback.approval_rules,
    branch_policies: branchPolicies.length > 0 ? branchPolicies : fallback.branch_policies,
    handoff_rules: handoffRules.length > 0 ? handoffRules : fallback.handoff_rules,
    parameters: readParameters(record.parameters),
    orchestrator: { ...fallback.orchestrator, ...readOrchestrator(record.orchestrator) },
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
  const assessmentRules = buildAssessmentRules(draft.assessment_rules);
  const approvalRules = buildApprovalRules(draft.approval_rules);
  const branchPolicies = buildBranchPolicies(draft.branch_policies);
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

  if (assessmentRules.length > 0) {
    definition.assessment_rules = assessmentRules.map((rule) =>
      compactRecord(rule as unknown as Record<string, unknown>),
    );
  }
  if (approvalRules.length > 0) {
    definition.approval_rules = approvalRules.map((rule) =>
      compactRecord(rule as unknown as Record<string, unknown>),
    );
  }
  if (branchPolicies.length > 0) {
    definition.branch_policies = branchPolicies.map((policy) =>
      compactRecord(policy as unknown as Record<string, unknown>),
    );
  }
  if (handoffRules.length > 0) {
    definition.handoff_rules = handoffRules.map((rule) =>
      compactRecord(rule as unknown as Record<string, unknown>),
    );
  }

  const orchestrator = compactRecord({
    max_rework_iterations: parseOptionalInt(draft.orchestrator.max_rework_iterations),
    max_iterations: parseOptionalInt(draft.orchestrator.max_iterations),
    llm_max_retries: parseOptionalInt(draft.orchestrator.llm_max_retries),
    max_active_tasks: parseOptionalInt(draft.orchestrator.max_active_tasks),
    max_active_tasks_per_work_item: parseOptionalInt(
      draft.orchestrator.max_active_tasks_per_work_item,
    ),
    allow_parallel_work_items: draft.orchestrator.allow_parallel_work_items,
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
    | 'roles'
    | 'checkpoints'
    | 'assessment_rules'
    | 'approval_rules'
    | 'branch_policies'
    | 'handoff_rules'
  >,
): WorkflowRuleValidationResult {
  const roleNames = new Set(draft.roles.map((entry) => entry.value.trim()).filter(Boolean));
  const checkpointNames = new Set(
    draft.checkpoints.map((entry) => entry.name.trim()).filter(Boolean),
  );
  const branchKeys = new Set(
    draft.branch_policies.map((entry) => entry.branch_key.trim()).filter(Boolean),
  );
  const duplicateBranchKeys = new Set(
    draft.branch_policies
      .map((entry) => entry.branch_key.trim().toLowerCase())
      .filter((value, index, values) => value && values.indexOf(value) !== index),
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
  const assessmentRuleErrors = draft.assessment_rules.map((rule) =>
    readAssessmentRuleError(rule, roleNames, checkpointNames, branchKeys)
  );
  const approvalRuleErrors = draft.approval_rules.map((rule) =>
    readApprovalRuleError(rule, checkpointNames),
  );
  const branchPolicyErrors = draft.branch_policies.map((policy) => ({
    branch_key: readBranchPolicyKeyError(policy, duplicateBranchKeys),
  }));
  const handoffRuleErrors = draft.handoff_rules.map((rule) => readHandoffRuleError(rule, roleNames));

  const blockingIssues = Array.from(
    new Set(
      [
        ...checkpointErrors.flatMap((entry) =>
          [entry.name, entry.goal].filter((value): value is string => Boolean(value)),
        ),
        ...assessmentRuleErrors.filter((value): value is string => Boolean(value)),
        ...approvalRuleErrors.filter((value): value is string => Boolean(value)),
        ...branchPolicyErrors.flatMap((entry) =>
          [entry.branch_key].filter((value): value is string => Boolean(value)),
        ),
        ...handoffRuleErrors.filter((value): value is string => Boolean(value)),
      ],
    ),
  );

  return {
    checkpointErrors,
    assessmentRuleErrors,
    approvalRuleErrors,
    branchPolicyErrors,
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
  const assessmentRules = draft.assessment_rules.filter(hasAssessmentRuleValue);
  const approvalRules = draft.approval_rules.filter(hasApprovalRuleValue);
  const branchPolicies = buildBranchPolicies(draft.branch_policies);
  const handoffRules = draft.handoff_rules.filter(hasHandoffRuleValue);
  const columns = buildBoardColumns(draft.columns);
  const parameters = buildParameters(draft.parameters);

  return {
    hasProcessInstructions: draft.process_instructions.trim().length > 0,
    roleCount: roles.length,
    checkpointCount: checkpoints.length,
    gatedCheckpointCount: checkpoints.filter((checkpoint) => checkpoint.human_gate).length,
    assessmentRuleCount: assessmentRules.length,
    requiredAssessmentRuleCount: assessmentRules.filter((rule) => rule.required !== false).length,
    approvalRuleCount: approvalRules.length,
    branchPolicyCount: branchPolicies.length,
    handoffRuleCount: handoffRules.length,
    columnCount: columns.length,
    blockedColumnCount: columns.filter((column) => column.is_blocked).length,
    terminalColumnCount: columns.filter((column) => column.is_terminal).length,
    parameterCount: parameters.length,
    requiredParameterCount: parameters.filter((parameter) => parameter.required).length,
    secretParameterCount: parameters.filter((parameter) => parameter.secret).length,
    runtimeOverrideCount: 0,
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

function buildAssessmentRules(assessmentRules: AssessmentRuleDraft[]) {
  return assessmentRules
    .map((rule) => {
      const subjectRole = readString(rule.subject_role).trim();
      const assessedBy = readString(rule.assessed_by).trim();
      const checkpoint = readString(rule.checkpoint).trim();
      const requestChangesTarget = readString(rule.request_changes_target).trim();
      const rejectedTarget = readString(rule.rejected_target).trim();
      const blockedTarget = readString(rule.blocked_target).trim();
      const decisionStates = rule.allow_blocked_decision
        ? ['approved', 'request_changes', 'rejected', 'blocked']
        : undefined;
      const revisionPolicy = compactRecord({
        assessment_retention: readString(rule.assessment_retention).trim() || undefined,
        approval_retention: readString(rule.approval_retention).trim() || undefined,
      });
      return {
        subject_role: subjectRole,
        assessed_by: assessedBy,
        checkpoint,
        required: rule.required,
        materiality: readString(rule.materiality).trim() || undefined,
        decision_states: decisionStates,
        outcome_actions: compactRecord({
          request_changes: buildOutcomeAction(
            resolveRequestChangesAction(rule.request_changes_action, requestChangesTarget),
            requestChangesTarget,
          ),
          rejected: buildOutcomeAction(
            resolveRejectedAction(rule.rejected_action, rejectedTarget),
            rejectedTarget,
          ),
          blocked: rule.allow_blocked_decision
            ? buildOutcomeAction(rule.blocked_action, blockedTarget)
            : undefined,
        }),
        revision_policy: Object.keys(revisionPolicy).length > 0 ? revisionPolicy : undefined,
      };
    })
    .filter(
      (rule) =>
        rule.subject_role ||
        rule.assessed_by ||
        rule.checkpoint ||
        rule.required !== true ||
        rule.materiality ||
        Boolean(rule.decision_states) ||
        Object.keys(rule.outcome_actions).length > 0 ||
        Boolean(rule.revision_policy),
    );
}

function resolveRequestChangesAction(
  action: AssessmentRuleDraft['request_changes_action'],
  role: string,
): AssessmentRuleDraft['request_changes_action'] {
  return role && action === 'reopen_subject' ? 'route_to_role' : action;
}

function resolveRejectedAction(
  action: AssessmentRuleDraft['rejected_action'],
  role: string,
): AssessmentRuleDraft['rejected_action'] {
  return role && action === 'block_subject' ? 'route_to_role' : action;
}

function buildOutcomeAction(
  action: AssessmentOutcomeActionDraft,
  role: string,
): { action: Exclude<AssessmentOutcomeActionDraft, ''>; role?: string } | undefined {
  if (!action) {
    return undefined;
  }
  if (action === 'route_to_role') {
    return compactRecord({
      action,
      role: role || undefined,
    }) as { action: 'route_to_role'; role?: string };
  }
  return { action };
}

function buildApprovalRules(approvalRules: ApprovalRuleDraft[]) {
  return approvalRules
    .map((rule) => {
      const checkpoint = rule.checkpoint.trim();
      const decisionStates = rule.allow_blocked_decision
        ? ['approved', 'request_changes', 'rejected', 'blocked']
        : undefined;
      const revisionPolicy = compactRecord({
        assessment_retention: readString(rule.assessment_retention).trim() || undefined,
        approval_retention: readString(rule.approval_retention).trim() || undefined,
      });
      const orderingPolicy = compactRecord({
        subject_boundary: rule.approval_before_assessment ? 'checkpoint' : undefined,
        approval_before_assessment: rule.approval_before_assessment || undefined,
      });
      return {
        on: rule.on as 'checkpoint' | 'completion',
        checkpoint,
        approved_by: 'human' as const,
        required: rule.required,
        materiality: readString(rule.materiality).trim() || undefined,
        decision_states: decisionStates,
        revision_policy: Object.keys(revisionPolicy).length > 0 ? revisionPolicy : undefined,
        ordering_policy: Object.keys(orderingPolicy).length > 0 ? orderingPolicy : undefined,
      };
    })
    .filter(
      (rule) =>
        rule.on === 'completion' ||
        rule.checkpoint ||
        rule.required !== true ||
        Boolean(rule.materiality) ||
        Boolean(rule.decision_states) ||
        Boolean(rule.revision_policy) ||
        Boolean(rule.ordering_policy),
    );
}

function buildBranchPolicies(branchPolicies: BranchPolicyDraft[]) {
  return branchPolicies
    .map((policy) => ({
      branch_key: policy.branch_key.trim(),
      termination_policy: policy.termination_policy,
    }))
    .filter((policy) => policy.branch_key);
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

function readAssessmentRuleError(
  rule: AssessmentRuleDraft,
  roleNames: Set<string>,
  checkpointNames: Set<string>,
  branchKeys: Set<string>,
): string | undefined {
  if (!hasAssessmentRuleValue(rule)) {
    return undefined;
  }
  const subjectRole = readString(rule.subject_role).trim();
  const assessedBy = readString(rule.assessed_by).trim();
  const checkpoint = readString(rule.checkpoint).trim();
  const requestChangesTarget = readString(rule.request_changes_target).trim();
  const rejectedTarget = readString(rule.rejected_target).trim();
  const blockedTarget = readString(rule.blocked_target).trim();
  if (!subjectRole || !assessedBy) {
    return 'Assessment rules must define both the subject role and the assessor role.';
  }
  if (!roleNames.has(subjectRole) || !roleNames.has(assessedBy)) {
    return 'Assessment rules must use roles selected in the team section.';
  }
  if (checkpoint && !checkpointNames.has(checkpoint)) {
    return 'Assessment rules must reference an existing checkpoint when one is selected.';
  }
  if (rule.request_changes_action === 'route_to_role' && !requestChangesTarget) {
    return 'Requested changes must route to a selected team role when route_to_role is used.';
  }
  if (requestChangesTarget && !roleNames.has(requestChangesTarget)) {
    return 'Requested changes must route to a selected team role when a role target is set.';
  }
  if (rule.rejected_action === 'route_to_role' && !rejectedTarget) {
    return 'Rejected work must route to a selected team role when route_to_role is used.';
  }
  if (rejectedTarget && !roleNames.has(rejectedTarget)) {
    return 'Rejected work must route to a selected team role when a role target is set.';
  }
  if (rule.allow_blocked_decision && rule.blocked_action === 'route_to_role' && !blockedTarget) {
    return 'Blocked decisions must route to a selected team role when route_to_role is used.';
  }
  if (blockedTarget && !roleNames.has(blockedTarget)) {
    return 'Blocked decisions must route to a selected team role when a role target is set.';
  }
  if (usesTerminateBranch(rule) && branchKeys.size === 0) {
    return 'Terminate branch actions require at least one branch policy.';
  }
  return undefined;
}

function hasAssessmentRuleValue(rule: AssessmentRuleDraft): boolean {
  return (
    readString(rule.subject_role).trim().length > 0 ||
    readString(rule.assessed_by).trim().length > 0 ||
    readString(rule.checkpoint).trim().length > 0 ||
    readString(rule.materiality).trim().length > 0 ||
    readString(rule.assessment_retention).trim().length > 0 ||
    readString(rule.approval_retention).trim().length > 0 ||
    rule.request_changes_action !== 'reopen_subject' ||
    readString(rule.request_changes_target).trim().length > 0 ||
    rule.rejected_action !== 'block_subject' ||
    readString(rule.rejected_target).trim().length > 0 ||
    rule.allow_blocked_decision ||
    rule.blocked_action !== 'block_subject' ||
    readString(rule.blocked_target).trim().length > 0 ||
    rule.required === false
  );
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
  if (rule.approval_before_assessment && rule.on !== 'checkpoint') {
    return 'Approval-before-assessment only applies to checkpoint approvals.';
  }
  return undefined;
}

function hasApprovalRuleValue(rule: ApprovalRuleDraft): boolean {
  return (
    rule.on === 'completion' ||
    rule.checkpoint.trim().length > 0 ||
    readString(rule.materiality).trim().length > 0 ||
    readString(rule.assessment_retention).trim().length > 0 ||
    readString(rule.approval_retention).trim().length > 0 ||
    rule.allow_blocked_decision ||
    rule.approval_before_assessment ||
    rule.required === false
  );
}

function readBranchPolicyKeyError(
  policy: BranchPolicyDraft,
  duplicateKeys: Set<string>,
): string | undefined {
  if (!hasBranchPolicyValue(policy)) {
    return undefined;
  }
  const branchKey = policy.branch_key.trim();
  if (!branchKey) {
    return 'Add a branch key.';
  }
  if (duplicateKeys.has(branchKey.toLowerCase())) {
    return 'Branch policy keys must be unique.';
  }
  return undefined;
}

function hasBranchPolicyValue(policy: BranchPolicyDraft): boolean {
  return policy.branch_key.trim().length > 0;
}

function usesTerminateBranch(rule: AssessmentRuleDraft): boolean {
  return rule.rejected_action === 'terminate_branch' || rule.blocked_action === 'terminate_branch';
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

  if (mapsTo === 'workspace.credentials.git_token') {
    if (!isSecret) {
      errors.secret = 'Git token mappings must be marked secret.';
    }
    if (category !== 'credential') {
      errors.category = 'Git token mappings should use the Credential category.';
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

function readAssessmentRules(value: unknown): AssessmentRuleDraft[] {
  return Array.isArray(value)
    ? value
        .map((entry) => {
          const record = asRecord(entry);
          const decisionStates = Array.isArray(record.decision_states)
            ? record.decision_states.filter((state): state is string => typeof state === 'string')
            : [];
          const outcomeActions = asRecord(record.outcome_actions);
          const requestChanges = asRecord(outcomeActions.request_changes);
          const rejected = asRecord(outcomeActions.rejected);
          const blocked = asRecord(outcomeActions.blocked);
          const revisionPolicy = asRecord(record.revision_policy);
          return {
            subject_role: readString(record.subject_role),
            assessed_by: readString(record.assessed_by),
            checkpoint: readString(record.checkpoint),
            required: typeof record.required === 'boolean' ? record.required : true,
            materiality: readString(record.materiality) as RuleMaterialityDraft,
            assessment_retention:
              readString(revisionPolicy.assessment_retention) as RevisionRetentionDraft,
            approval_retention:
              readString(revisionPolicy.approval_retention) as RevisionRetentionDraft,
            request_changes_action:
              (readString(requestChanges.action) as AssessmentRuleDraft['request_changes_action']) ||
              (readString(requestChanges.role) ? 'route_to_role' : 'reopen_subject'),
            request_changes_target:
              readString((record as { request_changes_target?: unknown }).request_changes_target) ||
              readString(requestChanges.role),
            rejected_action:
              (readString(rejected.action) as AssessmentRuleDraft['rejected_action']) ||
              (readString(rejected.role) ? 'route_to_role' : 'block_subject'),
            rejected_target:
              readString((record as { rejected_target?: unknown }).rejected_target) ||
              readString(rejected.role),
            allow_blocked_decision:
              decisionStates.includes('blocked') || readString(blocked.action).length > 0,
            blocked_action:
              (readString(blocked.action) as AssessmentRuleDraft['blocked_action']) ||
              'block_subject',
            blocked_target: readString(blocked.role),
          };
        })
        .filter(hasAssessmentRuleValue)
    : [];
}

function readApprovalRules(value: unknown): ApprovalRuleDraft[] {
  return Array.isArray(value)
    ? value
        .map((entry) => {
          const record = asRecord(entry);
          const decisionStates = Array.isArray(record.decision_states)
            ? record.decision_states.filter((state): state is string => typeof state === 'string')
            : [];
          const revisionPolicy = asRecord(record.revision_policy);
          const orderingPolicy = asRecord(record.ordering_policy);
          return {
            on: (record.on === 'completion' ? 'completion' : 'checkpoint') as
              | 'checkpoint'
              | 'completion',
            checkpoint: readString(record.checkpoint),
            required: typeof record.required === 'boolean' ? record.required : true,
            materiality: readString(record.materiality) as RuleMaterialityDraft,
            assessment_retention:
              readString(revisionPolicy.assessment_retention) as RevisionRetentionDraft,
            approval_retention:
              readString(revisionPolicy.approval_retention) as RevisionRetentionDraft,
            allow_blocked_decision: decisionStates.includes('blocked'),
            approval_before_assessment:
              orderingPolicy.approval_before_assessment === true,
          };
        })
        .filter(hasApprovalRuleValue)
    : [];
}

function readBranchPolicies(value: unknown): BranchPolicyDraft[] {
  return Array.isArray(value)
    ? value
        .map((entry) => {
          const record = asRecord(entry);
          return {
            branch_key: readString(record.branch_key),
            termination_policy:
              (readString(record.termination_policy) as BranchTerminationPolicyDraft) ||
              'stop_branch_only',
          };
        })
        .filter(hasBranchPolicyValue)
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
    max_rework_iterations: readNumberish(record.max_rework_iterations),
    max_iterations: readNumberish(record.max_iterations),
    llm_max_retries: readNumberish(record.llm_max_retries),
    max_active_tasks: readNumberish(record.max_active_tasks),
    max_active_tasks_per_work_item: readNumberish(record.max_active_tasks_per_work_item),
    allow_parallel_work_items:
      typeof record.allow_parallel_work_items === 'boolean'
        ? record.allow_parallel_work_items
        : createDefaultAuthoringDraft('ongoing').orchestrator.allow_parallel_work_items,
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
