import { ChevronDown, ChevronUp, Minus, Plus } from 'lucide-react';

import { Button } from '../../../components/ui/button.js';
import { Input } from '../../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select.js';
import { Textarea } from '../../../components/ui/textarea.js';
import { createEmptyColumnDraft, validateBoardColumnsDraft } from './playbook-authoring-support.js';
import { LabeledField, SectionCard } from './playbook-authoring-form-fields.js';
import {
  buildBoardColumnSelectOptions,
  moveHandler,
  resolveEntryColumnSelectionValue,
  resolveSemanticColumnSelectionValue,
  updateColumn,
  updateEntryColumnSelection,
  updateOrchestrator,
  updateSemanticColumnSelection,
} from './playbook-authoring-form-sections.state.js';
import {
  ENTRY_COLUMN_UNSET,
  IconButton,
  ORCHESTRATION_POLICY_UNSET,
  type SectionProps,
  ValidationText,
} from './playbook-authoring-form-sections.shared.js';

export function AdvancedWorkflowSection(props: SectionProps): JSX.Element {
  return (
    <div className="space-y-4">
      <BoardColumnsSection draft={props.draft} onChange={props.onChange} />
      <OrchestratorSection draft={props.draft} onChange={props.onChange} />
    </div>
  );
}

function BoardColumnsSection(props: SectionProps): JSX.Element {
  const boardValidation = validateBoardColumnsDraft(
    props.draft.columns,
    props.draft.entry_column_id,
  );
  const columnOptions = buildBoardColumnSelectOptions(props.draft.columns);
  const intakeValue = resolveEntryColumnSelectionValue(
    props.draft.columns,
    props.draft.entry_column_id,
  );
  const blockedValue = resolveSemanticColumnSelectionValue(props.draft.columns, 'is_blocked');
  const terminalValue = resolveSemanticColumnSelectionValue(props.draft.columns, 'is_terminal');
  const intakeOptions = columnOptions.filter(
    (option) =>
      option.value === intakeValue ||
      (option.value !== blockedValue && option.value !== terminalValue),
  );
  const blockedOptions = columnOptions.filter(
    (option) =>
      option.value === blockedValue ||
      (option.value !== intakeValue && option.value !== terminalValue),
  );
  const terminalOptions = columnOptions.filter(
    (option) =>
      option.value === terminalValue ||
      (option.value !== intakeValue && option.value !== blockedValue),
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
                onValueChange={(value) =>
                  updateSemanticColumnSelection(props, 'is_terminal', value)
                }
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
          <div
            key={`column-${index}`}
            className="rounded-xl border border-border/70 bg-card/60 p-4"
          >
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
                  onChange={(event) =>
                    updateColumn(props, index, 'description', event.target.value)
                  }
                  className="min-h-[90px]"
                />
              </LabeledField>
              <ValidationText
                issue={
                  props.showValidationErrors ? boardValidation.columnErrors[index]?.id : undefined
                }
              />
              <ValidationText
                issue={
                  props.showValidationErrors
                    ? boardValidation.columnErrors[index]?.label
                    : undefined
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
        `800`, LLM retry attempts `5`, max active tasks `No cap`, max active tasks per work item `No
        cap`, parallel work items enabled.
      </p>
    </SectionCard>
  );
}
