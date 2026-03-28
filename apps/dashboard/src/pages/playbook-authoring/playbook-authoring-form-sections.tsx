import { ChevronDown, ChevronUp, Minus, Plus } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import {
  createEmptyColumnDraft,
  createEmptyParameterDraft,
  createEmptyRoleDraft,
  createEmptyStageDraft,
  normalizeParameterSlug,
  validateBoardColumnsDraft,
  validateParameterDrafts,
  validateRoleDrafts,
  validateWorkflowRulesDraft,
  type BoardColumnDraft,
  type ParameterDraft,
  type PlaybookAuthoringDraft,
  type StageDraft,
} from './playbook-authoring-support.js';
import { canMoveDraftItem, moveDraftItem } from './playbook-authoring-reorder.js';
import { LabeledField, SectionCard, ToggleField } from './playbook-authoring-form-fields.js';

interface SectionProps {
  draft: PlaybookAuthoringDraft;
  showValidationErrors?: boolean;
  onChange(updater: (current: PlaybookAuthoringDraft) => PlaybookAuthoringDraft): void;
}

const ROLE_SELECT_UNSET = '__unset__';
const ENTRY_COLUMN_UNSET = '__unset__';
const ORCHESTRATION_POLICY_UNSET = '__orchestration_policy_default__';

export function ProcessInstructionsSection(props: SectionProps): JSX.Element {
  return (
    <SectionCard
      id="playbook-process-instructions"
      title="Process Instructions"
      description="Define the best-intent guide for this workflow: mandatory outcomes, preferred steps, real blockers, acceptable fallback paths, and the evidence the orchestrator must leave behind when it drives the work to closure."
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
          className="min-h-[220px]"
          placeholder="Example: Mandatory outcomes: ship a validated release packet and close the workflow with any residual risks recorded. Preferred steps: the architect clarifies scope, the developer implements in the delivery stage, a reviewer performs a substantive release review, and the orchestrator requests human approval once the release packet is ready. If a preferred step stalls or fails, the orchestrator must still drive the workflow to closure, record waived steps or unresolved advisory items, and explain the final judgement call."
        />
        <p className="max-w-full overflow-x-auto whitespace-nowrap text-sm text-muted">
          This guidance is the workflow contract: write it as a process guide that spells out mandatory outcomes, preferred steps, acceptable fallback paths, true blockers that require intervention, and any callouts or residual risks the orchestrator must record when the happy path does not land perfectly.
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
      title="Specialists"
      description="Choose the active specialist definitions for this workflow."
    >
      <div className="space-y-3">
        {props.showValidationErrors && roleValidation.selectionIssue ? (
          <p className="text-xs text-red-600 dark:text-red-400">{roleValidation.selectionIssue}</p>
        ) : null}
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
                  <SelectValue placeholder="Select a specialist" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROLE_SELECT_UNSET}>Select a specialist</SelectItem>
                  {availableRoleNames.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                  {!availableRoleNames.includes(role.value) && role.value.trim() ? (
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
                Remove Specialist
              </Button>
            </div>
            {props.showValidationErrors && roleValidation.roleErrors[index] ? (
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
          Add specialist
        </Button>
      </div>
    </SectionCard>
  );
}

export function WorkflowStagesSection(props: SectionProps): JSX.Element {
  const stageValidation = validateWorkflowRulesDraft(props.draft);
  return (
    <SectionCard
      id="playbook-workflow-stages"
      title="Workflow Stages"
      description="Define the structured milestones for this workflow. The process instructions tell the orchestrator what should happen inside each stage, what must finish there, and what can be waived or rerouted when reality does not match the ideal path."
    >
      <div className="space-y-4">
        {props.draft.stages.map((stage, index) => (
          <div key={`stage-${index}`} className="rounded-xl border border-border/70 bg-card/60 p-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)] lg:items-stretch">
              <div className="grid gap-3">
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Stage name</span>
                  <Input
                    value={stage.name}
                    onChange={(event) => updateStage(props, index, 'name', event.target.value)}
                  />
                  <ValidationText
                    issue={props.showValidationErrors ? stageValidation.stageErrors[index]?.name : undefined}
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Stage goal</span>
                  <Input
                    value={stage.goal}
                    onChange={(event) => updateStage(props, index, 'goal', event.target.value)}
                  />
                  <ValidationText
                    issue={props.showValidationErrors ? stageValidation.stageErrors[index]?.goal : undefined}
                  />
                </label>
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Stage guidance</span>
                  <Textarea
                    value={stage.guidance}
                    onChange={(event) => updateStage(props, index, 'guidance', event.target.value)}
                    className="min-h-[110px] lg:h-full"
                    placeholder="Optional stage-specific guidance for the orchestrator."
                  />
                </label>
                <div className="flex items-center gap-2 lg:pt-7">
                  <IconButton
                    icon={<ChevronUp className="h-4 w-4" />}
                    onClick={moveHandler(props, 'stages', index, 'earlier')}
                  />
                  <IconButton
                    icon={<ChevronDown className="h-4 w-4" />}
                    onClick={moveHandler(props, 'stages', index, 'later')}
                  />
                  <IconButton
                    icon={<Minus className="h-4 w-4" />}
                    onClick={() =>
                      props.onChange((current) => ({
                        ...current,
                        stages: current.stages.filter((_, entryIndex) => entryIndex !== index),
                      }))
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
        {props.showValidationErrors
        && stageValidation.blockingIssues.length > 0
        && props.draft.stages.length === 0 ? (
          <p className="text-xs text-red-600 dark:text-red-400">
            {stageValidation.blockingIssues[0]}
          </p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            props.onChange((current) => ({
              ...current,
              stages: [...current.stages, createEmptyStageDraft()],
            }))
          }
        >
          <Plus className="h-4 w-4" />
          Add Stage
        </Button>
      </div>
    </SectionCard>
  );
}

export function LaunchInputsSection(props: SectionProps): JSX.Element {
  const parameterValidation = validateParameterDrafts(props.draft.parameters);
  return (
    <SectionCard
      id="playbook-launch-inputs"
      title="Launch Inputs"
      description="Each launch input declares one workflow goal that operators can provide when the workflow starts."
    >
      <div className="space-y-4">
        {props.draft.parameters.map((parameter, index) => (
          <div
            key={`parameter-${index}`}
            className="grid gap-3 rounded-xl border border-border/70 bg-card/60 p-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_auto_auto] lg:items-start"
          >
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Slug</span>
              <Input
                value={parameter.slug}
                onChange={(event) => updateParameter(props, index, 'slug', event.target.value)}
              />
              <ValidationText
                issue={
                  props.showValidationErrors
                    ? parameterValidation.parameterErrors[index]?.slug
                    : undefined
                }
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Title</span>
              <Input
                value={parameter.title}
                onChange={(event) => updateParameterTitle(props, index, event.target.value)}
              />
              <ValidationText
                issue={
                  props.showValidationErrors
                    ? parameterValidation.parameterErrors[index]?.title
                    : undefined
                }
              />
            </label>
            <div className="flex items-start lg:min-w-[7rem] lg:pt-7">
              <ToggleField
                label="Required"
                checked={parameter.required}
                onCheckedChange={(checked) => updateParameterBoolean(props, index, 'required', checked)}
              />
            </div>
            <div className="flex items-start gap-2 lg:min-w-[8rem] lg:pt-7">
              <IconButton
                icon={<ChevronUp className="h-4 w-4" />}
                onClick={moveHandler(props, 'parameters', index, 'earlier')}
              />
              <IconButton
                icon={<ChevronDown className="h-4 w-4" />}
                onClick={moveHandler(props, 'parameters', index, 'later')}
              />
              <IconButton
                icon={<Minus className="h-4 w-4" />}
                onClick={() =>
                  props.onChange((current) => ({
                    ...current,
                    parameters: current.parameters.filter((_, entryIndex) => entryIndex !== index),
                  }))
                }
              />
            </div>
          </div>
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

export function AdvancedWorkflowSection(props: SectionProps): JSX.Element {
  return (
    <div className="space-y-4">
      <BoardColumnsSection draft={props.draft} onChange={props.onChange} />
      <OrchestratorSection draft={props.draft} onChange={props.onChange} />
    </div>
  );
}

function BoardColumnsSection(props: SectionProps): JSX.Element {
  const boardValidation = validateBoardColumnsDraft(props.draft.columns, props.draft.entry_column_id);
  const columnOptions = buildBoardColumnSelectOptions(props.draft.columns);
  const intakeValue = resolveEntryColumnSelectionValue(props.draft.columns, props.draft.entry_column_id);
  const blockedValue = resolveSemanticColumnSelectionValue(props.draft.columns, 'is_blocked');
  const terminalValue = resolveSemanticColumnSelectionValue(props.draft.columns, 'is_terminal');
  const intakeOptions = columnOptions.filter(
    (option) => option.value === intakeValue || (option.value !== blockedValue && option.value !== terminalValue),
  );
  const blockedOptions = columnOptions.filter(
    (option) => option.value === blockedValue || (option.value !== intakeValue && option.value !== terminalValue),
  );
  const terminalOptions = columnOptions.filter(
    (option) => option.value === terminalValue || (option.value !== intakeValue && option.value !== blockedValue),
  );
  return (
    <SectionCard
      id="playbook-board-columns"
      title="Board Columns"
      description="Keep the board simple. Most playbooks should keep the standard intake, active, review, blocked, and done lanes."
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="grid gap-1.5">
            <LabeledField label="Intake lane">
              <Select
                value={intakeValue}
                onValueChange={(value) => updateEntryColumnSelection(props, value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose the intake lane" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ENTRY_COLUMN_UNSET}>Choose the intake lane</SelectItem>
                  {intakeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </LabeledField>
            <ValidationText
              issue={props.showValidationErrors ? boardValidation.entryColumnError : undefined}
            />
          </div>
          <div className="grid gap-1.5">
            <LabeledField label="Blocked lane">
              <Select
                value={blockedValue}
                onValueChange={(value) => updateSemanticColumnSelection(props, 'is_blocked', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose the blocked lane" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ENTRY_COLUMN_UNSET}>Choose the blocked lane</SelectItem>
                  {blockedOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </LabeledField>
            <ValidationText
              issue={props.showValidationErrors ? boardValidation.blockedColumnError : undefined}
            />
          </div>
          <div className="grid gap-1.5">
            <LabeledField label="Terminal lane">
              <Select
                value={terminalValue}
                onValueChange={(value) => updateSemanticColumnSelection(props, 'is_terminal', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose the terminal lane" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ENTRY_COLUMN_UNSET}>Choose the terminal lane</SelectItem>
                  {terminalOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </LabeledField>
            <ValidationText
              issue={props.showValidationErrors ? boardValidation.terminalColumnError : undefined}
            />
          </div>
        </div>
        {props.draft.columns.map((column, index) => (
          <div key={`column-${index}`} className="rounded-xl border border-border/70 bg-card/60 p-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
              <LabeledField label="Column id">
                <Input
                  value={column.id}
                  onChange={(event) => updateColumn(props, index, 'id', event.target.value)}
                />
              </LabeledField>
              <LabeledField label="Column label">
                <Input
                  value={column.label}
                  onChange={(event) => updateColumn(props, index, 'label', event.target.value)}
                />
              </LabeledField>
              <div className="flex items-center justify-end gap-2 md:pb-2">
                <IconButton
                  icon={<ChevronUp className="h-4 w-4" />}
                  onClick={moveHandler(props, 'columns', index, 'earlier')}
                />
                <IconButton
                  icon={<ChevronDown className="h-4 w-4" />}
                  onClick={moveHandler(props, 'columns', index, 'later')}
                />
                <IconButton
                  icon={<Minus className="h-4 w-4" />}
                  onClick={() =>
                    props.onChange((current) => ({
                      ...current,
                      columns: current.columns.filter((_, entryIndex) => entryIndex !== index),
                    }))
                  }
                />
              </div>
            </div>
            <div className="mt-3 space-y-3">
              <LabeledField label="Description">
                <Textarea
                  value={column.description}
                  onChange={(event) => updateColumn(props, index, 'description', event.target.value)}
                  className="min-h-[90px]"
                />
              </LabeledField>
              <ValidationText
                issue={props.showValidationErrors ? boardValidation.columnErrors[index]?.id : undefined}
              />
              <ValidationText
                issue={
                  props.showValidationErrors ? boardValidation.columnErrors[index]?.label : undefined
                }
              />
            </div>
          </div>
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

function OrchestratorSection(props: SectionProps): JSX.Element {
  return (
    <SectionCard
      id="playbook-orchestration-policy"
      title="Orchestration Policy"
      description="Optional overrides for concurrency and iteration limits. Leave these blank to inherit the system defaults."
    >
      <div className="grid gap-3 md:grid-cols-2">
        <LabeledField label="Max rework iterations">
          <Input
            value={props.draft.orchestrator.max_rework_iterations}
            placeholder="10"
            onChange={(event) =>
              updateOrchestrator(props, 'max_rework_iterations', event.target.value)
            }
          />
        </LabeledField>
        <LabeledField label="Task max iterations">
          <Input
            value={props.draft.orchestrator.max_iterations}
            placeholder="800"
            onChange={(event) => updateOrchestrator(props, 'max_iterations', event.target.value)}
          />
        </LabeledField>
        <LabeledField label="LLM retry attempts">
          <Input
            value={props.draft.orchestrator.llm_max_retries}
            placeholder="5"
            onChange={(event) => updateOrchestrator(props, 'llm_max_retries', event.target.value)}
          />
        </LabeledField>
        <LabeledField label="Max active tasks">
          <Input
            value={props.draft.orchestrator.max_active_tasks}
            placeholder="No cap"
            onChange={(event) => updateOrchestrator(props, 'max_active_tasks', event.target.value)}
          />
        </LabeledField>
        <LabeledField label="Max active tasks per work item">
          <Input
            value={props.draft.orchestrator.max_active_tasks_per_work_item}
            placeholder="No cap"
            onChange={(event) =>
              updateOrchestrator(props, 'max_active_tasks_per_work_item', event.target.value)
            }
          />
        </LabeledField>
        <LabeledField label="Allow parallel work items">
          <Select
            value={props.draft.orchestrator.allow_parallel_work_items || ORCHESTRATION_POLICY_UNSET}
            onValueChange={(value) =>
              updateOrchestrator(
                props,
                'allow_parallel_work_items',
                value === ORCHESTRATION_POLICY_UNSET ? '' : value,
              )
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Default (Enabled)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ORCHESTRATION_POLICY_UNSET}>Default (Enabled)</SelectItem>
              <SelectItem value="true">Enabled</SelectItem>
              <SelectItem value="false">Disabled</SelectItem>
            </SelectContent>
          </Select>
        </LabeledField>
      </div>
      <p className="text-sm text-muted">
        Leave fields blank to inherit the defaults: rework iterations `10`, task max iterations
        `800`, LLM retry attempts `5`, max active tasks `No cap`, max active tasks per work item
        `No cap`, parallel work items enabled.
      </p>
    </SectionCard>
  );
}

function IconButton(props: { icon: JSX.Element; onClick?: () => void }): JSX.Element {
  return (
    <Button type="button" variant="outline" size="icon" disabled={!props.onClick} onClick={props.onClick}>
      {props.icon}
    </Button>
  );
}

function moveHandler(
  props: SectionProps,
  key: 'stages' | 'columns' | 'parameters',
  index: number,
  direction: 'earlier' | 'later',
): (() => void) | undefined {
  const values =
    key === 'stages' ? props.draft.stages : key === 'columns' ? props.draft.columns : props.draft.parameters;
  if (!canMoveDraftItem(index, values.length, direction)) {
    return undefined;
  }
  if (key === 'stages') {
    return () =>
      props.onChange((current) => ({
        ...current,
        stages: moveDraftItem(current.stages, index, direction),
      }));
  }
  if (key === 'columns') {
    return () =>
      props.onChange((current) => ({
        ...current,
        columns: moveDraftItem(current.columns, index, direction),
      }));
  }
  return () =>
    props.onChange((current) => ({
      ...current,
      parameters: moveDraftItem(current.parameters, index, direction),
    }));
}

function updateStage(
  props: SectionProps,
  index: number,
  field: keyof StageDraft,
  value: string,
): void {
  props.onChange((current) => ({
    ...current,
    stages: current.stages.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ),
  }));
}

function updateColumn(
  props: SectionProps,
  index: number,
  field: keyof Omit<BoardColumnDraft, 'is_blocked' | 'is_terminal'>,
  value: string,
): void {
  props.onChange((current) => ({
    ...current,
    entry_column_id:
      field === 'id' && current.columns[index]?.id.trim() === current.entry_column_id.trim()
        ? value.trim()
        : current.entry_column_id,
    columns: current.columns.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ),
  }));
}

function updateEntryColumnSelection(
  props: SectionProps,
  value: string,
): void {
  props.onChange((current) => ({
    ...current,
    entry_column_id: resolveSelectedColumnId(current.columns, value),
  }));
}

function updateSemanticColumnSelection(
  props: SectionProps,
  field: 'is_blocked' | 'is_terminal',
  value: string,
): void {
  const selectedIndex = parseSelectedColumnIndex(value);
  props.onChange((current) => ({
    ...current,
    columns: current.columns.map((entry, entryIndex) => ({
      ...entry,
      [field]: selectedIndex !== null && entryIndex === selectedIndex,
    })),
  }));
}

function updateOrchestrator(
  props: SectionProps,
  field: keyof PlaybookAuthoringDraft['orchestrator'],
  value: string,
): void {
  props.onChange((current) => ({
    ...current,
    orchestrator: { ...current.orchestrator, [field]: value },
  }));
}

function updateParameter(
  props: SectionProps,
  index: number,
  field: keyof Omit<ParameterDraft, 'required'>,
  value: string,
): void {
  props.onChange((current) => ({
    ...current,
    parameters: current.parameters.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ),
  }));
}

function updateParameterTitle(
  props: SectionProps,
  index: number,
  value: string,
): void {
  props.onChange((current) => ({
    ...current,
    parameters: current.parameters.map((entry, entryIndex) => {
      if (entryIndex !== index) {
        return entry;
      }

      const nextSlug = normalizeParameterSlug(value);
      const currentSlug = entry.slug.trim();
      const priorTitleSlug = normalizeParameterSlug(entry.title);
      return {
        ...entry,
        title: value,
        slug: !currentSlug || currentSlug === priorTitleSlug ? nextSlug : entry.slug,
      };
    }),
  }));
}

function updateParameterBoolean(
  props: SectionProps,
  index: number,
  field: 'required',
  value: boolean,
): void {
  props.onChange((current) => ({
    ...current,
    parameters: current.parameters.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ),
  }));
}

function resolveRoleSelectionValue(
  value: string,
  availableRoleNames: string[],
  index: number,
): string {
  return availableRoleNames.includes(value) ? value : value.trim() ? resolveMissingRoleValue(index) : ROLE_SELECT_UNSET;
}

function resolveMissingRoleValue(index: number): string {
  return `__missing_role_${index}__`;
}

function ValidationText(props: { issue?: string }): JSX.Element | null {
  return props.issue ? (
    <p className="text-xs text-red-600 dark:text-red-400">{props.issue}</p>
  ) : null;
}

function buildBoardColumnSelectOptions(
  columns: BoardColumnDraft[],
): Array<{ value: string; label: string }> {
  return columns
    .map((column, index) => {
      const id = column.id.trim();
      if (!id) {
        return null;
      }
      const label = column.label.trim();
      return {
        value: String(index),
        label: label && label !== id ? `${label} (${id})` : label || id,
      };
    })
    .filter((option): option is { value: string; label: string } => option !== null);
}

function resolveEntryColumnSelectionValue(
  columns: BoardColumnDraft[],
  entryColumnId: string,
): string {
  const selectedIndex = columns.findIndex((column) => column.id.trim() === entryColumnId.trim());
  return selectedIndex >= 0 ? String(selectedIndex) : ENTRY_COLUMN_UNSET;
}

function resolveSemanticColumnSelectionValue(
  columns: BoardColumnDraft[],
  field: 'is_blocked' | 'is_terminal',
): string {
  const selectedIndex = columns.findIndex((column) => column.id.trim() && column[field]);
  return selectedIndex >= 0 ? String(selectedIndex) : ENTRY_COLUMN_UNSET;
}

function resolveSelectedColumnId(columns: BoardColumnDraft[], value: string): string {
  const selectedIndex = parseSelectedColumnIndex(value);
  if (selectedIndex === null) {
    return '';
  }
  return columns[selectedIndex]?.id.trim() ?? '';
}

function parseSelectedColumnIndex(value: string): number | null {
  if (value === ENTRY_COLUMN_UNSET) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
