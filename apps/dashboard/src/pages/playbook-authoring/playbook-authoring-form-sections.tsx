import type { ReactNode } from 'react';
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
import { TypedParameterValueControl } from './playbook-authoring-structured-controls.js';

interface SectionProps {
  draft: PlaybookAuthoringDraft;
  onChange(updater: (current: PlaybookAuthoringDraft) => PlaybookAuthoringDraft): void;
}

const ROLE_SELECT_UNSET = '__unset__';
const ENTRY_COLUMN_UNSET = '__unset__';
const ORCHESTRATION_POLICY_UNSET = '__orchestration_policy_default__';
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
const WORKSPACE_MAPPING_OPTIONS = ['', 'workspace.credentials.git_token'];

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
        {roleValidation.selectionIssue ? (
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
                <div className="grid gap-2 text-sm lg:grid-cols-[6rem_minmax(0,1fr)] lg:items-start lg:gap-3">
                  <span className="font-medium lg:pt-2 lg:text-right">Stage name</span>
                  <div className="grid gap-2">
                    <Input
                      value={stage.name}
                      onChange={(event) => updateStage(props, index, 'name', event.target.value)}
                    />
                    <ValidationText issue={stageValidation.stageErrors[index]?.name} />
                  </div>
                </div>
                <div className="grid gap-2 text-sm lg:grid-cols-[6rem_minmax(0,1fr)] lg:items-start lg:gap-3">
                  <span className="font-medium lg:pt-2 lg:text-right">Stage goal</span>
                  <div className="grid gap-2">
                    <Input
                      value={stage.goal}
                      onChange={(event) => updateStage(props, index, 'goal', event.target.value)}
                    />
                    <ValidationText issue={stageValidation.stageErrors[index]?.goal} />
                  </div>
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start">
                <div className="flex items-center gap-2 lg:pt-1">
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
                <div className="grid gap-2 text-sm lg:grid-cols-[6rem_minmax(0,1fr)] lg:items-stretch lg:gap-3">
                  <span className="font-medium lg:pt-2 lg:text-right">Stage guidance</span>
                  <Textarea
                    value={stage.guidance}
                    onChange={(event) => updateStage(props, index, 'guidance', event.target.value)}
                    className="min-h-[110px] lg:h-full"
                    placeholder="Optional stage-specific guidance for the orchestrator."
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
        {stageValidation.blockingIssues.length > 0 && props.draft.stages.length === 0 ? (
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
      description="Define the operator inputs and optional workspace mappings available when the workflow starts."
    >
      <div className="space-y-4">
        {props.draft.parameters.map((parameter, index) => (
          <DraftCard
            key={`parameter-${index}`}
            moveEarlier={moveHandler(props, 'parameters', index, 'earlier')}
            moveLater={moveHandler(props, 'parameters', index, 'later')}
            onRemove={() =>
              props.onChange((current) => ({
                ...current,
                parameters: current.parameters.filter((_, entryIndex) => entryIndex !== index),
              }))
            }
          >
            <ParameterFields
              index={index}
              parameter={parameter}
              onChange={(field, value) => updateParameter(props, index, field, value)}
              onBooleanChange={(field, value) => updateParameterBoolean(props, index, field, value)}
              onParameterIssueChange={props.onParameterIssueChange}
            />
            <ValidationText issue={parameterValidation.parameterErrors[index]?.category} />
            <ValidationText issue={parameterValidation.parameterErrors[index]?.secret} />
            <ValidationText issue={parameterValidation.parameterErrors[index]?.maps_to} />
          </DraftCard>
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
  return (
    <SectionCard
      id="playbook-board-columns"
      title="Board Columns"
      description="Keep the board simple. Most playbooks should keep the standard intake, active, review, blocked, and done lanes."
    >
      <div className="space-y-4">
        <LabeledField label="Default intake column">
          <Select
            value={props.draft.entry_column_id || ENTRY_COLUMN_UNSET}
            onValueChange={(value) =>
              props.onChange((current) => ({
                ...current,
                entry_column_id: value === ENTRY_COLUMN_UNSET ? '' : value,
              }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose the default intake column" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ENTRY_COLUMN_UNSET}>Choose the default intake column</SelectItem>
              {props.draft.columns
                .map((column) => column.id.trim())
                .filter(Boolean)
                .map((columnId) => (
                  <SelectItem key={columnId} value={columnId}>
                    {columnId}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </LabeledField>
        {boardValidation.entryColumnError ? (
          <p className="text-xs text-red-600 dark:text-red-400">
            {boardValidation.entryColumnError}
          </p>
        ) : null}
        {props.draft.columns.map((column, index) => (
          <DraftCard
            key={`column-${index}`}
            moveEarlier={moveHandler(props, 'columns', index, 'earlier')}
            moveLater={moveHandler(props, 'columns', index, 'later')}
            onRemove={() =>
              props.onChange((current) => ({
                ...current,
                columns: current.columns.filter((_, entryIndex) => entryIndex !== index),
              }))
            }
          >
            <div className="grid gap-3 md:grid-cols-2">
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
            </div>
            <LabeledField label="Description">
              <Textarea
                value={column.description}
                onChange={(event) => updateColumn(props, index, 'description', event.target.value)}
                className="min-h-[90px]"
              />
            </LabeledField>
            <div className="flex flex-col gap-3 md:flex-row">
              <ToggleField
                label="Blocked lane"
                checked={column.is_blocked}
                onCheckedChange={(checked) => updateColumnBoolean(props, index, 'is_blocked', checked)}
              />
              <ToggleField
                label="Terminal lane"
                checked={column.is_terminal}
                onCheckedChange={(checked) => updateColumnBoolean(props, index, 'is_terminal', checked)}
              />
            </div>
            <ValidationText issue={boardValidation.columnErrors[index]?.id} />
            <ValidationText issue={boardValidation.columnErrors[index]?.label} />
          </DraftCard>
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
            placeholder="System default: 5"
            onChange={(event) =>
              updateOrchestrator(props, 'max_rework_iterations', event.target.value)
            }
          />
        </LabeledField>
        <LabeledField label="Task max iterations">
          <Input
            value={props.draft.orchestrator.max_iterations}
            onChange={(event) => updateOrchestrator(props, 'max_iterations', event.target.value)}
          />
        </LabeledField>
        <LabeledField label="LLM retry attempts">
          <Input
            value={props.draft.orchestrator.llm_max_retries}
            onChange={(event) => updateOrchestrator(props, 'llm_max_retries', event.target.value)}
          />
        </LabeledField>
        <LabeledField label="Max active tasks">
          <Input
            value={props.draft.orchestrator.max_active_tasks}
            placeholder="System default: 4"
            onChange={(event) => updateOrchestrator(props, 'max_active_tasks', event.target.value)}
          />
        </LabeledField>
        <LabeledField label="Max active tasks per work item">
          <Input
            value={props.draft.orchestrator.max_active_tasks_per_work_item}
            placeholder="System default: 2"
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
              <SelectValue placeholder="System default: enabled" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ORCHESTRATION_POLICY_UNSET}>System default: enabled</SelectItem>
              <SelectItem value="true">Enabled</SelectItem>
              <SelectItem value="false">Disabled</SelectItem>
            </SelectContent>
          </Select>
        </LabeledField>
      </div>
      <p className="text-sm text-muted">
        System defaults: rework iterations `5`, max active tasks `4`, max active tasks per work
        item `2`, parallel work items enabled.
      </p>
    </SectionCard>
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
        <Select value={props.parameter.type} onValueChange={(value) => props.onChange('type', value)}>
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
      <LabeledField label="Workspace mapping">
        <Select
          value={props.parameter.maps_to || ENTRY_COLUMN_UNSET}
          onValueChange={(value) => {
            props.onChange('maps_to', value === ENTRY_COLUMN_UNSET ? '' : value);
            props.onParameterIssueChange(props.index, 'mapping');
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Optional workspace mapping" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ENTRY_COLUMN_UNSET}>No workspace mapping</SelectItem>
            {WORKSPACE_MAPPING_OPTIONS.filter(Boolean).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </LabeledField>
      <LabeledField label="Category">
        <Select value={props.parameter.category || ENTRY_COLUMN_UNSET} onValueChange={(value) => props.onChange('category', value === ENTRY_COLUMN_UNSET ? '' : value)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PARAMETER_CATEGORY_OPTIONS.map((option) => (
              <SelectItem key={option.value || ENTRY_COLUMN_UNSET} value={option.value || ENTRY_COLUMN_UNSET}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </LabeledField>
      <LabeledField label="Description">
        <Input value={props.parameter.description} onChange={(event) => props.onChange('description', event.target.value)} />
      </LabeledField>
      <LabeledField label="Help text">
        <Input value={props.parameter.help_text} onChange={(event) => props.onChange('help_text', event.target.value)} />
      </LabeledField>
      <LabeledField label="Allowed values">
        <Input value={props.parameter.allowed_values} onChange={(event) => props.onChange('allowed_values', event.target.value)} />
      </LabeledField>
      <LabeledField label="Default value" className="md:col-span-2">
          <TypedParameterValueControl
            valueType={props.parameter.type}
            value={props.parameter.default_value}
            onChange={(nextValue) => props.onChange('default_value', nextValue)}
            onValidationChange={(issue?: string) =>
              props.onParameterIssueChange(props.index, 'default', issue)
            }
          />
      </LabeledField>
      <div className="flex flex-col gap-3 md:col-span-2 md:flex-row">
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
      </div>
    </div>
  );
}

function DraftCard(props: {
  children: ReactNode;
  moveEarlier?: () => void;
  moveLater?: () => void;
  onRemove(): void;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-card/60 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <IconButton icon={<ChevronUp className="h-4 w-4" />} onClick={props.moveEarlier} />
        <IconButton icon={<ChevronDown className="h-4 w-4" />} onClick={props.moveLater} />
        <IconButton icon={<Minus className="h-4 w-4" />} onClick={props.onRemove} />
      </div>
      <div className="space-y-3">{props.children}</div>
    </div>
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
    columns: current.columns.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ),
  }));
}

function updateColumnBoolean(
  props: SectionProps,
  index: number,
  field: 'is_blocked' | 'is_terminal',
  value: boolean,
): void {
  props.onChange((current) => ({
    ...current,
    columns: current.columns.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ),
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
  field: keyof Omit<ParameterDraft, 'required' | 'secret'>,
  value: string,
): void {
  props.onChange((current) => ({
    ...current,
    parameters: current.parameters.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ),
  }));
}

function updateParameterBoolean(
  props: SectionProps,
  index: number,
  field: 'required' | 'secret',
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
