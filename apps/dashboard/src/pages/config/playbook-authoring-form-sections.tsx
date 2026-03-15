import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp, Minus, Plus, Trash2 } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Switch } from '../../components/ui/switch.js';
import { Textarea } from '../../components/ui/textarea.js';
import {
  createEmptyApprovalRuleDraft,
  createEmptyCheckpointDraft,
  createEmptyColumnDraft,
  createEmptyHandoffRuleDraft,
  createEmptyParameterDraft,
  createEmptyReviewRuleDraft,
  createEmptyRoleDraft,
  validateBoardColumnsDraft,
  validateParameterDrafts,
  validateRoleDrafts,
  validateWorkflowRulesDraft,
  type BoardColumnDraft,
  type ParameterDraft,
  type PlaybookAuthoringDraft,
  type RuntimePoolDraft,
} from './playbook-authoring-support.js';
import { canMoveDraftItem, moveDraftItem } from './playbook-authoring-reorder.js';
import {
  LabeledField,
  RuntimePoolFields,
  SectionCard,
  ToggleField,
} from './playbook-authoring-form-fields.js';
import { TypedParameterValueControl } from './playbook-authoring-structured-controls.js';

interface SectionProps {
  draft: PlaybookAuthoringDraft;
  onChange(updater: (current: PlaybookAuthoringDraft) => PlaybookAuthoringDraft): void;
}

const ROLE_SELECT_UNSET = '__unset__';
const ENTRY_COLUMN_UNSET = '__unset__';
const PARAMETER_TYPE_OPTIONS = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'object', label: 'Object' },
  { value: 'array', label: 'Array' },
] as const;

const PARAMETER_CATEGORY_OPTIONS = [
  { value: '', label: 'No mapping category' },
  { value: 'input', label: 'Input' },
  { value: 'repository', label: 'Repository' },
  { value: 'credential', label: 'Credential' },
] as const;

const PROJECT_MAPPING_OPTIONS = [
  '',
  'project.repository_url',
  'project.settings.default_branch',
  'project.credentials.git_token',
];

export function ProcessInstructionsSection(props: SectionProps): JSX.Element {
  return (
    <SectionCard
      id="playbook-process-instructions"
      title="Process Instructions"
      description="Tell the orchestrator how this workflow must run, what must be reviewed, and when humans must approve."
    >
      <div className="space-y-2">
        <Textarea
          value={props.draft.process_instructions}
          onChange={(event) =>
            props.onChange((current) => ({
              ...current,
              process_instructions: event.target.value,
            }))
          }
          className="min-h-[180px]"
          placeholder="Example: Product manager clarifies the objective. Developer implements. Reviewer must review every code change. Rejected review returns to developer with findings. Human approval is required before completion."
        />
        <p className="text-sm text-muted">
          This is operator-authored guidance for the orchestrator. Mandatory rules below are still
          enforced separately by the platform.
        </p>
      </div>
    </SectionCard>
  );
}

export function TeamRolesSection(
  props: SectionProps & { availableRoleNames?: string[] },
): JSX.Element {
  const availableRoleNames = props.availableRoleNames ?? [];
  const roleValidation = validateRoleDrafts(props.draft.roles, availableRoleNames);

  return (
    <SectionCard
      id="playbook-team-roles"
      title="Team Roles"
      description="Choose the shared role definitions that may participate in this workflow."
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Playbooks use active role definitions from the shared role catalog.
        </p>
        {props.draft.roles.map((role, index) => (
          <div key={`role-${index}`} className="grid gap-1.5">
            <div className="flex items-start gap-2">
              <Select
                value={resolveRoleSelectionValue(role.value, availableRoleNames, index)}
                onValueChange={(value) =>
                  props.onChange((current) => ({
                    ...current,
                    roles: current.roles.map((entry, entryIndex) =>
                      entryIndex === index
                        ? { value: value === ROLE_SELECT_UNSET ? '' : value }
                        : entry,
                    ),
                  }))
                }
              >
                <SelectTrigger className="min-w-0 flex-1">
                  <SelectValue placeholder="Select a role definition" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROLE_SELECT_UNSET}>Select a role definition</SelectItem>
                  {availableRoleNames.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                  {!availableRoleNames.includes(role.value) && role.value.trim().length > 0 ? (
                    <SelectItem value={resolveMissingRoleValue(index)}>
                      Unknown role: {role.value}
                    </SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 whitespace-nowrap px-3"
                onClick={() =>
                  props.onChange((current) => ({
                    ...current,
                    roles:
                      current.roles.length === 1
                        ? current.roles
                        : current.roles.filter((_, entryIndex) => entryIndex !== index),
                  }))
                }
              >
                <Minus className="h-4 w-4" />
                Remove Role
              </Button>
            </div>
            {roleValidation.roleErrors[index] ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                {roleValidation.roleErrors[index]}
              </p>
            ) : null}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={availableRoleNames.length === 0}
          onClick={() =>
            props.onChange((current) => ({
              ...current,
              roles: [...current.roles, createEmptyRoleDraft()],
            }))
          }
        >
          <Plus className="h-4 w-4" />
          Add Role
        </Button>
      </div>
    </SectionCard>
  );
}

export function ReviewRulesSection(
  props: SectionProps & { availableRoleNames?: string[] },
): JSX.Element {
  const availableRoleNames = normalizedRoleOptions(props.availableRoleNames ?? []);
  const ruleValidation = validateWorkflowRulesDraft(props.draft);

  return (
    <SectionCard
      id="playbook-review-rules"
      title="Review Rules"
      description="Use explicit review rules for mandatory review paths instead of hoping the orchestrator infers them."
    >
      <div className="space-y-4">
        {props.draft.review_rules.map((rule, index) => (
          <InlineRuleRow
            key={`review-rule-${index}`}
            fieldsClassName="md:grid-cols-2 xl:grid-cols-3"
            error={ruleValidation.reviewRuleErrors[index]}
            actions={
              <InlineRuleActions
                required={rule.required}
                onRequiredChange={(checked) =>
                  props.onChange((current) => ({
                    ...current,
                    review_rules: current.review_rules.map((entry, entryIndex) =>
                      entryIndex === index ? { ...entry, required: checked } : entry,
                    ),
                  }))
                }
                onMoveEarlier={
                  canMoveDraftItem(index, props.draft.review_rules.length, 'earlier')
                    ? () =>
                        props.onChange((current) => ({
                          ...current,
                          review_rules: moveDraftItem(current.review_rules, index, 'earlier'),
                        }))
                    : undefined
                }
                onMoveLater={
                  canMoveDraftItem(index, props.draft.review_rules.length, 'later')
                    ? () =>
                        props.onChange((current) => ({
                          ...current,
                          review_rules: moveDraftItem(current.review_rules, index, 'later'),
                        }))
                    : undefined
                }
                onRemove={() =>
                  props.onChange((current) => ({
                    ...current,
                    review_rules: current.review_rules.filter(
                      (_, entryIndex) => entryIndex !== index,
                    ),
                  }))
                }
              />
            }
          >
            <RoleSelectField
              label="From"
              value={rule.from_role}
              availableRoleNames={availableRoleNames}
              inline
              className="min-w-0"
              triggerClassName="min-w-0"
              onValueChange={(value) =>
                updateReviewRule(props.onChange, index, 'from_role', value)
              }
            />
            <RoleSelectField
              label="Reviewer"
              value={rule.reviewed_by}
              availableRoleNames={availableRoleNames}
              inline
              className="min-w-0"
              triggerClassName="min-w-0"
              onValueChange={(value) =>
                updateReviewRule(props.onChange, index, 'reviewed_by', value)
              }
            />
            <RoleSelectField
              label="Reject to"
              value={rule.reject_role}
              availableRoleNames={availableRoleNames}
              placeholder="Optional rework role"
              allowUnset
              inline
              className="min-w-0"
              triggerClassName="min-w-0"
              onValueChange={(value) =>
                updateReviewRule(props.onChange, index, 'reject_role', value)
              }
            />
          </InlineRuleRow>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            props.onChange((current) => ({
              ...current,
              review_rules: [...current.review_rules, createEmptyReviewRuleDraft()],
            }))
          }
        >
          <Plus className="h-4 w-4" />
          Add Review Rule
        </Button>
      </div>
    </SectionCard>
  );
}

export function ApprovalRulesSection(props: SectionProps): JSX.Element {
  const checkpoints = props.draft.checkpoints
    .map((entry) => entry.name.trim())
    .filter(Boolean);
  const ruleValidation = validateWorkflowRulesDraft(props.draft);

  return (
    <SectionCard
      id="playbook-approval-rules"
      title="Approval Rules"
      description="Use human approvals only where the workflow truly needs an explicit operator decision."
    >
      <div className="space-y-4">
        {props.draft.approval_rules.map((rule, index) => (
          <InlineRuleRow
            key={`approval-rule-${index}`}
            fieldsClassName="md:grid-cols-2"
            error={ruleValidation.approvalRuleErrors[index]}
            actions={
              <InlineRuleActions
                required={rule.required}
                onRequiredChange={(checked) =>
                  props.onChange((current) => ({
                    ...current,
                    approval_rules: current.approval_rules.map((entry, entryIndex) =>
                      entryIndex === index ? { ...entry, required: checked } : entry,
                    ),
                  }))
                }
                onMoveEarlier={
                  canMoveDraftItem(index, props.draft.approval_rules.length, 'earlier')
                    ? () =>
                        props.onChange((current) => ({
                          ...current,
                          approval_rules: moveDraftItem(current.approval_rules, index, 'earlier'),
                        }))
                    : undefined
                }
                onMoveLater={
                  canMoveDraftItem(index, props.draft.approval_rules.length, 'later')
                    ? () =>
                        props.onChange((current) => ({
                          ...current,
                          approval_rules: moveDraftItem(current.approval_rules, index, 'later'),
                        }))
                    : undefined
                }
                onRemove={() =>
                  props.onChange((current) => ({
                    ...current,
                    approval_rules: current.approval_rules.filter(
                      (_, entryIndex) => entryIndex !== index,
                    ),
                  }))
                }
              />
            }
          >
            <InlineRuleField label="When" className="min-w-0">
              <Select
                value={rule.on}
                onValueChange={(value) =>
                  props.onChange((current) => ({
                    ...current,
                    approval_rules: current.approval_rules.map((entry, entryIndex) =>
                      entryIndex === index
                        ? {
                            ...entry,
                            on: value as 'checkpoint' | 'completion',
                            checkpoint: value === 'completion' ? '' : entry.checkpoint,
                          }
                        : entry,
                    ),
                  }))
                }
              >
                <SelectTrigger className="min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="checkpoint">At a checkpoint</SelectItem>
                  <SelectItem value="completion">Before completion</SelectItem>
                </SelectContent>
              </Select>
            </InlineRuleField>
            {rule.on === 'checkpoint' ? (
              <InlineRuleField label="Checkpoint" className="min-w-0">
                <Select
                  value={rule.checkpoint || ENTRY_COLUMN_UNSET}
                  onValueChange={(value) =>
                    props.onChange((current) => ({
                      ...current,
                      approval_rules: current.approval_rules.map((entry, entryIndex) =>
                        entryIndex === index
                          ? {
                              ...entry,
                              checkpoint: value === ENTRY_COLUMN_UNSET ? '' : value,
                            }
                          : entry,
                      ),
                    }))
                  }
                >
                  <SelectTrigger className="min-w-0">
                    <SelectValue placeholder="Select checkpoint" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ENTRY_COLUMN_UNSET}>Select checkpoint</SelectItem>
                    {checkpoints.map((checkpoint) => (
                      <SelectItem key={checkpoint} value={checkpoint}>
                        {checkpoint}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </InlineRuleField>
            ) : (
              <InlineRuleField label="Checkpoint" className="min-w-0">
                <div className="flex min-h-9 items-center rounded-md border border-border/70 bg-muted/20 px-3 text-xs text-muted">
                  Before completion
                </div>
              </InlineRuleField>
            )}
          </InlineRuleRow>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            props.onChange((current) => ({
              ...current,
              approval_rules: [...current.approval_rules, createEmptyApprovalRuleDraft()],
            }))
          }
        >
          <Plus className="h-4 w-4" />
          Add Approval Rule
        </Button>
      </div>
    </SectionCard>
  );
}

export function HandoffRulesSection(
  props: SectionProps & { availableRoleNames?: string[] },
): JSX.Element {
  const availableRoleNames = normalizedRoleOptions(props.availableRoleNames ?? []);
  const ruleValidation = validateWorkflowRulesDraft(props.draft);

  return (
    <SectionCard
      id="playbook-handoff-rules"
      title="Handoff Rules"
      description="Declare the required role-to-role transitions so the next specialist always receives the right predecessor context. Completed task handoffs are stored on the task and surfaced back into work-item continuity."
    >
      <div className="space-y-4">
        {props.draft.handoff_rules.map((rule, index) => (
          <InlineRuleRow
            key={`handoff-rule-${index}`}
            fieldsClassName="md:grid-cols-2"
            error={ruleValidation.handoffRuleErrors[index]}
            actions={
              <InlineRuleActions
                required={rule.required}
                onRequiredChange={(checked) =>
                  props.onChange((current) => ({
                    ...current,
                    handoff_rules: current.handoff_rules.map((entry, entryIndex) =>
                      entryIndex === index ? { ...entry, required: checked } : entry,
                    ),
                  }))
                }
                onMoveEarlier={
                  canMoveDraftItem(index, props.draft.handoff_rules.length, 'earlier')
                    ? () =>
                        props.onChange((current) => ({
                          ...current,
                          handoff_rules: moveDraftItem(current.handoff_rules, index, 'earlier'),
                        }))
                    : undefined
                }
                onMoveLater={
                  canMoveDraftItem(index, props.draft.handoff_rules.length, 'later')
                    ? () =>
                        props.onChange((current) => ({
                          ...current,
                          handoff_rules: moveDraftItem(current.handoff_rules, index, 'later'),
                        }))
                    : undefined
                }
                onRemove={() =>
                  props.onChange((current) => ({
                    ...current,
                    handoff_rules: current.handoff_rules.filter(
                      (_, entryIndex) => entryIndex !== index,
                    ),
                  }))
                }
              />
            }
          >
            <RoleSelectField
              label="From"
              value={rule.from_role}
              availableRoleNames={availableRoleNames}
              inline
              className="min-w-0"
              triggerClassName="min-w-0"
              onValueChange={(value) =>
                updateHandoffRule(props.onChange, index, 'from_role', value)
              }
            />
            <RoleSelectField
              label="To"
              value={rule.to_role}
              availableRoleNames={availableRoleNames}
              inline
              className="min-w-0"
              triggerClassName="min-w-0"
              onValueChange={(value) =>
                updateHandoffRule(props.onChange, index, 'to_role', value)
              }
            />
          </InlineRuleRow>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            props.onChange((current) => ({
              ...current,
              handoff_rules: [...current.handoff_rules, createEmptyHandoffRuleDraft()],
            }))
          }
        >
          <Plus className="h-4 w-4" />
          Add Handoff Rule
        </Button>
      </div>
    </SectionCard>
  );
}

export function WorkflowCheckpointsSection(props: SectionProps): JSX.Element {
  const ruleValidation = validateWorkflowRulesDraft(props.draft);

  return (
    <SectionCard
      id="playbook-workflow-checkpoints"
      title="Workflow Checkpoints"
      description="Checkpoints are lightweight milestones. Keep them sparse and meaningful."
    >
      <div className="space-y-4">
        {props.draft.checkpoints.map((checkpoint, index) => (
          <RuleCard
            key={`checkpoint-${index}`}
            title={`Checkpoint ${index + 1}`}
            onMoveEarlier={
              canMoveDraftItem(index, props.draft.checkpoints.length, 'earlier')
                ? () =>
                    props.onChange((current) => ({
                      ...current,
                      checkpoints: moveDraftItem(current.checkpoints, index, 'earlier'),
                    }))
                : undefined
            }
            onMoveLater={
              canMoveDraftItem(index, props.draft.checkpoints.length, 'later')
                ? () =>
                    props.onChange((current) => ({
                      ...current,
                      checkpoints: moveDraftItem(current.checkpoints, index, 'later'),
                    }))
                : undefined
            }
            onRemove={() =>
              props.onChange((current) => ({
                ...current,
                checkpoints: current.checkpoints.filter((_, entryIndex) => entryIndex !== index),
              }))
            }
          >
            <div className="grid gap-3 md:grid-cols-2">
              <LabeledField label="Checkpoint name">
                <Input
                  value={checkpoint.name}
                  onChange={(event) =>
                    updateCheckpoint(props.onChange, index, 'name', event.target.value)
                  }
                />
              </LabeledField>
              <ToggleField
                label="Human gate"
                checked={checkpoint.human_gate}
                onCheckedChange={(checked) =>
                  props.onChange((current) => ({
                    ...current,
                    checkpoints: current.checkpoints.map((entry, entryIndex) =>
                      entryIndex === index ? { ...entry, human_gate: checked } : entry,
                    ),
                  }))
                }
              />
              <LabeledField label="Goal" className="md:col-span-2">
                <Textarea
                  value={checkpoint.goal}
                  onChange={(event) =>
                    updateCheckpoint(props.onChange, index, 'goal', event.target.value)
                  }
                  className="min-h-[92px]"
                />
              </LabeledField>
              <LabeledField label="Entry criteria" className="md:col-span-2">
                <Textarea
                  value={checkpoint.entry_criteria}
                  onChange={(event) =>
                    updateCheckpoint(props.onChange, index, 'entry_criteria', event.target.value)
                  }
                  className="min-h-[92px]"
                />
              </LabeledField>
            </div>
            {ruleValidation.checkpointErrors[index]?.name ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                {ruleValidation.checkpointErrors[index]?.name}
              </p>
            ) : null}
            {ruleValidation.checkpointErrors[index]?.goal ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                {ruleValidation.checkpointErrors[index]?.goal}
              </p>
            ) : null}
          </RuleCard>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            props.onChange((current) => ({
              ...current,
              checkpoints: [...current.checkpoints, createEmptyCheckpointDraft()],
            }))
          }
        >
          <Plus className="h-4 w-4" />
          Add Checkpoint
        </Button>
      </div>
    </SectionCard>
  );
}

export function BoardColumnsSection(props: SectionProps): JSX.Element {
  const boardColumnValidation = validateBoardColumnsDraft(
    props.draft.columns,
    props.draft.entry_column_id,
  );

  return (
    <SectionCard
      id="playbook-board-columns"
      title="Board Override"
      description="Most playbooks should keep the standard board. Override it only when the workflow truly needs custom lanes."
    >
      <div className="space-y-4">
        <LabeledField label="Default intake column">
          <div className="space-y-1">
            <Select
              value={resolveBoardEntryColumnValue(props.draft)}
              onValueChange={(value) =>
                props.onChange((current) => ({
                  ...current,
                  entry_column_id: value === ENTRY_COLUMN_UNSET ? '' : value,
                }))
              }
            >
              <SelectTrigger
                aria-invalid={boardColumnValidation.entryColumnError ? true : undefined}
              >
                <SelectValue placeholder="Select the intake column" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ENTRY_COLUMN_UNSET}>Select the intake column</SelectItem>
                {buildEntryColumnOptions(props.draft.columns).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted">
              Automation and manual intake land here unless a work item explicitly targets another
              column.
            </p>
          </div>
        </LabeledField>
        {props.draft.columns.map((column, index) => (
          <RuleCard
            key={`column-${index}`}
            title={`Column ${index + 1}`}
            onMoveEarlier={
              canMoveDraftItem(index, props.draft.columns.length, 'earlier')
                ? () =>
                    props.onChange((current) => ({
                      ...current,
                      columns: moveDraftItem(current.columns, index, 'earlier'),
                    }))
                : undefined
            }
            onMoveLater={
              canMoveDraftItem(index, props.draft.columns.length, 'later')
                ? () =>
                    props.onChange((current) => ({
                      ...current,
                      columns: moveDraftItem(current.columns, index, 'later'),
                    }))
                : undefined
            }
            onRemove={() =>
              props.onChange((current) => ({
                ...current,
                columns:
                  current.columns.length === 1
                    ? current.columns
                    : current.columns.filter((_, entryIndex) => entryIndex !== index),
              }))
            }
          >
            <div className="grid gap-3 md:grid-cols-2">
              <LabeledField label="Column ID">
                <Input
                  value={column.id}
                  onChange={(event) =>
                    updateColumn(props.onChange, index, 'id', event.target.value)
                  }
                />
              </LabeledField>
              <LabeledField label="Label">
                <Input
                  value={column.label}
                  onChange={(event) =>
                    updateColumn(props.onChange, index, 'label', event.target.value)
                  }
                />
              </LabeledField>
              <LabeledField label="Description" className="md:col-span-2">
                <Textarea
                  value={column.description}
                  onChange={(event) =>
                    updateColumn(props.onChange, index, 'description', event.target.value)
                  }
                  className="min-h-[88px]"
                />
              </LabeledField>
              <ToggleField
                label="Blocked lane"
                checked={column.is_blocked}
                onCheckedChange={(checked) =>
                  updateColumnBoolean(props.onChange, index, 'is_blocked', checked)
                }
              />
              <ToggleField
                label="Terminal lane"
                checked={column.is_terminal}
                onCheckedChange={(checked) =>
                  updateColumnBoolean(props.onChange, index, 'is_terminal', checked)
                }
              />
            </div>
            {boardColumnValidation.columnErrors[index]?.id ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                {boardColumnValidation.columnErrors[index]?.id}
              </p>
            ) : null}
            {boardColumnValidation.columnErrors[index]?.label ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                {boardColumnValidation.columnErrors[index]?.label}
              </p>
            ) : null}
          </RuleCard>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            props.onChange((current) => ({
              ...current,
              columns: [...current.columns, createEmptyColumnDraft()],
            }))
          }
        >
          <Plus className="h-4 w-4" />
          Add Column
        </Button>
      </div>
    </SectionCard>
  );
}

export function OrchestratorSection(props: SectionProps): JSX.Element {
  return (
    <SectionCard
      id="playbook-orchestrator-policy"
      title="Orchestration Policy"
      description="Use these controls only when the default cadence or concurrency is not enough."
    >
      <div className="grid gap-3 md:grid-cols-2">
        <LabeledField label="Check interval">
          <Input
            value={props.draft.orchestrator.check_interval}
            onChange={(event) =>
              updateOrchestratorField(props.onChange, 'check_interval', event.target.value)
            }
          />
        </LabeledField>
        <LabeledField label="Stale threshold">
          <Input
            value={props.draft.orchestrator.stale_threshold}
            onChange={(event) =>
              updateOrchestratorField(props.onChange, 'stale_threshold', event.target.value)
            }
          />
        </LabeledField>
        <LabeledField label="Max rework iterations">
          <Input
            inputMode="numeric"
            value={props.draft.orchestrator.max_rework_iterations}
            onChange={(event) =>
              updateOrchestratorField(
                props.onChange,
                'max_rework_iterations',
                event.target.value,
              )
            }
          />
        </LabeledField>
        <LabeledField label="Max active tasks">
          <Input
            inputMode="numeric"
            value={props.draft.orchestrator.max_active_tasks}
            onChange={(event) =>
              updateOrchestratorField(props.onChange, 'max_active_tasks', event.target.value)
            }
          />
        </LabeledField>
        <LabeledField label="Max active tasks per work item">
          <Input
            inputMode="numeric"
            value={props.draft.orchestrator.max_active_tasks_per_work_item}
            onChange={(event) =>
              updateOrchestratorField(
                props.onChange,
                'max_active_tasks_per_work_item',
                event.target.value,
              )
            }
          />
          <p className="text-xs text-muted">
            In an SDLC workflow, a value of 2 lets one feature run implementation and QA in
            parallel without monopolizing all capacity.
          </p>
        </LabeledField>
        <ToggleField
          label="Allow parallel work items"
          checked={props.draft.orchestrator.allow_parallel_work_items}
          onCheckedChange={(checked) =>
            props.onChange((current) => ({
              ...current,
              orchestrator: { ...current.orchestrator, allow_parallel_work_items: checked },
            }))
          }
        />
      </div>
    </SectionCard>
  );
}

export function LaunchInputsSection(
  props: SectionProps & {
    onParameterIssueChange(index: number, kind: 'default' | 'mapping', issue?: string): void;
  },
): JSX.Element {
  const parameterValidation = validateParameterDrafts(props.draft.parameters);

  return (
    <SectionCard
      id="playbook-launch-inputs"
      title="Launch Inputs"
      description="Define only the operator inputs the workflow actually needs at launch."
    >
      <div className="space-y-4">
        {props.draft.parameters.map((parameter, index) => (
          <RuleCard
            key={`parameter-${index}`}
            title={`Input ${index + 1}`}
            onMoveEarlier={
              canMoveDraftItem(index, props.draft.parameters.length, 'earlier')
                ? () =>
                    props.onChange((current) => ({
                      ...current,
                      parameters: moveDraftItem(current.parameters, index, 'earlier'),
                    }))
                : undefined
            }
            onMoveLater={
              canMoveDraftItem(index, props.draft.parameters.length, 'later')
                ? () =>
                    props.onChange((current) => ({
                      ...current,
                      parameters: moveDraftItem(current.parameters, index, 'later'),
                    }))
                : undefined
            }
            onRemove={() =>
              props.onChange((current) => ({
                ...current,
                parameters: current.parameters.filter((_, entryIndex) => entryIndex !== index),
              }))
            }
          >
            <ParameterFields
              parameter={parameter}
              onChange={(field, value) => updateParameter(props.onChange, index, field, value)}
              onBooleanChange={(field, value) =>
                updateParameterBoolean(props.onChange, index, field, value)
              }
              onParameterIssueChange={props.onParameterIssueChange}
              index={index}
            />
            {parameterValidation.parameterErrors[index]?.category ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                {parameterValidation.parameterErrors[index]?.category}
              </p>
            ) : null}
            {parameterValidation.parameterErrors[index]?.secret ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                {parameterValidation.parameterErrors[index]?.secret}
              </p>
            ) : null}
          </RuleCard>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            props.onChange((current) => ({
              ...current,
              parameters: [...current.parameters, createEmptyParameterDraft()],
            }))
          }
        >
          <Plus className="h-4 w-4" />
          Add Input
        </Button>
      </div>
    </SectionCard>
  );
}

export function RuntimeSection(props: SectionProps): JSX.Element {
  return (
    <SectionCard
      id="playbook-runtime-section"
      title="Specialist Runtime Override"
      description="This is an uncommon advanced override. Leave it collapsed unless this workflow truly needs different specialist runtime posture."
    >
      <details>
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          Specialist runtime override
        </summary>
        <div className="mt-4">
          <RuntimePoolFields
            title="Specialist runtime override"
            pool={props.draft.runtime.specialist_pool}
            canDisable
            onEnabledChange={(enabled) =>
              props.onChange((current) => ({
                ...current,
                runtime: {
                  specialist_pool: { ...current.runtime.specialist_pool, enabled },
                },
              }))
            }
            onChange={(field, value) =>
              props.onChange((current) => ({
                ...current,
                runtime: {
                  specialist_pool: {
                    ...current.runtime.specialist_pool,
                    [field]: value,
                  } as RuntimePoolDraft,
                },
              }))
            }
          />
        </div>
      </details>
    </SectionCard>
  );
}

export function WorkflowRulesSection(
  props: SectionProps & { availableRoleNames?: string[] },
): JSX.Element {
  return (
    <div className="space-y-4">
      <ReviewRulesSection {...props} />
      <ApprovalRulesSection draft={props.draft} onChange={props.onChange} />
      <HandoffRulesSection {...props} />
      <WorkflowCheckpointsSection draft={props.draft} onChange={props.onChange} />
    </div>
  );
}

export function AdvancedWorkflowSection(props: SectionProps): JSX.Element {
  return (
    <div className="space-y-4">
      <BoardColumnsSection draft={props.draft} onChange={props.onChange} />
      <OrchestratorSection draft={props.draft} onChange={props.onChange} />
      <RuntimeSection draft={props.draft} onChange={props.onChange} />
    </div>
  );
}

function ParameterFields(props: {
  parameter: ParameterDraft;
  index: number;
  onChange(field: keyof Omit<ParameterDraft, 'required' | 'secret'>, value: string): void;
  onBooleanChange(field: 'required' | 'secret', value: boolean): void;
  onParameterIssueChange(index: number, kind: 'default' | 'mapping', issue?: string): void;
}): JSX.Element {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <LabeledField label="Name">
        <Input value={props.parameter.name} onChange={(event) => props.onChange('name', event.target.value)} />
      </LabeledField>
      <LabeledField label="Type">
        <Select
          value={props.parameter.type}
          onValueChange={(value) => props.onChange('type', value)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PARAMETER_TYPE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </LabeledField>
      <LabeledField label="Operator label">
        <Input value={props.parameter.label} onChange={(event) => props.onChange('label', event.target.value)} />
      </LabeledField>
      <LabeledField label="Project mapping">
        <Select
          value={props.parameter.maps_to || ENTRY_COLUMN_UNSET}
          onValueChange={(value) => {
            const nextValue = value === ENTRY_COLUMN_UNSET ? '' : value;
            props.onChange('maps_to', nextValue);
            props.onParameterIssueChange(props.index, 'mapping');
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Optional project mapping" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ENTRY_COLUMN_UNSET}>No project mapping</SelectItem>
            {PROJECT_MAPPING_OPTIONS.filter(Boolean).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </LabeledField>
      <LabeledField label="Category">
        <Select
          value={props.parameter.category || ENTRY_COLUMN_UNSET}
          onValueChange={(value) => props.onChange('category', value === ENTRY_COLUMN_UNSET ? '' : value)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PARAMETER_CATEGORY_OPTIONS.map((option) => (
              <SelectItem
                key={option.value || ENTRY_COLUMN_UNSET}
                value={option.value || ENTRY_COLUMN_UNSET}
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </LabeledField>
      <ToggleField
        label="Required"
        checked={props.parameter.required}
        onCheckedChange={(checked) => props.onBooleanChange('required', checked)}
      />
      <ToggleField
        label="Secret"
        checked={props.parameter.secret}
        onCheckedChange={(checked) => props.onBooleanChange('secret', checked)}
      />
      <LabeledField label="Help text" className="md:col-span-2">
        <Textarea
          value={props.parameter.help_text}
          onChange={(event) => props.onChange('help_text', event.target.value)}
          className="min-h-[84px]"
        />
      </LabeledField>
      <LabeledField label="Description" className="md:col-span-2">
        <Textarea
          value={props.parameter.description}
          onChange={(event) => props.onChange('description', event.target.value)}
          className="min-h-[84px]"
        />
      </LabeledField>
      <LabeledField label="Default value" className="md:col-span-2">
          <TypedParameterValueControl
            valueType={props.parameter.type}
            value={props.parameter.default_value}
            onValidationChange={(issue) =>
              props.onParameterIssueChange(props.index, 'default', issue)
            }
            onChange={(value) => {
              props.onChange('default_value', value);
            }}
          />
      </LabeledField>
    </div>
  );
}

function RoleSelectField(props: {
  label: string;
  value: string;
  availableRoleNames: string[];
  onValueChange(value: string): void;
  placeholder?: string;
  allowUnset?: boolean;
  inline?: boolean;
  className?: string;
  triggerClassName?: string;
}): JSX.Element {
  const control = (
    <Select
      value={props.value || ROLE_SELECT_UNSET}
      onValueChange={(value) =>
        props.onValueChange(value === ROLE_SELECT_UNSET ? '' : value)
      }
    >
      <SelectTrigger className={props.triggerClassName}>
        <SelectValue placeholder={props.placeholder ?? 'Select role'} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ROLE_SELECT_UNSET}>
          {props.allowUnset ? 'No role selected' : 'Select role'}
        </SelectItem>
        {props.availableRoleNames.map((name) => (
          <SelectItem key={name} value={name}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (props.inline) {
    return (
      <InlineRuleField label={props.label} className={props.className}>
        {control}
      </InlineRuleField>
    );
  }

  return (
    <LabeledField label={props.label} className={props.className}>
      {control}
    </LabeledField>
  );
}

function InlineRuleField(props: {
  label: string;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={`flex flex-col gap-1 lg:flex-row lg:items-center lg:gap-2 ${props.className ?? ''}`.trim()}
    >
      <span className="text-xs font-medium text-foreground lg:w-16 lg:shrink-0">
        {props.label}
      </span>
      <div className="min-w-0 flex-1">
        {props.children}
      </div>
    </div>
  );
}

function InlineRuleRow(props: {
  children: ReactNode;
  actions: ReactNode;
  error?: string;
  fieldsClassName?: string;
}): JSX.Element {
  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-background/40 p-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div
          className={`grid gap-3 ${props.fieldsClassName ?? ''} xl:flex xl:min-w-0 xl:flex-1 xl:items-center xl:gap-3 xl:[&>*]:min-w-0 xl:[&>*]:flex-1`.trim()}
        >
          {props.children}
        </div>
        <div className="xl:shrink-0">{props.actions}</div>
      </div>
      {props.error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{props.error}</p>
      ) : null}
    </div>
  );
}

function InlineRuleActions(props: {
  required: boolean;
  onRequiredChange(checked: boolean): void;
  onMoveEarlier?: () => void;
  onMoveLater?: () => void;
  onRemove?: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-nowrap items-center gap-1">
      <label className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/70 px-1.5 text-[11px] font-medium text-foreground">
        <Switch checked={props.required} onCheckedChange={props.onRequiredChange} />
        <span>Required</span>
      </label>
      {props.onMoveEarlier ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-7 w-7"
          aria-label="Move rule earlier"
          title="Move earlier"
          onClick={props.onMoveEarlier}
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
      ) : null}
      {props.onMoveLater ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-7 w-7"
          aria-label="Move rule later"
          title="Move later"
          onClick={props.onMoveLater}
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
      ) : null}
      {props.onRemove ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-7 w-7"
          aria-label="Remove rule"
          title="Remove rule"
          onClick={props.onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}

function RuleCard(props: {
  title: string;
  children: ReactNode;
  onMoveEarlier?: () => void;
  onMoveLater?: () => void;
  onRemove?: () => void;
}): JSX.Element {
  return (
    <div className="rounded-md border border-border/70 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">{props.title}</div>
        <div className="flex flex-wrap gap-2">
          {props.onMoveEarlier ? (
            <Button type="button" variant="outline" size="sm" onClick={props.onMoveEarlier}>
              Move Earlier
            </Button>
          ) : null}
          {props.onMoveLater ? (
            <Button type="button" variant="outline" size="sm" onClick={props.onMoveLater}>
              Move Later
            </Button>
          ) : null}
          {props.onRemove ? (
            <Button type="button" variant="outline" size="sm" onClick={props.onRemove}>
              <Minus className="h-4 w-4" />
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      <div className="space-y-3">{props.children}</div>
    </div>
  );
}

function updateCheckpoint(
  onChange: SectionProps['onChange'],
  index: number,
  field: 'name' | 'goal' | 'entry_criteria',
  value: string,
): void {
  onChange((current) => ({
    ...current,
    checkpoints: current.checkpoints.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ),
  }));
}

function updateReviewRule(
  onChange: SectionProps['onChange'],
  index: number,
  field: 'from_role' | 'reviewed_by' | 'reject_role',
  value: string,
): void {
  onChange((current) => ({
    ...current,
    review_rules: current.review_rules.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ),
  }));
}

function updateHandoffRule(
  onChange: SectionProps['onChange'],
  index: number,
  field: 'from_role' | 'to_role',
  value: string,
): void {
  onChange((current) => ({
    ...current,
    handoff_rules: current.handoff_rules.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ),
  }));
}

function updateColumn(
  onChange: SectionProps['onChange'],
  index: number,
  field: 'id' | 'label' | 'description',
  value: string,
): void {
  onChange((current) => ({
    ...current,
    columns: current.columns.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ),
  }));
}

function updateColumnBoolean(
  onChange: SectionProps['onChange'],
  index: number,
  field: 'is_blocked' | 'is_terminal',
  value: boolean,
): void {
  onChange((current) => ({
    ...current,
    columns: current.columns.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ),
  }));
}

function updateOrchestratorField(
  onChange: SectionProps['onChange'],
  field:
    | 'check_interval'
    | 'stale_threshold'
    | 'max_rework_iterations'
    | 'max_active_tasks'
    | 'max_active_tasks_per_work_item',
  value: string,
): void {
  onChange((current) => ({
    ...current,
    orchestrator: { ...current.orchestrator, [field]: value },
  }));
}

function updateParameter(
  onChange: SectionProps['onChange'],
  index: number,
  field: keyof Omit<ParameterDraft, 'required' | 'secret'>,
  value: string,
): void {
  onChange((current) => ({
    ...current,
    parameters: current.parameters.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ),
  }));
}

function updateParameterBoolean(
  onChange: SectionProps['onChange'],
  index: number,
  field: 'required' | 'secret',
  value: boolean,
): void {
  onChange((current) => ({
    ...current,
    parameters: current.parameters.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ),
  }));
}

function normalizedRoleOptions(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index)
    .sort((left, right) => left.localeCompare(right));
}

function resolveRoleSelectionValue(
  value: string,
  availableRoleNames: string[],
  index: number,
): string {
  if (!value.trim()) {
    return ROLE_SELECT_UNSET;
  }
  return availableRoleNames.includes(value) ? value : resolveMissingRoleValue(index);
}

function resolveMissingRoleValue(index: number): string {
  return `__missing_role_${index}__`;
}

function resolveBoardEntryColumnValue(draft: PlaybookAuthoringDraft): string {
  const current = draft.entry_column_id.trim();
  if (current && draft.columns.some((column) => column.id.trim() === current)) {
    return current;
  }
  return buildEntryColumnOptions(draft.columns)[0]?.value ?? ENTRY_COLUMN_UNSET;
}

function buildEntryColumnOptions(columns: BoardColumnDraft[]): Array<{ value: string; label: string }> {
  return columns
    .map((column) => ({
      value: column.id.trim(),
      label: column.label.trim() || column.id.trim(),
    }))
    .filter((option) => option.value.length > 0);
}
